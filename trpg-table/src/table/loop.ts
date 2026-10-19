import type { AppConfig } from '../config.js';
import type { AtlasClient } from '../atlas/client.js';
import { AtlasSync } from '../atlas/sync.js';
import type { Logs } from '../log.js';
import type { LLM } from '../llm/index.js';
import { RulesEngine, spawnMonster, type OpportunityOutcome } from '../rules/engine.js';
import { MONSTERS } from '../rules/data/monsters.js';
import { SPELLS } from '../rules/data/spells.js';
import { USABLE_FEATURES } from '../rules/features/registry.js';
import { WEAPONS } from '../rules/data/weapons.js';
import { CONDITION_ZH, type Actor, type AttackOptions, type RollResult, type RollSource } from '../rules/types.js';
import { atomicWriteJson, clip, readJsonIfExists, sleep, uuid } from '../util.js';
import type { Adventure, AdventureScene } from './content.js';
import { EventBus, type TableEvent } from './events.js';
import { GameMaster, type GmTurnInput, type GmTurnResult, type GmWorld } from './gm.js';
import { runPlayerTurn } from './player.js';
import { runRenderer } from './renderer.js';
import { statusTags } from './statusTags.js';
import { SuggestionQueue, type SuggestionAdd } from './suggestions.js';
import { buildPlayerView } from './view.js';
import { readBuildSpec } from './characters.js';
import { RoundClock, cadenceText, nextFireRound, type WorldSlot } from './roundClock.js';
import { CampaignMemory } from './memory.js';
import { SceneProgress } from './sceneProgress.js';
import { runDirector, type DirectorInput, type DirectorOutput } from './director.js';
import { lootLine } from './loot.js';
import { coinChip, describeInventory, inventoryOf } from '../rules/inventory.js';
import type { SpeechService } from '../tts/speech.js';
import { levelUpActor } from './progress.js';
import { featureInfo } from '../rules/build/index.js';
import { levelForXp, nextLevelXp, type XpAward } from '../rules/xp.js';
import {
  PLAYER_SEATS,
  type PlayerDecision,
  type SeatKey,
  type TablePhase,
  type TableSnapshot,
  type TranscriptEntry,
  type TurnRecord,
  type TurnUsageRecord,
} from './types.js';
import { join } from 'node:path';

/** 全员倒下后给 GM 的提示：战斗没有胜负，怎么收场由 GM 裁定。 */
const defeatNote =
  '战斗以全员倒下收场：PC 们昏迷或濒死，怪物还在场。GM：用 narrate 收尾（怪物可能抢走东西、抓走他们、或者以为他们死了就离开），需要时用 stabilize 维稳，之后用 rest 休息。不要凭空让他们醒来。';

export interface TableLoopOptions {
  config: AppConfig;
  llm: LLM;
  logs: Logs;
  adventure: Adventure;
  characters: Record<SeatKey, Actor>;
  rollSource: RollSource;
  atlas?: AtlasClient;
  dryRun: boolean;
  /** overlay 页面地址（iframe 里的演出框）；不填就用 8099 默认值。 */
  frameUrl?: string;
  /** 从 state/table.json 恢复（默认 true） */
  resume?: boolean;
}

export interface LinkStatus {
  game: 'trpg';
  online: boolean;
  paused: boolean;
  planner: { thinking: boolean; executing: { tool: string; params: Record<string, unknown> } | null; pending: number; givenUp: boolean };
  lastCommand: { text: string; at: number } | null;
  latestEventSeq: number;
  table: {
    phase: TablePhase;
    round: number;
    turn: string | null;
    scene: string;
    sceneId: string;
    sceneIndex: number;
    /** 旁白 / 角色的配音还在出声（估计）；Helixus 的页面据此等一等再开口，不和它们叠着说 */
    speaking: boolean;
    players: { seat: SeatKey; name: string; hp: number; maxHp: number; expression: string; thinking: boolean }[];
  };
  control: { paused: boolean; mode: 'agent' | 'dry-run' };
}

type ActionExecution = { ok: boolean; summary: string; rolls: RollResult[]; errors: string[] };

export class TableLoop implements GmWorld {
  readonly engine: RulesEngine;
  readonly bus: EventBus;
  readonly suggestions: SuggestionQueue;
  readonly adventure: Adventure;
  readonly characters: Record<SeatKey, Actor>;
  readonly transcript: TranscriptEntry[] = [];
  readonly history: TurnRecord[] = [];
  readonly visibleActorIds = new Set<string>();
  scene: AdventureScene;
  sceneIndex = 0;
  phase: TablePhase = 'explore';
  /** 回合计：第几轮、本轮谁行动过、环境条目。探索和战斗共用 */
  readonly clock = new RoundClock();
  /** 战役记忆：前几幕的前情 + GM 登记的世界事实，进存档，进 GM 和玩家的提示 */
  readonly memory = new CampaignMemory();
  /** 这一幕里桌面客观记下的事（升级、拿到的东西…），幕结束时进前情 */
  private sceneLog: string[] = [];
  /** 这一幕的进度：节拍、自动出口规则、已经满足正在等收尾的出口 */
  readonly progress = new SceneProgress();
  /** 进度导演最近一次给 GM 的指令（只在最近两轮内有效） */
  private directorOrders: { push: string; drift: string[]; stalled: boolean; revealed: string[]; round: number } | null = null;
  private lastDirectorRound = 0;
  /** 已经发出去的战利品（`${场景 id}:${loot id}`），GM 的清单里标「已发」 */
  readonly lootTaken = new Set<string>();

  readonly gm: GameMaster;
  /** 配音（旁白 + 两个角色）；main.ts 在 init 之前 attachSpeech，没开就是 undefined */
  speech?: SpeechService;
  readonly atlas?: AtlasClient;
  readonly dryRun: boolean;
  private readonly statePath: string;
  private paused: boolean;
  private stopped = false;
  private running: Promise<void> | null = null;
  private currentSeat: SeatKey | null = null;
  private lastAskPrompt: string | null = null;
  private pendingNote: string | null = null;
  private gmSteps = 0;
  private lastMonsterId: string | null = null;
  private monsterSteps = 0;
  private saving: Promise<void> = Promise.resolve();
  /** 正在进行的世界回合：还没登记完的位子靠 clock.worldDone 对出来 */
  private worldPending: WorldSlot[] | null = null;
  private sceneEndRequest: { summary: string; nextSceneId?: string; publicRecap?: string } | null = null;
  private gameEndSummary: string | null = null;
  private sceneIntroPending = true;
  private ended = false;
  private thinking = false;
  private executing: { tool: string; params: Record<string, unknown> } | null = null;
  private lastCommand: { text: string; at: number } | null = null;
  private expressions: Record<SeatKey, string> = { player_a: 'neutral', player_b: 'neutral' };
  private readonly lastThought = new Map<SeatKey, Record<string, unknown>>();
  private readonly lastDecision = new Map<SeatKey, Record<string, unknown>>();
  private readonly rendererStats: Record<SeatKey, { total: number; timeouts: number }> = {
    player_a: { total: 0, timeouts: 0 },
    player_b: { total: 0, timeouts: 0 },
  };
  private waitingForResume: (() => void)[] = [];
  private startedAt = Date.now();
  private readonly sync?: AtlasSync;
  private combatSynced = false;

  constructor(private readonly opts: TableLoopOptions) {
    this.adventure = opts.adventure;
    this.characters = opts.characters;
    this.dryRun = opts.dryRun;
    this.atlas = opts.atlas;
    this.scene = this.adventure.scenes[0];
    this.clock.loadScene(this.scene.environment ?? []);
    this.progress.loadScene(this.scene.beats, this.scene.autoExit);
    this.engine = new RulesEngine({ rollSource: opts.rollSource });
    this.engine.setMapInfo(this.scene.mapInfo);
    for (const seat of PLAYER_SEATS) {
      this.engine.addActor(this.characters[seat]);
      this.visibleActorIds.add(seat);
    }
    this.engine.ensurePositions();
    this.engine.placeParty();
    this.bus = new EventBus();
    this.suggestions = new SuggestionQueue(opts.config.table);
    this.paused = opts.config.table.startPaused;
    this.statePath = join(opts.config.paths.state, 'table.json');
    this.gm = new GameMaster(opts.llm, opts.config, this);
    if (this.atlas && !this.dryRun) {
      this.sync = new AtlasSync(this.atlas, this.engine, opts.logs, opts.config.paths.campaignVault, {
        stateDir: opts.config.paths.state,
        isVisible: (actorId) => this.visibleActorIds.has(actorId),
      });
    }
  }

  // ---------------------------------------------------------------- GmWorld
  setPhase(phase: TablePhase): void {
    this.phase = phase;
  }

  reveal(actorIds: string[]): void {
    for (const id of actorIds) this.visibleActorIds.add(id);
  }

  /** GM 的 next_turn 只推进了规则层；这里把 Atlas 先攻游标也对齐到当前行动者。 */
  async syncTurn(): Promise<void> {
    if (!this.sync) return;
    try {
      await this.sync.nextTurn();
    } catch (e) {
      this.opts.logs.trace(`Atlas 先攻同步失败：${(e as Error).message}`);
    }
  }

  /**
   * 剧本遭遇里的生物一进场就生成（按地图信息里的出场格）：标了 [可见] 的（拴着的狼、看守的 NPC）玩家看得见，地图上有 pin；
   * 没标的（伏兵、哨兵）也已经在场上，只是**藏着**——Atlas 里是隐藏 token，玩家看不见。GM 用 reveal_area、进度导演用 reveal 让它们现身，
   * 现身的那一刻地图上才出现 pin（以前要等 start_combat 才生成，叙述里哨兵都探出头了地图上还什么都没有）。
   * 它们都不在先攻里；GM 之后 start_combat 写同一个 monster_id 就是把它们拉进战斗（不会多出一份）。
   * 已经有同名活物 / 打倒了还没清场的（存档里的）不重复生成，所以进场、读档、换场景都可以调。
   */
  private ensureSceneCreatures(): void {
    // 这个种类场上已经有几只（活的死的都算，打倒了还没清场的也算）：GM 开战时自己起了名字生成的（「哨兵甲」），
    // 名字对不上剧本里的，只按名字去重会再补一份。所以按「种类 + 数量」认：剧本要 N 只，场上已有 M 只，就只补 N − M 只。
    const have = new Map<string, number>();
    for (const a of this.engine.actors.values()) {
      if (a.kind !== 'monster') continue;
      const id = a.id.split(':')[0];
      have.set(id, (have.get(id) ?? 0) + 1);
    }
    const placed = new Map<string, number>();
    for (const entry of this.scene.encounter) {
      if (!MONSTERS[entry.monsterId]) continue;
      for (let i = 0; i < entry.count; i++) {
        const ordinal = placed.get(entry.monsterId) ?? 0;
        placed.set(entry.monsterId, ordinal + 1);
        if (ordinal < (have.get(entry.monsterId) ?? 0)) continue;
        const baseName = entry.name ?? MONSTERS[entry.monsterId].name;
        const name = entry.count > 1 ? `${baseName}${i + 1}` : baseName;
        if ([...this.engine.actors.values()].some((a) => a.kind === 'monster' && a.name === name)) continue;
        const actor = spawnMonster(entry.monsterId, name);
        const cell = this.engine.spawnCellFor(actor, entry.monsterId, i);
        if (cell) actor.position = cell;
        this.engine.addActor(actor);
        if (entry.visible) this.visibleActorIds.add(actor.id);
      }
    }
    this.engine.ensurePositions(); // 剧本没给出场格的，补一个默认格（不会没有位置、也就不会没有 pin）
  }

  requestSceneEnd(summary: string, nextSceneId?: string, publicRecap?: string): void {
    this.sceneEndRequest = { summary, nextSceneId, publicRecap };
    this.transcript.push({ at: Date.now(), kind: 'event', text: `场景结束：${summary}` });
  }

  endGame(summary: string, publicRecap?: string): void {
    this.gameEndSummary = summary;
    this.sceneEndRequest = { summary, publicRecap };
  }

  // ---------------------------------------------------------------- 生命周期
  async init(): Promise<void> {
    const resumed = this.opts.resume !== false ? await this.restore() : false;
    if (!resumed) {
      this.scene = this.adventure.scenes[0];
      this.sceneIndex = 0;
      this.engine.setMapInfo(this.scene.mapInfo);
      this.clock.loadScene(this.scene.environment ?? []);
      this.progress.loadScene(this.scene.beats, this.scene.autoExit);
      this.publishScene();
      this.opts.logs.trace(`新桌面：${this.adventure.title} / ${this.scene.title}`);
    } else {
      this.opts.logs.trace(`从存档恢复：${this.adventure.title} / ${this.scene.title}（场景 ${this.sceneIndex + 1}）`);
    }
    this.ensureSceneCreatures();
    this.publishState('桌面就绪');
    this.save();
    if (this.sync) {
      try {
        await this.sync.openScene(this.scene.map);
        await this.sync.cleanupOrphanMonsters();
        if (!resumed) {
          // --fresh / 新桌面：上一场的先攻和迷雾不能留在地图上
          await this.sync.resetInitiative();
          await this.sync.clearFog();
        }
        await this.sync.syncAll(this.visibleActorIds);
        // 座位换了角色：先攻条里按旧名字建的条目作废（从存档恢复时上面那次重置不会走）
        if (this.sync.takeRenamed() > 0 && resumed) await this.sync.resetInitiative();
        await this.syncActors();
        await this.applyPlayerFrame();
      } catch (e) {
        this.bus.publish('system', `Atlas 同步失败：${clip((e as Error).message, 120)}`, 'soon');
      }
    }
  }

  attachSpeech(speech: SpeechService): void {
    this.speech = speech;
  }

  start(): void {
    if (this.running) return;
    this.running = this.loop();
    this.opts.logs.trace(
      `TableLoop 启动：${this.paused ? '暂停中（等页面 Ctrl+Alt+K）' : '运行中'}，` +
        `${this.dryRun ? 'dry-run（不连 Atlas）' : 'Atlas 已连接'}`
    );
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.setPaused(false);
    await this.running?.catch(() => undefined);
    await this.clearPlayerFrame();
    this.save();
    await this.flushSave();
  }

  private async loop(): Promise<void> {
    while (!this.stopped) {
      if (this.paused) {
        await new Promise<void>((resolve) => this.waitingForResume.push(resolve));
        continue;
      }
      const t0 = Date.now();
      try {
        await this.step();
      } catch (e) {
        const msg = `${(e as Error).name}: ${(e as Error).message}`;
        this.opts.logs.trace(`step 出错：${msg}`);
        this.bus.publish('system', `桌面出错：${clip(msg, 160)}`, 'soon');
        this.opts.logs.table.record({ kind: 'step_error', error: msg });
        await sleep(2000);
      }
      const elapsed = Date.now() - t0;
      if (elapsed < 400) await sleep(400 - elapsed);
    }
  }

  private async step(): Promise<void> {
    if (this.ended) return;
    if (this.sceneEndRequest) {
      await this.applySceneEnd();
      return;
    }
    const combat = this.engine.combat;
    if (combat.active) {
      this.enterCombatClock();
      // GM 的 next_turn 在它自己那一步里把先攻转了一圈：补上环境的世界回合，桌面轮 +1
      if (await this.settleCombatRounds()) return;
      const cur = this.engine.currentActor();
      if (!cur) {
        this.engine.endCombat();
        this.phase = 'explore';
        return;
      }
      if (cur.kind === 'monster') {
        // 同一个怪物的同一个回合里 GM 反复没推进才算“拖太久”；换了回合 / 换了怪物就重新数
        const turnKey = `${combat.round}:${cur.id}`;
        if (this.lastMonsterId === turnKey) this.monsterSteps += 1;
        else {
          this.lastMonsterId = turnKey;
          this.monsterSteps = 0;
        }
        if (this.monsterSteps >= 2) {
          this.bus.publish('system', `${cur.name} 的回合拖了太久，桌面自动轮到下一位。`, 'soon');
          await this.passTurn();
          this.monsterSteps = 0;
          this.lastMonsterId = null;
          return;
        }
        await this.runGm({ mode: 'monster', monsterId: cur.id });
        await this.afterGmTurn();
        return;
      }
      if (cur.seat) {
        await this.runPlayer(cur.seat as SeatKey);
        return;
      }
      await this.runGm({ mode: 'normal' });
      await this.afterGmTurn();
      return;
    }
    this.leaveCombatClock();
    this.checkSceneExit();
    if (this.currentSeat) {
      await this.runPlayer(this.currentSeat);
      return;
    }
    // 探索：所有能动的 PC 这一轮都行动过了，这一步的 GM 要顺带处理世界回合（场上的生物 + 到点的环境），然后关轮
    const worldRound = !this.sceneIntroPending && this.explorationRoundComplete();
    const slots = worldRound ? this.worldSlots() : [];
    this.worldPending = worldRound ? slots : null;
    await this.runGm({
      mode: this.sceneIntroPending ? 'opening' : 'normal',
      note: this.pendingNote ?? undefined,
      ...(slots.length ? { world: slots } : {}),
    });
    this.pendingNote = null;
    if (worldRound) await this.closeExplorationRound(slots);
    this.worldPending = null;
    if (worldRound) await this.maybeRunDirector();
    await this.afterGmTurn();
  }

  // ---------------------------------------------------------------- 回合计
  private canTakeTurn(seat: SeatKey): boolean {
    const a = this.engine.get(seat);
    return !!a && !a.deathSaves.dead && a.hp > 0;
  }

  /** 回合计认为下一个该行动的 PC：本轮还没动的第一位；本轮都动过了，就是下一轮的第一位。 */
  expectedSeat(): SeatKey | null {
    const eligible = (s: SeatKey) => this.canTakeTurn(s);
    return this.clock.nextSeat(eligible) ?? PLAYER_SEATS.find(eligible) ?? null;
  }

  /** 探索一轮的 PC 部分走完了：能动的 PC 都行动过（或者一个能动的都没有）。 */
  private explorationRoundComplete(): boolean {
    return this.clock.nextSeat((s) => this.canTakeTurn(s)) === null;
  }

  /** 这一轮的世界回合：场上还活着的非 PC 生物（战斗外），加上到点的环境条目。 */
  private worldSlots(opts: { combat?: boolean } = {}): WorldSlot[] {
    const out: WorldSlot[] = [];
    if (!opts.combat) {
      for (const a of this.engine.actors.values()) {
        if (a.kind === 'pc' || a.hp <= 0 || a.deathSaves.dead) continue;
        out.push({ id: a.id, name: a.name, kind: 'creature', detail: this.creatureDetail(a), secret: !this.visibleActorIds.has(a.id) });
      }
    }
    for (const e of this.clock.dueEnv()) {
      out.push({ id: e.id, name: e.name, kind: 'env', detail: `${cadenceText(e)}：${e.effect}`, secret: e.secret });
    }
    return out;
  }

  private creatureDetail(a: Actor): string {
    const where = a.position ? this.engine.describeCell(a.position) : '位置未知';
    const near = this.engine
      .party()
      .filter((p) => p.position && a.position && p.hp > 0)
      .map((p) => ({ p, feet: this.engine.distanceFeet(p.position!, a.position!) }))
      .sort((x, y) => x.feet - y.feet)[0];
    const cond = a.conditions.length ? `，状态：${a.conditions.map((c) => CONDITION_ZH[c.name]).join('、')}` : '';
    return `${where}${near ? `，离 ${near.p.name} ${near.feet} 尺` : ''}${cond}`;
  }

  /** 世界回合里还没登记的位子（GM 的 ask_player 要等它清空）。 */
  worldRemaining(): WorldSlot[] {
    return (this.worldPending ?? []).filter((s) => !this.clock.worldDone.has(s.id));
  }

  /** GM 的 world_act：登记一个位子这一轮做了什么。 */
  actWorld(ref: string, did: string, secret: boolean): { ok: boolean; text: string } {
    const pending = this.worldPending ?? [];
    // 模型有时会把清单里的写法整串抄进来（「[world:wolf:饿狼]」「world:env:1」「id=env:1」）：先剥掉
    const want = ref
      .trim()
      .replace(/^[\[【(（]+|[\]】)）]+$/g, '')
      .replace(/^(?:world:|id=|id:)/i, '')
      .trim();
    const slot =
      pending.find((s) => s.id === want || s.name === want) ??
      pending.find((s) => s.id.toLowerCase().includes(want.toLowerCase()) || s.name.includes(want));
    if (!slot) {
      const list = pending.map((s) => `${s.name}（${s.id}）`).join('、');
      return { ok: false, text: pending.length ? `这一轮的世界回合里没有「${ref}」。清单：${list}` : '现在不是世界回合，不用登记。' };
    }
    if (this.clock.worldDone.has(slot.id)) return { ok: false, text: `${slot.name} 这一轮已经登记过了。` };
    this.recordWorldAct(slot, { did: clip(did.trim() || '没动静', 160), secret: secret || slot.secret, auto: false });
    const rest = this.worldRemaining();
    if (rest.length) return { ok: true, text: `已登记。还剩：${rest.map((s) => `${s.name}（${s.id}）`).join('、')}` };
    return {
      ok: true,
      text: this.engine.combat.active
        ? '本轮世界回合全部登记完了，这一步到此为止（不用 next_turn，也不用 ask_player）。'
        : '本轮世界回合全部登记完了。现在可以 ask_player 把行动权交给下一轮的第一位。',
    };
  }

  private recordWorldAct(slot: WorldSlot, rec: { did: string; secret: boolean; auto: boolean }): void {
    if (!this.clock.register(slot.id, rec)) return;
    // 桌面替 GM 记的“没动静”不是事件，不上总线；玩家看不到的（秘密环境、藏着的生物）事件里不带名字和内容
    if (!rec.auto) {
      if (!rec.secret) this.transcript.push({ at: Date.now(), kind: 'event', text: `[第 ${this.clock.round} 轮] ${slot.name}：${rec.did}` });
      this.bus.publish(
        'world',
        rec.secret ? '暗处有动静' : `${slot.name}：${rec.did}`,
        'later',
        rec.secret
          ? { id: slot.id, kind: slot.kind, round: this.clock.round, secret: true }
          : { id: slot.id, name: slot.name, kind: slot.kind, round: this.clock.round, secret: false }
      );
    }
    this.publishState();
  }

  /** GM 没登记的位子，桌面替它记一个“没动静”：每个位子每一轮都一定有一条记录。 */
  private autoPassWorld(slots: readonly WorldSlot[]): void {
    for (const s of slots) {
      if (this.clock.worldDone.has(s.id)) continue;
      this.recordWorldAct(s, { did: '没动静', secret: true, auto: true });
      this.opts.logs.trace(`世界回合：GM 没有处理「${s.name}」，桌面记为没动静`);
    }
  }

  /** 探索的一轮结束：补登记没处理的位子 → 持续时间走一格 → 轮数 +1。GM 这一步里开了战斗就不关（战斗自己的轮接管）。 */
  private async closeExplorationRound(slots: readonly WorldSlot[]): Promise<void> {
    if (this.engine.combat.active) {
      this.clock.acted.clear();
      this.clock.worldDone.clear();
      return;
    }
    this.autoPassWorld(slots);
    this.engine.advanceExplorationRound();
    this.advanceClock('探索');
  }

  /** 轮数 +1，并让桌面、GM 的记录和观众都看到“新的一轮”。 */
  private advanceClock(kind: '探索' | '战斗'): void {
    const closed = this.clock.round;
    const next = this.clock.closeRound();
    this.bus.publish('round', `第 ${next} 轮`, 'soon', { round: next, closed, kind, roster: this.rosterState() });
    this.opts.logs.trace(`回合计：第 ${closed} 轮结束（${kind}）→ 第 ${next} 轮`);
    this.publishState();
  }

  /** 战斗刚开始：回合计记下战斗轮号，探索那一轮没走完的记录作废。 */
  private enterCombatClock(): void {
    if (this.clock.combatSeen !== 0) return;
    this.clock.combatSeen = this.engine.combat.round;
    this.clock.acted.clear();
    this.clock.worldDone.clear();
    this.opts.logs.trace(`回合计：战斗开始，桌面第 ${this.clock.round} 轮`);
  }

  /** 战斗结束回到探索：桌面轮 +1（战斗用掉了时间），新的一轮从头数谁行动。 */
  private leaveCombatClock(): void {
    if (this.clock.combatSeen === 0) return;
    this.clock.combatSeen = 0;
    this.advanceClock('战斗');
  }

  /**
   * 战斗轮结束的处理。引擎的战斗轮数涨了，说明上一个战斗轮的最后一个人行动完了：
   * 到点的环境条目这时各动一次（生物已经在先攻里，不重复），然后桌面轮 +1。返回 true = 这一步做了事。
   */
  private async settleCombatRounds(): Promise<boolean> {
    let did = false;
    while (this.engine.combat.active && this.engine.combat.round > this.clock.combatSeen) {
      did = true;
      const slots = this.worldSlots({ combat: true });
      if (slots.length) {
        this.worldPending = slots;
        await this.runGm({ mode: 'world', world: slots });
        await this.speech?.idle();
        this.autoPassWorld(slots);
        this.worldPending = null;
        if (!this.engine.combat.active) break; // 世界回合里战斗结束了
      }
      this.clock.combatSeen += 1;
      this.advanceClock('战斗');
    }
    if (did) this.save();
    return did;
  }

  private async afterGmTurn(): Promise<void> {
    // 旁白的声音还没念完就先别往下走（下一步是玩家说话或怪物行动）；最多等 wait_cap_ms
    await this.speech?.idle();
    this.sceneIntroPending = false;
    this.gmSteps += 1;
    if (!this.engine.combat.active && this.combatSynced) {
      this.combatSynced = false;
      await this.sync?.endCombat();
    }
    await this.syncCombatIfNeeded();
    await this.syncActors();
    if (this.engine.combat.active) {
      // 由下一步根据先攻决定是怪物还是玩家
      this.save();
      return;
    }
    if (this.currentSeat) {
      this.gmSteps = 0;
      this.save();
      return;
    }
    if (this.gmSteps >= 3) {
      const seat = this.expectedSeat() ?? this.nextPlayerSeat();
      this.currentSeat = seat;
      this.gmSteps = 0;
      this.bus.publish('system', `GM 连续几步没有交出行动权，桌面先轮到 ${this.characters[seat].name}。`, 'soon');
    }
    this.save();
  }

  private async syncCombatIfNeeded(): Promise<void> {
    if (!this.sync || !this.engine.combat.active || this.combatSynced) return;
    this.combatSynced = true;
    await this.sync
      .startCombat(this.engine.combat.order.map((o) => ({ actorId: o.actorId, initiative: o.initiative })))
      .catch((e) => this.opts.logs.trace(`Atlas 战斗同步失败：${(e as Error).message}`));
  }

  private async syncActors(): Promise<void> {
    if (!this.sync) return;
    for (const actor of this.engine.actors.values()) {
      // 倒下的怪物也要写 0 HP 到 Atlas，否则地图上会停在被击杀前的血量
      await this.sync
        .syncActor(actor, this.visibleActorIds)
        .catch((e) => this.opts.logs.trace(`Atlas 同步失败（${actor.name}）：${(e as Error).message}`));
    }
  }

  /** 把 Atlas 玩家窗口变成 1920x1080 的演出框：地图在中间，左右角色栏，底部 GM 叙述。 */
  private async applyPlayerFrame(forceReload = false): Promise<void> {
    if (!this.atlas || this.dryRun) return;
    const url = this.opts.frameUrl ?? 'http://127.0.0.1:8099/overlay?bg=transparent';
    const insets = this.opts.config.overlay.frame.insets;
    const canvas = this.opts.config.overlay.canvas;
    try {
      const r = await this.atlas.callJson<Record<string, unknown>>('atlas_player_frame', {
        enabled: true,
        url,
        insets,
        hideAtlasInitiative: true,
        hideAtlasDice: true,
        size: { w: canvas.width, h: canvas.height },
        reload: forceReload,
      });
      this.opts.logs.trace(
        `演出框：${String((r as { contentSize?: unknown })?.contentSize ? JSON.stringify((r as { contentSize?: unknown }).contentSize) : '已应用')}`
      );
    } catch (e) {
      this.bus.publish('system', `演出框没打开：${clip((e as Error).message, 160)}`, 'soon');
      this.opts.logs.trace(`atlas_player_frame 失败：${(e as Error).message}`);
    }
  }

  private async clearPlayerFrame(): Promise<void> {
    if (!this.atlas || this.dryRun) return;
    try {
      await this.atlas.callJson('atlas_player_frame', { enabled: false });
    } catch {
      /* 退出时 Atlas 可能已经关了 */
    }
  }

  /** overlay 服务起来后重新注入一次演出框（强制重载 iframe，否则首次 8099 未监听的错误页会留着）。 */
  async refreshFrame(): Promise<void> {
    await this.applyPlayerFrame(true);
  }

  // ---------------------------------------------------------------- GM
  private async runGm(input: GmTurnInput): Promise<GmTurnResult> {
    this.executing = { tool: input.mode === 'monster' ? '怪物回合' : 'GM 叙述', params: {} };
    this.bus.publish('thinking', input.mode === 'monster' ? `${this.engine.currentActor()?.name ?? '怪物'} 正在行动…` : 'GM 正在推进剧情…', 'later');
    const t0 = Date.now();
    const result = await this.gm.runTurn(input);
    this.executing = null;
    this.opts.logs.table.record({
      kind: 'gm_turn',
      mode: input.mode,
      note: input.note ?? null,
      narration: result.narration,
      askedSeat: result.askedSeat,
      sceneEnded: result.sceneEnded,
      toolCalls: result.toolCalls,
      usage: result.usage,
      latencyMs: result.latencyMs,
      model: result.model,
    });
    this.opts.logs.trace(
      `GM（${input.mode}）${Date.now() - t0}ms：${result.toolCalls.map((c) => c.name).join(' → ') || '（无工具）'}` +
        (result.askedSeat ? `，交给 ${result.askedSeat}` : '')
    );
    if (result.askedSeat) {
      // 探索按回合计走：GM 点的人要是不是下一位（比如已经行动过了），改成回合计认的那位。战斗按先攻，不走这里
      const expected = this.engine.combat.active ? null : this.expectedSeat();
      const seat = expected ?? result.askedSeat;
      let prompt = result.askedPrompt ?? null;
      if (seat !== result.askedSeat) {
        const skipped = this.characters[result.askedSeat]?.name ?? result.askedSeat;
        prompt = `${prompt ?? ''}（第 ${this.clock.round} 轮：${skipped} 这一轮已经行动过了，这一步轮到你；可以接着眼前正在发生的事做你自己想做的）`.trim();
        this.opts.logs.trace(`回合计：GM 想交给 ${result.askedSeat}，改成 ${seat}`);
      }
      this.currentSeat = seat;
      this.lastAskPrompt = prompt;
      this.gmSteps = 0;
      this.bus.publish('turn', `轮到 ${this.characters[seat]?.name ?? seat}（${prompt ?? ''}）`, 'soon', {
        seat,
        prompt,
        round: this.clock.round,
      });
    }
    if (result.sceneEnded) this.gmSteps = 0;
    if (!this.engine.combat.active && input.mode === 'normal') this.noteExitProgress(result.sceneEnded);
    return result;
  }

  // ---------------------------------------------------------------- 玩家
  private async runPlayer(seat: SeatKey): Promise<void> {
    this.currentSeat = null;
    const actor = this.engine.require(seat);
    // 战斗外的回合开始：动作、附赠动作、反应、移动恢复（战斗里由先攻推进时重置）
    this.engine.beginExplorationTurn(seat);
    this.bus.publish('thinking', `${actor.name} 正在思考…`, 'later', { seat, thinking: true, expression: 'thinking' });
    this.thinking = true;
    this.executing = { tool: '玩家思考', params: { seat } };
    const started = Date.now();

    const ownRecent = this.history
      .filter((h) => h.seat === seat)
      .slice(-3)
      .map((h) => `你说：「${h.decision.say}」；做：${this.actionText(h.decision)}`);
    const other = this.otherSeat(seat);
    const otherSays = this.history
      .filter((h) => h.seat === other)
      .slice(-5)
      .map((h) => `${this.characters[other].name}说：「${h.decision.say}」`);

    const view = buildPlayerView({
      engine: this.engine,
      selfId: seat,
      visibleActorIds: this.visibleActorIds,
      sceneTitle: this.scene.title,
      phase: this.phase,
      round: this.engine.combat.round,
      roundLine: this.roundLineFor(seat),
      memoryText: this.memory.playerBlock(),
      gmNarration: this.lastGmNarration(),
      publicEvents: this.publicEventLines(),
      otherPlayerSays: otherSays,
      legalActions: this.engine.legalActions(seat),
      inCombat: this.engine.combat.active,
      mapInfo: this.scene.mapInfo,
      turnNote: this.lastAskPrompt
        ? `GM：${this.lastAskPrompt}`
        : this.engine.combat.active
          ? '先攻轮到你了。'
          : undefined,
    });
    this.lastAskPrompt = null;

    const result = await runPlayerTurn(this.opts.llm, this.opts.config, {
      seat,
      actor,
      persona: actor.persona ?? this.characters[seat].persona ?? '',
      viewText: view.text,
      otherPlayerName: this.characters[other].name,
      ownRecentLines: ownRecent,
    }).finally(() => {
      this.thinking = false;
      this.executing = null;
    });

    // 台词一确定就开始合成：后面还有看点渲染和 tThought / tBetween 的等待，合成基本赶在气泡出现之前就好了
    const spoken = this.speech?.prepare(seat, result.decision.say) ?? null;
    this.expressions[seat] = result.decision.expression;
    if (this.opts.config.overlay.tokenExpressions && this.sync) {
      await this.sync.setTokenExpression(seat, result.decision.expression).catch((e) => {
        this.opts.logs.trace(`换棋子表情失败：${(e as Error).message}`);
      });
    }
    this.bus.publish('state', `${actor.name} 的表情：${result.decision.expression}`, 'later', {
      players: this.playerStates(),
      activeSeat: seat,
    });

    // 看点：预算放宽到 7 秒（Gemini 的思考摘要常常超过旧版 3 秒）；超时也出一行小字，不留空框
    const renderer = await runRenderer(this.opts.llm, this.opts.config, {
      seatName: actor.name,
      aliases: actor.aliases ?? [],
      reasoning: result.reasoning ?? '',
      reasoningKind: result.reasoningKind,
      decision: result.decision,
      situation: clip(view.text, 1200),
      budgetMs: 7000,
    });
    this.rendererStats[seat].total += 1;
    if (renderer.meta.reason === 'timeout') this.rendererStats[seat].timeouts += 1;
    const rs = this.rendererStats[seat];
    this.opts.logs.table.record({
      kind: 'renderer_stats',
      seat,
      total: rs.total,
      timeouts: rs.timeouts,
      timeoutRate: rs.total ? +(rs.timeouts / rs.total).toFixed(3) : 0,
      lastReason: renderer.meta.reason ?? null,
      latencyMs: renderer.meta.latencyMs,
    });

    const bubble = renderer.output.bubble;
    const hasBubble = !!bubble;
    const hasBeats = renderer.output.beats.length > 0;
    if (hasBeats || renderer.output.headline || hasBubble) {
      const thoughtData = {
        seat,
        bubble,
        bubbleValid: true,
        headline: renderer.output.headline,
        beats: renderer.output.beats,
        contrast: renderer.output.contrast,
        reasoningKind: result.reasoningKind ?? 'none',
        bubbleReason: renderer.meta.bubbleReason ?? null,
      };
      this.lastThought.set(seat, thoughtData);
      this.bus.publish('thought', bubble ?? renderer.output.headline ?? '看点', 'soon', thoughtData);
      // 心里话也配音：同一个音色、音量压低；和云朵同时出（只读上屏的那句 bubble，不读看点 / 细节）
      if (bubble) void this.speech?.prepare(seat, bubble, { thought: true })?.release();

      // Helixus 每回合只收一条 thought_beat：上屏的心里话 + 只有他看得到的全部细节。
      // 观众屏幕上只有 bubble；beats/headline 不再上屏，但 Helixus 可以拿来锐评。
      const visible = bubble ? `【观众看到的心里话】「${bubble}」` : '【观众看到的心里话】（这一回合没有可上屏的）';
      const hiddenBeats = renderer.output.beats.length
        ? renderer.output.beats.map((b, i) => `${i + 1}. ${b.text} #${b.tag}（${b.score}分）`).join('；')
        : '（无）';
      const hidden = `【只有你看得到】headline：${renderer.output.headline ?? '（无）'}；beats：${hiddenBeats}`;
      const topScore = renderer.output.beats[0]?.score ?? 0;
      this.bus.publish('thought_beat', `${visible}\n${hidden}`, topScore >= 7 ? 'immediate' : 'soon', {
        seat,
        bubble,
        beats: renderer.output.beats,
        headline: renderer.output.headline,
      });

      if (renderer.output.contrast) {
        this.bus.publish('contrast', `${actor.name} 想的是「${renderer.output.contrast}」`, 'immediate', {
          seat,
          contrast: renderer.output.contrast,
          decision: result.decision,
        });
      }
    } else {
      const reason = renderer.meta.reason ?? 'no_grounded_beats';
      const thoughtData = {
        seat,
        bubble: null,
        bubbleValid: false,
        headline: null,
        beats: [],
        contrast: null,
        reasoningKind: result.reasoningKind ?? 'none',
        bubbleReason: renderer.meta.bubbleReason ?? reason,
      };
      this.bus.publish('thought', '（这一回合没有可上屏的心里话）', 'later', thoughtData);
      this.opts.logs.trace(`${actor.name} 的心里话为空（${reason}）；不显示云朵，直接等决定。`);
    }

    const hot = renderer.output.contrast !== null || (renderer.output.beats[0]?.score ?? 0) >= 7;
    const waitThought = hasBubble ? this.opts.config.table.pacing.tThought : 0;
    if (hasBubble || hasBeats) {
      // 云朵留够时间；心里话的声音还没念完也等它念完（idle 自带 wait_cap_ms 上限）
      await Promise.all([sleep((waitThought + (hot ? this.opts.config.table.pacing.tReact : 0)) * 1000), this.speech?.idle()]);
    }
    await sleep(this.opts.config.table.pacing.tBetween * 1000);

    const decisionData = {
      seat,
      say: result.decision.say,
      action: result.decision.action,
      expression: result.decision.expression,
      contrast: renderer.output.contrast,
      headline: renderer.output.headline,
      beats: renderer.output.beats,
      bubble,
    };
    this.lastDecision.set(seat, decisionData);
    // 声音和气泡同时出来：release() 只是把已经合成好的音频放进 overlay 的播放队列（还没好就等它好）
    void spoken?.release();
    this.bus.publish('decision', this.decisionLinkText(actor.name, result.decision), 'soon', decisionData);
    // 动作要等他把话说完再结算（至少等 tDecision；idle 自带 wait_cap_ms 上限，合成慢或失败不会卡死）
    await Promise.all([sleep(this.opts.config.table.pacing.tDecision * 1000), this.speech?.idle()]);

    const exec = await this.executePlayerAction(seat, result.decision);
    const latency = Date.now() - started;
    // 战斗外的回合结束：回合末的事、带豁免的状态再豁免；然后记上“这一轮行动过了”
    if (!this.engine.combat.active) {
      const end = await this.engine.finishExplorationTurn(seat);
      for (const roll of end.rolls) this.publishRoll(roll);
      for (const note of end.notes) this.bus.publish('system', note, 'immediate', {});
      this.clock.markActed(seat);
    }

    const record: TurnRecord = {
      id: uuid(),
      at: Date.now(),
      seat,
      phase: this.phase,
      round: this.clock.round,
      sceneId: this.scene.id,
      gmNarration: this.lastGmNarration(),
      decision: result.decision,
      reasoning: result.reasoning,
      reasoningKind: result.reasoningKind,
      renderer: renderer.output,
      rendererMeta: renderer.meta,
      executed: { ok: exec.ok, summary: exec.summary, rolls: exec.rolls.length, errors: exec.errors },
      beatsShown: renderer.output.beats.length,
      latencyMs: latency,
      usage: [
        {
          seat,
          model: result.model,
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          latencyMs: result.latencyMs,
        },
      ],
    };
    this.history.push(record);
    if (this.history.length > this.opts.config.table.limits.historyTurns) {
      this.history.splice(0, this.history.length - this.opts.config.table.limits.historyTurns);
    }
    this.transcript.push({
      at: Date.now(),
      kind: 'player',
      seat,
      text: `说：「${result.decision.say}」 做：${this.actionText(result.decision)}`,
    });
    if (this.transcript.length > 200) this.transcript.splice(0, this.transcript.length - 200);

    // 原始思维链只写本地日志；不写事件、不上屏
    this.opts.logs.table.record({
      kind: 'player_turn',
      turnId: record.id,
      seat,
      scene: this.scene.id,
      phase: this.phase,
      round: this.clock.round,
      inputView: view.text,
      decision: result.decision,
      rawOutput: {
        reasoning: result.reasoning,
        reasoningKind: result.reasoningKind,
        reasoningElicited: result.reasoningElicited,
        fallback: result.fallback,
        parseRetries: result.parseRetries,
        parseErrors: result.parseErrors,
      },
      renderer: renderer.output,
      rendererMeta: renderer.meta,
      executed: record.executed,
      dice: exec.rolls.map((r) => ({
        kind: r.kind,
        formula: r.formula,
        natural: r.natural,
        total: r.total,
        dc: r.dc,
        success: r.success,
        crit: r.crit,
      })),
      latencyMs: latency,
      model: result.model,
      usage: result.usage,
    });
    this.opts.logs.trace(
      `${actor.name}（${result.latencyMs}ms，${result.reasoningKind ?? '无思维链'}）` +
        `${result.fallback ? ' [解析失败，默认行动]' : ''}：${clip(result.decision.say, 30)}｜${this.actionText(result.decision)}` +
        `｜看点 ${renderer.output.beats.length} 条（${renderer.meta.latencyMs}ms）${exec.ok ? '' : '，行动未执行'}`
    );

    this.pendingNote = this.buildGmNote(seat, result.decision, exec);
    this.expressions[seat] = result.decision.expression;
    await this.syncActors();
    this.publishState();
    await this.afterPlayerTurn();
  }

  private async afterPlayerTurn(): Promise<void> {
    if (!this.engine.combat.active) {
      this.save();
      return;
    }
    if (this.engine.combatStatus() === 'victory') {
      await this.finishCombat('敌人全部倒下了。');
      return;
    }
    if (this.engine.combatStatus() === 'defeat') {
      await this.finishCombat('所有人都倒下了。', defeatNote);
      return;
    }
    const moved = await this.passTurn();
    if (!moved) {
      await this.finishCombat('没有人还能继续战斗了。', this.engine.combatStatus() === 'defeat' ? defeatNote : undefined);
      return;
    }
    this.save();
  }

  /**
   * 换到下一个真的能行动的人：死了的跳过，濒死的 PC 自动掷死亡豁免，发骰子和旁白事件，同步 Atlas 先攻。
   * 返回 false = 绕了一圈没人能动。
   */
  private async passTurn(): Promise<boolean> {
    const adv = await this.engine.advanceTurn();
    for (const roll of adv.rolls) this.publishRoll(roll);
    for (const note of adv.notes) {
      this.bus.publish('system', note, 'immediate', {});
      this.opts.logs.trace(note);
    }
    await this.syncTurn();
    const cur = adv.actorId ? this.engine.get(adv.actorId) : null;
    if (!cur) return false;
    // 先攻转完一圈：先让环境的世界回合动一次、桌面轮 +1，再宣布新一轮的第一位
    await this.settleCombatRounds();
    if (!this.engine.combat.active) return true;
    this.bus.publish('turn', `先攻轮到 ${cur.name}（第 ${this.clock.round} 轮）`, 'soon', {
      actorId: cur.id,
      name: cur.name,
      seat: cur.seat ?? null,
      round: this.clock.round,
      initiative: this.rosterState(),
    });
    return true;
  }

  /** 战斗结束：清先攻、回探索阶段、通知 Atlas 和观众；GM 下一回合会收到 note。 */
  private async finishCombat(text: string, note?: string): Promise<void> {
    const rewards = await this.grantCombatRewards();
    this.engine.endCombat();
    this.phase = 'explore';
    this.combatSynced = false;
    await this.sync?.endCombat();
    this.bus.publish('combat_end', text, 'immediate', {});
    const merged = [note, rewards].filter(Boolean).join('\n');
    if (merged) this.pendingNote = merged;
    this.save();
  }

  // ---------------------------------------------------------------- 经验值 / 升级
  /**
   * 战斗里倒下的怪物发经验（见 RulesEngine.awardCombatXp），到线的 PC 自动升级。
   * 返回给 GM 看的结算文字；没有可发的返回空串。可以重复调用：发过的怪物不会再发。
   */
  async grantCombatRewards(): Promise<string> {
    const award = this.engine.awardCombatXp();
    return award ? this.settleXp(award) : '';
  }

  /** GM 的 award_xp：剧情经验，平分给还没死的 PC，到线自动升级。 */
  async grantStoryXp(total: number, reason: string): Promise<string> {
    const award = this.engine.awardXp(total, clip(reason, 60) || '剧情');
    return award ? this.settleXp(award) : '没有发经验：数量不对，或者队里没有活着的角色。';
  }

  private async settleXp(award: XpAward): Promise<string> {
    const lines = [`${award.reason}：共 ${award.total} 经验，每人 ${award.share}。`];
    const toasts: { seat: SeatKey | null; name: string; gained: number; total: number; leveledTo?: number }[] = [];
    const set = this.opts.config.table.characterSet ?? '';
    for (const gain of award.gains) {
      const actor = this.engine.require(gain.actorId);
      const toast: (typeof toasts)[number] = { seat: (actor.seat as SeatKey | undefined) ?? null, name: actor.name, gained: gain.gained, total: gain.total };
      toasts.push(toast);
      let line = `${actor.name} 经验 ${gain.total}`;
      while (levelForXp(actor.xp ?? 0) > actor.level) {
        const spec = actor.seat ? readBuildSpec(this.opts.config.paths.campaignVault, actor.seat as SeatKey, set) : null;
        if (!spec) {
          line += `；到了 ${levelForXp(actor.xp ?? 0)} 级的经验，但角色卡里没有 build，不能自动升级`;
          break;
        }
        const res = levelUpActor(actor, spec);
        if (!res.ok) {
          line += `；没能升级：${res.reason}`;
          this.opts.logs.trace(`升级失败：${res.reason}`);
          break;
        }
        const o = res.outcome;
        const feats = o.newFeatures.map((id) => featureInfo(id)?.zh ?? featureInfo(id)?.name ?? id);
        line += `；升到 ${o.toLevel} 级（最大 HP +${o.hpGain}${feats.length ? `，新特性：${feats.join('、')}` : ''}）`;
        toast.leveledTo = o.toLevel;
        this.sceneLog.push(`${actor.name} 升到 ${o.toLevel} 级`);
        for (const w of o.warnings) this.opts.logs.trace(`${actor.name} 升到 ${o.toLevel} 级：${w}`);
        this.bus.publish('level_up', `${actor.name} 升到 ${o.toLevel} 级`, 'soon', {
          seat: actor.seat ?? null,
          name: actor.name,
          level: o.toLevel,
          hpGain: o.hpGain,
          features: feats,
        });
      }
      const next = nextLevelXp(actor.level);
      if (next !== null) line += `（下一级 ${next}）`;
      lines.push(line);
    }
    this.bus.publish('xp', lines[0], 'soon', {
      reason: award.reason,
      total: award.total,
      share: award.share,
      gains: toasts,
    });
    for (const gain of award.gains) {
      const actor = this.engine.get(gain.actorId);
      if (actor && this.sync) await this.sync.syncActor(actor, this.visibleActorIds).catch(() => undefined);
    }
    this.publishState('经验值');
    this.save();
    const text = lines.join('\n');
    this.opts.logs.trace(text.replace(/\n/g, ' | '));
    return text;
  }

  // ---------------------------------------------------------------- 玩家行动执行
  private async executePlayerAction(seat: SeatKey, decision: PlayerDecision): Promise<ActionExecution> {
    const actor = this.engine.require(seat);
    const rolls: RollResult[] = [];
    const errors: string[] = [];
    const action = decision.action;
    let moveSummary = '';
    let moveCell = action.cell;
    // 活人不能叠在同一格。玩家常把「敌人所在的格子」写成 cell：攻击就当没给 cell（近战会自动贴到相邻的空格），
    // 其余行动挪到离那一格最近的空格，而不是整次行动作废。
    if (moveCell && this.engine.occupiedBy(moveCell, seat)) {
      moveCell = action.type === 'attack' ? undefined : (this.engine.nearestFreeCell(actor, moveCell) ?? undefined);
    }
    // cell 落在障碍 / 水面 / 地图外（红帐、帐篷、树丛）：原来整次行动作废、GM 只看到“行动未执行”，于是编出一个堵门的箱子。
    // 改成走到离它最近的合法格（一样近的取离自己近的那一侧），把原因记进结算，GM 和玩家都知道“停在帐门口”
    let snapNote = '';
    if (moveCell && !this.engine.canStandAt(actor, moveCell)) {
      const near = this.engine.nearestCellToward(actor, moveCell);
      if (near) {
        snapNote = `${this.engine.describeCell(moveCell)} 是障碍或水面，站不进去，改走到 ${this.engine.describeCell(near)}；`;
        moveCell = near;
      }
    }
    // 传送类法术（迷踪步）：cell 是目的地，不是“先走过去”
    let teleportDestination: { col: number; row: number } | undefined;
    if (action.type === 'cast' && moveCell) {
      const sp = this.resolveSpell(actor, `${action.detail ?? ''} ${action.target ?? ''}`);
      if (sp?.effect.kind === 'buff' && sp.effect.teleportFeet) {
        teleportDestination = moveCell;
        moveCell = undefined;
      }
    }
    // 和一个生物互动（检定 / 交谈 / 用物品 / 其它，比如摸狼的爪子、和 NPC 说话）得站在它旁边：人在五格外「托着它的爪子」，
    // 地图上的 pin 就对不上了。目标是场上的生物时，不管玩家写的 cell，直接走到它旁边的空格（探索不限速；已经相邻就不动）。
    const interactWith =
      ['check', 'talk', 'item', 'other'].includes(action.type) && action.target ? this.resolveTarget(action.target, seat) : null;
    const approachTarget = interactWith && interactWith.kind === 'monster' ? interactWith : null;
    if (approachTarget) moveCell = undefined;
    const explicitCell = moveCell !== undefined;
    try {
      // P1-2：任何类型（move/attack/cast/check/talk/item/other）只要带了 cell，都先移动再做动作。
      // 探索阶段不限速度；战斗阶段按剩余移动力算，走不过去就整次行动非法、token 不动。
      if (moveCell) {
        const from = actor.position;
        if (!from) throw new Error('规则层没有这个角色的位置');
        const maxCells = this.engine.combat.active ? this.engine.movementCellsLeft(actor) : Infinity;
        const move = await this.engine.moveWithReactions(seat, moveCell, { maxCells });
        if (!move.ok) throw new Error(move.reason ?? '走不到目标格');
        if (move.cells > 0) {
          const to = this.engine.positionOf(seat)!;
          await this.sync?.moveActor(actor).catch((e) => this.opts.logs.trace(`Atlas 移动 token 失败：${(e as Error).message}`));
          this.publishMove(
            actor.name,
            from,
            to,
            `${actor.name} 从 ${this.engine.describeCell(from)} 移到 ${this.engine.describeCell(to)}（移动 ${move.cells * 5} 尺）`
          );
          moveSummary = `移动 ${move.cells * 5} 尺到 ${this.engine.describeCell(to)}；`;
        }
        const hit = this.reportOpportunity(move.opportunity, rolls);
        if (hit) moveSummary += hit;
        if (snapNote) moveSummary = snapNote + moveSummary;
        if (move.downedAt) {
          return { ok: true, summary: `${moveSummary}${actor.name} 在半路被借机攻击放倒了，没能继续行动`, rolls, errors };
        }
      }

      if (approachTarget) {
        const got = await this.approachForInteraction(actor, approachTarget, rolls);
        if (got) moveSummary += got;
        if (actor.hp <= 0) return { ok: true, summary: `${moveSummary}${actor.name} 在靠近 ${approachTarget.name} 的路上被放倒了`, rolls, errors };
      }

      if (action.type === 'attack') {
        const target = this.resolveTarget(action.target, seat);
        if (!target) throw new Error('没有看得见的目标');
        const def = this.resolveAttack(actor, action.detail ?? action.target ?? '');
        if (!def) throw new Error('没有可用的武器');
        // 已经用 cell 明确走位了：直接从新位置攻击，不再自动贴近。
        // 没给 cell 的老行为保持不变：近战先自动贴到相邻格（速度内），够不到就整次行动非法。
        if (!explicitCell && this.engine.isMeleeAttack(seat, def)) {
          const approached = await this.approachForMelee(actor, target, rolls);
          if (approached) moveSummary += approached;
          if (actor.hp <= 0) {
            return { ok: true, summary: `${moveSummary}${actor.name} 在冲向 ${target.name} 的路上被放倒了`, rolls, errors };
          }
        }
        const attackOpts = this.attackOptionsFromText(actor, `${action.detail ?? ''}`);
        const results = attackOpts.offhand
          ? [await this.engine.attack(seat, target.id, def, attackOpts)]
          : await this.engine.attackAction(seat, target.id, def, attackOpts);
        const lines: string[] = [];
        for (const result of results) {
          rolls.push(result.attack);
          this.publishRoll(result.attack, seat);
          let line = `${actor.name} ${result.hit ? '命中' : '没有命中'} ${target.name}`;
          if (result.notes?.length) line += `（${result.notes.join('；')}）`;
          if (result.hit && result.damage) {
            rolls.push(result.damage);
            this.publishRoll(result.damage, seat);
            line += `，造成 ${result.damage.total} 点${result.crit ? '暴击' : ''}伤害；${target.name} 剩 ${Math.max(0, target.hp)}/${target.maxHp}`;
          }
          for (const extra of result.extraRolls ?? []) {
            rolls.push(extra);
            this.publishRoll(extra, seat);
          }
          if (result.conditionApplied) line += `；${target.name} 陷入「${CONDITION_ZH[result.conditionApplied]}」`;
          if (result.sneakAttack) line += '；偷袭生效';
          lines.push(line);
        }
        this.failIfDown(target);
        return { ok: true, summary: `${moveSummary}${lines.join('；然后 ')}`, rolls, errors };
      }
      if (action.type === 'cast') {
        const spell = this.resolveSpell(actor, `${action.detail ?? ''} ${action.target ?? ''}`);
        if (!spell) throw new Error('不能确定要施放哪个法术');
        const targets: string[] = [];
        // 己方的增益和治疗不写目标 = 施法者自己（或「你选定的盟友」类法术的默认盟友），别默认成眼前的怪物
        const friendly = spell.effect.kind === 'heal' || (spell.effect.kind === 'buff' && !spell.effect.markTarget);
        const target = !action.target && friendly ? null : this.resolveTarget(action.target, seat, true);
        if (target) targets.push(target.id);
        if (spell.needsTarget && !targets.length && !friendly) throw new Error('这个法术需要一个目标');
        const slot = this.bestSlot(actor, spell.level);
        if (spell.level > 0 && !slot) throw new Error(`没有可用的 ${spell.level} 环以上法术位`);
        const before = actor.position ? { ...actor.position } : null;
        // detail 里写明的选项（增强属性选哪种、降咒术选哪种）交给引擎认
        const result = await this.engine.castSpell(seat, spell.id, slot, targets, {
          ...(teleportDestination ? { destination: teleportDestination } : {}),
          ...(spell.choices?.length ? { option: `${action.detail ?? ''}` } : {}),
        });
        if (result.ok && teleportDestination && before && actor.position) {
          await this.sync?.moveActor(actor).catch((e) => this.opts.logs.trace(`Atlas 移动 token 失败：${(e as Error).message}`));
          this.publishMove(actor.name, before, actor.position, `${actor.name} 传送到 ${this.engine.describeCell(actor.position)}`);
        }
        if (!result.ok) throw new Error(result.error ?? '施法失败');
        rolls.push(...result.rolls);
        for (const r of result.rolls) this.publishRoll(r, seat);
        const parts: string[] = [`${actor.name} 施放「${spell.name}」（${result.slotLevel} 环）`];
        if (result.damage) parts.push(`伤害 ${result.damage}`);
        if (result.heal) parts.push(`治疗 ${result.heal}`);
        if (result.notes.length) parts.push(result.notes.join('；'));
        for (const t of targets) {
          const ta = this.engine.get(t);
          if (ta) this.failIfDown(ta);
        }
        return { ok: true, summary: `${moveSummary}${parts.join('，')}`, rolls, errors };
      }
      if (action.type === 'feature') {
        const featureId = this.parseFeatureId(`${action.detail ?? ''}`, actor);
        if (!featureId) throw new Error('feature 的 detail 要以特性 id 开头（比如 second_wind、rage）');
        const out = await this.engine.useFeature(seat, featureId, this.featureArgs(featureId, action, seat));
        const lines: string[] = [out.note];
        for (const r of out.rolls) {
          rolls.push(r);
          this.publishRoll(r, seat);
        }
        for (const a of out.attacks ?? []) {
          rolls.push(a.attack);
          this.publishRoll(a.attack, seat);
          if (a.hit && a.damage) {
            rolls.push(a.damage);
            this.publishRoll(a.damage, seat);
            lines.push(`${a.hit ? '命中' : '没打中'}，${a.damage.total} 点伤害`);
          }
        }
        return { ok: out.ok, summary: `${moveSummary}${lines.join('；')}`, rolls, errors };
      }
      if (action.type === 'grapple' || action.type === 'shove' || action.type === 'escape') {
        let out;
        if (action.type === 'escape') {
          out = await this.engine.escapeGrapple(seat);
        } else {
          const foe = this.resolveTarget(action.target, seat);
          if (!foe) throw new Error('没有看得见的目标');
          out =
            action.type === 'grapple'
              ? await this.engine.grapple(seat, foe.id)
              : await this.engine.shove(seat, foe.id, /push|推开/i.test(action.detail ?? '') ? 'push' : 'prone');
        }
        if (out.roll) {
          rolls.push(out.roll);
          this.publishRoll(out.roll, seat);
        }
        return { ok: out.ok, summary: `${moveSummary}${out.note}`, rolls, errors };
      }
      if (action.type === 'item') {
        // 背包里有、而且有规则效果的东西（治疗药水）：桌面结算——花动作、用掉一件、掷骰回血；可以给队友喝
        const used = this.itemMentioned(actor, `${action.detail ?? ''} ${action.target ?? ''}`);
        if (used && (used.use?.heal || used.use?.note)) {
          const ally = this.resolveTarget(action.target, seat, true);
          const targetPc = ally && ally.kind === 'pc' ? ally : actor;
          const out = await this.engine.useItem(seat, used.name, targetPc.id);
          if (out.roll) {
            rolls.push(out.roll);
            this.publishRoll(out.roll, seat);
          }
          if (out.consumed) this.announceLoot(seat, `${actor.name} 用掉了 ${used.name}`, { kind: 'item_used', name: used.name, qty: 1 });
          return { ok: out.ok, summary: `${moveSummary}${out.note}`, rolls, errors: out.ok ? errors : [...errors, out.note] };
        }
      }
      if (['dash', 'dodge', 'disengage', 'hide', 'help'].includes(action.type)) {
        const kind = action.type as 'dash' | 'dodge' | 'disengage' | 'hide' | 'help';
        let allyId: string | undefined;
        let targetId: string | undefined;
        if (kind === 'help') {
          allyId = this.resolveTarget(action.target, seat)?.id;
          const foe = this.resolveTarget(`${action.detail ?? ''}`, seat);
          targetId = foe && foe.kind === 'monster' ? foe.id : undefined;
          if (!allyId || !targetId) throw new Error('协助要写清楚帮哪位盟友（target）、对哪个敌人（detail）');
        }
        const out = await this.engine.takeAction(seat, kind, { allyId, targetId });
        if (out.roll) {
          rolls.push(out.roll);
          this.publishRoll(out.roll, seat);
        }
        return { ok: out.ok, summary: `${moveSummary}${out.note}`, rolls, errors };
      }
      if (action.type === 'move' && moveCell) {
        const to = this.engine.positionOf(seat);
        return {
          ok: true,
          summary: moveSummary || `${actor.name} 已经在${to ? this.engine.describeCell(to) : '原地'}`,
          rolls,
          errors,
        };
      }
    } catch (e) {
      const msg = (e as Error).message;
      errors.push(msg);
      this.bus.publish('system', `${actor.name} 的行动没执行：${clip(msg, 120)}`, 'soon', { seat });
      return { ok: false, summary: `行动未执行（${msg}）`, rolls, errors };
    }
    // move（无 cell）/ check / talk / item / other：移动已经做完了，剩下的交给 GM 裁定
    return { ok: true, summary: `${actor.name}：${moveSummary}${this.actionText(decision, !explicitCell)}`, rolls, errors };
  }

  /** 从玩家写的 detail 里读出攻击选项（鲁莽攻击 / 神圣斩击 / 震慑拳 / 副手）。 */
  private attackOptionsFromText(actor: Actor, text: string): AttackOptions {
    const o: AttackOptions = {};
    if (/鲁莽攻击|reckless/i.test(text)) o.reckless = true;
    if (/震慑拳|stunning/i.test(text)) o.stunningStrike = true;
    if (/神圣斩击|divine smite|smite/i.test(text)) {
      const slot = this.bestSlot(actor, 1);
      if (slot) o.smite = slot;
    }
    if (/副手|off-?hand/i.test(text)) o.offhand = true;
    return o;
  }

  /** detail 里第一个出现的主动特性 id（认英文 id，也认中文名）。 */
  private parseFeatureId(text: string, actor: Actor): string | null {
    const lower = text.toLowerCase();
    // 效果授予的攻击（灵体武器、火焰之刃）：认法术 id 或效果名
    for (const eff of actor.effects) {
      if (eff.grantsAttack && (lower.includes(eff.spellId.toLowerCase()) || text.includes(eff.name) || text.includes(eff.grantsAttack.name))) {
        return `granted:${eff.spellId}`;
      }
    }
    let best: { id: string; at: number } | null = null;
    for (const [id, f] of Object.entries(USABLE_FEATURES)) {
      for (const needle of [id, f.name]) {
        const at = lower.indexOf(needle.toLowerCase());
        if (at >= 0 && (!best || at < best.at)) best = { id, at };
      }
    }
    return best?.id ?? null;
  }

  /** 从玩家的行动里凑出 useFeature 的参数：目标、点数、模式、波及的目标、治疗分配。 */
  private featureArgs(featureId: string, action: { target?: string; detail?: string }, seat: SeatKey) {
    const detail = action.detail ?? '';
    const named = [...this.engine.actors.values()].filter((a) => a.id !== seat && a.hp > 0 && detail.includes(a.name));
    const amount = /\d+/.exec(detail)?.[0];
    const mode = /解毒|poison/i.test(detail) ? 'poison' : /解病|disease/i.test(detail) ? 'disease' : /dash|疾走/i.test(detail) ? 'dash' : /disengage|撤离/i.test(detail) ? 'disengage' : undefined;
    const distribution: Record<string, number> = {};
    if (featureId === 'preserve_life') {
      for (const a of this.engine.actors.values()) {
        const m = new RegExp(`${a.name}\\s*[:：]\\s*(\\d+)`).exec(detail);
        if (m) distribution[a.id] = Number(m[1]);
      }
    }
    return {
      targetId: this.resolveTarget(action.target, seat, true)?.id ?? named[0]?.id,
      targetIds: named.map((a) => a.id),
      amount: amount ? Number(amount) : undefined,
      mode,
      distribution,
    };
  }

  /** 近战前贴近：规则层算路线，Atlas 同步 token，事件里写清楚谁扑到谁身边。 */
  /**
   * 和生物互动前先走到它旁边。探索阶段不限速度（直接走到离它最近的空格）；战斗中按剩余移动力，走不到就按老规则（够不到）。
   * 路走不通时不让整次行动作废（探索里）：返回空串，棋子不动，剩下的交给 GM 裁定。
   */
  private async approachForInteraction(actor: Actor, target: Actor, rolls: RollResult[]): Promise<string> {
    const from = actor.position;
    const at = target.position;
    if (!from || !at) return '';
    if (Math.max(Math.abs(from.col - at.col), Math.abs(from.row - at.row)) <= 1) return '';
    if (this.engine.combat.active) return this.approachForMelee(actor, target, rolls);
    const cell = this.engine.nearestFreeCell(actor, at);
    if (!cell) return '';
    const move = await this.engine.moveWithReactions(actor.id, cell, { maxCells: Infinity });
    if (!move.ok || move.cells <= 0) return '';
    const to = this.engine.positionOf(actor.id);
    if (!to) return '';
    await this.sync?.moveActor(actor).catch((e) => this.opts.logs.trace(`Atlas 移动 token 失败：${(e as Error).message}`));
    this.publishMove(
      actor.name,
      from,
      to,
      `${actor.name} 走到 ${target.name} 身边（${this.engine.describeCell(to)}，移动 ${move.cells * 5} 尺）`
    );
    return `${this.reportOpportunity(move.opportunity, rolls)}走到 ${target.name} 身边（移动 ${move.cells * 5} 尺）；`;
  }

  private async approachForMelee(attacker: Actor, target: Actor, rolls: RollResult[]): Promise<string> {
    const approach = await this.engine.approachWithReactions(attacker.id, target.id);
    if (!approach.ok) throw new Error(approach.reason ?? '够不到目标');
    if (approach.movedCells > 0 && approach.from && approach.to) {
      await this.sync?.moveActor(attacker).catch((e) => this.opts.logs.trace(`Atlas 移动 token 失败：${(e as Error).message}`));
      this.publishMove(
        attacker.name,
        approach.from,
        approach.to,
        `${attacker.name} 扑到 ${target.name} 身边（移动 ${approach.movedCells * 5} 尺）`
      );
    }
    return this.reportOpportunity(approach.opportunity, rolls);
  }

  /** 借机攻击：发骰子事件，返回一句结算文字（没有借机攻击就是空串）。 */
  private reportOpportunity(outcomes: OpportunityOutcome[] | undefined, rolls: RollResult[]): string {
    if (!outcomes?.length) return '';
    const parts: string[] = [];
    for (const o of outcomes) {
      const reactor = this.engine.get(o.reactorId);
      const mover = this.engine.get(o.targetId);
      if (!reactor || !mover) continue;
      rolls.push(o.result.attack);
      this.publishRoll(o.result.attack, reactor.seat as SeatKey | undefined);
      let line = `${reactor.name} 借机攻击${o.result.hit ? '命中' : '没打中'}${mover.name}`;
      if (o.result.hit && o.result.damage) {
        rolls.push(o.result.damage);
        this.publishRoll(o.result.damage, reactor.seat as SeatKey | undefined);
        line += `，${o.result.damage.total} 点伤害，${mover.name} 剩 ${Math.max(0, mover.hp)}/${mover.maxHp}`;
      }
      parts.push(line);
    }
    return `${parts.join('；')}；`;
  }

  private publishMove(actorName: string, from: { col: number; row: number }, to: { col: number; row: number }, text: string): void {
    this.bus.publish('move', text, 'soon', { actorName, from, to });
    this.opts.logs.table.record({ kind: 'move', actor: actorName, from, to, text });
    this.opts.logs.trace(text);
  }

  private resolveTarget(ref: string | undefined, selfSeat: SeatKey, allowSelf = false): Actor | null {
    const candidates = [...this.engine.actors.values()].filter((a) => {
      if (a.id === selfSeat) return allowSelf;
      if (a.kind === 'pc') return true;
      return this.visibleActorIds.has(a.id) && a.hp > 0 && !a.deathSaves.dead;
    });
    if (ref) {
      const s = ref.trim();
      const direct = candidates.find((a) => a.id === s || a.name === s);
      if (direct) return direct;
      // 玩家常用泛称指代：「拴着的狼」指向名字叫「饿狼」的那只（按怪物种类名「狼」认）
      const generic = (a: Actor): string | undefined => (a.kind === 'monster' ? MONSTERS[a.id.split(':')[0]]?.name : undefined);
      const fuzzy = candidates.find((a) => a.name.includes(s) || s.includes(a.name) || a.id.includes(s));
      return fuzzy ?? candidates.find((a) => { const g = generic(a); return !!g && s.includes(g); }) ?? null;
    }
    return candidates.find((a) => a.kind === 'monster' && a.hp > 0) ?? null;
  }

  private resolveAttack(actor: Actor, text: string) {
    for (const def of actor.attacks) {
      const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
      const names = [def.name, weapon?.name, def.weaponId].filter((x): x is string => !!x);
      if (names.some((n) => text.includes(n))) return def;
    }
    return actor.attacks[0];
  }

  private resolveSpell(actor: Actor, text: string) {
    const known = actor.spells?.known ?? [];
    for (const id of known) {
      const s = SPELLS[id];
      if (!s) continue;
      if (text.includes(s.name) || text.toLowerCase().includes(id)) return s;
    }
    return null;
  }

  private bestSlot(actor: Actor, level: number): number {
    if (level === 0) return 0;
    for (let l = level; l <= 9; l++) {
      const slot = actor.spells?.slots[l];
      if (slot && slot.used < slot.max) return l;
    }
    return 0;
  }

  private failIfDown(actor: Actor): void {
    if (actor.hp <= 0 && !actor.deathSaves.dead) {
      this.bus.publish('system', `${actor.name} 倒下了。`, 'immediate', { actorId: actor.id });
    }
  }

  private publishRoll(roll: RollResult, seat?: SeatKey): void {
    this.bus.publish('roll', this.rollText(roll), roll.crit || roll.fumble ? 'immediate' : 'later', {
      roll: {
        kind: roll.kind,
        label: roll.label,
        formula: roll.formula,
        total: roll.total,
        natural: roll.natural,
        modifier: roll.modifier,
        dc: roll.dc,
        success: roll.success,
        crit: roll.crit,
        fumble: roll.fumble,
        actorId: roll.actorId ?? seat ?? null,
        targetId: roll.targetId ?? null,
      },
      seat,
    });
  }

  private rollText(roll: RollResult): string {
    const mod = roll.modifier >= 0 ? `+${roll.modifier}` : `${roll.modifier}`;
    if (roll.kind === 'attack') {
      return `${roll.label}：d20=${roll.natural ?? '?'}${mod} 对 AC ${roll.dc ?? '?'}，${roll.success ? '命中' : '未命中'}${roll.crit ? '（暴击）' : ''}${roll.fumble ? '（大失败）' : ''}`;
    }
    if (roll.dc !== undefined) {
      return `${roll.label}：d20=${roll.natural ?? '?'}${mod} 对 DC ${roll.dc}，${roll.success ? '成功' : '失败'}`;
    }
    return `${roll.label}：${roll.formula} = ${roll.total}`;
  }

  private decisionLinkText(actorName: string, decision: PlayerDecision): string {
    const a = decision.action;
    const say = decision.say ? `【观众看到的说话】「${clip(decision.say, 60)}」` : '【观众看到的说话】（没有说话）';
    const target = a.target ? `目标 ${a.target}` : '';
    const detail = a.detail ? `做法 ${a.detail}` : '';
    const cell = a.cell ? `移动到 ${this.engine.describeCell(a.cell)}` : '';
    const hidden = [a.type, target, detail, cell].filter(Boolean).join('；');
    return `${say}\n【只有你看得到】${actorName}：${hidden || '（没有额外细节）'}`;
  }

  private actionText(decision: PlayerDecision, withCell = true): string {
    const a = decision.action;
    const target = a.target ? ` ${a.target}` : '';
    const cell = withCell && a.cell ? ` → ${this.engine.describeCell(a.cell)}` : '';
    const typeZh: Record<string, string> = {
      attack: '攻击',
      cast: '施法',
      move: '移动',
      check: '尝试',
      talk: '交涉',
      item: '使用物品',
      other: '行动',
    };
    return `${typeZh[a.type] ?? a.type}${target}${a.detail ? `（${clip(a.detail, 60)}）` : ''}${cell}`;
  }

  private buildGmNote(seat: SeatKey, decision: PlayerDecision, exec: ActionExecution): string {
    return `${this.characters[seat].name} 这一回合：${this.decisionLinkText(this.characters[seat].name, decision)}。结算：${exec.summary}。${
      exec.ok ? '' : `（规则层拒绝了其中的动作：${exec.errors.join('；')}）`
    }`;
  }

  // ---------------------------------------------------------------- 进度管理（自动出口 + 进度导演）
  /** 地标上有没有人。离地标矩形 1 格以内算到达；只算还能动的 PC。 */
  private landmarkPresence(ref: string): { any: boolean; all: boolean } {
    const want = ref.trim();
    const lm = (this.scene.mapInfo?.landmarks ?? []).find((l) => l.id === want || l.name === want) ?? (this.scene.mapInfo?.landmarks ?? []).find((l) => l.name.includes(want));
    if (!lm) return { any: false, all: false };
    const pcs = this.engine.party().filter((p) => p.hp > 0 && !p.deathSaves.dead && p.position);
    const near = (p: Actor) => {
      const c = p.position!;
      const dx = Math.max(lm.cells.col[0] - c.col, 0, c.col - lm.cells.col[1]);
      const dy = Math.max(lm.cells.row[0] - c.row, 0, c.row - lm.cells.row[1]);
      return Math.max(dx, dy) <= 1;
    };
    const inside = pcs.filter(near);
    return { any: inside.length > 0, all: pcs.length > 0 && inside.length === pcs.length };
  }

  /** 自动出口：规则满足了就记下来，下一次 GM 的提示里会写【出口已达成】。战斗里不判（打完再说）。 */
  private checkSceneExit(): void {
    if (this.engine.combat.active || this.ended || this.sceneEndRequest || this.progress.exit) return;
    const rule = this.progress.evaluate({ round: this.clock.round, at: (ref) => this.landmarkPresence(ref) });
    if (!rule) return;
    // 说明是剧本作者写的，不含秘密，兜底当公开版前情用
    this.progress.exit = { rule: rule.raw, note: rule.note, sinceRound: this.clock.round, gmSteps: 0, ...(rule.note ? { publicRecap: rule.note } : {}) };
    this.opts.logs.trace(`进度：自动出口满足（${rule.raw}，第 ${this.clock.round} 轮）`);
    this.opts.logs.table.record({ kind: 'scene_exit', source: 'rule', rule: rule.raw, round: this.clock.round, scene: this.scene.id });
    this.save();
  }

  /** GM 的提示里的收尾指令；出口满足了才有。 */
  exitOrder(): string {
    const ex = this.progress.exit;
    if (!ex) return '';
    const ender = this.scene.ending ? 'end_game' : 'end_scene';
    return (
      `\n【出口已达成 · 这一步必须收尾】${ex.note || ex.rule}（${ex.rule}${ex.gmSteps ? `；已经提醒过 ${ex.gmSteps} 次，再不收尾桌面就替你收` : ''}）。` +
      `别再开新支线、别再续写障碍：用 narrate 写一句收尾，然后 ${ender}（summary 给你自己，public_recap 写玩家知道的）。`
    );
  }

  /** 出口满足之后 GM 又走了一步：GM 收了就算了，两步还没收桌面替它收。 */
  private noteExitProgress(sceneEnded: boolean): void {
    const ex = this.progress.exit;
    if (!ex || sceneEnded) return;
    ex.gmSteps += 1;
    if (ex.gmSteps >= 2) this.forceSceneEnd();
  }

  private forceSceneEnd(): void {
    const ex = this.progress.exit;
    if (!ex || this.sceneEndRequest) return;
    const lastNarration = this.transcript.filter((t) => t.kind === 'gm').slice(-2).map((t) => t.text).join(' ');
    const summary = ex.summary || `【桌面按出口条件收尾】${ex.note || ex.rule}。最后的局面：${clip(lastNarration, 160)}`;
    this.opts.logs.trace(`进度：GM 没有收尾，桌面按出口条件替它收（${ex.rule}）`);
    this.opts.logs.table.record({ kind: 'scene_exit', source: 'forced', rule: ex.rule, round: this.clock.round, scene: this.scene.id });
    this.bus.publish('system', '这一幕按剧本的出口条件收尾。', 'later');
    this.requestSceneEnd(summary, undefined, ex.publicRecap);
  }

  /** 导演给 GM 的推进指令；只在最近两轮内有效。 */
  directorBrief(): string {
    const o = this.directorOrders;
    if (!o || this.clock.round - o.round > 2) return '';
    const lines = ['\n【导演指令（进度导演对照剧本给你的，要照做）】'];
    if (o.push) lines.push(`- 下一步该推的：${o.push}`);
    if (o.drift.length) lines.push(`- 和剧本对不上的（别再续写这些，也别当成已经发生）：${o.drift.join('；')}`);
    if (o.revealed.length) lines.push(`- 桌面已经把这些生物放上地图了（玩家看得见它们的标记了，旁白里要交代它们是怎么出现的）：${o.revealed.join('、')}`);
    if (o.stalled) lines.push('- 最近几轮在原地打转：别再重复同一类场面，让局面动起来。');
    return lines.length > 1 ? lines.join('\n') : '';
  }

  private buildDirectorInput(): DirectorInput {
    const s = this.scene;
    const next = this.adventure.scenes[this.sceneIndex + 1];
    const scene = [
      `标题：${s.title}`,
      s.readAloud ? `读给玩家听的：${clip(s.readAloud, 600)}` : '',
      s.publicNotes ? `公开信息：${clip(s.publicNotes, 600)}` : '',
      `GM 秘密：${clip(s.gmSecrets || '（无）', 1400)}`,
      s.encounter.length ? `预设遭遇：${s.encounter.map((e) => `${e.monsterId}×${e.count}${e.visible ? '（已在地图上）' : ''}`).join('、')}` : '',
      s.loot?.length ? `战利品清单：\n${s.loot.map((l) => lootLine(l, this.lootTaken.has(`${s.id}:${l.id}`))).join('\n')}` : '',
      s.exits ? `出口/推进条件：${s.exits}` : '',
      next ? `下一幕（只用来判断 GM 有没有提前演它的内容）：${next.title}。${clip(next.readAloud, 200)} 遭遇：${next.encounter.map((e) => e.monsterId).join('、') || '无'}` : '',
    ].filter(Boolean).join('\n');
    const party = this.engine.party().map((p) => `${p.name}：${p.position ? this.engine.describeCell(p.position) : '位置未知'}`);
    const living = [...this.engine.actors.values()].filter((a) => a.kind === 'monster' && a.hp > 0 && !a.deathSaves.dead);
    const creatures = living.filter((a) => a.position).map((a) => `${a.name}：${this.engine.describeCell(a.position!)}${this.visibleActorIds.has(a.id) ? '' : '（藏着）'}`);
    const hiddenNow = living.filter((a) => !this.visibleActorIds.has(a.id));
    const recent = this.transcript
      .slice(-20)
      .map((t) => `- [${t.kind === 'gm' ? 'GM' : t.kind === 'player' ? (t.seat === 'player_a' ? '玩家A' : '玩家B') : '记录'}] ${clip(t.text, 200)}`)
      .join('\n');
    return {
      scene,
      progress: this.progress.gmBlock(this.clock.round),
      memory: this.memory.gmBlock(),
      recent,
      where: [...party, ...creatures].join('\n'),
      factKeys: this.memory.facts.map((f) => f.key),
      beatIds: this.progress.beats.map((b) => b.id),
      hidden: hiddenNow.map((a) => `- ${a.id}：${a.name}（${a.position ? this.engine.describeCell(a.position) : '位置未知'}）`).join('\n'),
      hiddenIds: hiddenNow.map((a) => a.id),
      isEnding: !!s.ending,
    };
  }

  /** 每隔几个探索轮请进度导演判断一次；超时 / 出错就跳过，确定性的自动出口照常。 */
  private async maybeRunDirector(): Promise<void> {
    const cfg = this.opts.config.table.director;
    if (!cfg?.enabled || this.engine.combat.active || this.ended || this.sceneEndRequest) return;
    if (this.clock.round - this.lastDirectorRound < cfg.everyRounds) return;
    this.lastDirectorRound = this.clock.round;
    const input = this.buildDirectorInput();
    const res = await runDirector(this.opts.llm, this.opts.config, input);
    this.opts.logs.table.record({ kind: 'director', ok: res.ok, error: res.error ?? null, output: res.output ?? null, round: this.clock.round, scene: this.scene.id, model: res.model, latencyMs: res.latencyMs, usage: res.usage });
    if (!res.ok || !res.output) {
      this.opts.logs.trace(`导演这一次没判出来（${res.error ?? '没有输出'}），跳过`);
      return;
    }
    await this.applyDirector(res.output);
  }

  /** 桌面强制执行导演的判断：打勾、删对不上的事实、出口满足就让 GM 收尾、推进指令给 GM。 */
  private async applyDirector(out: DirectorOutput): Promise<void> {
    const done: string[] = [];
    for (const id of out.beatsDone) if (this.progress.markBeat(id)) done.push(id);
    const dropped: string[] = [];
    const drift: string[] = [];
    for (const d of out.drift) {
      drift.push(d.what);
      if (d.factKey && this.memory.dropFact(d.factKey)) dropped.push(d.factKey);
    }
    if (out.exitMet && !this.progress.exit) {
      this.progress.exit = {
        rule: '导演判断',
        note: out.exitReason || '剧本的出口条件已经满足',
        sinceRound: this.clock.round,
        gmSteps: 0,
        ...(out.summary ? { summary: out.summary } : {}),
        ...(out.publicRecap ? { publicRecap: out.publicRecap } : {}),
      };
    } else if (out.exitMet && this.progress.exit) {
      // 自动出口已经满足：导演写的收尾文字比桌面兜底的好，补上
      if (out.summary && !this.progress.exit.summary) this.progress.exit.summary = out.summary;
      if (out.publicRecap) this.progress.exit.publicRecap = out.publicRecap;
    }
    // 导演让藏着的生物现身：桌面直接把它们揭示并同步到 Atlas，地图上才有 pin（旁白由 GM 下一步按指令交代）
    const revealIds = out.reveal.filter((id) => {
      const a = this.engine.get(id);
      return !!a && a.kind === 'monster' && a.hp > 0 && !a.deathSaves.dead && !this.visibleActorIds.has(id);
    });
    const revealed = revealIds.map((id) => this.engine.get(id)!.name);
    if (revealIds.length) {
      this.reveal(revealIds);
      await this.syncActors();
    }
    this.directorOrders = { push: out.push, drift, stalled: out.stalled, revealed, round: this.clock.round };
    this.opts.logs.trace(
      `导演：${out.exitMet ? '出口满足；' : ''}${done.length ? `打勾 ${done.join('、')}；` : ''}${drift.length ? `对不上 ${drift.length} 条${dropped.length ? `（删了事实 ${dropped.join('、')}）` : ''}；` : ''}${out.stalled ? '原地打转；' : ''}${revealed.length ? `现身 ${revealed.join('、')}；` : ''}${out.push ? `推：${clip(out.push, 60)}` : '没有要推的'}`
    );
    if (done.length || dropped.length || revealIds.length || out.exitMet) this.publishState();
    this.save();
  }

  // ---------------------------------------------------------------- 物品和金币
  /** 拿到 / 付出 / 用掉东西或钱：记进桌面记录（GM 和前情都看得到）、给 overlay 弹提示、立刻存档。 */
  announceLoot(actorId: string, text: string, data: Record<string, unknown> = {}): void {
    const actor = this.engine.get(actorId);
    this.transcript.push({ at: Date.now(), kind: 'event', text: `[第 ${this.clock.round} 轮] ${text}` });
    this.sceneLog.push(text);
    this.bus.publish('loot', text, 'soon', { ...data, seat: actor?.seat ?? null, round: this.clock.round });
    this.publishState();
    this.save();
  }

  /** 玩家写的话里提到了背包里的哪件东西（名字长的优先，免得「药」抢了「治疗药水」）。 */
  private itemMentioned(actor: Actor, text: string) {
    const norm = (s: string) => s.toLowerCase().replace(/\s+/g, '');
    const t = norm(text);
    return [...inventoryOf(actor)].sort((a, b) => b.name.length - a.name.length).find((i) => t.includes(norm(i.name))) ?? null;
  }

  // ---------------------------------------------------------------- 战役记忆
  /** 一幕结束：把 GM 的结局和桌面客观记下的（倒下的怪物、升级…）存成前情。换场景 / 一场结束都走这里。 */
  private recordSceneRecap(summary: string, publicRecap?: string): void {
    const defeated = [...this.engine.actors.values()].filter((a) => a.kind === 'monster' && a.hp <= 0).map((a) => a.name);
    const facts = [...(defeated.length ? [`击败：${[...new Set(defeated)].join('、')}`] : []), ...this.sceneLog];
    this.memory.addRecap({
      sceneId: this.scene.id,
      title: this.scene.title,
      summary,
      publicRecap: publicRecap?.trim() ?? '',
      facts,
      rounds: this.clock.round,
    });
    this.opts.logs.trace(`前情：「${this.scene.title}」${this.clock.round} 轮，${facts.length} 条客观记录`);
  }

  /** 老存档没有 memory：从记录里的「场景结束：…」尽量补出前几幕的前情（只有 GM 的那句话，没有公开版）。 */
  private backfillMemory(transcript: readonly TranscriptEntry[], sceneIndex: number): void {
    if (sceneIndex <= 0) return;
    const ends = transcript.filter((t) => t.kind === 'event' && t.text.startsWith('场景结束：')).map((t) => t.text.slice('场景结束：'.length));
    const take = ends.slice(-sceneIndex);
    take.forEach((summary, i) => {
      const scene = this.adventure.scenes[sceneIndex - take.length + i];
      if (!scene) return;
      this.memory.addRecap({ sceneId: scene.id, title: scene.title, summary, publicRecap: '', facts: [], rounds: 0 });
    });
    if (take.length) this.opts.logs.trace(`前情：老存档没有，从记录里补了 ${take.length} 幕`);
  }

  // ---------------------------------------------------------------- 场景
  private async applySceneEnd(): Promise<void> {
    const req = this.sceneEndRequest!;
    this.sceneEndRequest = null;
    // 场景一换怪物就清掉了：倒在这一幕里、还没发过经验的先发
    await this.grantCombatRewards();
    await this.speech?.idle(); // 这一幕最后一段旁白念完再换
    this.recordSceneRecap(req.summary, req.publicRecap);
    if (this.gameEndSummary) {
      this.finishGame(this.gameEndSummary);
      return;
    }
    let nextIndex = req.nextSceneId ? this.adventure.scenes.findIndex((s) => s.id === req.nextSceneId) : this.sceneIndex + 1;
    if (req.nextSceneId && nextIndex < 0) {
      // 以前这里 findIndex 得到 -1 就走「一场结束」，GM 写错一个 id 整个 one-shot 就没了：退回按顺序进下一幕
      this.opts.logs.trace(`换幕：GM 给的 next_scene_id「${req.nextSceneId}」不存在，改成按顺序进下一幕`);
      nextIndex = this.sceneIndex + 1;
    }
    if (nextIndex < 0 || nextIndex >= this.adventure.scenes.length) {
      this.finishGame(req.summary);
      return;
    }
    for (const actor of [...this.engine.actors.values()]) {
      if (actor.kind === 'monster') this.engine.removeActor(actor.id);
    }
    this.engine.endCombat();
    this.phase = 'explore';
    this.sceneIndex = nextIndex;
    this.scene = this.adventure.scenes[nextIndex];
    this.engine.setMapInfo(this.scene.mapInfo);
    this.clock.loadScene(this.scene.environment ?? []); // 新场景从第 1 轮重新数
    this.progress.loadScene(this.scene.beats, this.scene.autoExit);
    this.directorOrders = null;
    this.lastDirectorRound = 0;
    this.worldPending = null;
    this.sceneLog = [];
    this.engine.placeParty();
    this.visibleActorIds.clear();
    for (const seat of PLAYER_SEATS) this.visibleActorIds.add(seat);
    this.ensureSceneCreatures();
    this.lastThought.clear();
    this.lastDecision.clear();
    this.currentSeat = null;
    this.gmSteps = 0;
    this.sceneIntroPending = true;
    this.pendingNote = null;
    this.lastMonsterId = null;
    this.monsterSteps = 0;
    this.combatSynced = false;
    this.transcript.push({ at: Date.now(), kind: 'scene', text: `新场景：${this.scene.title}` });
    this.publishScene();
    if (this.sync) {
      try {
        await this.sync.openScene(this.scene.map);
        // 新场景：先清掉上一场留下的 token / 先攻 / 迷雾，再按规则层补 token、画位置
        await this.sync.cleanupOrphanMonsters();
        await this.sync.resetInitiative();
        await this.sync.clearFog();
        await this.sync.syncAll(this.visibleActorIds);
        await this.syncActors();
        await this.applyPlayerFrame();
      } catch (e) {
        this.bus.publish('system', `Atlas 切场景失败：${clip((e as Error).message, 120)}`, 'soon');
      }
    }
    this.publishState();
    this.save();
    await sleep(this.opts.config.table.pacing.tScene * 1000);
  }

  private finishGame(summary: string): void {
    this.ended = true;
    this.phase = 'ended';
    this.engine.endCombat();
    this.transcript.push({ at: Date.now(), kind: 'event', text: `结束：${summary}` });
    this.bus.publish('scene_end', summary, 'immediate', { summary });
    this.opts.logs.trace(`one-shot 结束：${clip(summary, 80)}`);
    this.save();
  }

  private publishScene(): void {
    this.bus.publish('scene', `新场景：${this.scene.title}`, 'soon', {
      sceneId: this.scene.id,
      title: this.scene.title,
      index: this.sceneIndex,
      total: this.adventure.scenes.length,
      readAloud: this.scene.readAloud,
      publicNotes: this.scene.publicNotes,
    });
    this.transcript.push({ at: Date.now(), kind: 'scene', text: `场景：${this.scene.title}` });
  }

  // ---------------------------------------------------------------- 视图辅助
  private lastGmNarration(): string {
    const last = [...this.transcript].reverse().find((t) => t.kind === 'gm');
    return last?.text ?? '';
  }

  private publicEventLines(): string[] {
    return this.bus
      .recent(40)
      .filter((e) => ['gm_narration', 'roll', 'combat_start', 'combat_end', 'scene', 'suggestion_result'].includes(e.kind))
      .filter((e) => e.data?.secret !== true)
      .slice(-10)
      .map((e) => clip(e.text, 200));
  }

  private otherSeat(seat: SeatKey): SeatKey {
    return seat === 'player_a' ? 'player_b' : 'player_a';
  }

  private nextPlayerSeat(): SeatKey {
    const last = this.history[this.history.length - 1]?.seat;
    return last === 'player_a' ? 'player_b' : 'player_a';
  }

  private playerStates() {
    return PLAYER_SEATS.map((seat) => {
      const a = this.engine.require(seat);
      // tags：濒死 / 稳定 / 死亡 → 负面状态与效果 → 增益（法术、狂暴…），overlay 用它分颜色并在放不下时自动滚动；
      // conditions 是同一批的纯文字，留给不认 tags 的旧页面
      const tags = statusTags(a, this.engine.isRaging(a));
      return {
        seat,
        name: a.name,
        role: a.charClass ?? '',
        hp: a.hp,
        maxHp: this.engine.maxHpOf(a),
        ac: this.engine.acOf(a),
        gold: coinChip(a),
        conditions: tags.map((t) => t.text),
        tags,
        expression: this.expressions[seat],
        reasoningKind: seat === 'player_a' ? 'raw' : 'summary',
      };
    });
  }

  /**
   * 回合条（overlay 底栏用）：这一轮每个会动的位子，行动过的打勾，当前的高亮。
   * 战斗里是先攻顺序 + 到点的环境；探索里是 PC + 场上看得见的生物 + 到点的环境。玩家看不到的（秘密环境、藏着的生物）不列。
   */
  private rosterState() {
    const combat = this.engine.combat;
    type Row = { actorId: string; name: string; seat: SeatKey | null; kind: 'pc' | 'monster' | 'env'; initiative: number | null; current: boolean; done: boolean };
    const rows: Row[] = [];
    if (combat.active) {
      combat.order.forEach((o, index) => {
        const a = this.engine.get(o.actorId);
        rows.push({
          actorId: o.actorId,
          name: a?.name ?? o.actorId,
          seat: (a?.seat as SeatKey | undefined) ?? null,
          kind: a?.kind ?? 'monster',
          initiative: o.initiative,
          current: index === combat.index,
          done: index < combat.index,
        });
      });
    } else {
      const next = this.currentSeat ?? this.clock.nextSeat((s) => this.canTakeTurn(s));
      for (const seat of PLAYER_SEATS) {
        rows.push({
          actorId: seat,
          name: this.engine.get(seat)?.name ?? seat,
          seat,
          kind: 'pc',
          initiative: null,
          current: seat === next,
          done: this.clock.acted.has(seat),
        });
      }
      for (const a of this.engine.actors.values()) {
        if (a.kind === 'pc' || a.hp <= 0 || a.deathSaves.dead || !this.visibleActorIds.has(a.id)) continue;
        rows.push({ actorId: a.id, name: a.name, seat: null, kind: 'monster', initiative: null, current: false, done: this.clock.worldDone.has(a.id) });
      }
    }
    for (const e of this.clock.envThisRound()) {
      if (e.secret) continue;
      rows.push({ actorId: e.id, name: e.name, seat: null, kind: 'env', initiative: null, current: false, done: this.clock.worldDone.has(e.id) });
    }
    return rows;
  }

  /** 给玩家看的一行：现在是第几轮、你是本轮第几位、队友动过没有（探索）；战斗里同时标出战斗轮号。 */
  private roundLineFor(seat: SeatKey): string {
    const combat = this.engine.combat;
    if (combat.active) return `桌面第 ${this.clock.round} 轮（战斗第 ${combat.round} 轮，按先攻行动）`;
    const order = PLAYER_SEATS.filter((s) => this.canTakeTurn(s));
    const mine = order.indexOf(seat) + 1;
    const mates = order
      .filter((s) => s !== seat)
      .map((s) => `${this.characters[s]?.name ?? s}${this.clock.acted.has(s) ? '这一轮已经行动过了' : '这一轮还没行动'}`);
    return `第 ${this.clock.round} 轮，你是本轮第 ${mine || 1} 位行动${mates.length ? `；${mates.join('；')}` : ''}。每一轮每个人只行动一次，做完这一轮的事就等下一轮。`;
  }

  publishState(note?: string): void {
    this.bus.publish('state', note ?? '状态更新', 'later', {
      players: this.playerStates(),
      phase: this.phase,
      round: this.clock.round,
      combatRound: this.engine.combat.active ? this.engine.combat.round : null,
      scene: this.scene.title,
      sceneId: this.scene.id,
      sceneIndex: this.sceneIndex,
      sceneTotal: this.adventure.scenes.length,
      turn: this.engine.currentActor()?.name ?? null,
      activeSeat: this.engine.currentActor()?.seat ?? null,
      combat: this.engine.combat.active,
      initiative: this.rosterState(),
      beats: { done: this.progress.done.size, total: this.progress.total },
      paused: this.paused,
    });
  }

  // ---------------------------------------------------------------- 协议
  status(): LinkStatus {
    const current = this.engine.currentActor();
    return {
      game: 'trpg',
      online: true,
      paused: this.paused,
      planner: {
        thinking: this.thinking,
        executing: this.executing,
        pending: this.currentSeat ? 1 : 0,
        givenUp: false,
      },
      lastCommand: this.lastCommand,
      latestEventSeq: this.bus.latest,
      table: {
        phase: this.phase,
        round: this.clock.round,
        turn: this.currentSeat
          ? this.characters[this.currentSeat]?.name ?? null
          : current
            ? `${current.name}${current.kind === 'monster' ? '（怪物）' : ''}`
            : null,
        scene: this.scene.title,
        sceneId: this.scene.id,
        sceneIndex: this.sceneIndex,
        speaking: this.speech?.busy ?? false,
        players: PLAYER_SEATS.map((seat) => {
          const a = this.engine.require(seat);
          return {
            seat,
            name: a.name,
            hp: a.hp,
            maxHp: a.maxHp,
            expression: this.expressions[seat],
            thinking: this.thinking && this.currentSeat === seat,
          };
        }),
      },
      control: { paused: this.paused, mode: this.dryRun ? 'dry-run' : 'agent' },
    };
  }

  eventsAfter(seq: number): { events: TableEvent[]; latest: number } {
    return this.bus.after(seq);
  }

  addSuggestion(text: string): { status: number; body: Record<string, unknown> } {
    const r: SuggestionAdd = this.suggestions.add(text);
    if (!r.ok) {
      const status = r.code === 'disabled' ? 403 : r.code === 'duplicate' ? 409 : 400;
      return { status, body: { ok: false, code: r.code, message: r.message } };
    }
    this.lastCommand = { text: r.suggestion.text, at: r.suggestion.at };
    this.opts.logs.table.record({ kind: 'suggestion_in', id: r.suggestion.id, text: r.suggestion.text });
    for (const old of r.expired) {
      this.bus.publish('system', 'Helixus 的旧建议已作废（最多保留 2 条）。', 'later');
    }
    return { status: 200, body: { ok: true, id: r.suggestion.id } };
  }

  setPaused(paused: boolean): void {
    if (this.paused === paused) return;
    this.paused = paused;
    this.bus.publish('pause', paused ? '桌面暂停（停在这一步之后）。' : '桌面继续。', 'soon', { paused });
    this.opts.logs.trace(paused ? '暂停' : '继续');
    if (!paused) {
      const waiters = this.waitingForResume.splice(0);
      waiters.forEach((w) => w());
    }
    this.publishState();
  }

  isPaused(): boolean {
    return this.paused;
  }

  forget(): void {
    this.suggestions.clear();
    this.pendingNote = null;
    this.bus.publish('system', '已清空 Helixus 的建议和一步笔记。', 'later');
    this.opts.logs.trace('forget');
  }

  heartbeat(): void {
    // 给 link 的 /status 用：没有真实心跳也保持 online true
  }

  // ---------------------------------------------------------------- 存档
  snapshot(): TableSnapshot {
    return {
      version: 1,
      campaignVault: this.opts.config.paths.campaignVault,
      adventure: this.adventure.id,
      sceneId: this.scene.id,
      sceneIndex: this.sceneIndex,
      phase: this.phase,
      round: this.clock.round,
      turnSeat: this.currentSeat,
      history: this.history,
      transcript: this.transcript.slice(-120),
      summary: this.buildSummary(),
      visibleActorIds: [...this.visibleActorIds],
      sceneFlags: {},
      seq: this.bus.latest,
      updatedAt: Date.now(),
      rules: this.engine.snapshot(),
      clock: this.clock.snapshot(),
      memory: this.memory.snapshot(),
      lootTaken: [...this.lootTaken],
      progress: this.progress.snapshot(),
    };
  }

  private buildSummary(): string {
    return this.transcript
      .filter((t) => t.kind === 'gm' || t.kind === 'event' || t.kind === 'scene')
      .slice(-8)
      .map((t) => clip(t.text, 80))
      .join(' / ');
  }

  /** 快照当场取，写盘排队一个接一个：几次存档挨得很近时，最后一次一定最后落盘（并发写可能让旧快照盖掉新的）。 */
  save(): void {
    const snap = this.snapshot();
    this.saving = this.saving
      .then(() => atomicWriteJson(this.statePath, snap))
      .catch((e) => {
        this.opts.logs.trace(`存档失败：${(e as Error).message}`);
      });
  }

  /** 等排队的存档都写完（停机、测试用）。 */
  async flushSave(): Promise<void> {
    await this.saving;
  }

  private async restore(): Promise<boolean> {
    let snap: TableSnapshot | null;
    try {
      snap = await readJsonIfExists<TableSnapshot>(this.statePath);
    } catch {
      return false;
    }
    if (!snap || snap.version !== 1 || snap.adventure !== this.adventure.id) return false;
    const rules = snap.rules as { combat?: unknown; actors?: Actor[]; rollLog?: RollResult[] } | undefined;
    if (!rules?.actors?.length) return false;
    const idx = this.adventure.scenes.findIndex((s) => s.id === snap!.sceneId);
    this.sceneIndex = idx >= 0 ? idx : Math.min(snap.sceneIndex ?? 0, this.adventure.scenes.length - 1);
    this.scene = this.adventure.scenes[this.sceneIndex];
    // 先决定场景、写入地图信息，再恢复规则层位置（老存档的默认格要落在能站的地方）
    this.engine.setMapInfo(this.scene.mapInfo);
    this.engine.load(rules as Parameters<RulesEngine['load']>[0]);
    this.history.length = 0;
    this.history.push(...(snap.history ?? []));
    this.transcript.length = 0;
    this.transcript.push(...(snap.transcript ?? []));
    this.visibleActorIds.clear();
    for (const id of snap.visibleActorIds ?? []) this.visibleActorIds.add(id);
    this.phase = snap.phase ?? 'explore';
    this.currentSeat = snap.turnSeat ?? null;
    // 回合计：老存档没有，就按这个场景从第 1 轮开始数（场景自带的环境条目照常装上）
    this.clock.loadScene(this.scene.environment ?? []);
    this.progress.loadScene(this.scene.beats, this.scene.autoExit);
    if (snap.progress) this.progress.load(snap.progress);
    if (snap.clock) this.clock.load(snap.clock);
    this.lootTaken.clear();
    for (const k of snap.lootTaken ?? []) this.lootTaken.add(k);
    if (snap.memory) this.memory.load(snap.memory);
    else this.backfillMemory(snap.transcript ?? [], this.sceneIndex);
    this.bus.resetTo(snap.seq ?? 0);
    this.ended = this.phase === 'ended';
    this.sceneIntroPending = !this.transcript.some((t) => t.kind === 'gm');
    for (const seat of PLAYER_SEATS) {
      const actor = this.engine.get(seat);
      if (!actor) continue;
      // 人设是内容、不是状态：存档里的旧人设不能盖过角色卡文件现在写的（改了人设不用 --fresh 重开）
      const fresh = this.characters[seat];
      if (fresh?.persona) actor.persona = fresh.persona;
      if (fresh?.aliases?.length) actor.aliases = [...fresh.aliases];
      this.characters[seat] = actor;
    }
    return true;
  }

  /** overlay 连上时先同步一份当前状态（不发事件、不改 seq） */
  overlayState(): Record<string, unknown> {
    return {
      players: this.playerStates(),
      phase: this.phase,
      round: this.clock.round,
      combatRound: this.engine.combat.active ? this.engine.combat.round : null,
      scene: this.scene.title,
      sceneId: this.scene.id,
      sceneIndex: this.sceneIndex,
      sceneTotal: this.adventure.scenes.length,
      turn: this.engine.currentActor()?.name ?? this.characters[this.currentSeat ?? 'player_a']?.name ?? null,
      activeSeat: this.engine.currentActor()?.seat ?? this.currentSeat,
      combat: this.engine.combat.active,
      initiative: this.rosterState(),
      beats: { done: this.progress.done.size, total: this.progress.total },
      paused: this.paused,
      adventure: this.adventure.title,
      seq: this.bus.latest,
      narration: this.lastGmNarration(),
      thoughts: Object.fromEntries(this.lastThought),
      decisions: Object.fromEntries(this.lastDecision),
    };
  }
}
