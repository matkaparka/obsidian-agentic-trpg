import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { spawnMonster } from '../src/rules/engine.js';
import { loadAdventure } from '../src/table/content.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { TableLoop } from '../src/table/loop.js';
import type { PlayerDecision } from '../src/table/types.js';
import type { SpeechService } from '../src/tts/speech.js';
import { projectRoot, sleep } from '../src/util.js';

const dirs: string[] = [];

afterEach(() => {
  // 临时目录留给系统清理；这里只清标记
  dirs.length = 0;
});

function makeConfig() {
  const root = projectRoot();
  const dir = mkdtempSync(join(tmpdir(), 'trpg-test-'));
  dirs.push(dir);
  const config = loadConfig(root);
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.startPaused = true;
  config.table.limits.gmMaxToolCalls = 8;
  return { config, dir };
}

function makeLoop(config: ReturnType<typeof makeConfig>['config'], dir: string) {
  const logs = createLogs(dir);
  const llm = new FakeLLM(config, logs);
  const adventure = loadAdventure(config.paths.campaignVault, 'crashed-ship');
  const party = makeDefaultParty();
  return {
    logs,
    loop: new TableLoop({
      config,
      llm,
      logs,
      adventure,
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(42)),
      dryRun: true,
      resume: true,
    }),
  };
}

describe('TableLoop（假模型，dry-run）', () => {
  it('能连续跑 GM → 玩家 → GM，并落盘日志与存档', async () => {
    const { config, dir } = makeConfig();
    const { loop, logs } = makeLoop(config, dir);
    await loop.init();
    expect(loop.status().paused).toBe(true);

    loop.setPaused(false);
    loop.start();
    await sleep(1200);
    await loop.stop();

    expect(loop.history.length).toBeGreaterThan(0);
    const kinds = loop.eventsAfter(0).events.map((e) => e.kind);
    expect(kinds).toContain('scene');
    expect(kinds).toContain('gm_narration');
    expect(kinds).toContain('decision');
    expect(kinds).toContain('thought');

    const status = loop.status();
    expect(status.game).toBe('trpg');
    expect(status.table.players).toHaveLength(2);
    expect(status.table.scene).toContain('甲板');
    expect(status.table.speaking).toBe(false); // 没接配音

    const tableLog = join(dir, 'logs', 'table.jsonl');
    expect(existsSync(tableLog)).toBe(true);
    await logs.table.flush();
    const text = readFileSync(tableLog, 'utf8');
    expect(text).toContain('player_turn');
    expect(text).toContain('reasoning');
    expect(text).toContain('gm_turn');

    const statePath = join(dir, 'state', 'table.json');
    expect(existsSync(statePath)).toBe(true);
    const snap = JSON.parse(readFileSync(statePath, 'utf8')) as { history: unknown[]; sceneId: string };
    expect(snap.history.length).toBe(loop.history.length);
    expect(snap.sceneId).toBe(loop.scene.id);

    // 原始思维链绝不能出现在事件里
    const allEventText = loop.eventsAfter(0).events.map((e) => JSON.stringify(e)).join('\n');
    expect(allEventText).not.toContain('我盯着那只箱子，先别让她看见');
  });

  it('重启后从 state/table.json 接着跑，不从头开始', async () => {
    const { config, dir } = makeConfig();
    const first = makeLoop(config, dir);
    await first.loop.init();
    first.loop.setPaused(false);
    first.loop.start();
    await sleep(700);
    await first.loop.stop();
    const historyLen = first.loop.history.length;
    expect(historyLen).toBeGreaterThan(0);
    const sceneId = first.loop.scene.id;
    const seq = first.loop.bus.latest;

    const second = makeLoop(config, dir);
    await second.loop.init();
    expect(second.loop.scene.id).toBe(sceneId);
    expect(second.loop.history.length).toBe(historyLen);
    expect(second.loop.bus.latest).toBeGreaterThanOrEqual(seq);
    expect(second.loop.status().paused).toBe(true);
  });

  it('status().table.speaking 跟着配音的 busy 走（Helixus 页面据此不抢话）', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    await loop.init();
    const voice = { busy: false };
    loop.attachSpeech(voice as unknown as SpeechService);
    expect(loop.status().table.speaking).toBe(false);
    voice.busy = true;
    expect(loop.status().table.speaking).toBe(true);
  });
});

type ExecResult = { ok: boolean; summary: string; rolls: unknown[]; errors: string[] };

function execAction(loop: TableLoop, seat: 'player_a' | 'player_b', decision: PlayerDecision): Promise<ExecResult> {
  const fn = (
    loop as unknown as {
      executePlayerAction: (s: 'player_a' | 'player_b', d: PlayerDecision) => Promise<ExecResult>;
    }
  ).executePlayerAction;
  return fn.call(loop, seat, decision);
}

function enterCombat(loop: TableLoop): void {
  loop.engine.combat = {
    active: true,
    round: 1,
    order: [
      { actorId: 'player_a', initiative: 20, dex: 10 },
      { actorId: 'player_b', initiative: 10, dex: 10 },
    ],
    index: 0,
  };
  loop.engine.beginTurn('player_a');
  loop.engine.require('player_a').position = { col: 4, row: 3 };
  loop.engine.require('player_b').position = { col: 6, row: 3 };
}

describe('TableLoop：整场战斗走真规则层（假模型）', () => {
  it('怪物多攻、玩家倒地后自动死亡豁免、没有桌面出错，战斗能一直推进', async () => {
    const { config, dir } = makeConfig();
    const { loop, logs } = makeLoop(config, dir);
    await loop.init();
    loop.setPaused(false);
    loop.start();
    // 等战斗打起来、至少转过两轮（假模型一次 30ms，几秒就够）
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      await sleep(150);
      if (loop.engine.combat.active && loop.engine.combat.round >= 3) break;
      if (!loop.engine.combat.active && loop.eventsAfter(0).events.some((e) => e.kind === 'combat_end')) break;
    }
    await loop.stop();
    await logs.table.flush();

    // eventsAfter 一次最多 50 条：事件多了掷骰会被挤出去，读整个环形缓冲
    const events = loop.bus.recent(500);
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain('combat_start');
    const rollTexts = events.filter((e) => e.kind === 'roll').map((e) => String(e.text));
    // 鱼人多攻：一个回合里应该能看到啮咬、爪击 / 矛至少两种不同的攻击
    const monsterAttacks = rollTexts.filter((t) => /沙华鱼人\d.*→/.test(t) || /啮咬|爪击|矛/.test(t));
    expect(monsterAttacks.length).toBeGreaterThan(0);
    const errors = events.filter((e) => e.kind === 'system' && /桌面出错/.test(String(e.text)));
    expect(errors).toHaveLength(0);
    const text = readFileSync(join(dir, 'logs', 'table.jsonl'), 'utf8');
    expect(text).not.toContain('step_error');
  }, 30000);
});

describe('P1-2：带 cell 的行动先移动再做动作', () => {
  it('探索阶段 check 带 cell：先移动并更新位置，再交给动作', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    loop.engine.require('player_a').position = { col: 4, row: 3 };
    loop.engine.require('player_b').position = { col: 6, row: 3 };

    const res = await execAction(loop, 'player_a', {
      say: '我去货舱口看看。',
      action: { type: 'check', detail: '贴着货舱口查看', cell: { col: 5, row: 6 } },
      expression: 'thinking',
    });

    expect(res.ok).toBe(true);
    expect(loop.engine.positionOf('player_a')).toEqual({ col: 5, row: 6 });
    expect(loop.engine.require('player_a').turn.movementUsed).toBe(20); // 绕过货箱 A，比直线多一格
    expect(res.summary).toContain('移动');
    expect(res.summary).toContain('货舱口');
    expect(loop.eventsAfter(0).events.some((e) => e.kind === 'move')).toBe(true);
  });

  it('战斗阶段 check 带 cell 但超出剩余移动力：整次拒绝，位置不动', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    enterCombat(loop);

    const res = await execAction(loop, 'player_a', {
      say: '我冲过去。',
      action: { type: 'check', detail: '冲到右舷', cell: { col: 18, row: 3 } },
      expression: 'angry',
    });

    expect(res.ok).toBe(false);
    expect(res.errors[0]).toMatch(/最多还能走|走不到/);
    expect(loop.engine.positionOf('player_a')).toEqual({ col: 4, row: 3 });
    expect(loop.engine.require('player_a').turn.movementUsed).toBe(0);
    expect(loop.eventsAfter(0).events.some((e) => e.kind === 'move')).toBe(false);
    expect(loop.eventsAfter(0).events.some((e) => e.kind === 'system' && e.text.includes('没执行'))).toBe(true);
  });

  it('战斗阶段 attack 带 cell：先走到目标旁，再从新位置攻击（不再自动贴近）', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    enterCombat(loop);
    const goblin = spawnMonster('goblin', '靶子');
    goblin.position = { col: 8, row: 3 };
    loop.engine.addActor(goblin);
    loop.visibleActorIds.add(goblin.id);

    const res = await execAction(loop, 'player_a', {
      say: '别挡路。',
      action: { type: 'attack', target: '靶子', detail: '刺剑', cell: { col: 7, row: 3 } },
      expression: 'angry',
    });

    expect(res.ok).toBe(true);
    expect(loop.engine.positionOf('player_a')).toEqual({ col: 7, row: 3 });
    expect(loop.engine.require('player_a').turn.movementUsed).toBe(15);
    expect(res.summary).toMatch(/命中/);
    expect(res.rolls.length).toBeGreaterThan(0);
    expect(loop.engine.require('player_a').turn.actionUsed).toBe(true);
  });

  it('cell 写成了敌人站的格子：攻击改成自动贴近到相邻空格，不叠在一起、不整次作废', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    enterCombat(loop);
    const goblin = spawnMonster('goblin', '靶子');
    goblin.position = { col: 8, row: 3 };
    loop.engine.addActor(goblin);
    loop.visibleActorIds.add(goblin.id);

    const res = await execAction(loop, 'player_a', {
      say: '就是你了。',
      action: { type: 'attack', target: '靶子', detail: '刺剑', cell: { col: 8, row: 3 } },
      expression: 'angry',
    });

    expect(res.ok).toBe(true);
    const pos = loop.engine.positionOf('player_a')!;
    expect(loop.engine.distanceCells(pos, goblin.position!)).toBe(1);
    expect(loop.engine.occupiedBy(pos, 'player_a')).toBeNull();
    expect(res.summary).toMatch(/命中/);
  });

  it('cell 写成了别人站的格子（非攻击）：挪到离它最近的空格', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    loop.engine.require('player_a').position = { col: 4, row: 3 };
    loop.engine.require('player_b').position = { col: 6, row: 3 };

    const res = await execAction(loop, 'player_a', {
      say: '我挨着你站。',
      action: { type: 'check', detail: '看看他在干什么', cell: { col: 6, row: 3 } },
      expression: 'neutral',
    });

    expect(res.ok).toBe(true);
    const pos = loop.engine.positionOf('player_a')!;
    expect(pos).not.toEqual({ col: 6, row: 3 });
    expect(loop.engine.distanceCells(pos, { col: 6, row: 3 })).toBe(1);
  });
});

describe('TableLoop：用构建器造的角色打一整场', () => {
  it('野蛮人 + 牧师（构建器 5 级）：特性进了提示词，战斗正常推进、没有桌面出错', async () => {
    const { buildCharacter } = await import('../src/rules/build/index.js');
    const { actorFromCharacter } = await import('../src/rules/sheet.js');
    const { buildPlayerView } = await import('../src/table/view.js');
    const barb = buildCharacter({
      name: '格罗姆',
      race: 'half_orc',
      background: 'outlander',
      classes: [{ id: 'barbarian', level: 5, subclass: 'berserker' }],
      abilityScores: { str: 15, dex: 13, con: 14, int: 8, wis: 12, cha: 10 },
      skills: ['athletics', 'survival'],
      equipment: { armor: null, weapons: ['greataxe', 'handaxe'] },
    });
    const cleric = buildCharacter({
      name: '艾琳',
      race: 'lightfoot_halfling',
      background: 'acolyte',
      classes: [{ id: 'cleric', level: 5, subclass: 'life_domain' }],
      abilityScores: { str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 },
      skills: ['medicine', 'persuasion'],
      equipment: { armor: 'chain_mail', shield: true, weapons: ['mace'] },
    });
    expect(barb.errors).toEqual([]);
    expect(cleric.errors).toEqual([]);

    const { config, dir } = makeConfig();
    const logs = createLogs(dir);
    const llm = new FakeLLM(config, logs);
    const adventure = loadAdventure(config.paths.campaignVault, 'crashed-ship');
    const a = actorFromCharacter(barb.file, 'player_a', 'player_a');
    const b = actorFromCharacter(cleric.file, 'player_b', 'player_b');
    const loop = new TableLoop({
      config,
      llm,
      logs,
      adventure,
      characters: { player_a: a, player_b: b },
      rollSource: new LocalRollSource(mulberry32(11)),
      dryRun: true,
      resume: false,
    });
    await loop.init();

    // 提示词里能看到特性分组、资源、有效 AC
    const view = buildPlayerView({
      engine: loop.engine,
      selfId: 'player_a',
      visibleActorIds: new Set(['player_a', 'player_b']),
      sceneTitle: '测试',
      phase: 'explore',
      round: 0,
      gmNarration: '',
      publicEvents: [],
      otherPlayerSays: [],
      legalActions: loop.engine.legalActions('player_a'),
      inCombat: false,
    });
    expect(view.text).toContain('特性·要主动用');
    expect(view.text).toContain('狂暴');
    expect(view.text).toContain('特性：');
    expect(view.text).toContain(`AC ${loop.engine.acOf(a)}`);

    loop.setPaused(false);
    loop.start();
    const deadline = Date.now() + 25000;
    while (Date.now() < deadline) {
      await sleep(200);
      if (!loop.engine.combat.active && loop.eventsAfter(0).events.some((e) => e.kind === 'combat_end')) break;
    }
    await loop.stop();
    await logs.table.flush();
    const events = loop.eventsAfter(0).events;
    expect(events.map((e) => e.kind)).toContain('combat_start');
    expect(events.filter((e) => e.kind === 'system' && /桌面出错/.test(String(e.text)))).toHaveLength(0);
    expect(readFileSync(join(dir, 'logs', 'table.jsonl'), 'utf8')).not.toContain('step_error');
  }, 40000);
});

describe('TableLoop 配音挂钩', () => {
  it('旁白文字交给 narrator；玩家台词在回合里先 prepare、气泡出现时 release，然后 idle 等声音播完', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    const calls: string[] = [];
    const said: { who: string; text: string }[] = [];
    const prepared: { who: string; text: string }[] = [];
    // 只记录调用顺序的假配音（不连任何服务）
    const stub = {
      say: (who: string, text: string) => {
        calls.push(`say:${who}`);
        said.push({ who, text });
      },
      prepare: (who: string, text: string) => {
        calls.push(`prepare:${who}`);
        prepared.push({ who, text });
        return {
          chars: text.length,
          release: () => {
            calls.push(`release:${who}`);
            return Promise.resolve();
          },
        };
      },
      idle: () => {
        calls.push('idle');
        return Promise.resolve();
      },
    };
    loop.attachSpeech(stub as unknown as Parameters<typeof loop.attachSpeech>[0]);
    await loop.init();
    loop.setPaused(false);
    loop.start();
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline && !(prepared.length >= 1 && calls.filter((c) => c === 'idle').length >= 2)) await sleep(100);
    await loop.stop();

    // GM 的旁白文字和 gm_narration 事件是同一段
    const narrations = loop.eventsAfter(0).events.filter((e) => e.kind === 'gm_narration');
    expect(narrations.length).toBeGreaterThan(0);
    expect(said.length).toBeGreaterThan(0);
    expect(said.every((s) => s.who === 'narrator')).toBe(true);
    expect(narrations.map((e) => e.text)).toContain(said[0].text);
    // 玩家：先 prepare，再 release（气泡出现的时候），之后才轮到 idle
    const i = calls.findIndex((c) => c.startsWith('prepare:'));
    expect(i).toBeGreaterThanOrEqual(0);
    const who = calls[i].slice('prepare:'.length);
    expect(['player_a', 'player_b']).toContain(who);
    expect(calls.indexOf(`release:${who}`)).toBeGreaterThan(i);
    expect(prepared[0].text.length).toBeGreaterThan(0);
    // 决定事件的台词就是 prepare 的台词
    const decision = loop.eventsAfter(0).events.find((e) => e.kind === 'decision' && e.data?.seat === who);
    expect(String(decision?.data?.say)).toBe(prepared[0].text);
    // GM 回合结束后会等旁白念完
    expect(calls).toContain('idle');
  }, 20000);

  it('没挂配音时一切照旧（不报错、不多出 tts 事件）', async () => {
    const { config, dir } = makeConfig();
    const { loop } = makeLoop(config, dir);
    await loop.init();
    loop.setPaused(false);
    loop.start();
    await sleep(900);
    await loop.stop();
    expect(loop.eventsAfter(0).events.some((e) => e.kind === 'tts')).toBe(false);
    expect(loop.history.length).toBeGreaterThan(0);
  }, 20000);
});
