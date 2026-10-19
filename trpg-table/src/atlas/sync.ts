import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logs } from '../log.js';
import type { RulesEngine } from '../rules/engine.js';
import type { Actor, ConditionName, GridPos } from '../rules/types.js';
import { MONSTERS } from '../rules/data/monsters.js';
import { sleep } from '../util.js';
import type { AtlasClient } from './client.js';

export interface AtlasTokenSummary {
  id: string;
  name: string | null;
  imagePath?: string;
  hidden?: boolean;
  conditions?: unknown[];
  resources?: Record<string, { current?: number; max?: number }>;
  cell?: { col: number; row: number } | { q: number; r: number };
}

export interface AtlasSceneSummary {
  mapPath?: string;
  name?: string | null;
  grid?: { type?: string; cellSize?: number } | null;
  tokens?: AtlasTokenSummary[];
  initiative?: {
    isActive?: boolean;
    round?: number;
    currentIndex?: number;
    entries?: { id: string; name?: string; initiative?: number; active?: boolean; isNPC?: boolean }[];
  };
}

const CONDITION_IDS: Record<ConditionName, string> = {
  blinded: 'blinded',
  charmed: 'charmed',
  deafened: 'deafened',
  frightened: 'frightened',
  grappled: 'grappled',
  incapacitated: 'incapacitated',
  invisible: 'invisible',
  paralyzed: 'paralyzed',
  petrified: 'petrified',
  poisoned: 'poisoned',
  prone: 'prone',
  restrained: 'restrained',
  stunned: 'stunned',
  unconscious: 'unconscious',
  exhaustion: 'exhaustion',
  // Atlas 没有“躲藏”这个状态，用隐形的图标表示
  hidden: 'invisible',
};

interface TokenRecord {
  id: string;
  name: string;
  kind: 'pc' | 'monster';
  at: number;
}

interface TokenRegistry {
  version: 1;
  /** scenePath -> actorId -> token created/adopted by trpg-table */
  scenes: Record<string, Record<string, TokenRecord>>;
}

export interface AtlasSyncOptions {
  /** state/ 目录：用来记住 trpg-table 自己建过哪些 token，重开局才能只删自己的。 */
  stateDir?: string;
  /** 当前对玩家可见的 actor；怪物不在里面时 token 必须 hidden。 */
  isVisible?: (actorId: string) => boolean;
}

/**
 * 规则层 → Atlas 的镜像。规则层是权威；Atlas 只显示。
 * 每次写完回读核对；不一致记 warning，不让桌面崩。
 *
 * 位置、可见性、token 归属也在这里对齐：
 *  - 规则层 actor.position 是 token 位置的唯一来源；
 *  - 还没揭示的怪物 isHidden=true；
 *  - state/atlas-tokens.json 记下 trpg-table 建过的 token id，重开局只删自己的。
 */
export class AtlasSync {
  private readonly tokenOf = new Map<string, string>();
  private readonly lastConditions = new Map<string, string>();
  private readonly lastCell = new Map<string, string>();
  private readonly tokenCells = new Map<string, string>();
  private readonly lastHidden = new Map<string, boolean>();
  private readonly tokenImages = new Map<string, string>();
  private readonly imageSynced = new Set<string>();
  /** 座位换了角色后，认下来的旧 token 还要改成新名字：actorId → { tokenId, 旧名字 } */
  private readonly renameTo = new Map<string, { tokenId: string; from: string }>();
  private readonly lastExpressionAt = new Map<string, number>();
  private readonly lastExpressionPath = new Map<string, string>();
  private readonly vault: string;
  private readonly stateDir?: string;
  private readonly isVisible: (actorId: string) => boolean;
  private scenePath: string | null = null;
  private registry: TokenRegistry = { version: 1, scenes: {} };

  constructor(
    private readonly client: AtlasClient,
    private readonly engine: RulesEngine,
    private readonly logs: Logs,
    vault: string,
    opts: AtlasSyncOptions = {}
  ) {
    this.vault = vault;
    this.stateDir = opts.stateDir;
    this.isVisible = opts.isVisible ?? (() => true);
    this.loadRegistry();
  }

  tokenId(actorId: string): string | undefined {
    return this.tokenOf.get(actorId);
  }

  // ---------------------------------------------------------------- token 归属记录
  private get registryPath(): string | null {
    return this.stateDir ? join(this.stateDir, 'atlas-tokens.json') : null;
  }

  private loadRegistry(): void {
    const path = this.registryPath;
    if (!path || !existsSync(path)) return;
    try {
      const raw = JSON.parse(readFileSync(path, 'utf8')) as TokenRegistry;
      if (raw?.version === 1 && raw.scenes && typeof raw.scenes === 'object') this.registry = raw;
    } catch (e) {
      this.logs.trace(`读取 atlas-tokens.json 失败（按空记录处理）：${(e as Error).message}`);
    }
  }

  private saveRegistry(): void {
    const path = this.registryPath;
    if (!path) return;
    try {
      mkdirSync(this.stateDir!, { recursive: true });
      const tmp = `${path}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.registry, null, 2), 'utf8');
      renameSync(tmp, path);
    } catch (e) {
      this.logs.trace(`写 atlas-tokens.json 失败：${(e as Error).message}`);
    }
  }

  private sceneKey(): string {
    return this.scenePath ?? 'unknown';
  }

  private recordToken(actor: Actor, tokenId: string): void {
    const scene = this.sceneKey();
    this.registry.scenes[scene] ??= {};
    this.registry.scenes[scene][actor.id] = { id: tokenId, name: actor.name, kind: actor.kind, at: Date.now() };
    this.saveRegistry();
  }

  private forgetToken(actorId: string): void {
    const scene = this.sceneKey();
    const bucket = this.registry.scenes[scene];
    if (!bucket || !bucket[actorId]) return;
    delete bucket[actorId];
    if (!Object.keys(bucket).length) delete this.registry.scenes[scene];
    this.saveRegistry();
  }

  /** 打开剧本指定的场景（如果给了 map），否则沿用 Atlas 当前场景。 */
  async openScene(mapPath?: string): Promise<void> {
    if (mapPath) {
      try {
        await this.client.callJson('atlas_open_scene', { path: mapPath });
        this.scenePath = mapPath;
        await sleep(1500);
      } catch (e) {
        this.logs.trace(`Atlas 打开场景失败（${mapPath}）：${(e as Error).message}`);
      }
    }
    // 换了场景：旧 token id / 位置 / 可见性缓存全部作废，必须重新按名字映射。
    this.tokenOf.clear();
    this.lastConditions.clear();
    this.lastCell.clear();
    this.tokenCells.clear();
    this.lastHidden.clear();
    this.renameTo.clear();
    // 让 Obsidian 的玩家窗口显示地图（用户共享这个窗口；不调用 atlas_screenshot，避免置顶闪烁）
    try {
      await this.client.callJson('atlas_command', { id: 'atlas-vtt:show-map-in-player-window' });
    } catch {
      /* 命令可能在不同版本里改名；不影响桌面 */
    }
    await this.refreshTokens();
  }

  private async summary(): Promise<AtlasSceneSummary> {
    return this.client.callJson<AtlasSceneSummary>('atlas_scene_summary', { maxTokens: 120 });
  }

  private async refreshTokens(): Promise<AtlasSceneSummary> {
    const s = await this.summary();
    if (!this.scenePath && s.mapPath) this.scenePath = s.mapPath;
    const byId = new Map((s.tokens ?? []).map((t) => [t.id, t]));
    const actors = [...this.engine.actors.values()];
    for (const t of s.tokens ?? []) {
      if (!t.name) continue;
      const actor = actors.find((a) => a.name === t.name);
      if (actor) {
        this.tokenOf.set(actor.id, t.id);
        if (t.imagePath) this.tokenImages.set(actor.id, t.imagePath);
        const key = this.summaryCellKey(t);
        if (key) this.tokenCells.set(actor.id, key);
      }
    }
    // 记录里属于这个场景、且 token 还在的，直接用（名字被 GM 改过也能找到）
    const bucket = this.registry.scenes[this.sceneKey()] ?? {};
    for (const [actorId, rec] of Object.entries(bucket)) {
      if (!this.engine.get(actorId)) continue;
      if (byId.has(rec.id)) this.tokenOf.set(actorId, rec.id);
    }
    // 座位换了角色（同一个座位、名字变了）：旧 token 的头像还在用这个座位的图，认它当这个座位的 token，
    // 之后在 syncAll 里改成新名字，免得地图上留着旧角色、又补一个新的。
    for (const actor of actors) {
      if (actor.kind !== 'pc' || !actor.seat || this.tokenOf.has(actor.id)) continue;
      const mine = new RegExp(`(^|/)(${actor.seat}(-[a-z]+)?\\.png|sprites/${actor.seat}/)`);
      const t = (s.tokens ?? []).find((x) => x.imagePath && mine.test(x.imagePath.replace(/\\/g, '/')) && x.name && x.name !== actor.name);
      if (!t) continue;
      this.tokenOf.set(actor.id, t.id);
      this.tokenImages.set(actor.id, t.imagePath!);
      this.renameTo.set(actor.id, { tokenId: t.id, from: t.name! });
      const key = this.summaryCellKey(t);
      if (key) this.tokenCells.set(actor.id, key);
    }
    return s;
  }

  /**
   * 清掉自己建过、但规则层里已经没有的 token；也顺手清上一版留下的 SRD 怪物 token。
   * 不是 trpg-table 建的 token 不动（有记录时只认记录里的 id；无记录时只认 SRD 怪物名）。
   */
  async cleanupOrphanMonsters(): Promise<{ removed: string[] }> {
    try {
      const s = await this.summary();
      if (!this.scenePath && s.mapPath) this.scenePath = s.mapPath;
      const tokens = s.tokens ?? [];
      const byId = new Map(tokens.map((t) => [t.id, t]));
      const actors = [...this.engine.actors.values()];
      const currentNames = new Set(actors.map((a) => a.name));
      const knownMonsterNames = Object.values(MONSTERS).map((m) => m.name);
      const stale = new Map<string, string>();

      const bucket = this.registry.scenes[this.sceneKey()] ?? {};
      for (const [actorId, rec] of Object.entries(bucket)) {
        if (this.engine.get(actorId)) continue;
        if (byId.has(rec.id)) {
          stale.set(rec.id, rec.name);
        } else {
          delete bucket[actorId];
        }
      }
      // 兼容没有记录时的旧残留：只匹配 SRD 怪物名 + 编号，不碰作者放的 NPC。
      for (const t of tokens) {
        const name = t.name ?? '';
        if (!name || currentNames.has(name)) continue;
        if (knownMonsterNames.some((n) => name === n || new RegExp(`^${n}(\\d+|[甲乙丙丁戊己庚辛])$`).test(name))) {
          stale.set(t.id, name);
        }
      }

      const ids = [...stale.keys()];
      if (ids.length) {
        await this.client.callJson('atlas_remove_tokens', { ids });
        this.logs.trace(`Atlas 清理旧 token：${ids.map((id) => stale.get(id)).join('、')}`);
      }
      if (Object.keys(bucket).length) {
        for (const [actorId, rec] of Object.entries(bucket)) {
          if (!this.engine.get(actorId) && !byId.has(rec.id)) delete bucket[actorId];
        }
        if (!Object.keys(bucket).length) delete this.registry.scenes[this.sceneKey()];
      }
      this.saveRegistry();
      return { removed: ids };
    } catch (e) {
      this.logs.trace(`Atlas 清理旧 token 失败：${(e as Error).message}`);
      return { removed: [] };
    }
  }

  /** 重开局/进新场景：先验层重置，再清掉 Atlas 里上一场的先攻与迷雾。 */
  async resetInitiative(): Promise<void> {
    try {
      await this.client.callJson('atlas_initiative', { action: 'reset' });
      await this.client.callJson('atlas_initiative', { action: 'end' });
      await this.client.callJson('atlas_initiative', { action: 'tracker', open: false });
    } catch (e) {
      this.logs.trace(`Atlas 重置先攻失败：${(e as Error).message}`);
    }
  }

  /** 当前场景没有迷雾定义：重开局/进新场景清空，避免上一场的雾留在地图上。 */
  async clearFog(): Promise<number> {
    try {
      const list = await this.client.callJson<{ operations?: { id?: string }[]; count?: number }>('atlas_fog', {
        action: 'list',
        limit: 500,
      });
      const ids = (list.operations ?? []).map((o) => o.id).filter((x): x is string => !!x);
      if (ids.length) {
        await this.client.callJson('atlas_fog', { action: 'delete', ids });
        this.logs.trace(`Atlas 清空迷雾：${ids.length} 个操作`);
      }
      return ids.length;
    } catch (e) {
      this.logs.trace(`Atlas 清空迷雾失败：${(e as Error).message}`);
      return 0;
    }
  }

  /** 给 PC 和怪物补 token；已有同名 token 就复用。还没揭示的怪物 hidden=true。 */
  async syncAll(visible?: ReadonlySet<string>): Promise<void> {
    await this.refreshTokens();
    const actors = [...this.engine.actors.values()].filter((a) => a.kind === 'pc' || a.hp > 0);
    let index = 0;
    for (const actor of actors) {
      const slot = index++;
      if (this.tokenOf.has(actor.id)) {
        await this.renameStaleToken(actor);
        await this.refreshPcImage(actor);
        // 上一场/上一次进程留下的同名 token 可能还在别的位置：按规则层位置挪过去。
        const actual = this.tokenCells.get(actor.id) ?? '';
        const want = this.cellKey(actor.position);
        if (want && actual && actual !== want) {
          const tokenId = this.tokenOf.get(actor.id)!;
          try {
            await this.client.callJson('atlas_move_token', { id: tokenId, cell: actor.position });
            this.tokenCells.set(actor.id, want);
            this.lastCell.set(actor.id, want);
            this.logs.trace(`Atlas 校正 token 位置：${actor.name} ${actual} → ${want}`);
          } catch (e) {
            this.logs.trace(`Atlas 校正 token 位置失败（${actor.name}）：${(e as Error).message}`);
          }
        } else {
          this.lastCell.set(actor.id, actual || want);
        }
        continue;
      }
      if (!existsSync(this.vault)) {
        this.logs.trace('Atlas 同步：campaign vault 不存在，跳过补 token');
        return;
      }
      const imagePath = this.imageFor(actor);
      const cell = actor.position ?? this.defaultCell(actor, slot);
      const isVis = visible ? visible.has(actor.id) : this.isVisible(actor.id);
      const hidden = actor.kind === 'monster' && !isVis;
      try {
        const r = await this.client.callJson<{ id?: string }>('atlas_add_token', {
          imagePath,
          name: actor.name,
          cell,
          hidden,
          ...(actor.kind === 'pc' ? { data: { kind: 'character' } } : {}),
        });
        if (r.id) {
          this.tokenOf.set(actor.id, r.id);
          this.recordToken(actor, r.id);
          this.lastCell.set(actor.id, this.cellKey(cell));
          this.tokenCells.set(actor.id, this.cellKey(cell));
          this.lastHidden.set(actor.id, hidden);
          this.logs.trace(`Atlas 补 token：${actor.name} @ ${JSON.stringify(cell)} hidden=${hidden}（${imagePath}）`);
        }
      } catch (e) {
        this.logs.trace(`Atlas 补 token 失败（${actor.name}）：${(e as Error).message}`);
      }
    }
  }

  private renamedCount = 0;

  /**
   * 自上次调用以来，有几个旧角色的 token 被改成了新名字（座位换了角色）。
   * 先攻条里按旧名字建的条目也作废了，调用方应该重置先攻。
   */
  takeRenamed(): number {
    const n = this.renamedCount;
    this.renamedCount = 0;
    return n;
  }

  /** 这个座位上一个角色留下的 token：改成现在这个角色的名字。 */
  private async renameStaleToken(actor: Actor): Promise<void> {
    const pending = this.renameTo.get(actor.id);
    if (!pending) return;
    this.renameTo.delete(actor.id);
    try {
      await this.client.callJson('atlas_update_token', { id: pending.tokenId, updates: { name: actor.name } });
      this.renamedCount += 1;
      this.logs.trace(`Atlas 改 token 名字：${pending.from} → ${actor.name}`);
    } catch (e) {
      this.logs.trace(`Atlas 改 token 名字失败（${pending.from} → ${actor.name}）：${(e as Error).message}`);
    }
  }

  /** 复用上一局留下的 PC token 时，头像可能还是旧的 A / B 圆章：换成现在该用的（脸部裁图优先）。 */
  private async refreshPcImage(actor: Actor): Promise<void> {
    if (actor.kind !== 'pc' || this.imageSynced.has(actor.id)) return;
    this.imageSynced.add(actor.id);
    const tokenId = this.tokenOf.get(actor.id);
    const want = this.imageFor(actor);
    const cur = this.tokenImages.get(actor.id);
    if (!tokenId || !cur || cur === want) return;
    try {
      await this.client.callJson('atlas_update_token', { id: tokenId, updates: { imagePath: want } });
      this.tokenImages.set(actor.id, want);
      this.logs.trace(`Atlas 换头像：${actor.name} ${cur} → ${want}`);
    } catch (e) {
      this.logs.trace(`Atlas 换头像失败（${actor.name}）：${(e as Error).message}`);
    }
  }

  private cellKey(pos?: GridPos): string {
    return pos ? `${pos.col},${pos.row}` : '';
  }

  private summaryCellKey(token: AtlasTokenSummary): string {
    const cell = token.cell as { col?: number; row?: number; q?: number; r?: number } | undefined;
    if (!cell) return '';
    const col = cell.col ?? cell.q;
    const row = cell.row ?? cell.r;
    return typeof col === 'number' && typeof row === 'number' ? `${col},${row}` : '';
  }

  private imageFor(actor: Actor): string {
    if (actor.kind === 'pc' && actor.seat) {
      const face = `assets/tokens/faces/${actor.seat}-neutral.png`;
      if (existsSync(join(this.vault, face))) return face;
      const p = `sprites/${actor.seat}/neutral.png`;
      if (existsSync(join(this.vault, p))) return p;
      return `assets/tokens/${actor.seat}.png`;
    }
    const monsterId = actor.id.split(':')[0];
    // lmop/ 是凡达林模组 token 包（scripts/import_lmop_tokens.py 放进去的，文件名 = 怪物 id）
    for (const p of [`assets/tokens/${monsterId}.png`, `assets/tokens/lmop/${monsterId}.png`]) {
      if (existsSync(join(this.vault, p))) return p;
    }
    return 'assets/tokens/monster.png';
  }

  private defaultCell(actor: Actor, index: number): { col: number; row: number } {
    if (actor.kind === 'pc') return { col: 3 + index * 2, row: 3 };
    return { col: 5 + index * 2, row: 6 };
  }

  /** 写 HP / 状态 / 位置 / 可见性，然后回读核对。 */
  async syncActor(actor: Actor, visible?: ReadonlySet<string>): Promise<void> {
    let tokenId = this.tokenOf.get(actor.id);
    if (!tokenId) {
      await this.syncAll(visible);
      tokenId = this.tokenOf.get(actor.id);
    }
    if (!tokenId) return;
    try {
      await this.client.callJson('atlas_set_token_resources', {
        id: tokenId,
        resources: { hp: { current: Math.max(0, actor.hp), max: actor.maxHp } },
        overriddenMax: ['hp'],
      });
    } catch (e) {
      this.logs.trace(`Atlas 写 HP 失败（${actor.name}）：${(e as Error).message}`);
      return;
    }
    await this.syncConditions(actor, tokenId);
    await this.syncVisibility(actor, tokenId, visible);
    await this.syncPosition(actor, tokenId);
    await this.verifyActor(actor, tokenId);
  }

  private async syncConditions(actor: Actor, tokenId: string): Promise<void> {
    const active = actor.conditions.map((c) => CONDITION_IDS[c.name]).filter((x): x is string => !!x);
    const key = active.slice().sort().join(',');
    if (this.lastConditions.get(actor.id) === key) return;
    try {
      // atlas_clear_conditions 的参数是单数 id（不是 ids）
      await this.client.callJson('atlas_clear_conditions', { id: tokenId });
      for (const conditionId of active) {
        await this.client.callJson('atlas_set_condition', { ids: [tokenId], conditionId, active: true });
      }
      this.lastConditions.set(actor.id, key);
    } catch (e) {
      this.logs.trace(`Atlas 写状态失败（${actor.name}）：${(e as Error).message}`);
    }
  }

  /** 还没登场的怪物必须 hidden；visibleActorIds 是唯一依据。 */
  private async syncVisibility(actor: Actor, tokenId: string, visible?: ReadonlySet<string>): Promise<void> {
    const isVis = visible ? visible.has(actor.id) : this.isVisible(actor.id);
    const hidden = actor.kind === 'monster' && !isVis;
    if (this.lastHidden.get(actor.id) === hidden) return;
    try {
      await this.client.callJson('atlas_update_token', { id: tokenId, updates: { isHidden: hidden } });
      this.lastHidden.set(actor.id, hidden);
      this.logs.trace(`Atlas ${hidden ? '隐藏' : '揭示'} ${actor.name}`);
    } catch (e) {
      this.logs.trace(`Atlas 写可见性失败（${actor.name}）：${(e as Error).message}`);
    }
  }

  /** 规则层位置变了就 atlas_move_token；同一格不重复写。 */
  async moveActor(actor: Actor): Promise<{ moved: boolean; from?: string; to?: string }> {
    const tokenId = this.tokenOf.get(actor.id);
    if (!tokenId || !actor.position) return { moved: false };
    const to = this.cellKey(actor.position);
    const from = this.tokenCells.get(actor.id) ?? this.lastCell.get(actor.id);
    if (from === to) return { moved: false };
    const r = await this.client.callJson<{
      frameCheck?: {
        checked?: boolean;
        updated?: boolean;
        latencyMs?: number;
        diffPixels?: number;
        bbox?: { x: number; y: number; w: number; h: number } | null;
        reason?: string;
        from?: { col: number; row: number };
        to?: { col: number; row: number };
      };
    }>('atlas_move_token', { id: tokenId, cell: actor.position });
    const frame = r?.frameCheck;
    if (frame?.checked) {
      this.logs.table.record({
        kind: 'frame_check',
        actor: actor.name,
        from: frame.from,
        to: frame.to,
        updated: frame.updated,
        latencyMs: frame.latencyMs,
        diffPixels: frame.diffPixels,
        bbox: frame.bbox,
        reason: frame.reason,
      });
      if (!frame.updated) {
        this.logs.trace(
          `像素检查失败：${actor.name} @ ${to} 的 token 区域在 ${frame.latencyMs ?? '1000'}ms 内没有变化（${frame.reason ?? 'unknown'}）`
        );
      }
    }
    this.lastCell.set(actor.id, to);
    this.tokenCells.set(actor.id, to);
    return { moved: true, from, to };
  }

  private async syncPosition(actor: Actor, tokenId: string): Promise<void> {
    if (!actor.position) return;
    const to = this.cellKey(actor.position);
    if ((this.tokenCells.get(actor.id) ?? this.lastCell.get(actor.id)) === to) return;
    try {
      await this.client.callJson('atlas_move_token', { id: tokenId, cell: actor.position });
      this.lastCell.set(actor.id, to);
      this.tokenCells.set(actor.id, to);
    } catch (e) {
      this.logs.trace(`Atlas 移动 token 失败（${actor.name}）：${(e as Error).message}`);
    }
  }

  async verifyActor(actor: Actor, tokenId?: string): Promise<boolean> {
    const id = tokenId ?? this.tokenOf.get(actor.id);
    if (!id) return false;
    try {
      const s = await this.summary();
      const token = s.tokens?.find((t) => t.id === id);
      const hp = token?.resources?.hp;
      if (!token) {
        this.logs.trace(`Atlas 回读：找不到 ${actor.name} 的 token`);
        return false;
      }
      if (hp && (hp.current !== Math.max(0, actor.hp) || hp.max !== actor.maxHp)) {
        this.logs.trace(
          `Atlas 回读不一致（${actor.name}）：Atlas HP ${hp.current}/${hp.max}，规则层 ${actor.hp}/${actor.maxHp}`
        );
        return false;
      }
      const expectedHidden = actor.kind === 'monster' && !this.isVisible(actor.id);
      if (actor.kind === 'monster' && !!token.hidden !== expectedHidden) {
        this.logs.trace(`Atlas 回读不一致（${actor.name}）：hidden=${!!token.hidden}，期望 ${expectedHidden}`);
        return false;
      }
      return true;
    } catch (e) {
      this.logs.trace(`Atlas 回读失败（${actor.name}）：${(e as Error).message}`);
      return false;
    }
  }

  /** 战斗开始：token 进先攻栏、写入规则层掷出的先攻值、开始。 */
  async startCombat(order: { actorId: string; initiative: number }[]): Promise<void> {
    await this.syncAll();
    const ids = order.map((o) => this.tokenOf.get(o.actorId)).filter((x): x is string => !!x);
    if (!ids.length) return;
    try {
      await this.client.callJson('atlas_initiative', { action: 'reset' });
      await this.client.callJson('atlas_initiative', { action: 'add_tokens', ids });
      const list = await this.client.callJson<{ entries?: { id: string; name?: string; initiative?: number }[] }>(
        'atlas_initiative',
        { action: 'list' }
      );
      for (const entry of list.entries ?? []) {
        const actor = [...this.engine.actors.values()].find((a) => a.name === entry.name);
        if (!actor) continue;
        const o = order.find((x) => x.actorId === actor.id);
        if (!o) continue;
        await this.client.callJson('atlas_initiative', {
          action: 'update',
          id: entry.id,
          updates: { initiative: o.initiative, isNPC: actor.kind === 'monster' },
        });
      }
      await this.client.callJson('atlas_initiative', { action: 'config', autoSort: true });
      await this.client.callJson('atlas_initiative', { action: 'start' });
      await this.client.callJson('atlas_initiative', { action: 'tracker', open: true });
      // Atlas may keep insertion order until the next render. Align its currentIndex with the
      // rules layer before the first turn starts (this is what made the GM panel lag one actor).
      await this.alignTurn();
      // 回读核对
      const after = await this.client.callJson<{
        round?: number;
        currentIndex?: number;
        entries?: { name?: string; initiative?: number }[];
      }>('atlas_initiative', { action: 'list' });
      const expected = order
        .map((o) => `${this.engine.get(o.actorId)?.name}:${o.initiative}`)
        .sort()
        .join('|');
      const actual = (after.entries ?? []).map((e) => `${e.name}:${e.initiative}`).sort().join('|');
      if (expected !== actual) {
        this.logs.trace(`Atlas 先攻回读不一致：规则层 ${expected} / Atlas ${actual}`);
      }
      const cur = this.engine.currentActor();
      if (cur && after.entries?.[after.currentIndex ?? -1]?.name !== cur.name) {
        this.logs.trace(
          `Atlas 当前行动者仍不一致：规则层 ${cur.name} / Atlas ${after.entries?.[after.currentIndex ?? -1]?.name ?? '?'}`
        );
      }
    } catch (e) {
      this.logs.trace(`Atlas 先攻同步失败：${(e as Error).message}`);
    }
  }

  async nextTurn(): Promise<void> {
    try {
      await this.client.callJson('atlas_initiative', { action: 'next' });
      await this.alignTurn();
    } catch (e) {
      this.logs.trace(`Atlas 先攻 next 失败：${(e as Error).message}`);
    }
  }

  /**
   * Make Atlas' currentIndex point at the rules layer's current actor. Atlas has its own turn
   * rotation; a GM `next_turn` that only advanced the engine used to leave the GM panel one
   * actor behind. Stepping with next/prev is the only exposed way to set the cursor.
   */
  async alignTurn(actorId?: string): Promise<{ aligned: boolean; atlasIndex: number; tableActor: string | null; steps: number }> {
    const target = actorId ? this.engine.get(actorId) : this.engine.currentActor();
    const entries = await this.client
      .callJson<{ currentIndex?: number; entries?: { id: string; tokenId?: string; name?: string }[] }>('atlas_initiative', { action: 'list' })
      .then((r) => r.entries ?? []);
    if (!target || !entries.length) return { aligned: false, atlasIndex: -1, tableActor: target?.name ?? null, steps: 0 };
    const tokenId = this.tokenOf.get(target.id);
    const indexOf = (list: { tokenId?: string; name?: string }[]) => {
      const byToken = tokenId ? list.findIndex((e) => e.tokenId === tokenId) : -1;
      return byToken >= 0 ? byToken : list.findIndex((e) => e.name === target.name);
    };
    let state = await this.client.callJson<{ currentIndex?: number; entries?: { id: string; tokenId?: string; name?: string }[] }>(
      'atlas_initiative',
      { action: 'list' }
    );
    let steps = 0;
    while (steps <= entries.length + 1) {
      const list = state.entries ?? [];
      const want = indexOf(list);
      const current = state.currentIndex ?? -1;
      if (want < 0) break;
      if (want === current) return { aligned: true, atlasIndex: current, tableActor: target.name, steps };
      await this.client.callJson('atlas_initiative', { action: want > current ? 'next' : 'prev' });
      steps += 1;
      state = await this.client.callJson('atlas_initiative', { action: 'list' });
    }
    const list = state.entries ?? [];
    const got = list[state.currentIndex ?? -1]?.name ?? null;
    if (steps) this.logs.trace(`Atlas 先攻对齐 ${target.name}：走了 ${steps} 步（Atlas 现在 ${got ?? '?'}）`);
    return { aligned: got === target.name, atlasIndex: state.currentIndex ?? -1, tableActor: target.name, steps };
  }

  async endCombat(): Promise<void> {
    try {
      await this.client.callJson('atlas_initiative', { action: 'end' });
    } catch {
      /* 场景可能已经关了 */
    }
  }

  /**
   * 表情上棋子头像：把 sprites/<seat>/<expr>.png 的裁好的脸部图写到 token.imagePath。
   * 同一棋子 3 秒内最多换一次；裁图文件不存在时保留原头像。
   */
  async setTokenExpression(seat: string, expression: string): Promise<void> {
    const tokenId = this.tokenOf.get(seat);
    if (!tokenId) return;
    const now = Date.now();
    const last = this.lastExpressionAt.get(seat) ?? 0;
    if (now - last < 3000) return;
    const avatar = `assets/tokens/faces/${seat}-${expression}.png`;
    if (!existsSync(join(this.vault, avatar))) return;
    if (this.lastExpressionPath.get(seat) === avatar) return;
    try {
      await this.client.callJson('atlas_update_token', { id: tokenId, updates: { imagePath: avatar } });
      this.lastExpressionAt.set(seat, now);
      this.lastExpressionPath.set(seat, avatar);
    } catch (e) {
      this.logs.trace(`Atlas 换表情失败（${seat} → ${expression}）：${(e as Error).message}`);
    }
  }

  get currentScene(): string | null {
    return this.scenePath;
  }
}
