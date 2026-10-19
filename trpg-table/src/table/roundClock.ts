import { PLAYER_SEATS, type SeatKey } from './types.js';

/**
 * 回合计：桌面的“第 N 轮”。探索和战斗共用一条计数，每一轮里每个能动的角色和环境都要行动一次：
 *   探索：PC 按固定顺序各一次 → 世界回合（场上的生物 + 到点的环境条目）→ 关轮（计数 +1、持续时间走一格）
 *   战斗：先攻顺序里的每个人各一次（引擎管）→ 世界回合（到点的环境条目）→ 关轮
 * 这里只放纯逻辑（谁该行动、哪些环境到点、存档），不碰 LLM 和引擎，所以可以单独测。
 */

/** 剧本 `## 环境` 一行解析出来的条目（还没有 id 和进度）。 */
export interface SceneEnv {
  name: string;
  effect: string;
  first: number;
  every: number | null;
  secret: boolean;
}

/** 自己会动的环境：水位、天色、巡逻、倒计时。 */
export interface EnvEntry extends SceneEnv {
  id: string;
  source: 'scene' | 'gm';
  /** 最近一次已经登记过的轮次；同一轮不会再到点 */
  lastFired?: number;
}

/** 世界回合里的一个“位子”：场上的生物，或者到点的环境条目。 */
export interface WorldSlot {
  id: string;
  name: string;
  kind: 'creature' | 'env';
  /** 给 GM 看的说明：生物的现状，或者环境条目的效果（可以含秘密） */
  detail: string;
  secret: boolean;
}

export interface WorldRecord {
  did: string;
  secret: boolean;
  /** true = GM 没登记，桌面替它记了一个“没动静” */
  auto: boolean;
}

export interface RoundClockSnapshot {
  round: number;
  acted: SeatKey[];
  worldDone: Record<string, WorldRecord>;
  env: EnvEntry[];
  combatSeen: number;
  nextTimerId: number;
}

/** 这个条目在第 round 轮到点吗（不看 lastFired）。 */
export function envFires(e: Pick<SceneEnv, 'first' | 'every'>, round: number): boolean {
  if (round < e.first) return false;
  if (e.every === null) return round === e.first;
  return (round - e.first) % e.every === 0;
}

/** “每 3 轮（第 2 轮起）”之类的人话，给 GM 和日志看。 */
export function cadenceText(e: Pick<SceneEnv, 'first' | 'every'>): string {
  if (e.every === null) return `第 ${e.first} 轮`;
  if (e.every === 1) return e.first <= 1 ? '每轮' : `第 ${e.first} 轮起每轮`;
  return e.first === e.every ? `每 ${e.every} 轮` : `第 ${e.first} 轮起每 ${e.every} 轮`;
}

/** 下一次到点的轮次（含当前轮；不会再到点就是 null）。 */
export function nextFireRound(e: Pick<SceneEnv, 'first' | 'every'>, fromRound: number, lastFired?: number): number | null {
  const start = lastFired !== undefined && lastFired >= fromRound ? lastFired + 1 : fromRound;
  if (e.every === null) return e.first >= start ? e.first : null;
  if (start <= e.first) return e.first;
  const k = Math.ceil((start - e.first) / e.every);
  return e.first + k * e.every;
}

const SECRET_MARK = /[\[【](?:秘密|secret|隐藏)[\]】]/i;

/**
 * 解析 `## 环境` 段：每行 `- 名字｜节奏｜效果`，分隔符 `|` 或 `｜`。
 * 节奏：`每轮` / `每 3 轮` / `第 8 轮`（只在那一轮）/ `第 3 轮起每轮` / `第 3 轮起每 2 轮`。
 * 行里带 `[秘密]` 的条目玩家和观众都看不到（画面上不显示，GM 照常处理）。读不懂的行直接忽略。
 */
export function parseEnvironment(raw: string): SceneEnv[] {
  const out: SceneEnv[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const m = /^\s*[-*]\s*(.+)$/.exec(line);
    if (!m) continue;
    const secret = SECRET_MARK.test(m[1]);
    const parts = m[1].replace(SECRET_MARK, '').split(/[|｜]/).map((s) => s.trim());
    if (parts.length < 3 || !parts[0] || !parts[2]) continue;
    const cadence = parseCadence(parts[1]);
    if (!cadence) continue;
    out.push({ name: parts[0], effect: parts.slice(2).join('｜'), first: cadence.first, every: cadence.every, secret });
  }
  return out;
}

function parseCadence(text: string): { first: number; every: number | null } | null {
  const t = text.replace(/\s+/g, '');
  let m = /^第(\d+)轮起每(?:(\d+))?轮$/.exec(t);
  if (m) {
    const first = Number(m[1]);
    const every = m[2] ? Number(m[2]) : 1;
    return first >= 1 && every >= 1 ? { first, every } : null;
  }
  m = /^每(?:(\d+))?轮$/.exec(t);
  if (m) {
    const every = m[1] ? Number(m[1]) : 1;
    return every >= 1 ? { first: every, every } : null;
  }
  m = /^第(\d+)轮$/.exec(t);
  if (m) {
    const first = Number(m[1]);
    return first >= 1 ? { first, every: null } : null;
  }
  return null;
}

export class RoundClock {
  /** 本场景的第几轮（探索和战斗共用） */
  round = 1;
  /** 探索：本轮已经行动过的 PC */
  acted = new Set<SeatKey>();
  /** 本轮世界回合已经登记过的位子 */
  worldDone = new Map<string, WorldRecord>();
  env: EnvEntry[] = [];
  /**
   * 战斗已经“开了”的战斗轮号（0 = 现在不在战斗里）。引擎的战斗轮数增加了，
   * 说明上一个战斗轮结束了，要补一次环境的世界回合再关桌面轮。
   */
  combatSeen = 0;
  private nextTimerId = 1;

  /** 换场景 / 新桌面：从第 1 轮重新数，环境换成这个场景自己的。 */
  loadScene(entries: readonly SceneEnv[]): void {
    this.round = 1;
    this.acted.clear();
    this.worldDone.clear();
    this.combatSeen = 0;
    this.nextTimerId = 1;
    this.env = entries.map((e, i) => ({ ...e, id: `env:${i + 1}`, source: 'scene' as const }));
  }

  /** 探索：下一个该行动的 PC（固定顺序，已经行动过或不能行动的跳过）。 */
  nextSeat(eligible: (seat: SeatKey) => boolean = () => true): SeatKey | null {
    return PLAYER_SEATS.find((s) => !this.acted.has(s) && eligible(s)) ?? null;
  }

  markActed(seat: SeatKey): void {
    this.acted.add(seat);
  }

  /** 这一轮会动的环境条目（不管登记过没有），画面上的回合条用。 */
  envThisRound(round = this.round): EnvEntry[] {
    return this.env.filter((e) => envFires(e, round));
  }

  /** 这一轮到点、还没登记过的环境条目。 */
  dueEnv(round = this.round): EnvEntry[] {
    return this.envThisRound(round).filter((e) => e.lastFired !== round);
  }

  /** 登记一个位子这一轮做了什么。返回 false = 这一轮已经登记过了。 */
  register(id: string, rec: WorldRecord): boolean {
    if (this.worldDone.has(id)) return false;
    this.worldDone.set(id, rec);
    const env = this.env.find((e) => e.id === id);
    if (env) env.lastFired = this.round;
    return true;
  }

  /** 关轮：轮数 +1，本轮的行动记录清空；只触发一次的环境条目用完就摘掉。返回新的轮数。 */
  closeRound(): number {
    const closed = this.round;
    this.env = this.env.filter((e) => !(e.every === null && e.first <= closed));
    this.round += 1;
    this.acted.clear();
    this.worldDone.clear();
    return this.round;
  }

  /** GM 登记一个倒计时 / 周期事件。inRounds 轮之后第一次到点。 */
  addTimer(opts: { name: string; inRounds: number; every?: number | null; effect: string; secret?: boolean }): EnvEntry {
    const entry: EnvEntry = {
      id: `env:g${this.nextTimerId++}`,
      name: opts.name,
      effect: opts.effect,
      first: this.round + Math.max(1, Math.floor(opts.inRounds)),
      every: opts.every && opts.every >= 1 ? Math.floor(opts.every) : null,
      secret: !!opts.secret,
      source: 'gm',
    };
    this.env.push(entry);
    return entry;
  }

  /** 按 id 或名字取消一个环境条目。 */
  cancel(ref: string): EnvEntry | null {
    const i = this.env.findIndex((e) => e.id === ref || e.name === ref);
    if (i < 0) return null;
    return this.env.splice(i, 1)[0];
  }

  snapshot(): RoundClockSnapshot {
    return {
      round: this.round,
      acted: [...this.acted],
      worldDone: Object.fromEntries(this.worldDone),
      env: this.env.map((e) => ({ ...e })),
      combatSeen: this.combatSeen,
      nextTimerId: this.nextTimerId,
    };
  }

  load(snap: Partial<RoundClockSnapshot> | undefined | null): void {
    if (!snap) return;
    this.round = Number.isFinite(snap.round) && (snap.round as number) >= 1 ? (snap.round as number) : 1;
    this.acted = new Set((snap.acted ?? []).filter((s): s is SeatKey => PLAYER_SEATS.includes(s)));
    this.worldDone = new Map(Object.entries(snap.worldDone ?? {}));
    this.env = (snap.env ?? []).map((e) => ({ ...e }));
    this.combatSeen = snap.combatSeen ?? 0;
    this.nextTimerId = snap.nextTimerId ?? 1;
  }
}
