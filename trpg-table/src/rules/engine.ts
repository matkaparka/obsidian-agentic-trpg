import { uuid } from '../util.js';
import { d20Natural, diceTotal, doubleDiceFormula, formulaAverage, rollFormula } from './dice.js';
import { MONSTERS } from './data/monsters.js';
import { SPELLS, type SpellChoice, type SpellDef } from './data/spells.js';
import { WEAPONS } from './data/weapons.js';
import {
  applyDeathSaveRoll,
  describeTrack,
  freshDeathTrack,
  isMassiveDamage,
  onDamageAtZero,
  stableDeathTrack,
  STABILIZE_DC,
  type DeathSaveOutcome,
} from './logic/death.js';
import {
  attackContext,
  effectiveSpeed,
  exhaustionMaxHp,
  exhaustionRollState,
  incapacitatedBy,
  isIncapacitated as namesIncapacitated,
  mergeAdvantage,
  rollDerivation,
  INCAPACITATING,
} from './logic/conditions.js';
import { damageAdjust } from './logic/damage.js';
import {
  bardicDie,
  brutalCriticDice,
  breathDice,
  classLevelOr,
  critThreshold,
  DRACONIC_ANCESTRY,
  greatWeaponRerollBelow,
  halfProficiencyBonus,
  hasFeature,
  isMonkWeapon,
  martialArtsDie,
  rageDamage,
  smiteDice,
  styleAttackBonus,
  styleDamageBonus,
  weaponContext,
} from './features/passive.js';
import { creatureCover, isFlanking, leavesReachAt, terrainCover } from './logic/reach.js';
import { ATTACK_OPTIONS, USABLE_FEATURES } from './features/registry.js';
import { plannedSwings, swingsPerAction } from './logic/routines.js';
import { actorFromMonster, skillBonus } from './sheet.js';
import {
  addCoins,
  addItem,
  findItem,
  inventoryOf,
  itemLine,
  removeItem,
  spendCoins,
  type ItemStack,
  type NewItem,
} from './inventory.js';
import { levelForXp, xpForCr, xpForLevel, type XpAward, type XpDefeated, type XpGain } from './xp.js';
import {
  ABILITY_ZH,
  CONDITION_ZH,
  SKILLS,
  SKILL_ABILITY,
  SKILL_ZH,
  abilityMod,
  emptyTurn,
  type Ability,
  type ActiveEffect,
  type Actor,
  type Advantage,
  type AttackDef,
  type AttackMath,
  type AttackOptions,
  type AttackResult,
  type CastResult,
  type CellRange,
  type CheckOptions,
  type CombatState,
  type ConditionName,
  type DamageType,
  type DeathSaves,
  type GridPos,
  type Landmark,
  type LegalAction,
  type MapInfo,
  type MapPoint,
  type RollKind,
  type RollModFields,
  type RollResult,
  type RollSource,
  type Skill,
  type WaterRegion,
} from './types.js';

export interface RulesEngineOptions {
  rollSource: RollSource;
  onRoll?: (roll: RollResult) => void;
  /** 借机攻击：走位离开敌对生物触及范围时自动结算（默认开）。 */
  opportunityAttacks?: boolean;
  /** 夹击（DMG 可选规则，默认关）。 */
  flanking?: boolean;
  /** 自动反应：被攻击命中时，会护盾术的目标在护盾术能让这一击落空时自动施放（默认开）。 */
  autoReactions?: boolean;
}

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

/** 把加值骰接到公式后面：正的写 +1d4，负的（灾祸术 -1d4）本身带负号。 */
const diceTerm = (d: string): string => (d.startsWith('-') ? d : `+${d}`);

/** 加速术结束后的倦怠：状态 / 效果的来源标记 */
const LETHARGY = 'haste_lethargy';

const ROLL_MOD_KEYS = [
  'attackRoll',
  'attackersDisadvantageFrom',
  'saveEdges',
  'checkEdges',
  'skillBonuses',
  'saveBonuses',
  'maxHealing',
  'noReactions',
  'maxSwings',
] as const satisfies readonly (keyof RollModFields)[];

/** 只挑出掷骰修正那几个字段（没写的不带 undefined 键）；深拷贝，免得效果和法术数据共用同一个对象。 */
function rollModsOf(src?: RollModFields): RollModFields {
  const out: Record<string, unknown> = {};
  if (src) for (const k of ROLL_MOD_KEYS) if (src[k] !== undefined) out[k] = structuredClone(src[k]);
  return out as RollModFields;
}

/** 法术数据里 attackRoll.against 可以写 '$caster' / '$target'，施法时换成真实的 id。 */
function resolveMods(mods: RollModFields, caster: Actor, target: Actor): RollModFields {
  const a = mods.attackRoll;
  if (!a?.against) return mods;
  const against = a.against === '$caster' ? caster.id : a.against === '$target' ? target.id : a.against;
  return { ...mods, attackRoll: { ...a, against } };
}

/** 法术射程（尺）：触碰 5，自身 0，其余取字符串里的数字；读不出来 = 不限。 */
function spellRangeFeet(spell: SpellDef): number | null {
  if (spell.range.includes('触碰')) return 5;
  if (spell.range.startsWith('自身')) return 0;
  const m = /(\d+)\s*尺/.exec(spell.range);
  return m ? Number(m[1]) : null;
}

/** D&D 5e：一格 5 尺。地图边界（方格数）给移动/可达格用；比实际地图略大也不会越界。 */
const CELL_FEET = 5;
/** 战斗外的一轮约 1 分钟，等于 10 个 6 秒的战斗轮 */
const EXPLORATION_ROUND_TICKS = 10;
const BOARD_COLS = 32;
const BOARD_ROWS = 24;
const chebyshev = (a: GridPos, b: GridPos): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));
const cellKey = (c: GridPos): string => `${c.col},${c.row}`;
/** 8 邻接；顺序固定，BFS 结果可复现。 */
const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [1, 1],
  [0, 1],
  [-1, 1],
  [-1, 0],
  [-1, -1],
  [0, -1],
  [1, -1],
];

/** 一次借机攻击：谁打了谁，结果是什么。 */
export interface OpportunityOutcome {
  reactorId: string;
  targetId: string;
  result: AttackResult;
}

export interface ApproachResult {
  ok: boolean;
  movedCells: number;
  from?: GridPos;
  to?: GridPos;
  distanceCells: number;
  reason?: string;
  /** 走位引发的借机攻击（只有 approachWithReactions 会填） */
  opportunity?: OpportunityOutcome[];
  /** 被借机攻击打倒在半路：停在这一格 */
  downedAt?: GridPos;
}

export interface MoveToResult {
  ok: boolean;
  /** 不含起点的路径；最后一个是目标格 */
  path: GridPos[];
  cells: number;
  reason?: string;
  opportunity?: OpportunityOutcome[];
  downedAt?: GridPos;
}

/** 倒地（0 HP）时挂的昏迷 / 倒地的来源标记：治疗和复活只清这一种昏迷，不动睡眠术之类的。 */
const DYING_SOURCE = 'dying';

export interface DeathSaveResult {
  roll: RollResult;
  outcome: DeathSaveOutcome;
  track: DeathSaves;
}

/** 换回合时顺带发生的事（自动死亡豁免等），给调用方发事件用。 */
export interface TurnAdvance {
  actorId: string | null;
  notes: string[];
  rolls: RollResult[];
  /** 自动掷死亡豁免的角色，以及结果 */
  deathSaves: { actorId: string; outcome: string; roll: RollResult }[];
}

export interface ActionOutcome {
  ok: boolean;
  note: string;
  roll?: RollResult;
}

/** useFeature 的参数：目标、治疗量、模式、分配方案。 */
export interface FeatureArgs {
  targetId?: string;
  targetIds?: string[];
  /** 圣疗：治疗多少点 */
  amount?: number;
  /** 圣疗：poison / disease 表示解毒 / 解病；疾风步：dash / disengage */
  mode?: string;
  /** 保全生命：{ 角色 id: 治疗多少点 } */
  distribution?: Record<string, number>;
}

export interface FeatureOutcome {
  ok: boolean;
  note: string;
  rolls: RollResult[];
  /** 疾风连击、武艺附赠打击打出的攻击 */
  attacks?: AttackResult[];
}

export class RulesEngine {
  readonly actors = new Map<string, Actor>();
  combat: CombatState = { active: false, round: 0, order: [], index: 0 };
  rollLog: RollResult[] = [];

  private readonly rollSource: RollSource;
  private readonly onRoll?: (roll: RollResult) => void;
  private readonly opportunityAttacks: boolean;
  private readonly flanking: boolean;
  private readonly autoReactions: boolean;
  /** 当前场景地图；null = 没有地图数据，整块棋盘都能站。 */
  private map: MapInfo | null = null;

  constructor(opts: RulesEngineOptions) {
    this.rollSource = opts.rollSource;
    this.onRoll = opts.onRoll;
    this.opportunityAttacks = opts.opportunityAttacks ?? true;
    this.flanking = opts.flanking ?? false;
    this.autoReactions = opts.autoReactions ?? true;
  }

  // ---------------------------------------------------------------- 存取
  addActor(actor: Actor): Actor {
    this.actors.set(actor.id, actor);
    return actor;
  }

  get(id: string): Actor | undefined {
    return this.actors.get(id);
  }

  require(id: string): Actor {
    const a = this.actors.get(id);
    if (!a) throw new Error(`没有这个角色：${id}`);
    return a;
  }

  party(): Actor[] {
    return [...this.actors.values()].filter((a) => a.kind === 'pc');
  }

  livingMonsters(): Actor[] {
    return [...this.actors.values()].filter((a) => a.kind === 'monster' && a.hp > 0 && !a.deathSaves.dead);
  }

  removeActor(id: string): void {
    this.actors.delete(id);
    if (this.combat.active) {
      this.combat.order = this.combat.order.filter((o) => o.actorId !== id);
      this.combat.index = Math.max(0, Math.min(this.combat.index, this.combat.order.length - 1));
    }
  }

  // ---------------------------------------------------------------- 位置 / 移动
  /** 场景加载时由 TableLoop 写入；null / 缺省 = 没有地图数据，整块棋盘都能站。 */
  setMapInfo(info?: MapInfo | null): void {
    this.map = info ?? null;
  }

  get mapInfo(): MapInfo | null {
    return this.map;
  }

  private usingWholeBoard(): boolean {
    return !this.map || this.map.wholeBoard === true || this.map.standable.length === 0;
  }

  private pointInPolygon(x: number, y: number, polygon: MapPoint[]): boolean {
    let inside = false;
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      if (yi === yj) continue;
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }

  private cellInPolygon(cell: GridPos, polygon: MapPoint[]): boolean {
    return this.pointInPolygon(cell.col + 0.5, cell.row + 0.5, polygon);
  }

  private inCellRange(cell: GridPos, range: CellRange): boolean {
    return (
      cell.col >= range.col[0] &&
      cell.col <= range.col[1] &&
      cell.row >= range.row[0] &&
      cell.row <= range.row[1]
    );
  }

  /**
   * 水面是否“挖穿”了可站立地面：
   * 甲板外的海面包住整块甲板，甲板优先算可站立，海面只在地板外生效；
   * 货舱水洼 / 洞穴水池整个落在可站立区域里，会把地面挖掉，只有会游泳的能站。
   */
  private waterCutsFloor(water: WaterRegion): boolean {
    if (!this.map) return false;
    return this.map.standable.some((s) => water.polygon.every(([x, y]) => this.pointInPolygon(x, y, s.polygon)));
  }

  private cellKind(cell: GridPos): 'standable' | 'water' | 'blocked' | 'outside' {
    if (cell.col < 0 || cell.row < 0 || cell.col >= BOARD_COLS || cell.row >= BOARD_ROWS) return 'outside';
    if (this.usingWholeBoard()) return 'standable';
    const map = this.map!;
    if (map.blocked.some((b) => this.inCellRange(cell, b.cells))) return 'blocked';
    const stand = map.standable.some((s) => this.cellInPolygon(cell, s.polygon));
    const water = map.water.find((w) => this.cellInPolygon(cell, w.polygon));
    if (water && this.waterCutsFloor(water)) return 'water';
    if (stand) return 'standable';
    if (water) return 'water';
    return 'outside';
  }

  /** 这个角色能不能站在这一格：障碍/地图外不行；水面只有游泳速度 > 0 的行。 */
  canStandAt(actor: Actor, cell: GridPos): boolean {
    const rounded = { col: Math.round(cell.col), row: Math.round(cell.row) };
    const kind = this.cellKind(rounded);
    if (kind === 'standable') return true;
    if (kind === 'water') return (actor.swimSpeed ?? 0) > 0;
    return false;
  }

  /** 这一格上站着的、还活着的另一个角色（不算 except 自己）。同一格不能叠两个活人。 */
  occupiedBy(cell: GridPos, exceptId: string): Actor | null {
    for (const other of this.actors.values()) {
      if (other.id === exceptId || other.hp <= 0 || !other.position) continue;
      if (other.position.col === cell.col && other.position.row === cell.row) return other;
    }
    return null;
  }

  /** 敌对方站着的格子走不过去（PC 和怪物互为敌对）；自己人的格子可以穿过，但不能停在上面。 */
  private blockedByHostile(actor: Actor, cell: GridPos): boolean {
    const other = this.occupiedBy(cell, actor.id);
    return !!other && other.kind !== actor.kind;
  }

  /** 位置是规则层的东西：Atlas 只是把它画出来。老存档没有位置时补一个合法的默认格。 */
  ensurePositions(): void {
    let pcIndex = 0;
    let monsterIndex = 0;
    for (const actor of this.actors.values()) {
      if (actor.position) continue;
      const preferred =
        actor.kind === 'pc'
          ? { col: 4 + pcIndex++ * 2, row: 3 }
          : { col: 8 + monsterIndex++, row: 7 };
      actor.position = this.nearestStandableCell(actor, preferred) ?? { col: 4, row: 3 };
    }
  }

  /**
   * 场景开始：把 PC 放到地图信息里写的起始格（MapInfo.start）。格子不合法 / 被占就挪到最近的合法格；
   * 没写起始格的座位不动。返回有挪动的角色 id（调用方据此同步 token）。
   */
  placeParty(): string[] {
    const start = this.map?.start;
    if (!start) return [];
    const moved: string[] = [];
    for (const actor of this.actors.values()) {
      if (actor.kind !== 'pc' || !actor.seat) continue;
      const want = start[actor.seat];
      if (!want) continue;
      const cell = this.canStandAt(actor, want) && !this.occupiedBy(want, actor.id) ? { ...want } : this.nearestStandableCell(actor, want);
      if (cell && (cell.col !== actor.position?.col || cell.row !== actor.position?.row)) {
        actor.position = cell;
        moved.push(actor.id);
      }
    }
    return moved;
  }

  /** 这个怪物 id 的第 index 个出场格（MapInfo.spawns），合法就用，不合法 / 被占就挪到最近的合法格；没写返回 null。 */
  spawnCellFor(actor: Actor, monsterId: string, index: number): GridPos | null {
    const want = this.map?.spawns?.[monsterId]?.[index];
    if (!want) return null;
    return this.canStandAt(actor, want) && !this.occupiedBy(want, actor.id) ? { ...want } : this.nearestStandableCell(actor, want);
  }

  /** 离 near 最近的、这个角色能站且没人占的格子（给「cell 写成了别人站的格子」用）。 */
  nearestFreeCell(actor: Actor, near: GridPos): GridPos | null {
    return this.nearestStandableCell(actor, { col: Math.round(near.col), row: Math.round(near.row) });
  }

  /**
   * 离 want 最近、能站且没人占的格子；一样近的取离角色现在位置最近的——
   * 玩家要进红帐（格子是障碍）时停在帐门口这一侧，而不是被挪到帐篷另一边。
   */
  nearestCellToward(actor: Actor, want: GridPos): GridPos | null {
    const target = { col: Math.round(want.col), row: Math.round(want.row) };
    const from = actor.position ?? null;
    let best: GridPos | null = null;
    let bestDist = Infinity;
    let bestFrom = Infinity;
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cell = { col, row };
        if (!this.canStandAt(actor, cell) || this.occupiedBy(cell, actor.id)) continue;
        const d = chebyshev(cell, target);
        const df = from ? chebyshev(cell, from) : 0;
        if (d < bestDist || (d === bestDist && df < bestFrom)) {
          best = cell;
          bestDist = d;
          bestFrom = df;
        }
      }
    }
    return best;
  }

  /** 离 preferred 最近的合法格；地图很小，直接全盘扫描。 */
  private nearestStandableCell(actor: Actor, preferred: GridPos): GridPos | null {
    let best: GridPos | null = null;
    let bestDist = Infinity;
    for (let row = 0; row < BOARD_ROWS; row++) {
      for (let col = 0; col < BOARD_COLS; col++) {
        const cell = { col, row };
        if (!this.canStandAt(actor, cell)) continue;
        if (this.occupiedBy(cell, actor.id)) continue;
        const d = chebyshev(cell, preferred);
        if (d < bestDist) {
          best = cell;
          bestDist = d;
        }
      }
    }
    return best;
  }

  positionOf(actorId: string): GridPos | null {
    const p = this.actors.get(actorId)?.position;
    return p ? { ...p } : null;
  }

  /** 非法格子直接抛错，不悄悄夹到别的格子。棋盘边界仍然夹住（数字安全），越界本身算非法。 */
  setPosition(actorId: string, pos: GridPos): GridPos {
    const actor = this.require(actorId);
    const col = Math.round(pos.col);
    const row = Math.round(pos.row);
    if (!Number.isFinite(col) || !Number.isFinite(row)) throw new Error('目标格不是合法数字');
    const cell = {
      col: Math.max(0, Math.min(BOARD_COLS - 1, col)),
      row: Math.max(0, Math.min(BOARD_ROWS - 1, row)),
    };
    if (cell.col !== col || cell.row !== row) {
      throw new Error(`目标格 (${col},${row}) 在地图边界外`);
    }
    const kind = this.cellKind(cell);
    if (!this.canStandAt(actor, cell)) {
      throw new Error(`${actor.name} 不能站在 ${this.describeCell(cell)}（${kindText(kind)}）`);
    }
    const occupant = this.occupiedBy(cell, actor.id);
    if (occupant) throw new Error(`${this.describeCell(cell)} 已经站着 ${occupant.name}`);
    actor.position = cell;
    return { ...cell };
  }

  distanceCells(a: GridPos, b: GridPos): number {
    return chebyshev(a, b);
  }

  distanceFeet(a: GridPos, b: GridPos): number {
    return chebyshev(a, b) * CELL_FEET;
  }

  /** 状态名（小写英文），含“0 HP 的 PC 已经昏迷倒地”和“闪避”。给 logic/ 下的纯函数用。 */
  conditionNames(actor: Actor): string[] {
    const names: string[] = actor.conditions
      .filter((c) => (c.level ?? 1) > 0)
      .filter((c) => c.name !== 'grappled' || !c.grapplerId || !this.grapplerReleased(c.grapplerId, actor))
      .map((c) => c.name);
    if (actor.kind === 'pc' && actor.hp <= 0 && !actor.deathSaves.dead && !names.includes('unconscious')) names.push('unconscious');
    if (names.includes('unconscious') && !names.includes('prone')) names.push('prone');
    if (actor.turn.dodging) names.push('dodging');
    return names;
  }

  /** 擒抱者倒下 / 失能 / 离开触及范围，擒抱就松了。（只看原始状态，免得两个互相擒抱时无限递归） */
  private grapplerReleased(grapplerId: string, held: Actor): boolean {
    const g = this.actors.get(grapplerId);
    if (!g || g.hp <= 0 || g.deathSaves.dead) return true;
    if (g.conditions.some((c) => INCAPACITATING.includes(c.name))) return true;
    if (g.position && held.position && this.distanceFeet(g.position, held.position) > CELL_FEET) return true;
    return false;
  }

  /** 实际的 HP 上限（力竭 4 级减半）。 */
  maxHpOf(actor: Actor): number {
    return exhaustionMaxHp(this.exhaustion(actor), actor.maxHp);
  }

  /** 实际速度（尺）：状态和力竭的影响，不含疾走。 */
  speedOf(actor: Actor): number {
    const bonus = actor.effects.reduce((s, e) => s + (e.speedBonus ?? 0), 0);
    const mult = actor.effects.reduce((m, e) => m * (e.speedMultiplier ?? 1), 1);
    return effectiveSpeed(this.conditionNames(actor), Math.floor((actor.speed + bonus) * mult), this.exhaustion(actor));
  }

  movementCellsLeft(actor: Actor): number {
    const speed = this.speedOf(actor) * (actor.turn.dashed ? 2 : 1);
    return Math.max(0, Math.floor((speed - actor.turn.movementUsed) / CELL_FEET));
  }

  /** 战斗里从倒地站起来要花一半速度；探索阶段不花。 */
  private standUpCells(actor: Actor): number {
    if (!this.combat.active || !this.hasCondition(actor, 'prone')) return 0;
    return Math.ceil(Math.floor(this.speedOf(actor) / 2) / CELL_FEET);
  }

  /** 探索阶段没有回合速度限制；只是提示“附近”时用一次速度的范围。 */
  private nearbyBudget(actor: Actor): number {
    if (this.combat.active) return this.movementCellsLeft(actor);
    return Math.max(0, Math.floor(this.speedOf(actor) / CELL_FEET));
  }

  /** BFS：只走这个角色能站的格子。maxSteps 为 Infinity 时找出全图最短路。 */
  private findPath(actor: Actor, start: GridPos, goal: (cell: GridPos) => boolean, maxSteps: number): GridPos[] | null {
    if (goal(start)) return [];
    const parent = new Map<string, string | null>([[cellKey(start), null]]);
    const cells = new Map<string, GridPos>([[cellKey(start), start]]);
    let frontier: GridPos[] = [start];
    for (let dist = 1; dist <= maxSteps && frontier.length; dist++) {
      const next: GridPos[] = [];
      for (const cur of frontier) {
        for (const [dc, dr] of NEIGHBOURS) {
          const cell = { col: cur.col + dc, row: cur.row + dr };
          const key = cellKey(cell);
          if (parent.has(key)) continue;
          if (!this.canStandAt(actor, cell)) continue;
          if (this.blockedByHostile(actor, cell)) continue;
          parent.set(key, cellKey(cur));
          cells.set(key, cell);
          if (goal(cell)) return reconstructPath(parent, cells, key);
          next.push(cell);
        }
      }
      frontier = next;
    }
    return null;
  }

  /** 速度范围内能走到的格子（给 legalActions / 玩家提示词看；最多 limit 个，按距离排序）。 */
  reachableCells(actor: Actor, limit = 12): GridPos[] {
    const start = actor.position;
    if (!start) return [];
    const budget = this.nearbyBudget(actor);
    if (budget <= 0) return [];
    const seen = new Set<string>([cellKey(start)]);
    const found: { cell: GridPos; dist: number }[] = [];
    let frontier: GridPos[] = [start];
    for (let dist = 1; dist <= budget && frontier.length; dist++) {
      const next: GridPos[] = [];
      for (const cur of frontier) {
        for (const [dc, dr] of NEIGHBOURS) {
          const cell = { col: cur.col + dc, row: cur.row + dr };
          const key = cellKey(cell);
          if (seen.has(key)) continue;
          seen.add(key);
          if (!this.canStandAt(actor, cell)) continue;
          if (this.blockedByHostile(actor, cell)) continue;
          // 自己人的格子可以穿过，但不能停在上面
          if (!this.occupiedBy(cell, actor.id)) found.push({ cell, dist });
          next.push(cell);
        }
      }
      frontier = next;
    }
    return found
      .sort((a, b) => a.dist - b.dist || a.cell.col - b.cell.col || a.cell.row - b.cell.row)
      .slice(0, limit)
      .map((x) => x.cell);
  }

  // ---------------------------------------------------------------- 移动（含借机攻击）
  /** 只规划，不落位。战斗里站起来要花一半速度，从预算里先扣掉。 */
  private planMove(actorId: string, cell: GridPos, opts: { maxCells?: number } = {}): MoveToResult & { target?: GridPos } {
    const actor = this.require(actorId);
    const start = actor.position;
    if (!start) return { ok: false, path: [], cells: 0, reason: `${actor.name} 还没有位置` };
    const target = { col: Math.round(cell.col), row: Math.round(cell.row) };
    if (!Number.isFinite(target.col) || !Number.isFinite(target.row)) {
      return { ok: false, path: [], cells: 0, reason: '目标格不是合法数字' };
    }
    if (target.col < 0 || target.row < 0 || target.col >= BOARD_COLS || target.row >= BOARD_ROWS) {
      return { ok: false, path: [], cells: 0, reason: `目标格 (${target.col},${target.row}) 在地图边界外` };
    }
    if (this.speedOf(actor) <= 0) {
      const why = incapacitatedBy(this.conditionNames(actor)) ?? this.conditions0(actor);
      return { ok: false, path: [], cells: 0, reason: `${actor.name} 现在动不了${why ? `（${why}）` : ''}` };
    }
    const standCells = this.standUpCells(actor);
    const maxCells = (opts.maxCells ?? Infinity) - standCells;
    if (!this.canStandAt(actor, target)) {
      return {
        ok: false,
        path: [],
        cells: 0,
        reason: `${actor.name} 不能站在 ${this.describeCell(target)}（${kindText(this.cellKind(target))}）`,
      };
    }
    const occupant = this.occupiedBy(target, actorId);
    if (occupant) {
      return {
        ok: false,
        path: [],
        cells: 0,
        reason: `${this.describeCell(target)} 已经站着 ${occupant.name}，不能停在同一格`,
      };
    }
    if (maxCells < 0) {
      return { ok: false, path: [], cells: 0, reason: `${actor.name} 倒在地上，这回合剩下的移动力不够站起来（要花一半速度）` };
    }
    const goal = (c: GridPos) => c.col === target.col && c.row === target.row;
    const path = this.findPath(actor, start, goal, maxCells);
    if (!path) {
      const anywhere = this.findPath(actor, start, goal, Infinity);
      if (!anywhere) {
        return {
          ok: false,
          path: [],
          cells: 0,
          reason: `${actor.name} 走不到 ${this.describeCell(target)}：水域或障碍挡住了路线`,
        };
      }
      return {
        ok: false,
        path: [],
        cells: 0,
        reason:
          `${actor.name} 走不到 ${this.describeCell(target)}：需要走 ${anywhere.length} 格（${anywhere.length * CELL_FEET} 尺）` +
          `${standCells ? `，另外站起来要花 ${standCells * CELL_FEET} 尺` : ''}，` +
          `这回合最多还能走 ${Math.max(0, maxCells)} 格（${Math.max(0, maxCells) * CELL_FEET} 尺）`,
      };
    }
    return { ok: true, path, cells: path.length, target };
  }

  /** 状态里写着的、让速度为 0 的那个（给提示文字）。 */
  private conditions0(actor: Actor): string | null {
    const hit = actor.conditions.find((c) => ['grappled', 'restrained'].includes(c.name));
    return hit ? CONDITION_ZH[hit.name] : this.exhaustion(actor) >= 5 ? '力竭 5 级' : null;
  }

  /** 落位：移动力记账，倒地的站起来。 */
  private commitMove(actor: Actor, dest: GridPos, cells: number): void {
    const stand = this.standUpCells(actor);
    actor.position = { col: dest.col, row: dest.row };
    if (cells > 0) {
      actor.turn.movementUsed += (cells + stand) * CELL_FEET;
      if (this.hasCondition(actor, 'prone')) this.removeCondition(actor, 'prone');
    }
  }

  /**
   * 走到指定格（先 BFS 找路，再一次性落位；走不通 / 超出 maxCells 就整次失败，不移动）。
   * 探索阶段传 maxCells: Infinity；战斗阶段传 movementCellsLeft()。不结算借机攻击。
   */
  moveTo(actorId: string, cell: GridPos, opts: { maxCells?: number } = {}): MoveToResult {
    const { target, ...plan } = this.planMove(actorId, cell, opts);
    if (!plan.ok || !target) return plan;
    this.commitMove(this.require(actorId), target, plan.cells);
    return plan;
  }

  /** 同 moveTo，但离开敌对生物触及范围时先结算借机攻击；被打倒就停在半路。 */
  async moveWithReactions(actorId: string, cell: GridPos, opts: { maxCells?: number } = {}): Promise<MoveToResult> {
    const { target, ...plan } = this.planMove(actorId, cell, opts);
    if (!plan.ok || !target) return plan;
    const actor = this.require(actorId);
    const steps = [{ ...actor.position! }, ...plan.path];
    const { outcomes, stopped } = await this.provokeOpportunityAttacks(actor, steps);
    if (stopped) {
      this.commitMove(actor, stopped.cell, stopped.index);
      return {
        ok: true,
        path: plan.path.slice(0, stopped.index),
        cells: stopped.index,
        opportunity: outcomes,
        downedAt: stopped.cell,
      };
    }
    this.commitMove(actor, target, plan.cells);
    return outcomes.length ? { ...plan, opportunity: outcomes } : plan;
  }

  private planApproach(attackerId: string, targetId: string): ApproachResult & { path?: GridPos[] } {
    const attacker = this.require(attackerId);
    const target = this.require(targetId);
    const from = attacker.position;
    const to = target.position;
    if (!from || !to) return { ok: true, movedCells: 0, distanceCells: 0 };
    const distanceCells = chebyshev(from, to);
    // 距离 0 是老存档里叠在同一格的残局：当作还没贴好，让它走开到相邻格
    if (distanceCells === 1) return { ok: true, movedCells: 0, from: { ...from }, to: { ...to }, distanceCells };
    if (this.speedOf(attacker) <= 0) {
      return {
        ok: false,
        movedCells: 0,
        from: { ...from },
        to: { ...to },
        distanceCells,
        reason: `${attacker.name} 现在动不了，够不到 ${target.name}`,
      };
    }
    const budget = this.movementCellsLeft(attacker) - this.standUpCells(attacker);
    const adjacent = (c: GridPos) =>
      !(c.col === to.col && c.row === to.row) && chebyshev(c, to) <= 1 && !this.occupiedBy(c, attackerId);
    const path = budget >= 0 ? this.findPath(attacker, from, adjacent, budget) : null;
    if (!path) {
      const anywhere = this.findPath(attacker, from, adjacent, Infinity);
      if (!anywhere) {
        return {
          ok: false,
          movedCells: 0,
          from: { ...from },
          to: { ...to },
          distanceCells,
          reason: `${attacker.name} 找不到贴近 ${target.name} 的路线（水域或障碍挡住了）`,
        };
      }
      return {
        ok: false,
        movedCells: 0,
        from: { ...from },
        to: { ...to },
        distanceCells,
        reason: `${attacker.name} 离 ${target.name} ${distanceCells * CELL_FEET} 尺，本回合最多再走 ${Math.max(0, budget) * CELL_FEET} 尺，够不到`,
      };
    }
    return {
      ok: true,
      movedCells: path.length,
      from: { ...from },
      to: path.length ? { ...path[path.length - 1] } : { ...from },
      distanceCells,
      path,
    };
  }

  /**
   * 近战前自动贴近：BFS 走到目标相邻格，只经过合法格；速度内走不到就整次行动非法，不移动。
   * 返回值给调用方发事件、写 Atlas。不结算借机攻击。
   */
  approachTarget(attackerId: string, targetId: string): ApproachResult {
    const { path, ...res } = this.planApproach(attackerId, targetId);
    if (res.ok && path && path.length > 0) {
      this.commitMove(this.require(attackerId), path[path.length - 1], path.length);
    }
    return res;
  }

  /** 同 approachTarget，但先结算借机攻击；被打倒就停在半路（ok 仍为 true，调用方看 downedAt）。 */
  async approachWithReactions(attackerId: string, targetId: string): Promise<ApproachResult> {
    const { path, ...res } = this.planApproach(attackerId, targetId);
    if (!res.ok || !path || path.length === 0) return res;
    const attacker = this.require(attackerId);
    const steps = [{ ...attacker.position! }, ...path];
    const { outcomes, stopped } = await this.provokeOpportunityAttacks(attacker, steps);
    if (stopped) {
      this.commitMove(attacker, stopped.cell, stopped.index);
      return { ...res, movedCells: stopped.index, to: { ...stopped.cell }, opportunity: outcomes, downedAt: stopped.cell };
    }
    this.commitMove(attacker, path[path.length - 1], path.length);
    return outcomes.length ? { ...res, opportunity: outcomes } : res;
  }

  /** 这个攻击是不是近战（怪物天生武器默认近战；mode 可以写 ranged）。 */
  private defIsMelee(def: AttackDef): boolean {
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    return weapon ? weapon.kind === 'melee' : def.mode !== 'ranged';
  }

  /** 近战触及（尺）：长柄武器 10，其余 5；天生武器可以写 reach。 */
  private defReachFeet(def: AttackDef): number {
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    return def.reach ?? (weapon?.properties.includes('reach') ? 10 : CELL_FEET);
  }

  /** 做借机攻击用的那个近战攻击：平均伤害最高的。没有近战攻击就是 null。 */
  private opportunityWeapon(actor: Actor): AttackDef | null {
    let best: AttackDef | null = null;
    let bestAvg = -1;
    for (const def of actor.attacks) {
      if (!this.defIsMelee(def)) continue;
      const avg = formulaAverage(this.attackMath(actor, def).damageFormula);
      if (avg > bestAvg) {
        best = def;
        bestAvg = avg;
      }
    }
    return best;
  }

  /**
   * 沿着 steps（含起点）走位会引发的借机攻击：每个能反应的敌对生物，在 mover 走出它触及范围的那一格
   * 用反应打一次近战攻击。mover 被打到 0 就停在那一格，后面的借机攻击不再发生。
   * 撤离（disengaged）不引发。
   */
  private async provokeOpportunityAttacks(
    mover: Actor,
    steps: GridPos[]
  ): Promise<{ outcomes: OpportunityOutcome[]; stopped?: { cell: GridPos; index: number } }> {
    const outcomes: OpportunityOutcome[] = [];
    if (!this.opportunityAttacks || mover.turn.disengaged || steps.length < 2) return { outcomes };
    const moverNames = this.conditionNames(mover);
    if (moverNames.includes('invisible') || moverNames.includes('hidden')) return { outcomes };
    const plans: { reactor: Actor; at: GridPos; index: number; def: AttackDef }[] = [];
    for (const reactor of this.actors.values()) {
      if (reactor.id === mover.id || reactor.kind === mover.kind) continue;
      if (reactor.hp <= 0 || reactor.deathSaves.dead || !reactor.position) continue;
      if (!this.canReact(reactor) || this.isIncapacitated(reactor) || this.hasCondition(reactor, 'blinded')) continue;
      const def = this.opportunityWeapon(reactor);
      if (!def) continue;
      const reach = Math.max(1, Math.floor(this.defReachFeet(def) / CELL_FEET));
      const at = leavesReachAt(steps, reactor.position, reach);
      if (!at) continue;
      plans.push({ reactor, at, index: steps.findIndex((s) => s.col === at.col && s.row === at.row), def });
    }
    plans.sort((a, b) => a.index - b.index);
    for (const p of plans) {
      if (mover.hp <= 0 || mover.deathSaves.dead) break;
      mover.position = { ...p.at };
      let result: AttackResult;
      try {
        result = await this.attack(p.reactor.id, mover.id, p.def, { reaction: true });
      } catch {
        continue;
      }
      outcomes.push({ reactorId: p.reactor.id, targetId: mover.id, result });
      if (mover.hp <= 0 || mover.deathSaves.dead) return { outcomes, stopped: { cell: { ...p.at }, index: p.index } };
    }
    return { outcomes };
  }

  /** 离这一格最近的地标；没有地标返回 null。 */
  private nearestLandmark(cell: GridPos): Landmark | null {
    if (!this.map) return null;
    let best: Landmark | null = null;
    let bestDist = Infinity;
    for (const lm of this.map.landmarks) {
      const d = rangeDistance(cell, lm.cells);
      if (d < bestDist) {
        best = lm;
        bestDist = d;
      }
    }
    return best;
  }

  private regionNameAt(cell: GridPos): string | null {
    if (!this.map || this.usingWholeBoard()) return null;
    const stand = this.map.standable.find((s) => this.cellInPolygon(cell, s.polygon));
    if (stand) return stand.name;
    const water = this.map.water.find((w) => this.cellInPolygon(cell, w.polygon));
    return water?.name ?? null;
  }

  /**
   * 人话描述一格：用地标 + 方位 + 原始格 + 距离。
   * 例：`货舱口北沿 (5,5)，15 尺`。
   */
  describeCell(cell: GridPos, from?: GridPos): string {
    const target = { col: Math.round(cell.col), row: Math.round(cell.row) };
    const lm = this.nearestLandmark(target);
    let label: string;
    if (lm) {
      const inCol = target.col >= lm.cells.col[0] && target.col <= lm.cells.col[1];
      const inRow = target.row >= lm.cells.row[0] && target.row <= lm.cells.row[1];
      if (inCol && inRow) {
        label = `${lm.name}内`;
      } else {
        const vertical = inRow ? '' : target.row < lm.cells.row[0] ? '北' : '南';
        const horizontal = inCol ? '' : target.col < lm.cells.col[0] ? '西' : '东';
        if (vertical && horizontal) label = `${lm.name}${horizontal}${vertical}角`;
        else if (vertical) label = `${lm.name}${vertical}沿`;
        else if (horizontal) label = `${lm.name}${horizontal}沿`;
        else label = lm.name;
      }
    } else {
      label = this.regionNameAt(target) ?? '空地';
    }
    const feet = from ? this.distanceFeet(from, target) : null;
    return `${label} (${target.col},${target.row})${feet === null ? '' : `，${feet} 尺`}`;
  }

  // ---------------------------------------------------------------- 状态判定
  hasCondition(actor: Actor, ...names: ConditionName[]): boolean {
    return actor.conditions.some((c) => names.includes(c.name) && (c.level ?? 1) > 0);
  }

  exhaustion(actor: Actor): number {
    return actor.conditions.find((c) => c.name === 'exhaustion')?.level ?? 0;
  }

  isDead(actor: Actor): boolean {
    return actor.deathSaves.dead || (actor.hp <= 0 && actor.deathSaves.failures >= 3);
  }

  /** 失能：0 HP，或带失能类状态（失能 / 麻痹 / 震慑 / 昏迷 / 石化）。 */
  isIncapacitated(actor: Actor): boolean {
    return actor.hp <= 0 || namesIncapacitated(this.conditionNames(actor));
  }

  /** 怪物特性：按名字或说明认出（中文名 / 英文名都行）。 */
  hasTrait(actor: Actor, pattern: RegExp): boolean {
    return (actor.traits ?? []).some((t) => pattern.test(t.name) || pattern.test(t.text.slice(0, 40)));
  }

  acOf(actor: Actor): number {
    let ac = actor.ac;
    // AC 基础值（法师护甲、树肤术）：取较大者
    for (const e of actor.effects) {
      if (e.acBase) ac = Math.max(ac, e.acBase.base + (e.acBase.addDex ? abilityMod(actor.abilities.dex) : 0));
    }
    return ac + actor.effects.reduce((s, e) => s + (e.acBonus ?? 0), 0);
  }

  /** 能不能用反应：反应没用掉，身上也没有“不能反应”的效果（缓慢术、电爪）。 */
  private canReact(actor: Actor): boolean {
    return !actor.turn.reactionUsed && !actor.effects.some((e) => e.noReactions);
  }

  /** 一个 Attack 动作最多几次攻击：正常的次数，被缓慢术之类限制到 maxSwings。 */
  private swingBudget(actor: Actor): number {
    const base = swingsPerAction(actor.attacks, actor.routines, actor.attacksPerAction ?? 1);
    const caps = actor.effects.map((e) => e.maxSwings).filter((n): n is number => n !== undefined);
    return caps.length ? Math.max(1, Math.min(base, ...caps)) : base;
  }

  /** 属性检定 / 技能检定受效果影响的优势劣势来源（强化属性、预知术、着迷术…）。 */
  private checkEdges(actor: Actor, ability: Ability, skill?: Skill): Advantage[] {
    const out: Advantage[] = [];
    for (const e of actor.effects) {
      for (const c of e.checkEdges ?? []) {
        const bySkill = !!skill && !!c.skills?.includes(skill);
        const byAbility = !!c.abilities && (c.abilities.includes('all') || c.abilities.includes(ability));
        if (bySkill || byAbility) out.push(c.state);
      }
    }
    return out;
  }

  /** 豁免受效果影响的优势劣势来源。ability = 'death' 是死亡豁免（只吃 'all' 和 'death'）。against = 对抗的状态 / 伤害类型。 */
  private saveEdges(actor: Actor, ability: Ability | 'death', against?: string): Advantage[] {
    const out: Advantage[] = [];
    for (const e of actor.effects) {
      for (const c of e.saveEdges ?? []) {
        if (!(c.abilities.includes('all') || c.abilities.includes(ability))) continue;
        if (c.against && !(against && c.against.includes(against))) continue;
        out.push(c.state);
      }
    }
    return out;
  }

  /** 被动感知（躲藏检定的对手）。 */
  passivePerception(actor: Actor): number {
    return 10 + skillBonus(actor, 'perception');
  }

  beginTurn(actorId: string): void {
    const a = this.require(actorId);
    a.turn = emptyTurn();
    a.turn.attacksAllowed = this.swingBudget(a);
    // 加速术：每个回合多一个动作
    if (a.effects.some((e) => e.extraAction)) a.turn.extraActions += 1;
    // “到某人下回合开始”结束的效果（护盾术、协助）：挂在谁身上都算
    for (const actor of this.actors.values()) {
      if (actor.effects.some((e) => e.untilTurnOf === actorId)) {
        actor.effects = actor.effects.filter((e) => e.untilTurnOf !== actorId);
      }
      // “等到某人下一个回合才生效”的效果（克敌先击）：这个回合起开始生效
      for (const e of actor.effects) if (e.armedAtTurnOf === actorId) delete e.armedAtTurnOf;
    }
  }

  // ---------------------------------------------------------------- 掷骰
  private async d20(opts: {
    kind: RollKind;
    label: string;
    modifier: number;
    dc?: number;
    advantage?: Advantage;
    actorId?: string;
    targetId?: string;
    extraDice?: string;
    damageType?: DamageType;
    /** 攻击自然点数 ≥ 这个就是暴击（额外暴击 19、卓越暴击 18）；默认 20 */
    critOn?: number;
    /** 半身人幸运：自然 1 重掷一次，用新的 */
    luck?: boolean;
  }): Promise<RollResult> {
    const adv = opts.advantage ?? 'none';
    const base = adv === 'adv' ? '2d20kh1' : adv === 'dis' ? '2d20kl1' : '1d20';
    const formula = `${base}${signed(opts.modifier)}${opts.extraDice ?? ''}`;
    let outcome = await this.rollSource.roll({
      formula,
      label: opts.label,
      player: opts.actorId,
    });
    let natural = d20Natural(outcome.dice);
    let label = opts.label;
    if (opts.luck && natural === 1) {
      outcome = await this.rollSource.roll({ formula, label: `${opts.label}（半身人幸运重掷）`, player: opts.actorId });
      natural = d20Natural(outcome.dice);
      label = `${opts.label}（半身人幸运重掷）`;
    }
    const isAttack = opts.kind === 'attack';
    const roll: RollResult = {
      id: uuid(),
      at: Date.now(),
      kind: opts.kind,
      label,
      actorId: opts.actorId,
      targetId: opts.targetId,
      formula: outcome.formula,
      dice: outcome.dice,
      modifier: opts.modifier,
      total: outcome.total,
      natural,
      dc: opts.dc,
      success: opts.dc !== undefined ? outcome.total >= opts.dc : undefined,
      crit: isAttack && natural !== null && natural >= (opts.critOn ?? 20),
      fumble: isAttack && natural === 1,
      advantage: adv,
      damageType: opts.damageType,
      source: outcome.source,
    };
    this.record(roll);
    return roll;
  }

  private async damageRoll(opts: {
    label: string;
    formula: string;
    damageType: DamageType;
    actorId?: string;
    targetId?: string;
    crit?: boolean;
    /** 暴击时在翻倍之后再多掷的骰（野蛮暴击、野蛮攻击） */
    critExtra?: string;
    /** 前 rerollFirst 个骰里 ≤ rerollBelow 的重掷一次（巨武器战斗） */
    rerollBelow?: number;
    rerollFirst?: number;
    /** 每个骰都取最大值（希望信标的治疗、枯萎术打植物） */
    maximize?: boolean;
  }): Promise<RollResult> {
    let formula = opts.crit ? doubleDiceFormula(opts.formula) : opts.formula;
    let outcome = await this.rollSource.roll({ formula, label: opts.label, player: opts.actorId });
    if (opts.maximize) {
      let diff = 0;
      for (const d of outcome.dice) {
        if (!d.kept) continue;
        diff += d.sides - d.value;
        d.value = d.sides;
      }
      outcome = { ...outcome, total: outcome.total + diff, modifiers: outcome.modifiers + diff };
    }
    if (opts.rerollBelow && opts.rerollFirst) {
      let rerolled = 0;
      for (const d of outcome.dice) {
        if (rerolled >= opts.rerollFirst) break;
        rerolled += 1;
        if (!d.kept || d.value > opts.rerollBelow) continue;
        const again = await this.rollSource.roll({ formula: `1d${d.sides}`, label: `${opts.label}（重掷）`, player: opts.actorId });
        const diff = again.total - d.value;
        d.value = again.total;
        outcome = { ...outcome, total: outcome.total + diff, modifiers: outcome.modifiers + diff };
      }
    }
    if (opts.crit && opts.critExtra) {
      const more = await this.rollSource.roll({ formula: opts.critExtra, label: `${opts.label}（暴击额外骰）`, player: opts.actorId });
      outcome = {
        ...outcome,
        formula: `${outcome.formula}+${more.formula}`,
        dice: [...outcome.dice, ...more.dice],
        total: outcome.total + more.total,
        modifiers: outcome.modifiers + more.modifiers,
      };
      formula = outcome.formula;
    }
    const roll: RollResult = {
      id: uuid(),
      at: Date.now(),
      kind: 'damage',
      label: opts.label,
      actorId: opts.actorId,
      targetId: opts.targetId,
      formula: outcome.formula,
      dice: outcome.dice,
      modifier: 0,
      total: outcome.total,
      natural: null,
      crit: false,
      fumble: false,
      advantage: 'none',
      damageType: opts.damageType,
      source: outcome.source,
    };
    this.record(roll);
    return roll;
  }

  private record(roll: RollResult): void {
    this.rollLog.push(roll);
    if (this.rollLog.length > 500) this.rollLog.splice(0, this.rollLog.length - 500);
    this.onRoll?.(roll);
  }

  private autoFail(label: string, actorId: string, kind: RollKind, dc: number): RollResult {
    const roll: RollResult = {
      id: uuid(),
      at: Date.now(),
      kind,
      label: `${label}（自动失败）`,
      actorId,
      formula: '-',
      dice: [],
      modifier: 0,
      total: 0,
      natural: null,
      dc,
      success: false,
      crit: false,
      fumble: false,
      advantage: 'none',
      source: 'none',
    };
    this.record(roll);
    return roll;
  }

  // ---------------------------------------------------------------- 检定 / 豁免
  async check(
    actorId: string,
    abilityOrSkill: Ability | Skill,
    dc: number,
    opts: CheckOptions = {}
  ): Promise<RollResult> {
    const actor = this.require(actorId);
    const names = this.conditionNames(actor);
    // 昏迷 / 麻痹 / 震慑 / 石化的生物做不了需要行动的检定；单纯“失能”或被擒抱仍然可以
    if (actor.hp <= 0 || ['unconscious', 'paralyzed', 'stunned', 'petrified'].some((n) => names.includes(n))) {
      return this.autoFail('无法行动', actorId, 'check', dc);
    }
    const isSkill = (SKILLS as readonly string[]).includes(abilityOrSkill);
    const ability: Ability = isSkill ? SKILL_ABILITY[abilityOrSkill as Skill] : (abilityOrSkill as Ability);
    const label = isSkill ? `${actor.name} ${SKILL_ZH[abilityOrSkill as Skill]}检定` : `${actor.name} ${ABILITY_ZH[ability]}检定`;
    let mod = abilityMod(actor.abilities[ability]);
    // 技能检定的半熟练（杂艺、超凡运动员）已经算在 skillBonus 里
    if (isSkill) mod = skillBonus(actor, abilityOrSkill as Skill);
    else mod += halfProficiencyBonus(actor, ability);
    mod += opts.bonus ?? 0;
    // 效果给的技能固定加值（无痕步：隐匿 +10）
    if (isSkill) mod += actor.effects.reduce((sum, e) => sum + (e.skillBonuses?.[abilityOrSkill as Skill] ?? 0), 0);
    const derived = rollDerivation(names, isSkill ? 'skill_check' : 'ability_check', ability, this.exhaustion(actor));
    const sources: Advantage[] = [
      opts.advantage ?? 'none',
      ...derived.sources,
      ...this.checkEdges(actor, ability, isSkill ? (abilityOrSkill as Skill) : undefined),
    ];
    if (ability === 'str' && this.isRaging(actor)) sources.push('adv');
    const extra = actor.effects
      .map((e) => e.checkDice)
      .filter((d): d is string => !!d)
      .map(diceTerm)
      .join('');
    const roll = await this.d20({
      kind: 'check',
      label,
      modifier: mod,
      dc,
      advantage: mergeAdvantage(sources),
      actorId,
      extraDice: extra || undefined,
      luck: hasFeature(actor, 'halfling_luck'),
    });
    // 可靠才能（盗贼 11 级）：熟练的技能检定，d20 低于 10 当 10
    const proficient = isSkill && (actor.skills.includes(abilityOrSkill as Skill) || actor.expertise.includes(abilityOrSkill as Skill));
    if (proficient && hasFeature(actor, 'reliable_talent') && roll.natural !== null && roll.natural < 10) {
      roll.total += 10 - roll.natural;
      roll.success = roll.total >= dc;
      roll.label += '（可靠才能）';
    }
    await this.tryInspiration(actor, roll);
    return roll;
  }

  async save(
    actorId: string,
    ability: Ability,
    dc: number,
    opts: CheckOptions & {
      label?: string;
      /** 这次豁免是对抗什么状态 / 伤害（charmed、frightened、poison）；种族抗性据此给优势 */
      against?: string;
      /** 对抗法术或魔法效果（侏儒狡黠、魔法抗性） */
      magical?: boolean;
    } = {}
  ): Promise<RollResult> {
    const actor = this.require(actorId);
    const label = opts.label ?? `${actor.name} ${ABILITY_ZH[ability]}豁免`;
    const derived = rollDerivation(this.conditionNames(actor), 'saving_throw', ability, this.exhaustion(actor));
    if (derived.autoFail) return this.autoFail(label, actorId, 'save', dc);
    let mod = abilityMod(actor.abilities[ability]);
    if (actor.saves.includes(ability)) mod += actor.proficiencyBonus;
    mod += actor.effects.reduce((s, e) => s + (e.saveBonus ?? 0) + (e.saveBonuses?.[ability] ?? 0), 0);
    mod += this.auraBonus(actor);
    mod += opts.bonus ?? 0;
    const sources: Advantage[] = [opts.advantage ?? 'none', ...derived.sources, ...this.saveEdges(actor, ability, opts.against)];
    const aware = !this.hasCondition(actor, 'blinded', 'deafened') && !this.isIncapacitated(actor);
    if (ability === 'dex' && aware && hasFeature(actor, 'danger_sense')) sources.push('adv');
    if (ability === 'str' && this.isRaging(actor)) sources.push('adv');
    const against = opts.against ?? '';
    if (against === 'charmed' && hasFeature(actor, 'fey_ancestry')) sources.push('adv');
    if (against === 'frightened' && hasFeature(actor, 'brave')) sources.push('adv');
    if ((against === 'poison' || against === 'poisoned') && hasFeature(actor, 'dwarven_resilience')) sources.push('adv');
    if (opts.magical) {
      if (['int', 'wis', 'cha'].includes(ability) && hasFeature(actor, 'gnome_cunning')) sources.push('adv');
      if (this.hasTrait(actor, /魔法抗性|magic resistance/i)) sources.push('adv');
    }
    const extra = actor.effects
      .map((e) => e.saveDice)
      .filter((d): d is string => !!d)
      .map(diceTerm)
      .join('');
    const luck = hasFeature(actor, 'halfling_luck');
    let roll = await this.d20({
      kind: 'save',
      label,
      modifier: mod,
      dc,
      advantage: mergeAdvantage(sources),
      actorId,
      extraDice: extra || undefined,
      luck,
    });
    await this.tryInspiration(actor, roll);
    // 不屈（战士）：失败的豁免可以重掷，加战士等级
    if (!roll.success && hasFeature(actor, 'indomitable') && this.resourceLeft(actor, 'indomitable') > 0) {
      this.spendResource(actor, 'indomitable');
      const bonus = classLevelOr(actor, 'fighter');
      roll = await this.d20({
        kind: 'save',
        label: `${label}（不屈重掷）`,
        modifier: mod + bonus,
        dc,
        advantage: mergeAdvantage(sources),
        actorId,
        extraDice: extra || undefined,
      });
    }
    return roll;
  }

  /** 护盾术自动反应；成功施放返回 true。 */
  private async autoShield(target: Actor, attackTotal: number, ac: number): Promise<boolean> {
    if (!this.autoReactions || !this.canReact(target) || this.isIncapacitated(target)) return false;
    if (attackTotal >= ac + 5) return false; // 护盾术救不了
    if (!target.spells?.known.includes('shield') || this.isRaging(target)) return false;
    const slot = target.spells.slots[1];
    if (!slot || slot.used >= slot.max) return false;
    const cast = await this.castSpell(target.id, 'shield', 1, []);
    return cast.ok;
  }

  /** 圣武士光环：附近（10 尺）没倒下的圣武士 6 级起给盟友（含自己）所有豁免加魅力调整值（至少 +1）。 */
  private auraBonus(actor: Actor): number {
    let best = 0;
    for (const p of this.actors.values()) {
      if (p.kind !== actor.kind || p.hp <= 0 || !hasFeature(p, 'aura_of_protection') || this.isIncapacitated(p)) continue;
      const near = p.id === actor.id || (!!p.position && !!actor.position && this.distanceFeet(p.position, actor.position) <= 10);
      if (near) best = Math.max(best, Math.max(1, abilityMod(p.abilities.cha)));
    }
    return best;
  }

  /** 诗人激励：目标差一点就成功时，加一个激励骰（用掉就没）。 */
  private async tryInspiration(actor: Actor, roll: RollResult): Promise<void> {
    if (roll.dc === undefined || roll.success !== false || roll.fumble) return;
    const eff = actor.effects.find((e) => e.inspirationDie);
    if (!eff || !eff.inspirationDie) return;
    if (roll.dc - roll.total > eff.inspirationDie) return;
    const die = await this.rollSource.roll({ formula: `1d${eff.inspirationDie}`, label: '诗人激励', player: actor.id });
    actor.effects = actor.effects.filter((e) => e !== eff);
    roll.total += die.total;
    roll.dice = [...roll.dice, ...die.dice];
    roll.success = roll.total >= roll.dc;
    roll.label += `（诗人激励 +${die.total}）`;
  }

  /** 狂暴中？ */
  isRaging(actor: Actor): boolean {
    return actor.effects.some((e) => e.spellId === 'rage');
  }

  /** 狂暴的“本回合攻击过或受过伤”标记：整个回合都没有，狂暴就结束。 */
  private stoke(actor: Actor): void {
    const rage = actor.effects.find((e) => e.spellId === 'rage');
    if (rage) rage.stoked = true;
  }

  /** 回合结束时的事：狂暴没被维持就结束。 */
  private endTurnOf(actor: Actor): void {
    // 到这个角色回合结束时结束的效果（恶言相加、克敌先击）；还没生效（armed）的不算
    this.dropEffects((e) => e.untilEndOfTurnOf === actor.id && !e.armedAtTurnOf);
    const rage = actor.effects.find((e) => e.spellId === 'rage');
    if (!rage) return;
    if (rage.stoked) rage.stoked = false;
    else actor.effects = actor.effects.filter((e) => e !== rage);
  }

  /** 把满足条件的效果从所有角色身上摘掉；某个专注的效果全没了，专注也就结束了。返回被摘掉的。 */
  private dropEffects(pred: (e: ActiveEffect) => boolean): ActiveEffect[] {
    const removed: ActiveEffect[] = [];
    for (const holder of this.actors.values()) {
      if (!holder.effects.some(pred)) continue;
      holder.effects = holder.effects.filter((e) => {
        if (!pred(e)) return true;
        removed.push(e);
        return false;
      });
    }
    if (removed.length) {
      for (const owner of this.actors.values()) {
        const c = owner.concentration;
        if (c && removed.some((e) => c.effectIds.includes(e.id)) && !this.concentrationAlive(owner)) owner.concentration = null;
      }
    }
    return removed;
  }

  /** 这个角色专注的法术还有没有效果 / 状态挂在谁身上（挂在别人身上的也算）。 */
  private concentrationAlive(owner: Actor): boolean {
    const c = owner.concentration;
    if (!c) return false;
    return [...this.actors.values()].some(
      (h) =>
        h.effects.some((e) => c.effectIds.includes(e.id)) ||
        h.conditions.some((cond) => cond.source === c.spellId && cond.concentrationOf === owner.id)
    );
  }

  /** 加速术结束：这个生物陷入一个回合的失能 + 速度 0。战斗外没有回合，不处理。 */
  private startLethargy(holder: Actor): void {
    if (!this.combat.active || holder.hp <= 0 || holder.deathSaves.dead) return;
    const idx = this.combat.order.findIndex((o) => o.actorId === holder.id);
    if (idx < 0) return;
    // 这一轮 ta 的回合还没到：撑到这一轮结束；已经过去（或正在进行）：撑到下一轮 ta 的回合结束
    const rounds = idx <= this.combat.index ? 2 : 1;
    this.applyCondition(holder.id, 'incapacitated', { source: LETHARGY, rounds });
    holder.effects.push({
      id: uuid(),
      spellId: LETHARGY,
      name: '加速术的倦怠（失能、速度 0）',
      concentration: false,
      speedMultiplier: 0,
      rounds,
    });
  }

  /** 暴击额外武器骰数：野蛮暴击（野蛮人 9/13/17 级）+ 野蛮攻击（半兽人）。 */
  private critExtraDice(actor: Actor): number {
    const brutal = hasFeature(actor, 'brutal_critical') ? brutalCriticDice(classLevelOr(actor, 'barbarian')) : 0;
    return brutal + (hasFeature(actor, 'savage_attacks') ? 1 : 0);
  }

  resourceLeft(actor: Actor, key: string): number {
    const r = actor.resources[key];
    return r ? Math.max(0, r.max - r.used) : 0;
  }

  spendResource(actor: Actor, key: string, n = 1): void {
    const r = actor.resources[key];
    if (!r || r.max - r.used < n) throw new Error(`${actor.name} 的「${r?.name ?? key}」用完了`);
    r.used += n;
  }

  /**
   * 一次死亡豁免。自然 20：1 HP 醒来；自然 1：两次失败；总值 ≥10 成功，三次成功稳定，三次失败死亡。
   * 它是不挂属性的豁免：祝福术、力竭、效果加值都吃。只有濒死（0 HP、没稳定、没死）的角色能掷。
   */
  async rollDeathSave(actorId: string): Promise<DeathSaveResult> {
    const actor = this.require(actorId);
    if (actor.kind !== 'pc' || actor.hp > 0 || actor.deathSaves.dead || actor.deathSaves.stable) {
      throw new Error(`${actor.name} 现在不需要掷死亡豁免`);
    }
    const derived = rollDerivation(this.conditionNames(actor), 'saving_throw', undefined, this.exhaustion(actor));
    const mod = actor.effects.reduce((s, e) => s + (e.saveBonus ?? 0), 0);
    const extra = actor.effects
      .map((e) => e.saveDice)
      .filter((d): d is string => !!d)
      .map(diceTerm)
      .join('');
    const roll = await this.d20({
      kind: 'death_save',
      label: `${actor.name} 死亡豁免`,
      modifier: mod,
      dc: 10,
      advantage: mergeAdvantage([...derived.sources, ...this.saveEdges(actor, 'death')]),
      actorId,
      extraDice: extra || undefined,
    });
    const applied = applyDeathSaveRoll(actor.deathSaves, roll.natural ?? roll.total, roll.total);
    actor.deathSaves = applied.track;
    roll.success = applied.outcome === 'success' || applied.outcome === 'stable' || applied.outcome === 'revive';
    if (applied.outcome === 'revive') {
      actor.hp = 1;
      this.wake(actor);
    }
    return { roll, outcome: applied.outcome, track: { ...actor.deathSaves } };
  }

  /** 向后兼容：只要骰子结果。 */
  async deathSave(actorId: string): Promise<RollResult> {
    return (await this.rollDeathSave(actorId)).roll;
  }

  /** HP 回来：醒来，但还躺在地上（倒地要自己站起来）。法术造成的昏迷（睡眠术）不归这里管。 */
  private wake(actor: Actor): void {
    actor.conditions = actor.conditions.filter((c) => !(c.name === 'unconscious' && c.source === DYING_SOURCE));
  }

  /**
   * 维稳：对濒死的角色做医药检定（DC 10）/ 用医疗包 / 维稳术。成功后稳定（不再掷死亡豁免）。
   * 战斗里要花一个动作。
   */
  async stabilize(
    targetId: string,
    method: 'check' | 'kit' | 'spell',
    healerId?: string
  ): Promise<ActionOutcome> {
    const target = this.require(targetId);
    if (target.kind !== 'pc' || target.hp > 0 || target.deathSaves.dead) {
      return { ok: false, note: `${target.name} 不是濒死状态，不需要维稳` };
    }
    if (target.deathSaves.stable) return { ok: false, note: `${target.name} 已经稳定了` };
    const healer = healerId ? this.require(healerId) : null;
    if (healer && this.combat.active) this.spendSimpleAction(healer, 'action');
    let roll: RollResult | undefined;
    if (method === 'check') {
      if (!healer) return { ok: false, note: '医药检定需要一个施救者' };
      roll = await this.check(healer.id, 'medicine', STABILIZE_DC);
      if (!roll.success) return { ok: true, note: `${healer.name} 没能稳住 ${target.name}（医药 ${roll.total} < DC ${STABILIZE_DC}）`, roll };
    }
    target.deathSaves = stableDeathTrack();
    return { ok: true, note: `${target.name} 稳定了：昏迷在 0 HP，不再掷死亡豁免`, ...(roll ? { roll } : {}) };
  }

  // ---------------------------------------------------------------- 攻击
  attackMath(actor: Actor, def: AttackDef, opts: { offhand?: boolean } = {}): AttackMath {
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    const effectBonus = actor.effects.reduce((s, e) => s + (e.attackBonus ?? 0), 0);
    if (!weapon) {
      return {
        attackBonus: (def.attackBonus ?? 0) + effectBonus,
        damageFormula: def.damage ?? '1d4',
        damageType: def.damageType ?? 'bludgeoning',
        ability: 'str',
        proficient: true,
      };
    }
    const melee = weapon.kind === 'melee';
    const finesse = weapon.properties.includes('finesse');
    // 武僧：徒手和武僧武器用敏捷或力量（取高），伤害骰换成武艺骰
    const monk = hasFeature(actor, 'martial_arts') && isMonkWeapon(weapon);
    const ability: Ability = !melee
      ? 'dex'
      : finesse || monk
        ? actor.abilities.dex >= actor.abilities.str
          ? 'dex'
          : 'str'
        : 'str';
    const proficient = def.proficient !== false;
    const magic = (weapon.magicBonus ?? 0) + (def.magicBonus ?? 0);
    const wctx = weaponContext(def, melee);
    const attackBonus =
      abilityMod(actor.abilities[ability]) + (proficient ? actor.proficiencyBonus : 0) + magic + effectBonus + styleAttackBonus(actor, wctx);
    let damage = (weapon.versatile && def.twoHanded ? weapon.versatile : weapon.damage).replace(/\s+/g, '').toLowerCase();
    if (monk) {
      const die = martialArtsDie(classLevelOr(actor, 'monk'));
      const single = /^1d(\d+)$/.exec(damage);
      if (damage === '1' || (single && Number(single[1]) < die)) damage = `1d${die}`;
    }
    const rageBonus = melee && ability === 'str' && this.isRaging(actor) ? rageDamage(classLevelOr(actor, 'barbarian')) : 0;
    let mod = abilityMod(actor.abilities[ability]);
    // 副手攻击：伤害不加正的属性调整值，除非有双武器战斗风格
    if (opts.offhand && mod > 0 && !hasFeature(actor, 'fighting_style_two_weapon_fighting')) mod = 0;
    const damageFormula = `${damage}${signed(mod + magic + styleDamageBonus(actor, wctx) + rageBonus)}`;
    return { attackBonus, damageFormula, damageType: weapon.damageType, ability, proficient };
  }

  /** 这个攻击是不是近战（怪物天生武器默认近战）。给怪物回合决定要不要先贴近。 */
  isMeleeAttack(actorId: string, attack: AttackDef | string | number): boolean {
    const actor = this.require(actorId);
    return this.defIsMelee(this.resolveAttack(actor, attack));
  }

  /**
   * 距离检查：近战必须在触及范围内（可投掷的近战武器可以按投掷打，射程内算远程）；远程不能超出长射程。
   * 没有位置的测试/老存档不做距离检查。返回这次攻击实际是不是远程，以及正常射程。
   */
  private assertAttackRange(
    attacker: Actor,
    target: Actor,
    def: AttackDef
  ): { feet: number | null; ranged: boolean; normal: number | null } {
    const a = attacker.position;
    const t = target.position;
    const feet = a && t ? this.distanceFeet(a, t) : null;
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    if (this.defIsMelee(def)) {
      const reach = this.defReachFeet(def);
      if (feet === null || feet <= reach) return { feet, ranged: false, normal: null };
      const thrown = weapon?.properties.includes('thrown') ? weapon.range : undefined;
      if (thrown) {
        if (feet > thrown[1]) {
          throw new Error(`${attacker.name} 离 ${target.name} ${feet} 尺，超出${weapon!.name}的投掷射程 ${thrown[1]} 尺`);
        }
        return { feet, ranged: true, normal: thrown[0] };
      }
      throw new Error(`${attacker.name} 离 ${target.name} 还有 ${feet} 尺，近战需要先贴近到 ${reach} 尺内`);
    }
    const range = def.range ?? weapon?.range;
    const long = range?.[1];
    if (long && feet !== null && feet > long) {
      throw new Error(`${attacker.name} 离 ${target.name} ${feet} 尺，超出${weapon?.name ?? def.name ?? '武器'}的 ${long} 尺长射程`);
    }
    return { feet, ranged: true, normal: range?.[0] ?? null };
  }

  /** 活着、没失能、没目盲的敌对生物在某一格的 radius 格内。 */
  private hostilesNear(of: Actor, radius = 1): Actor[] {
    const at = of.position;
    if (!at) return [];
    return [...this.actors.values()].filter(
      (o) =>
        o.id !== of.id &&
        o.kind !== of.kind &&
        o.hp > 0 &&
        !!o.position &&
        chebyshev(o.position, at) <= radius &&
        !this.isIncapacitated(o) &&
        !this.hasCondition(o, 'blinded')
    );
  }

  /** 和 of 同阵营、没失能的盟友在 cell 的 radius 格内（不含 of 自己）。 */
  private alliesNear(of: Actor, cell: GridPos | undefined, radius = 1): Actor[] {
    if (!cell) return [];
    return [...this.actors.values()].filter(
      (o) =>
        o.id !== of.id &&
        o.kind === of.kind &&
        o.hp > 0 &&
        !!o.position &&
        chebyshev(o.position, cell) <= radius &&
        !this.isIncapacitated(o)
    );
  }

  /** 目标因地形或别的生物挡着得到的掩蔽（AC +2 / +5）。 */
  coverBonus(from: Actor, to: Actor): 0 | 2 | 5 {
    if (!from.position || !to.position) return 0;
    const terrain = terrainCover((c) => this.cellKind(c) === 'blocked', from.position, to.position);
    const others = [...this.actors.values()]
      .filter((o) => o.id !== from.id && o.id !== to.id && o.hp > 0 && o.position)
      .map((o) => o.position!);
    return terrain < 2 && creatureCover(from.position, to.position, others) ? 2 : terrain;
  }

  /**
   * 一次攻击的情境：优势/劣势/自动暴击、掩蔽、哪些“只用一次”的效果被用掉。
   * range 是 assertAttackRange 的结果；法术攻击也走这里。
   */
  private attackSituation(
    attacker: Actor,
    target: Actor,
    range: { feet: number | null; ranged: boolean; normal: number | null },
    explicit?: Advantage
  ) {
    const effectSources: { state: Advantage; note: string }[] = [];
    const usedOnTarget = target.effects.filter((e) => e.grantsAdvantageOnce);
    if (target.effects.some((e) => e.grantsAttackersAdvantage)) {
      effectSources.push({ state: 'adv', note: '目标被标记（妖火）：优势' });
    }
    if (target.effects.some((e) => e.attackersDisadvantage)) {
      effectSources.push({ state: 'dis', note: '目标身形模糊：劣势' });
    }
    // 嗜血狂热（鲨人）：目标 HP 不满，攻击有优势
    if (this.hasTrait(attacker, /血之狂热|blood frenzy/i) && target.hp < this.maxHpOf(target)) {
      effectSources.push({ state: 'adv', note: '嗜血狂热：目标已经受伤，优势' });
    }
    if (usedOnTarget.length) effectSources.push({ state: 'adv', note: '目标被光导：优势' });
    const helped = attacker.effects.filter(
      (e) => e.advantageOnNextAttack && (!e.advantageOnNextAttack.against || e.advantageOnNextAttack.against === target.id)
    );
    // 效果给自己攻击掷骰的优势 / 劣势（克敌先击、恶言相加、降咒术、预知术）；armed 还没到的不算
    const rollMods = attacker.effects.filter(
      (e) => e.attackRoll && !e.armedAtTurnOf && (!e.attackRoll.against || e.attackRoll.against === target.id)
    );
    for (const e of rollMods) {
      const state = e.attackRoll!.state;
      effectSources.push({ state, note: `${e.name}：${state === 'adv' ? '优势' : '劣势'}` });
    }
    // 防护善恶之类：特定类型的攻击者打目标时劣势
    const warded = target.effects.find((e) => !!attacker.creatureType && e.attackersDisadvantageFrom?.includes(attacker.creatureType));
    if (warded) effectSources.push({ state: 'dis', note: `${warded.name}：${attacker.creatureType}的攻击劣势` });
    const exhaustion = exhaustionRollState(this.exhaustion(attacker), 'attack');
    if (exhaustion.advantage !== 'none') effectSources.push({ state: exhaustion.advantage, note: exhaustion.note ?? '力竭' });
    const ctx = attackContext({
      attackerConditions: this.conditionNames(attacker),
      targetConditions: this.conditionNames(target),
      adjacent: range.feet === null ? true : range.feet <= CELL_FEET,
      requested: explicit,
      rangedWithHostileNear: range.ranged && this.hostilesNear(attacker).length > 0,
      beyondNormalRange: range.ranged && range.normal !== null && range.feet !== null && range.feet > range.normal,
      packTactics:
        this.hasTrait(attacker, /群体战术|pack tactics/i) && this.alliesNear(attacker, target.position).length > 0,
      flanking:
        this.flanking &&
        !range.ranged &&
        !!attacker.position &&
        !!target.position &&
        isFlanking(
          attacker.position,
          target.position,
          this.alliesNear(attacker, target.position).map((o) => o.position!)
        ),
      extraAdvantage: helped.map(() => '协助：优势'),
      effectSources,
      attackerSeesInvisible: target.effects.some((e) => e.blocksInvisibility),
    });
    return {
      ctx,
      cover: this.coverBonus(attacker, target),
      used: { target: usedOnTarget, attacker: [...helped, ...rollMods.filter((e) => e.attackRoll!.once)] },
    };
  }

  /** 攻击掷骰之后：用掉的一次性效果移除；躲藏 / 隐形术（攻击就结束）现形。 */
  private afterAttackRoll(
    attacker: Actor,
    target: Actor,
    used: { target: Actor['effects']; attacker: Actor['effects'] }
  ): void {
    if (used.target.length) target.effects = target.effects.filter((e) => !used.target.includes(e));
    if (used.attacker.length) attacker.effects = attacker.effects.filter((e) => !used.attacker.includes(e));
    this.reveal(attacker);
  }

  /** 攻击或施法会暴露躲藏的位置，也会结束隐形术。 */
  private reveal(actor: Actor): void {
    const had = actor.conditions.length;
    actor.conditions = actor.conditions.filter(
      (c) => !(c.name === 'hidden' || (c.name === 'invisible' && c.source === 'invisibility'))
    );
    if (actor.conditions.length !== had && actor.concentration?.spellId === 'invisibility') {
      this.breakConcentration(actor, '攻击结束了隐形术');
    }
  }

  /**
   * 偷袭：①攻击有优势，或 ②目标 5 尺内有另一个没失能的盟友（敌人）且自己没有劣势；并且武器是灵巧或远程。
   * forced 显式给了就听它的。
   */
  private qualifiesForSneak(attacker: Actor, target: Actor, def: AttackDef, advantage: Advantage, forced?: boolean): boolean {
    if (forced !== undefined) return forced;
    if (attacker.sneakAttackDice <= 0 || attacker.turn.sneakUsed) return false;
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    if (weapon && !(weapon.kind === 'ranged' || weapon.properties.includes('finesse'))) return false;
    if (advantage === 'adv') return true;
    if (advantage === 'dis') return false;
    // 另一个没失能的盟友在目标 5 尺内
    return this.alliesNear(attacker, target.position).length > 0;
  }

  /** 这一击占哪个“槽”：新的动作 / 继续 Attack 动作 / 额外动作 / 附赠动作 / 反应 / 不占。不够就抛错（不消耗）。 */
  private attackSlotOrThrow(
    attacker: Actor,
    how: { reaction?: boolean; bonusAction?: boolean; noSlot?: boolean }
  ): 'reaction' | 'continue' | 'extra' | 'new' | 'bonus' | 'none' {
    const t = attacker.turn;
    if (how.noSlot) return 'none';
    if (how.reaction) {
      if (!this.canReact(attacker)) throw new Error(`${attacker.name} 现在不能用反应（这个回合已经用过，或被限制了）`);
      return 'reaction';
    }
    if (how.bonusAction) {
      if (t.bonusUsed) throw new Error(`${attacker.name} 这个回合已经用过附赠动作了`);
      return 'bonus';
    }
    if (t.actionUsed) {
      if (t.attacksMade > 0 && t.attacksMade < t.attacksAllowed) return 'continue';
      if (t.extraActions > 0) return 'extra';
      throw new Error(`${attacker.name} 这个回合已经用过动作了`);
    }
    return 'new';
  }

  private consumeAttackSlot(attacker: Actor, slot: 'reaction' | 'continue' | 'extra' | 'new' | 'bonus' | 'none'): void {
    const t = attacker.turn;
    const perAction = this.swingBudget(attacker);
    if (slot === 'none') return;
    if (slot === 'reaction') t.reactionUsed = true;
    else if (slot === 'bonus') t.bonusUsed = true;
    else if (slot === 'continue') t.attacksMade += 1;
    else if (slot === 'extra') {
      t.extraActions -= 1;
      t.attacksMade = 1;
      t.attacksAllowed = perAction;
    } else {
      t.actionUsed = true;
      t.attacksMade = 1;
      t.attacksAllowed = perAction;
    }
  }

  async attack(
    attackerId: string,
    targetId: string,
    attack: AttackDef | string | number,
    opts: AttackOptions = {}
  ): Promise<AttackResult> {
    const attacker = this.require(attackerId);
    const target = this.require(targetId);
    if (this.isIncapacitated(attacker)) throw new Error(`${attacker.name} 现在不能攻击`);
    if (target.deathSaves.dead) throw new Error(`${target.name} 已经死了`);
    const def = this.resolveAttack(attacker, attack);
    const range = this.assertAttackRange(attacker, target, def);
    const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
    const meleeWeapon = this.defIsMelee(def);
    if (opts.offhand) {
      if (!(attacker.turn.actionUsed && attacker.turn.attacksMade > 0)) {
        throw new Error(`${attacker.name} 要先用 Attack 动作攻击一次，才能用附赠动作打副手`);
      }
      if (!meleeWeapon || !weapon?.properties.includes('light')) throw new Error('副手攻击要用轻型近战武器');
    }
    const slot = this.attackSlotOrThrow(attacker, { reaction: opts.reaction, bonusAction: opts.bonusAction || opts.offhand, noSlot: opts.noSlot });
    const math = this.attackMath(attacker, def, { offhand: opts.offhand });
    // 鲁莽攻击：回合内第一击上声明，本回合近战力量攻击有优势，对你的攻击也有优势（到你下回合开始）
    if (opts.reckless && hasFeature(attacker, 'reckless_attack') && meleeWeapon && attacker.turn.attacksMade === 0 && !attacker.turn.reckless) {
      attacker.turn.reckless = true;
      attacker.effects.push({
        id: uuid(),
        spellId: 'reckless',
        name: '鲁莽攻击',
        concentration: false,
        grantsAttackersAdvantage: true,
        untilTurnOf: attacker.id,
        note: '对你的攻击有优势，直到你下回合开始',
      });
    }
    const sit = this.attackSituation(attacker, target, range, opts.advantage);
    const notes = [...sit.ctx.notes];
    let advantage = sit.ctx.advantage;
    if (attacker.turn.reckless && meleeWeapon && math.ability === 'str') {
      advantage = mergeAdvantage([...sit.ctx.sources, 'adv']);
      notes.push('鲁莽攻击：优势');
    }
    const extra = attacker.effects
      .map((e) => e.attackDice)
      .filter((d): d is string => !!d)
      .map(diceTerm)
      .join('');
    let ac = this.acOf(target) + sit.cover;
    const roll = await this.d20({
      kind: 'attack',
      label: `${attacker.name} → ${target.name}：${def.name ?? weapon?.name ?? '攻击'}`,
      modifier: math.attackBonus,
      dc: ac,
      advantage,
      actorId: attackerId,
      targetId,
      extraDice: extra || undefined,
      critOn: critThreshold(attacker),
      luck: hasFeature(attacker, 'halfling_luck'),
    });
    await this.tryInspiration(attacker, roll);
    this.consumeAttackSlot(attacker, slot);
    this.afterAttackRoll(attacker, target, sit.used);
    this.stoke(attacker);
    if (sit.cover) notes.push(`目标有${sit.cover === 5 ? '四分之三' : '半'}掩蔽：AC +${sit.cover}`);

    let hit = roll.crit || (!roll.fumble && roll.total >= ac);
    // 护盾术（反应）：这一击会命中、但 AC +5 能让它落空，而且目标会、有法术位、有反应 —— 自动施放
    if (hit && !roll.crit && (await this.autoShield(target, roll.total, ac))) {
      ac += 5;
      hit = roll.total >= ac;
      notes.push('目标用反应施放了护盾术（AC +5）');
    }
    roll.success = hit;
    const tag = {
      ...(opts.reaction ? { reaction: true } : {}),
    };
    if (!hit) {
      return {
        attack: roll,
        hit: false,
        crit: false,
        fumble: roll.fumble,
        damage: null,
        appliedDamage: 0,
        targetDown: false,
        sneakAttack: false,
        targetAc: ac,
        notes,
        coverBonus: sit.cover,
        ...tag,
      };
    }
    // 麻痹/昏迷的目标，5 尺内命中即暴击
    const crit = roll.crit || sit.ctx.autoCrit;
    roll.crit = crit;

    const sneak = this.qualifiesForSneak(attacker, target, def, advantage, opts.sneakAttack);
    const sneakFormula = sneak ? `+${attacker.sneakAttackDice}d6` : '';
    if (sneak) attacker.turn.sneakUsed = true;

    // 暴击额外骰：野蛮暴击、野蛮攻击（半兽人）——多掷武器骰，不翻倍
    const wctx = weaponContext(def, meleeWeapon);
    const die = /(\d*)d(\d+)/i.exec(math.damageFormula);
    const critExtraCount = crit && meleeWeapon ? this.critExtraDice(attacker) : 0;
    const damage = await this.damageRoll({
      label: `${attacker.name} 对 ${target.name} 的伤害${crit ? '（暴击）' : ''}`,
      formula: `${math.damageFormula}${sneakFormula}`,
      damageType: math.damageType,
      actorId: attackerId,
      targetId,
      crit,
      critExtra: critExtraCount > 0 && die ? `${critExtraCount}d${die[2]}` : undefined,
      rerollBelow: greatWeaponRerollBelow(attacker, wctx),
      rerollFirst: die ? Number(die[1] || 1) * (crit ? 2 : 1) : 0,
    });
    const parts: { amount: number; type: DamageType }[] = [{ amount: damage.total, type: math.damageType }];
    const extraRolls: RollResult[] = [];
    let total = damage.total;
    if (critExtraCount > 0) notes.push(`暴击额外 ${critExtraCount} 个武器骰`);
    if (def.extraDamage) {
      const extraRoll = await this.damageRoll({
        label: `${target.name} 的额外${def.extraDamage.damageType}伤害`,
        formula: def.extraDamage.formula,
        damageType: def.extraDamage.damageType,
        actorId: attackerId,
        targetId,
        crit,
      });
      let amount = extraRoll.total;
      if (def.extraDamage.save) {
        const sv = await this.save(target.id, def.extraDamage.save.ability, def.extraDamage.save.dc, {
          label: `${target.name} 豁免${def.name ?? '攻击'}的额外伤害（DC ${def.extraDamage.save.dc}）`,
          against: def.extraDamage.damageType === 'poison' ? 'poison' : undefined,
        });
        extraRolls.push(sv);
        if (sv.success) amount = Math.floor(amount / 2);
      }
      parts.push({ amount, type: def.extraDamage.damageType });
      total += amount;
    }
    // 效果带来的武器附加伤害：猎人印记（只对被标记的）、神恩术、惩击类（用一次就结束，并结束专注）
    for (const eff of [...attacker.effects]) {
      const b = eff.bonusDamage;
      if (!b || (b.against && b.against !== target.id)) continue;
      const type = b.damageType ?? math.damageType;
      const bd = await this.damageRoll({
        label: `${eff.name}：额外伤害`,
        formula: b.dice,
        damageType: type,
        actorId: attackerId,
        targetId,
        crit,
      });
      extraRolls.push(bd);
      parts.push({ amount: bd.total, type });
      total += bd.total;
      notes.push(`${eff.name} +${bd.total} ${type}`);
      if (b.once) {
        attacker.effects = attacker.effects.filter((e) => e !== eff);
        if (attacker.concentration?.spellId === eff.spellId) attacker.concentration = null;
      }
    }
    // 神圣斩击：命中后用一个法术位多打光耀伤害（近战武器攻击）
    const smiteLevel = opts.smite ?? 0;
    if (smiteLevel > 0 && hasFeature(attacker, 'divine_smite') && meleeWeapon) {
      const slotState = attacker.spells?.slots[smiteLevel];
      if (slotState && slotState.used < slotState.max) {
        slotState.used += 1;
        const smite = await this.damageRoll({
          label: `${attacker.name} 的神圣斩击（${smiteLevel} 环）`,
          formula: `${smiteDice(smiteLevel)}d8`,
          damageType: 'radiant',
          actorId: attackerId,
          targetId,
          crit,
        });
        extraRolls.push(smite);
        parts.push({ amount: smite.total, type: 'radiant' });
        total += smite.total;
        notes.push(`神圣斩击（${smiteLevel} 环法术位）+${smite.total} 光耀`);
      } else {
        notes.push(`想用神圣斩击，但没有 ${smiteLevel} 环法术位`);
      }
    }
    const magical = opts.magical === true || (weapon?.magicBonus ?? 0) + (def.magicBonus ?? 0) > 0;
    const applied = await this.applyDamageParts(target, parts, `${attacker.name} 的攻击`, { crit, magical, fromAttack: true });
    // 命中后的状态（撞倒、麻痹、擒抱）：给了 save 就是豁免失败才中
    let conditionApplied: ConditionName | undefined;
    if (def.onHit && !target.deathSaves.dead) {
      let lands = true;
      if (def.onHit.save) {
        const sv = await this.save(target.id, def.onHit.save.ability, def.onHit.save.dc, {
          label: `${target.name} 豁免${def.name ?? '攻击'}（DC ${def.onHit.save.dc}）`,
          against: def.onHit.condition,
        });
        extraRolls.push(sv);
        lands = !sv.success;
      }
      if (
        lands &&
        this.applyCondition(target.id, def.onHit.condition, {
          rounds: def.onHit.rounds,
          source: def.name,
          ...(def.onHit.condition === 'grappled' ? { grapplerId: attacker.id, escapeDc: def.onHit.escapeDc } : {}),
        })
      ) {
        conditionApplied = def.onHit.condition;
      }
    }
    // 震慑拳：命中后花 1 点气，体质豁免失败则震慑到你的下回合结束
    if (opts.stunningStrike && hasFeature(attacker, 'stunning_strike') && meleeWeapon && target.hp > 0) {
      if (this.resourceLeft(attacker, 'ki') > 0) {
        this.spendResource(attacker, 'ki');
        const dcStun = 8 + attacker.proficiencyBonus + abilityMod(attacker.abilities.wis);
        const sv = await this.save(target.id, 'con', dcStun, { label: `${target.name} 豁免震慑拳（DC ${dcStun}）` });
        extraRolls.push(sv);
        if (!sv.success && this.applyCondition(target.id, 'stunned', { rounds: 2, source: '震慑拳' })) {
          conditionApplied = 'stunned';
        }
      } else {
        notes.push('想用震慑拳，但气用完了');
      }
    }
    return {
      attack: roll,
      hit: true,
      crit,
      fumble: false,
      damage: { ...damage, total },
      appliedDamage: applied,
      targetDown: target.hp <= 0 || target.deathSaves.dead,
      sneakAttack: sneak,
      targetAc: ac,
      notes,
      coverBonus: sit.cover,
      ...(extraRolls.length ? { extraRolls } : {}),
      ...(conditionApplied ? { conditionApplied } : {}),
      ...tag,
    };
  }

  /**
   * 一次 Attack 动作：按额外攻击 / 怪物多攻套路连着打（目标倒下就停；“命中后才打”的步骤前一击没中就跳过）。
   * 第一击出错（够不到、动作用过了）直接抛错；后面的击出错就停在那里，返回已经打出的。
   */
  async attackAction(
    attackerId: string,
    targetId: string,
    attack: AttackDef | string | number,
    opts: AttackOptions = {}
  ): Promise<AttackResult[]> {
    const attacker = this.require(attackerId);
    const target = this.require(targetId);
    const def = this.resolveAttack(attacker, attack);
    const known = attacker.attacks.includes(def);
    const t = attacker.turn;
    const perAction = this.swingBudget(attacker);
    // Attack 动作已经打完了、但还有额外动作（动作如潮）：下一次是全新的一个 Attack 动作
    const openAttack = t.actionUsed && t.attacksMade > 0 && t.attacksMade < t.attacksAllowed;
    const capacity = openAttack ? t.attacksAllowed - t.attacksMade : perAction;
    const swings = known
      ? plannedSwings(attacker.attacks, attacker.routines, def.name ?? def.weaponId, attacker.attacksPerAction ?? 1)
      : [def];
    const results: AttackResult[] = [];
    let previousHit = true;
    // 神圣斩击 / 震慑拳 / 鲁莽攻击只在这个动作的第一次命中（第一击）上声明，不要每一击都花资源
    const swingOpts: AttackOptions = { ...opts };
    for (const swing of swings.slice(0, capacity)) {
      if (target.hp <= 0 || target.deathSaves.dead) break;
      if (swing.onlyIfHit && !previousHit) continue;
      try {
        const result = await this.attack(attackerId, targetId, swing, swingOpts);
        results.push(result);
        previousHit = result.hit;
        delete swingOpts.reckless;
        if (result.hit) {
          delete swingOpts.smite;
          delete swingOpts.stunningStrike;
        }
      } catch (e) {
        if (!results.length) throw e;
        break;
      }
    }
    return results;
  }

  private resolveAttack(actor: Actor, attack: AttackDef | string | number): AttackDef {
    if (typeof attack === 'number') {
      const def = actor.attacks[attack];
      if (!def) throw new Error(`${actor.name} 没有第 ${attack} 个攻击方式`);
      return def;
    }
    if (typeof attack === 'string') {
      const byId = actor.attacks.find((a) => a.weaponId === attack || a.name === attack);
      if (byId) return byId;
      if (WEAPONS[attack]) return { weaponId: attack };
      throw new Error(`不认识的攻击方式：${attack}`);
    }
    return attack;
  }

  // ---------------------------------------------------------------- 伤害 / 治疗
  async damage(
    targetId: string,
    amount: number,
    type: DamageType,
    sourceLabel = '伤害',
    opts: { crit?: boolean; magical?: boolean } = {}
  ): Promise<number> {
    return this.applyDamageParts(this.require(targetId), [{ amount, type }], sourceLabel, opts);
  }

  /**
   * 结算伤害：每种伤害各自过抗性 / 易伤 / 免疫，合起来先扣临时 HP 再扣 HP。
   * 0 HP：怪物直接死；PC 昏迷倒地并开始濒死，溢出 ≥ 最大 HP 即死；已经在 0 HP 再受伤记死亡豁免失败（暴击两次）。
   * 返回减免之后的总伤害（含被临时 HP 吸收的部分）。
   */
  private async applyDamageParts(
    target: Actor,
    parts: { amount: number; type: DamageType }[],
    sourceLabel: string,
    opts: { crit?: boolean; magical?: boolean; fromAttack?: boolean } = {}
  ): Promise<number> {
    if (target.deathSaves.dead) return 0;
    const resistAll = this.hasCondition(target, 'petrified');
    // 效果带来的抗性（狂暴）
    const extraRes = target.effects.flatMap((e) => e.resistances ?? []);
    const extraResNonmagical = target.effects.flatMap((e) => e.resistancesNonmagical ?? []);
    const defenses =
      extraRes.length || extraResNonmagical.length
        ? {
            ...target,
            resistances: [...target.resistances, ...extraRes],
            resistancesNonmagical: [...(target.resistancesNonmagical ?? []), ...extraResNonmagical],
          }
        : target;
    let total = 0;
    for (const p of parts) {
      total += damageAdjust(Math.max(0, Math.floor(p.amount)), p.type, defenses, { magical: opts.magical, resistAll }).amount;
    }
    if (total <= 0) return 0;
    // 直觉闪避（盗贼）：看得见的攻击者命中时，用反应把这次攻击的伤害减半
    if (opts.fromAttack && hasFeature(target, 'uncanny_dodge') && this.canReact(target) && !this.isIncapacitated(target)) {
      target.turn.reactionUsed = true;
      total = Math.floor(total / 2);
    }
    this.stoke(target);
    const hpBefore = target.hp;
    let dmg = total;
    if (target.tempHp > 0) {
      const absorbed = Math.min(target.tempHp, dmg);
      target.tempHp -= absorbed;
      dmg -= absorbed;
    }
    if (dmg > 0) {
      target.hp = Math.max(0, hpBefore - dmg);
      // 不死坚韧（丧尸）：被打到 0 HP 时 DC 5+伤害 的体质豁免，成功留 1 HP；光耀和暴击不行
      if (
        target.hp === 0 &&
        target.kind === 'monster' &&
        this.hasTrait(target, /不死坚韧|undead fortitude/i) &&
        !opts.crit &&
        !parts.some((p) => p.type === 'radiant')
      ) {
        const sv = await this.save(target.id, 'con', 5 + dmg, { label: `${target.name} 不死坚韧（DC ${5 + dmg}）` });
        if (sv.success) target.hp = 1;
      }
      if (target.hp === 0) this.onZeroHp(target, { dropped: hpBefore > 0, overkill: Math.max(0, dmg - hpBefore), crit: opts.crit === true, sourceLabel });
    }
    if (target.hp > 0 && target.concentration) {
      const dc = Math.max(10, Math.floor(total / 2));
      const save = await this.save(target.id, 'con', dc, { label: `${target.name} 专注豁免（DC ${dc}）` });
      if (!save.success) this.breakConcentration(target, '专注被打断');
    }
    return total;
  }

  /** HP 到 0 之后的事。 */
  private onZeroHp(
    target: Actor,
    ctx: { dropped: boolean; overkill: number; crit: boolean; sourceLabel: string }
  ): void {
    // 狂暴在失去意识时结束
    target.effects = target.effects.filter((e) => e.spellId !== 'rage');
    // 不屈耐力（半兽人）：没被即死的话，每次长休一次，留 1 HP 站着
    if (
      target.kind === 'pc' &&
      ctx.dropped &&
      hasFeature(target, 'relentless_endurance') &&
      !isMassiveDamage(ctx.overkill, this.maxHpOf(target))
    ) {
      const r = target.resources.relentless_endurance;
      if (!r || r.used < r.max) {
        if (r) r.used += 1;
        target.hp = 1;
        return;
      }
    }
    if (target.concentration) this.breakConcentration(target, '倒地');
    if (target.kind === 'monster') {
      target.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
      return;
    }
    const massive = isMassiveDamage(ctx.overkill, this.maxHpOf(target));
    if (!ctx.dropped) {
      // 已经在 0 HP：溢出 ≥ 最大 HP 即死，否则记死亡豁免失败，稳定也被打破
      target.deathSaves = massive
        ? { successes: 0, failures: 3, stable: false, dead: true }
        : onDamageAtZero(target.deathSaves, ctx.crit);
      return;
    }
    target.deathSaves = massive ? { successes: 0, failures: 3, stable: false, dead: true } : freshDeathTrack();
    if (!this.hasCondition(target, 'unconscious')) {
      target.conditions.push({ name: 'unconscious', source: DYING_SOURCE });
    }
    if (!this.hasCondition(target, 'prone')) target.conditions.push({ name: 'prone', source: DYING_SOURCE });
  }

  async heal(actorId: string, amount: number): Promise<number> {
    const actor = this.require(actorId);
    if (actor.deathSaves.dead) return 0;
    const healed = Math.min(Math.max(0, Math.floor(amount)), Math.max(0, this.maxHpOf(actor) - actor.hp));
    actor.hp += healed;
    if (actor.hp > 0 && healed > 0) {
      actor.deathSaves = freshDeathTrack();
      this.wake(actor);
    }
    return healed;
  }

  /** 任意骰子（陷阱伤害、治疗药水等）；让模型给公式、不给数字。 */
  async roll(formula: string, label: string): Promise<RollResult> {
    return this.damageRoll({ label, formula, damageType: 'force' });
  }

  // ---------------------------------------------------------------- 状态
  /** 加状态。免疫的状态加不上（返回 false）；力竭按等级叠加，4 级起 HP 上限减半，6 级死亡；失能会打断专注。 */
  applyCondition(
    actorId: string,
    name: ConditionName,
    opts: {
      level?: number;
      rounds?: number;
      source?: string;
      concentrationOf?: string;
      grapplerId?: string;
      escapeDc?: number;
      /** 每个回合结束再做一次这个豁免，成功就结束 */
      save?: { ability: Ability; dc: number };
      /** 摆脱用的检定属性（蛛网术：力量） */
      escapeAbility?: Ability;
    } = {}
  ): boolean {
    const actor = this.require(actorId);
    if ((actor.conditionImmunities ?? []).includes(name)) return false;
    if (name === 'exhaustion') {
      const existing = actor.conditions.find((c) => c.name === 'exhaustion');
      if (existing) existing.level = Math.min(6, (existing.level ?? 1) + (opts.level ?? 1));
      else actor.conditions.push({ name: 'exhaustion', level: Math.min(6, opts.level ?? 1), source: opts.source });
      const level = this.exhaustion(actor);
      if (level >= 6) {
        actor.hp = 0;
        actor.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
      } else if (level >= 4) {
        actor.hp = Math.min(actor.hp, this.maxHpOf(actor));
      }
      return true;
    }
    const existing = actor.conditions.find((c) => c.name === name);
    if (existing) {
      if (opts.rounds) existing.rounds = opts.rounds;
      return true;
    }
    actor.conditions.push({
      name,
      level: opts.level,
      rounds: opts.rounds,
      source: opts.source,
      ...(opts.concentrationOf ? { concentrationOf: opts.concentrationOf } : {}),
      ...(opts.grapplerId ? { grapplerId: opts.grapplerId } : {}),
      ...(opts.escapeDc !== undefined ? { escapeDc: opts.escapeDc } : {}),
      ...(opts.save ? { save: opts.save } : {}),
      ...(opts.escapeAbility ? { escapeAbility: opts.escapeAbility } : {}),
    });
    if (INCAPACITATING.includes(name) && actor.concentration) this.breakConcentration(actor, `${CONDITION_ZH[name]}，专注中断`);
    return true;
  }

  removeCondition(actor: Actor, name: ConditionName): boolean {
    const before = actor.conditions.length;
    actor.conditions = actor.conditions.filter((c) => c.name !== name);
    return actor.conditions.length !== before;
  }

  clearConditions(actorId: string, opts: { keepExhaustion?: boolean } = {}): void {
    const actor = this.require(actorId);
    actor.conditions = actor.conditions.filter((c) => opts.keepExhaustion && c.name === 'exhaustion');
  }

  private breakConcentration(actor: Actor, reason: string): string[] {
    const spellId = actor.concentration?.spellId;
    if (!spellId) return [];
    const removed: string[] = [];
    const tired: Actor[] = [];
    // 专注效果可能挂在别的角色身上（祝福术、信仰之盾）：整盘找
    const ids = new Set(actor.concentration?.effectIds ?? []);
    for (const holder of this.actors.values()) {
      const kept = holder.effects.filter((e) => {
        if (!ids.has(e.id)) return true;
        removed.push(e.name);
        if (e.lethargyOnEnd) tired.push(holder);
        return false;
      });
      holder.effects = kept;
      const before = holder.conditions.length;
      holder.conditions = holder.conditions.filter((c) => !(c.source === spellId && c.concentrationOf === actor.id));
      if (holder.conditions.length !== before) removed.push(`${spellId} 的状态`);
    }
    actor.concentration = null;
    void reason;
    // 加速术没了：被加速的生物陷入一个回合的倦怠
    for (const holder of tired) this.startLethargy(holder);
    return removed;
  }

  // ---------------------------------------------------------------- 动作
  private spendSimpleAction(actor: Actor, kind: 'action' | 'bonus'): void {
    if (this.isIncapacitated(actor)) throw new Error(`${actor.name} 现在不能行动`);
    const t = actor.turn;
    if (kind === 'bonus') {
      if (t.bonusUsed) throw new Error(`${actor.name} 这个回合已经用过附赠动作了`);
      t.bonusUsed = true;
      return;
    }
    if (t.actionUsed) {
      if (t.extraActions > 0) {
        t.extraActions -= 1;
        return;
      }
      throw new Error(`${actor.name} 这个回合已经用过动作了`);
    }
    t.actionUsed = true;
  }

  /**
   * 不是攻击也不是施法的动作：疾走（移动力翻倍）、闪避、撤离（不引发借机攻击）、躲藏（隐匿检定对被动感知）、
   * 协助（给盟友对某个目标的下一次攻击优势）、使用物体。bonus 为 true 时花附赠动作（狡诈动作之类）。
   */
  async takeAction(
    actorId: string,
    kind: 'dash' | 'dodge' | 'disengage' | 'hide' | 'help' | 'use_object',
    opts: { bonus?: boolean; allyId?: string; targetId?: string } = {}
  ): Promise<ActionOutcome> {
    const actor = this.require(actorId);
    if (opts.bonus) {
      const cunning = hasFeature(actor, 'cunning_action') && ['dash', 'disengage', 'hide'].includes(kind);
      const nimble = this.hasTrait(actor, /灵巧逃脱|nimble escape/i) && ['disengage', 'hide'].includes(kind);
      if (!cunning && !nimble) throw new Error(`${actor.name} 没有能用附赠动作做「${kind}」的特性（狡诈动作 / 灵巧逃脱）`);
    }
    this.spendSimpleAction(actor, opts.bonus ? 'bonus' : 'action');
    switch (kind) {
      case 'dash':
        actor.turn.dashed = true;
        return { ok: true, note: `${actor.name} 疾走：本回合移动力翻倍（共 ${this.speedOf(actor) * 2} 尺）` };
      case 'dodge':
        actor.turn.dodging = true;
        return { ok: true, note: `${actor.name} 闪避：到下回合开始前，对 ta 的攻击有劣势，敏捷豁免有优势` };
      case 'disengage':
        actor.turn.disengaged = true;
        return { ok: true, note: `${actor.name} 撤离：本回合移动不引发借机攻击` };
      case 'hide': {
        const foes = [...this.actors.values()].filter((o) => o.kind !== actor.kind && o.hp > 0 && !this.isIncapacitated(o));
        const dc = Math.max(10, ...foes.map((o) => this.passivePerception(o)));
        const roll = await this.check(actor.id, 'stealth', dc);
        if (roll.success) {
          this.applyCondition(actor.id, 'hidden', { source: 'hide' });
          return { ok: true, note: `${actor.name} 躲了起来（隐匿 ${roll.total} ≥ ${dc}）`, roll };
        }
        return { ok: true, note: `${actor.name} 没能藏住（隐匿 ${roll.total} < ${dc}）`, roll };
      }
      case 'help': {
        const ally = opts.allyId ? this.require(opts.allyId) : null;
        if (!ally || !opts.targetId) return { ok: false, note: '协助需要指定盟友和目标' };
        ally.effects.push({
          id: uuid(),
          spellId: 'help',
          name: '协助',
          concentration: false,
          advantageOnNextAttack: { against: opts.targetId },
          untilTurnOf: actor.id,
        });
        return { ok: true, note: `${actor.name} 协助 ${ally.name}：ta 对目标的下一次攻击有优势（到 ${actor.name} 下回合开始前）` };
      }
      case 'use_object':
        return { ok: true, note: `${actor.name} 使用物体` };
    }
  }


  /** 把目标沿着“远离 from”的方向推 feet 尺，撞到障碍或别人就停；返回实际推了几格。 */
  private pushActor(target: Actor, from: GridPos | undefined, feet: number): number {
    if (!target.position || !from) return 0;
    const dc = Math.sign(target.position.col - from.col);
    const dr = Math.sign(target.position.row - from.row);
    if (dc === 0 && dr === 0) return 0;
    let moved = 0;
    let pos: GridPos = { ...target.position };
    for (let i = 0; i < Math.floor(feet / CELL_FEET); i++) {
      const dest: GridPos = { col: pos.col + dc, row: pos.row + dr };
      if (!this.canStandAt(target, dest) || this.occupiedBy(dest, target.id)) break;
      pos = dest;
      target.position = dest;
      moved += 1;
    }
    return moved;
  }

  /** 用效果授予的攻击（灵体武器、火焰之刃）：法术攻击检定，伤害按效果里的骰。 */
  private async useGrantedAttack(actor: Actor, spellId: string, target: Actor | null): Promise<FeatureOutcome> {
    const eff = actor.effects.find((e) => e.spellId === spellId && e.grantsAttack);
    const g = eff?.grantsAttack;
    if (!eff || !g) throw new Error(`${actor.name} 现在没有「${spellId}」可用的攻击`);
    if (!target) throw new Error(`${g.name} 要指定目标`);
    if (target.deathSaves.dead) throw new Error(`${target.name} 已经死了`);
    const feet = actor.position && target.position ? this.distanceFeet(actor.position, target.position) : null;
    if (feet !== null && feet > g.rangeFeet) throw new Error(`${target.name} 离 ${actor.name} ${feet} 尺，${g.name}最多打 ${g.rangeFeet} 尺`);
    this.spendSimpleAction(actor, g.cost === 'bonus' ? 'bonus' : 'action');
    const sit = this.attackSituation(actor, target, { feet: g.floating ? null : feet, ranged: !g.melee, normal: null });
    const ac = this.acOf(target) + sit.cover;
    const roll = await this.d20({
      kind: 'attack',
      label: `${actor.name} → ${target.name}：${g.name}`,
      modifier: this.spellAttackBonus(actor),
      dc: ac,
      advantage: sit.ctx.advantage,
      actorId: actor.id,
      targetId: target.id,
    });
    this.afterAttackRoll(actor, target, sit.used);
    const hit = roll.crit || (!roll.fumble && roll.total >= ac);
    roll.success = hit;
    const base: AttackResult = {
      attack: roll,
      hit,
      crit: false,
      fumble: roll.fumble,
      damage: null,
      appliedDamage: 0,
      targetDown: false,
      sneakAttack: false,
      targetAc: ac,
      notes: sit.ctx.notes,
    };
    if (!hit) return { ok: true, note: `${actor.name} 的${g.name}没打中 ${target.name}`, rolls: [], attacks: [base] };
    const crit = roll.crit || sit.ctx.autoCrit;
    roll.crit = crit;
    const mod = g.addMod ? abilityMod(actor.abilities[actor.spells?.ability ?? 'wis']) : 0;
    const dmg = await this.damageRoll({
      label: `${g.name} 伤害${crit ? '（暴击）' : ''}`,
      formula: `${g.dice}${mod ? signed(mod) : ''}`,
      damageType: g.damageType,
      actorId: actor.id,
      targetId: target.id,
      crit,
    });
    const applied = await this.applyDamageParts(target, [{ amount: dmg.total, type: g.damageType }], g.name, { crit, magical: true });
    return {
      ok: true,
      note: `${actor.name} 的${g.name}命中 ${target.name}，${dmg.total} 点${g.damageType}伤害`,
      rolls: [],
      attacks: [{ ...base, crit, damage: dmg, appliedDamage: applied, targetDown: target.hp <= 0 || target.deathSaves.dead }],
    };
  }

  // ---------------------------------------------------------------- 擒抱 / 推撞 / 挣脱
  private static readonly SIZES = ['tiny', 'small', 'medium', 'large', 'huge', 'gargantuan'];

  private sizeRank(actor: Actor): number {
    const i = RulesEngine.SIZES.indexOf((actor.size ?? 'medium').toLowerCase());
    return i < 0 ? 2 : i;
  }

  /** 对抗检定：双方各从给的技能里挑加值高的那个掷一次；平手算防守方赢。 */
  private async contest(
    aId: string,
    aSkills: Skill[],
    bId: string,
    bSkills: Skill[]
  ): Promise<{ attackerWins: boolean; a: RollResult; b: RollResult }> {
    const best = (id: string, skills: Skill[]): Skill => {
      const actor = this.require(id);
      return [...skills].sort((x, y) => skillBonus(actor, y) - skillBonus(actor, x))[0];
    };
    const a = await this.check(aId, best(aId, aSkills), 0);
    const b = await this.check(bId, best(bId, bSkills), 0);
    return { attackerWins: a.total > b.total, a, b };
  }

  private assertReachable(attacker: Actor, target: Actor): void {
    if (attacker.position && target.position && this.distanceFeet(attacker.position, target.position) > CELL_FEET) {
      throw new Error(`${attacker.name} 够不到 ${target.name}（要在 5 尺内）`);
    }
  }

  /**
   * 擒抱：用一次攻击（Attack 动作里的一击）做运动检定对抗对方的运动或杂技；目标不能比你大超过一级。
   * 成功则目标被擒抱（速度 0），你失能、倒地或它被拉出触及范围时结束。
   */
  async grapple(attackerId: string, targetId: string): Promise<ActionOutcome> {
    const attacker = this.require(attackerId);
    const target = this.require(targetId);
    if (this.isIncapacitated(attacker)) throw new Error(`${attacker.name} 现在不能行动`);
    this.assertReachable(attacker, target);
    if (this.sizeRank(target) > this.sizeRank(attacker) + 1) throw new Error(`${target.name} 体型太大，擒抱不住`);
    const slot = this.attackSlotOrThrow(attacker, {});
    this.consumeAttackSlot(attacker, slot);
    const c = await this.contest(attackerId, ['athletics'], targetId, ['athletics', 'acrobatics']);
    if (!c.attackerWins) return { ok: true, note: `${attacker.name} 没能擒住 ${target.name}（${c.a.total} 对 ${c.b.total}）`, roll: c.a };
    this.applyCondition(target.id, 'grappled', { source: `${attacker.name} 的擒抱`, grapplerId: attacker.id });
    return { ok: true, note: `${attacker.name} 擒住了 ${target.name}（${c.a.total} 对 ${c.b.total}）：速度变成 0`, roll: c.a };
  }

  /** 推撞：同样用一次攻击；成功则目标倒地，或者被推开 5 尺。 */
  async shove(attackerId: string, targetId: string, mode: 'prone' | 'push' = 'prone'): Promise<ActionOutcome> {
    const attacker = this.require(attackerId);
    const target = this.require(targetId);
    if (this.isIncapacitated(attacker)) throw new Error(`${attacker.name} 现在不能行动`);
    this.assertReachable(attacker, target);
    if (this.sizeRank(target) > this.sizeRank(attacker) + 1) throw new Error(`${target.name} 体型太大，推不动`);
    const slot = this.attackSlotOrThrow(attacker, {});
    this.consumeAttackSlot(attacker, slot);
    const c = await this.contest(attackerId, ['athletics'], targetId, ['athletics', 'acrobatics']);
    if (!c.attackerWins) return { ok: true, note: `${attacker.name} 没推动 ${target.name}（${c.a.total} 对 ${c.b.total}）`, roll: c.a };
    if (mode === 'prone') {
      this.applyCondition(target.id, 'prone', { source: `${attacker.name} 的推撞` });
      return { ok: true, note: `${attacker.name} 把 ${target.name} 推倒在地（${c.a.total} 对 ${c.b.total}）`, roll: c.a };
    }
    if (attacker.position && target.position) {
      const dc = Math.sign(target.position.col - attacker.position.col);
      const dr = Math.sign(target.position.row - attacker.position.row);
      const dest = { col: target.position.col + dc, row: target.position.row + dr };
      if (this.canStandAt(target, dest) && !this.occupiedBy(dest, target.id)) {
        target.position = dest;
        return { ok: true, note: `${attacker.name} 把 ${target.name} 推开了 5 尺`, roll: c.a };
      }
      return { ok: true, note: `${attacker.name} 推了 ${target.name}，但后面没有空间`, roll: c.a };
    }
    return { ok: true, note: `${attacker.name} 把 ${target.name} 推开了 5 尺`, roll: c.a };
  }

  /** 挣脱擒抱：用一个动作，运动或杂技对抗擒抱者的运动检定（怪物的擒抱有固定的脱逃 DC）。 */
  async escapeGrapple(actorId: string): Promise<ActionOutcome> {
    const actor = this.require(actorId);
    const grip =
      actor.conditions.find((c) => c.name === 'grappled') ??
      actor.conditions.find((c) => c.name === 'restrained' && c.escapeDc !== undefined);
    if (!grip) return { ok: false, note: `${actor.name} 没有被擒抱或困住` };
    this.spendSimpleAction(actor, 'action');
    const grappler = grip.grapplerId ? this.get(grip.grapplerId) : undefined;
    let success: boolean;
    let roll: RollResult;
    let text: string;
    if (grip.escapeDc !== undefined || !grappler) {
      const dc = grip.escapeDc ?? 10;
      // 蛛网术这类：指定用什么属性检定；擒抱：运动或杂技
      const skill: Ability | Skill = grip.escapeAbility ?? (skillBonus(actor, 'athletics') >= skillBonus(actor, 'acrobatics') ? 'athletics' : 'acrobatics');
      roll = await this.check(actor.id, skill, dc);
      success = roll.success === true;
      text = `（${roll.total} 对脱逃 DC ${dc}）`;
    } else {
      const c = await this.contest(actor.id, ['athletics', 'acrobatics'], grappler.id, ['athletics']);
      roll = c.a;
      success = c.attackerWins;
      text = `（${c.a.total} 对 ${c.b.total}）`;
    }
    if (success) {
      this.removeCondition(actor, grip.name);
      return { ok: true, note: `${actor.name} 挣脱了擒抱${text}`, roll };
    }
    return { ok: true, note: `${actor.name} 没能挣脱${text}`, roll };
  }

  // ---------------------------------------------------------------- 职业 / 种族特性（要“按下去”的那类）
  /**
   * 使用一个主动特性。可用的特性和用法见 features/registry.ts 的 USABLE_FEATURES：
   * 回气、动作如潮、狂暴、圣疗、驱逐不死生物、保全生命、疾风连击、坚忍防御、疾风步、武艺附赠打击、诗人激励、龙息。
   * 资源不够 / 动作用掉了 / 没有这个特性就抛错（不消耗任何东西）。
   */
  async useFeature(actorId: string, featureId: string, args: FeatureArgs = {}): Promise<FeatureOutcome> {
    const actor = this.require(actorId);
    if (this.isIncapacitated(actor)) throw new Error(`${actor.name} 现在不能使用特性`);
    const need = (id: string, label: string) => {
      if (!hasFeature(actor, id)) throw new Error(`${actor.name} 没有「${label}」`);
    };
    const rolls: RollResult[] = [];
    const target = args.targetId ? this.require(args.targetId) : null;

    switch (featureId) {
      case 'second_wind': {
        need('second_wind', '回气');
        this.assertResource(actor, 'second_wind');
        this.spendSimpleAction(actor, 'bonus');
        this.spendResource(actor, 'second_wind');
        const roll = await this.damageRoll({
          label: `${actor.name} 回气`,
          formula: `1d10+${classLevelOr(actor, 'fighter')}`,
          damageType: 'radiant',
          actorId,
        });
        rolls.push(roll);
        const healed = await this.heal(actor.id, roll.total);
        return { ok: true, note: `${actor.name} 回气，恢复 ${healed} 点 HP（${actor.hp}/${this.maxHpOf(actor)}）`, rolls };
      }
      case 'action_surge': {
        need('action_surge', '动作如潮');
        this.assertResource(actor, 'action_surge');
        this.spendResource(actor, 'action_surge');
        actor.turn.extraActions += 1;
        return { ok: true, note: `${actor.name} 动作如潮：这个回合多一个完整动作`, rolls };
      }
      case 'rage': {
        need('rage', '狂暴');
        if (this.isRaging(actor)) throw new Error(`${actor.name} 已经在狂暴了`);
        this.assertResource(actor, 'rage');
        this.spendSimpleAction(actor, 'bonus');
        this.spendResource(actor, 'rage');
        if (actor.concentration) this.breakConcentration(actor, '进入狂暴，专注中断');
        const level = classLevelOr(actor, 'barbarian');
        actor.effects.push({
          id: uuid(),
          spellId: 'rage',
          name: '狂暴',
          concentration: false,
          rounds: 10,
          resistances: ['bludgeoning', 'piercing', 'slashing'],
          stoked: true,
          note: `物理伤害抗性；近战力量攻击 +${rageDamage(level)} 伤害；力量检定和豁免优势；不能施法或专注`,
        });
        return {
          ok: true,
          note: `${actor.name} 狂暴！物理伤害抗性，近战力量攻击 +${rageDamage(level)} 伤害；整个回合不攻击也不受伤就会结束`,
          rolls,
        };
      }
      case 'lay_on_hands': {
        need('lay_on_hands', '圣疗');
        const who = target ?? actor;
        const left = this.resourceLeft(actor, 'lay_on_hands');
        if (left <= 0) throw new Error(`${actor.name} 的圣疗池空了`);
        const cure = args.mode === 'poison' || args.mode === 'disease';
        const amount = Math.max(0, Math.min(left, Math.floor(args.amount ?? 0)));
        if (!cure && amount <= 0) throw new Error('圣疗要写治疗多少点（amount）');
        if (this.combat.active && who.position && actor.position && this.distanceFeet(actor.position, who.position) > CELL_FEET) {
          throw new Error(`${actor.name} 要碰到 ${who.name} 才能圣疗（5 尺内）`);
        }
        this.spendSimpleAction(actor, 'action');
        if (cure) {
          this.spendResource(actor, 'lay_on_hands', Math.min(5, left));
          this.removeCondition(who, 'poisoned');
          return { ok: true, note: `${actor.name} 用 5 点圣疗池解除了 ${who.name} 的${args.mode === 'poison' ? '毒素' : '疾病'}`, rolls };
        }
        this.spendResource(actor, 'lay_on_hands', amount);
        const healed = await this.heal(who.id, amount);
        return { ok: true, note: `${actor.name} 圣疗 ${who.name}：恢复 ${healed} 点 HP（圣疗池剩 ${this.resourceLeft(actor, 'lay_on_hands')}）`, rolls };
      }
      case 'turn_undead': {
        if (!hasFeature(actor, 'channel_divinity') && !hasFeature(actor, 'channel_divinity_turn_undead')) throw new Error(`${actor.name} 没有引导神力`);
        this.assertResource(actor, 'channel_divinity');
        this.spendSimpleAction(actor, 'action');
        this.spendResource(actor, 'channel_divinity');
        const dc = this.spellSaveDc(actor);
        const level = classLevelOr(actor, 'cleric');
        const destroyBelow = level >= 17 ? 4 : level >= 14 ? 3 : level >= 11 ? 2 : level >= 8 ? 1 : level >= 5 ? 0.5 : 0;
        const notes: string[] = [];
        const foes = [...this.actors.values()].filter(
          (o) =>
            o.kind !== actor.kind &&
            o.hp > 0 &&
            o.creatureType === 'undead' &&
            (!args.targetIds?.length || args.targetIds.includes(o.id)) &&
            (!o.position || !actor.position || this.distanceFeet(actor.position, o.position) <= 30)
        );
        for (const foe of foes) {
          const save = await this.save(foe.id, 'wis', dc, { label: `${foe.name} 豁免驱逐不死生物（DC ${dc}）`, magical: true, against: 'frightened' });
          rolls.push(save);
          if (save.success) continue;
          if (destroyBelow > 0 && (foe.cr ?? 99) <= destroyBelow) {
            foe.hp = 0;
            foe.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
            notes.push(`${foe.name} 被神力摧毁`);
          } else {
            this.applyCondition(foe.id, 'frightened', { rounds: 10, source: '驱逐不死生物' });
            notes.push(`${foe.name} 被驱逐（1 分钟内恐惧）`);
          }
        }
        return {
          ok: true,
          note: `${actor.name} 举起圣徽驱逐不死生物（DC ${dc}）：${foes.length ? notes.join('；') || '全都扛住了' : '30 尺内没有不死生物'}`,
          rolls,
        };
      }
      case 'preserve_life': {
        need('channel_divinity_preserve_life', '保全生命');
        this.assertResource(actor, 'channel_divinity');
        const pool = 5 * classLevelOr(actor, 'cleric');
        const dist = args.distribution ?? {};
        const total = Object.values(dist).reduce((s, n) => s + Math.max(0, Math.floor(n)), 0);
        if (total <= 0) throw new Error('保全生命要写 distribution：{ 角色id: 治疗多少点 }');
        if (total > pool) throw new Error(`保全生命最多分配 ${pool} 点（牧师等级 ×5），你写了 ${total}`);
        this.spendSimpleAction(actor, 'action');
        this.spendResource(actor, 'channel_divinity');
        const notes: string[] = [];
        for (const [id, want] of Object.entries(dist)) {
          const who = this.get(id);
          if (!who || who.deathSaves.dead) continue;
          if (who.position && actor.position && this.distanceFeet(actor.position, who.position) > 30) {
            notes.push(`${who.name} 在 30 尺外`);
            continue;
          }
          // 只能把 HP 补到上限的一半
          const room = Math.max(0, Math.floor(this.maxHpOf(who) / 2) - who.hp);
          const healed = await this.heal(who.id, Math.min(room, Math.max(0, Math.floor(want))));
          notes.push(`${who.name} +${healed}`);
        }
        return { ok: true, note: `${actor.name} 保全生命：${notes.join('，')}`, rolls };
      }
      case 'flurry_of_blows': {
        need('flurry_of_blows', '疾风连击');
        if (!target) throw new Error('疾风连击要指定目标');
        if (!(actor.turn.actionUsed && actor.turn.attacksMade > 0)) throw new Error('疾风连击要在 Attack 动作之后');
        if (actor.turn.bonusUsed) throw new Error(`${actor.name} 这个回合已经用过附赠动作了`);
        this.assertResource(actor, 'ki');
        this.spendResource(actor, 'ki');
        actor.turn.bonusUsed = true;
        const attacks: AttackResult[] = [];
        for (let i = 0; i < 2; i++) {
          if (target.hp <= 0 || target.deathSaves.dead) break;
          attacks.push(await this.attack(actor.id, target.id, 'unarmed', { noSlot: true }));
        }
        return { ok: true, note: `${actor.name} 疾风连击（气剩 ${this.resourceLeft(actor, 'ki')}）`, rolls, attacks };
      }
      case 'martial_arts': {
        need('martial_arts', '武艺');
        if (!target) throw new Error('武艺附赠打击要指定目标');
        if (!(actor.turn.actionUsed && actor.turn.attacksMade > 0)) throw new Error('武艺的附赠打击要在 Attack 动作之后');
        if (actor.turn.bonusUsed) throw new Error(`${actor.name} 这个回合已经用过附赠动作了`);
        actor.turn.bonusUsed = true;
        const attacks = [await this.attack(actor.id, target.id, 'unarmed', { noSlot: true })];
        return { ok: true, note: `${actor.name} 用附赠动作徒手打击`, rolls, attacks };
      }
      case 'patient_defense': {
        need('patient_defense', '坚忍防御');
        this.assertResource(actor, 'ki');
        this.spendSimpleAction(actor, 'bonus');
        this.spendResource(actor, 'ki');
        actor.turn.dodging = true;
        return { ok: true, note: `${actor.name} 坚忍防御：花 1 点气，附赠动作闪避`, rolls };
      }
      case 'step_of_the_wind': {
        need('step_of_the_wind', '疾风步');
        this.assertResource(actor, 'ki');
        this.spendSimpleAction(actor, 'bonus');
        this.spendResource(actor, 'ki');
        if (args.mode === 'dash') actor.turn.dashed = true;
        else actor.turn.disengaged = true;
        return { ok: true, note: `${actor.name} 疾风步：花 1 点气，附赠动作${args.mode === 'dash' ? '疾走' : '撤离'}`, rolls };
      }
      case 'bardic_inspiration': {
        need('bardic_inspiration', '诗人激励');
        if (!target || target.id === actor.id) throw new Error('诗人激励要指定一位盟友（不能是自己）');
        if (target.kind !== actor.kind) throw new Error('诗人激励只能给盟友');
        if (actor.position && target.position && this.distanceFeet(actor.position, target.position) > 60) throw new Error(`${target.name} 在 60 尺外`);
        this.assertResource(actor, 'bardic_inspiration');
        this.spendSimpleAction(actor, 'bonus');
        this.spendResource(actor, 'bardic_inspiration');
        const die = bardicDie(classLevelOr(actor, 'bard'));
        target.effects = target.effects.filter((e) => !e.inspirationDie);
        target.effects.push({
          id: uuid(),
          spellId: 'bardic_inspiration',
          name: '诗人激励',
          concentration: false,
          rounds: 100,
          inspirationDie: die,
          note: `一次攻击 / 检定 / 豁免差一点就成功时，自动加 d${die}`,
        });
        return { ok: true, note: `${actor.name} 激励 ${target.name}：持有 d${die} 激励骰（10 分钟内，差一点成功时自动用）`, rolls };
      }
      case 'breath_weapon': {
        const ancestry = (actor.features ?? []).find((f) => f.startsWith('draconic_ancestry_'))?.replace('draconic_ancestry_', '');
        const info = ancestry ? DRACONIC_ANCESTRY[ancestry] : undefined;
        if (!hasFeature(actor, 'breath_weapon') || !info) throw new Error(`${actor.name} 没有龙息（或没选龙裔祖先）`);
        if (!args.targetIds?.length) throw new Error('龙息要写 targetIds（锥形/直线里的目标）');
        this.assertResource(actor, 'breath_weapon');
        this.spendSimpleAction(actor, 'action');
        this.spendResource(actor, 'breath_weapon');
        const dc = 8 + abilityMod(actor.abilities.con) + actor.proficiencyBonus;
        const formula = `${breathDice(actor.level)}d6`;
        const notes: string[] = [];
        let first = true;
        let base = 0;
        for (const id of args.targetIds) {
          const foe = this.get(id);
          if (!foe || foe.hp <= 0) continue;
          if (first) {
            const dmg = await this.damageRoll({ label: `${actor.name} 的龙息`, formula, damageType: info.damage, actorId });
            rolls.push(dmg);
            base = dmg.total;
            first = false;
          }
          const save = await this.save(foe.id, info.save, dc, { label: `${foe.name} 豁免龙息（DC ${dc}）`, magical: false });
          rolls.push(save);
          const dealt = await this.applyDamageParts(foe, [{ amount: save.success ? Math.floor(base / 2) : base, type: info.damage }], '龙息', {});
          notes.push(`${foe.name} ${save.success ? '半伤' : '全伤'} ${dealt}`);
        }
        return { ok: true, note: `${actor.name} 喷出${info.damage}龙息（DC ${dc}，${formula}）：${notes.join('；')}`, rolls };
      }
      default:
        if (featureId.startsWith('granted:')) return this.useGrantedAttack(actor, featureId.slice('granted:'.length), target);
        throw new Error(`没有这个可主动使用的特性：${featureId}`);
    }
  }

  private assertResource(actor: Actor, key: string): void {
    if (this.resourceLeft(actor, key) <= 0) throw new Error(`${actor.name} 的「${actor.resources[key]?.name ?? key}」没有次数了`);
  }

  // ---------------------------------------------------------------- 法术
  spellSaveDc(caster: Actor): number {
    const ability = caster.spells?.ability ?? 'wis';
    return 8 + caster.proficiencyBonus + abilityMod(caster.abilities[ability]);
  }

  spellAttackBonus(caster: Actor): number {
    const ability = caster.spells?.ability ?? 'wis';
    return caster.proficiencyBonus + abilityMod(caster.abilities[ability]) + caster.effects.reduce((s, e) => s + (e.attackBonus ?? 0), 0);
  }

  private slotFor(caster: Actor, level: number) {
    return caster.spells?.slots[level];
  }

  async castSpell(
    casterId: string,
    spellId: string,
    slotLevel: number,
    targetIds: string[],
    opts: { ignoreKnown?: boolean; destination?: GridPos; option?: string } = {}
  ): Promise<CastResult> {
    const caster = this.require(casterId);
    const spell = SPELLS[spellId];
    const notes: string[] = [];
    const rolls: RollResult[] = [];
    const fail = (error: string): CastResult => ({
      ok: false,
      error,
      spell: spellId,
      slotLevel,
      slotUsed: false,
      concentration: false,
      rolls,
      damage: 0,
      heal: 0,
      notes,
    });
    if (!spell) return fail(`没有这个法术：${spellId}`);
    if (this.isIncapacitated(caster)) return fail(`${caster.name} 现在不能施法`);
    if (!caster.spells) return fail(`${caster.name} 不会施法`);
    if (!opts.ignoreKnown && !caster.spells.known.includes(spellId)) return fail(`${caster.name} 没有准备「${spell.name}」`);
    if (this.isRaging(caster)) return fail(`${caster.name} 在狂暴中，不能施法也不能专注`);
    const minimum = spell.level;
    const useLevel = spell.level === 0 ? 0 : slotLevel || minimum;
    if (spell.level > 0) {
      if (useLevel < minimum) return fail(`${spell.name} 至少需要 ${minimum} 环法术位`);
      if (useLevel > 9) return fail('法术位环阶不合法');
      const slot = this.slotFor(caster, useLevel);
      if (!slot || slot.used >= slot.max) return fail(`${caster.name} 没有可用的 ${useLevel} 环法术位`);
    }
    const cost = spell.castingTime;
    if (cost === 'action' && caster.turn.actionUsed) return fail(`${caster.name} 这个回合已经用过动作`);
    if (cost === 'bonus' && caster.turn.bonusUsed) return fail(`${caster.name} 这个回合已经用过附赠动作`);
    if (cost === 'reaction' && !this.canReact(caster)) return fail(`${caster.name} 现在不能用反应（这个回合已经用过，或被限制了）`);

    // 先把能检查的都检查完（目标、射程），再扣法术位和动作：不要出错了还白扔一个法术位
    let choice: SpellChoice | undefined;
    if (spell.choices?.length) {
      const text = (opts.option ?? '').toLowerCase();
      choice = spell.choices.find((c) => c.match.some((k) => text.includes(k.toLowerCase())));
      if (!choice) return fail(`${spell.name} 要先选一种：${spell.choices.map((c) => c.label).join('、')}（施法时要写明选哪一种）`);
    }
    const up = useLevel - minimum;
    // 戏法随施法者总等级成长：5 / 11 / 17 级伤害骰 ×2 / ×3 / ×4（魔能爆是射线数）
    const cantripFactor = spell.level === 0 && spell.cantripScaling ? (caster.level >= 17 ? 4 : caster.level >= 11 ? 3 : caster.level >= 5 ? 2 : 1) : 1;
    let targets = targetIds.map((id) => this.actors.get(id)).filter((a): a is Actor => !!a);
    // 「你选定的任意数量生物」类的增益：没给目标就是射程内所有活着的盟友（含自己）
    const allyRadius = spell.allyRadius;
    if (!targets.length && allyRadius && spell.effect.kind === 'buff') {
      targets = [...this.actors.values()].filter(
        (a) =>
          a.kind === caster.kind &&
          a.hp > 0 &&
          !a.deathSaves.dead &&
          (a.id === caster.id || !caster.position || !a.position || this.distanceFeet(caster.position, a.position) <= allyRadius)
      );
    }
    const needsTarget = ['attack', 'save', 'auto'].includes(spell.effect.kind) || (spell.effect.kind === 'buff' && !!spell.effect.markTarget);
    if (needsTarget && !targets.length) return fail(`${spell.name} 需要一个目标`);
    const rangeFeet = spellRangeFeet(spell);
    if (rangeFeet !== null && rangeFeet > 0 && caster.position) {
      for (const target of targets) {
        if (!target.position || target.id === caster.id) continue;
        const feet = this.distanceFeet(caster.position, target.position);
        if (feet > rangeFeet) return fail(`${target.name} 离 ${caster.name} ${feet} 尺，超出「${spell.name}」的 ${rangeFeet} 尺射程`);
      }
    }

    // 传送：落点要合法，错了不扣法术位
    let teleportTo: GridPos | null = null;
    if (spell.effect.kind === 'buff' && spell.effect.teleportFeet) {
      const dest = opts.destination ? { col: Math.round(opts.destination.col), row: Math.round(opts.destination.row) } : null;
      if (!dest) return fail(`${spell.name} 要给目的地格子（cell）`);
      if (!caster.position) return fail(`${caster.name} 还没有位置`);
      const feet = this.distanceFeet(caster.position, dest);
      if (feet > spell.effect.teleportFeet) return fail(`目的地离 ${caster.name} ${feet} 尺，${spell.name}最多 ${spell.effect.teleportFeet} 尺`);
      if (!this.canStandAt(caster, dest)) return fail(`${caster.name} 站不到 ${this.describeCell(dest)}（${kindText(this.cellKind(dest))}）`);
      const occupant = this.occupiedBy(dest, caster.id);
      if (occupant) return fail(`${this.describeCell(dest)} 已经站着 ${occupant.name}`);
      teleportTo = dest;
    }

    if (spell.concentration && caster.concentration) this.breakConcentration(caster, '开始新的专注');
    if (spell.level > 0) this.slotFor(caster, useLevel)!.used += 1;
    if (cost === 'action') caster.turn.actionUsed = true;
    if (cost === 'bonus') caster.turn.bonusUsed = true;
    if (cost === 'reaction') caster.turn.reactionUsed = true;

    const dc = this.spellSaveDc(caster);
    const effectIds: string[] = [];
    const concentrationOf = spell.concentration ? caster.id : undefined;

    const applyEffect = (
      target: Actor | undefined,
      e: Omit<Partial<ActiveEffect>, 'id' | 'spellId' | 'concentration'> & {
        name: string;
        condition?: ConditionName;
        untilCasterTurn?: boolean;
        /** 到挂着它的角色自己下个回合结束时结束（恶言相加） */
        untilTargetTurnEnd?: boolean;
        /** 等到施法者下一个回合才生效，并在那个回合结束时结束（克敌先击） */
        armedNextTurn?: boolean;
      }
    ) => {
      const who = target ?? caster;
      const { condition, untilCasterTurn, untilTargetTurnEnd, armedNextTurn, ...fields } = e;
      const timing = armedNextTurn
        ? { armedAtTurnOf: caster.id, untilEndOfTurnOf: caster.id }
        : untilCasterTurn
          ? { untilTurnOf: caster.id }
          : untilTargetTurnEnd
            ? { untilEndOfTurnOf: who.id }
            : { rounds: durationRounds(spell) };
      const effect: ActiveEffect = {
        ...fields,
        id: uuid(),
        spellId,
        concentration: spell.concentration,
        ...timing,
      };
      who.effects.push(effect);
      effectIds.push(effect.id);
      if (condition) {
        this.applyCondition(who.id, condition, { source: spellId, rounds: durationRounds(spell), concentrationOf });
      }
    };
    // 升环时能多影响几个目标（祝福术、灾祸术）
    const maxTargetsHere = (spell.maxTargets ?? Infinity) + (spell.maxTargets && spell.upcast?.targets ? spell.upcast.targets * up : 0);

    let damageDealt = 0;
    let healed = 0;

    switch (spell.effect.kind) {
      case 'attack': {
        const beams = spell.id === 'eldritch_blast';
        const count = (beams ? cantripFactor : spell.effect.attacks) + (spell.upcast?.attacks ?? 0) * up;
        const baseFormula = beams ? spell.effect.damage : scaleDice(spell.effect.damage, cantripFactor);
        // 魔能爆 + 痛击魔爆（邪术师祈请）：每道射线伤害加魅力调整值
        const agonizing = beams && hasFeature(caster, 'agonizing_blast') ? abilityMod(caster.abilities.cha) : 0;
        const damageFormula = addDice(agonizing ? `${baseFormula}${signed(agonizing)}` : baseFormula, spell.upcast?.damage, up);
        const melee = rangeFeet === 5;
        for (let i = 0; i < count; i++) {
          const target = targets[i % targets.length];
          const feet = caster.position && target.position ? this.distanceFeet(caster.position, target.position) : null;
          const sit = this.attackSituation(caster, target, { feet, ranged: !melee, normal: null });
          const ac = this.acOf(target) + sit.cover;
          let advantage = sit.ctx.advantage;
          if (spell.effect.advantageIfMetalArmor && target.metalArmor) {
            advantage = mergeAdvantage([...sit.ctx.sources, 'adv']);
            notes.push(`${target.name} 穿着金属护甲：${spell.name}有优势`);
          }
          const roll = await this.d20({
            kind: 'attack',
            label: `${caster.name} 施放 ${spell.name} → ${target.name}`,
            modifier: this.spellAttackBonus(caster),
            dc: ac,
            advantage,
            actorId: casterId,
            targetId: target.id,
          });
          rolls.push(roll);
          this.afterAttackRoll(caster, target, sit.used);
          const hit = roll.crit || (!roll.fumble && roll.total >= ac);
          roll.success = hit;
          if (!hit) continue;
          const crit = roll.crit || sit.ctx.autoCrit;
          roll.crit = crit;
          const dmg = await this.damageRoll({
            label: `${spell.name} 伤害${crit ? '（暴击）' : ''}`,
            formula: damageFormula,
            damageType: spell.effect.damageType,
            actorId: casterId,
            targetId: target.id,
            crit,
          });
          rolls.push(dmg);
          const parts: { amount: number; type: DamageType }[] = [{ amount: dmg.total, type: spell.effect.damageType }];
          // 降咒术之类“每次命中额外伤害”的效果：法术攻击命中也算
          for (const eff of caster.effects) {
            const b = eff.bonusDamage;
            if (!b?.spellAttacks || (b.against && b.against !== target.id)) continue;
            const bd = await this.damageRoll({
              label: `${eff.name}：额外伤害`,
              formula: b.dice,
              damageType: b.damageType ?? spell.effect.damageType,
              actorId: casterId,
              targetId: target.id,
              crit,
            });
            rolls.push(bd);
            parts.push({ amount: bd.total, type: b.damageType ?? spell.effect.damageType });
            notes.push(`${eff.name} +${bd.total}`);
          }
          damageDealt += await this.applyDamageParts(target, parts, spell.name, {
            crit,
            magical: true,
          });
          if (spell.effect.rider) {
            const rider = spell.effect.rider;
            target.effects.push({
              id: uuid(),
              spellId,
              name: rider.name,
              concentration: false,
              grantsAttackersAdvantage: rider.grantsAttackersAdvantage,
              grantsAdvantageOnce: rider.grantsAdvantageOnce,
              ...(rider.noReactions ? { noReactions: true } : {}),
              ...(rider.untilCasterTurn
                ? { untilTurnOf: caster.id }
                : rider.untilTargetTurn
                  ? { untilTurnOf: target.id }
                  : { rounds: rider.rounds ?? 1 }),
              note: rider.note,
            });
          }
        }
        break;
      }
      case 'save': {
        const dmgFormula = addDice(spell.effect.damage ? scaleDice(spell.effect.damage, cantripFactor) : spell.effect.damage, spell.upcast?.damage, up);
        const extraTargets = (spell.upcast?.targets ?? 0) * up;
        const cap = spell.aoe ? Infinity : 1 + extraTargets;
        const list = targets.slice(0, Math.min(cap, maxTargetsHere));
        const rules = spell.effect.typeRules;
        for (const target of list) {
          // 按生物类型区别对待：免疫 / 豁免劣势 / 受最大伤害（枯萎术、日爆术、粉碎音波）
          const kind = target.creatureType ?? '';
          if (rules?.immune?.includes(kind)) {
            notes.push(`${target.name} 是${kind}，${spell.name}对它无效`);
            continue;
          }
          const typeDis = !!rules?.disadvantage?.includes(kind);
          const typeMax = !!rules?.maxDamage?.includes(kind);
          // 掩蔽给敏捷豁免加值（圣火之类无视掩蔽的除外）
          const cover = spell.effect.ability === 'dex' && !spell.effect.ignoreCover ? this.coverBonus(caster, target) : 0;
          const save = await this.save(target.id, spell.effect.ability, dc, {
            label: `${target.name} 豁免 ${spell.name}（DC ${dc}）`,
            bonus: cover,
            magical: true,
            against: spell.effect.condition ?? (spell.effect.damageType === 'poison' ? 'poison' : undefined),
            ...(typeDis ? { advantage: 'dis' as const } : {}),
          });
          if (typeDis) notes.push(`${target.name} 是${kind}：豁免劣势`);
          rolls.push(save);
          // 敏捷豁免半伤的法术：有“灵巧闪避”的目标成功则无伤、失败也只受半伤
          const evasion =
            spell.effect.ability === 'dex' && spell.effect.halfOnSave === true && hasFeature(target, 'evasion') && !this.isIncapacitated(target);
          if (spell.effect.damage) {
            let amount = 0;
            if (save.success && evasion) {
              notes.push(`${target.name} 灵巧闪避：一点伤害都没吃`);
            } else if (save.success) {
              if (spell.effect.halfOnSave) {
                const dmg = await this.damageRoll({
                  label: `${spell.name} 半伤`,
                  formula: dmgFormula,
                  damageType: spell.effect.damageType!,
                  actorId: casterId,
                  targetId: target.id,
                  maximize: typeMax,
                });
                rolls.push(dmg);
                amount = Math.floor(dmg.total / 2);
              }
            } else {
              const dmg = await this.damageRoll({
                label: `${spell.name} 伤害${typeMax ? '（取最大值）' : ''}`,
                formula: dmgFormula,
                damageType: spell.effect.damageType!,
                actorId: casterId,
                targetId: target.id,
                maximize: typeMax,
              });
              rolls.push(dmg);
              amount = evasion ? Math.floor(dmg.total / 2) : dmg.total;
            }
            if (amount > 0) {
              damageDealt += await this.applyDamageParts(
                target,
                [{ amount, type: spell.effect.damageType ?? 'force' }],
                spell.name,
                { magical: true }
              );
            }
          }
          if (!save.success && spell.effect.condition) {
            const applied = this.applyCondition(target.id, spell.effect.condition, {
              source: spellId,
              rounds: spell.effect.conditionRounds ?? durationRounds(spell),
              concentrationOf,
              ...(spell.effect.repeatSave ? { save: { ability: spell.effect.ability, dc } } : {}),
              ...(spell.effect.escapeAbility ? { escapeDc: dc, escapeAbility: spell.effect.escapeAbility } : {}),
            });
            notes.push(applied ? `${target.name} 被${CONDITION_ZH[spell.effect.condition]}` : `${target.name} 免疫${CONDITION_ZH[spell.effect.condition]}`);
          }
          if (!save.success && spell.effect.failEffect) {
            const { repeatSave, ...fe } = spell.effect.failEffect;
            const chosen = choice && !choice.onCaster ? choice : undefined;
            applyEffect(target, {
              ...fe,
              ...resolveMods(rollModsOf(fe), caster, target),
              ...resolveMods(rollModsOf(chosen?.fields), caster, target),
              ...(repeatSave ? { endSave: { ability: spell.effect.ability, dc } } : {}),
              name: choice ? `${fe.name}：${choice.label}` : fe.name,
            });
            // 挂在施法者身上的那一类选项（降咒术：你的攻击对它额外伤害）
            if (choice?.onCaster) {
              applyEffect(caster, {
                name: `${spell.name}：${choice.label}`,
                ...resolveMods(rollModsOf(choice.fields), caster, target),
                ...(choice.fields.bonusDamage ? { bonusDamage: { ...choice.fields.bonusDamage, against: target.id, spellAttacks: true } } : {}),
              });
            }
            notes.push(`${target.name} ${choice ? `${fe.name}（${choice.label}）` : fe.name}`);
          }
          if (!save.success && spell.effect.pushFeet && target.hp > 0) {
            const moved = this.pushActor(target, caster.position, spell.effect.pushFeet);
            if (moved > 0) notes.push(`${target.name} 被推开 ${moved * CELL_FEET} 尺`);
          }
        }
        break;
      }
      case 'auto': {
        if (spell.effect.darts && spell.effect.dartDamage) {
          // 魔法飞弹：每枚必中，可以分给不同的目标，升环每环多一枚
          const total = spell.effect.darts + (spell.upcast?.damage ? up : 0);
          const perTarget = new Map<string, number>();
          for (let i = 0; i < total; i++) {
            const t = targets[i % targets.length];
            perTarget.set(t.id, (perTarget.get(t.id) ?? 0) + 1);
          }
          for (const [id, n] of perTarget) {
            const target = this.require(id);
            const dmg = await this.damageRoll({
              label: `${spell.name} 伤害（${n} 枚飞弹 → ${target.name}）`,
              formula: multiplyFormula(spell.effect.dartDamage, n),
              damageType: spell.effect.damageType,
              actorId: casterId,
              targetId: target.id,
            });
            rolls.push(dmg);
            damageDealt += await this.applyDamageParts(target, [{ amount: dmg.total, type: spell.effect.damageType }], spell.name, {
              magical: true,
            });
          }
          break;
        }
        const target = targets[0];
        const formula = addDice(spell.effect.damage, spell.upcast?.damage, up);
        const dmg = await this.damageRoll({
          label: `${spell.name} 伤害`,
          formula,
          damageType: spell.effect.damageType,
          actorId: casterId,
          targetId: target.id,
        });
        rolls.push(dmg);
        damageDealt += await this.applyDamageParts(target, [{ amount: dmg.total, type: spell.effect.damageType }], spell.name, {
          magical: true,
        });
        break;
      }
      case 'heal': {
        const target = targets[0] ?? caster;
        const formula = addDice(spell.effect.dice, spell.upcast?.heal, up);
        // 希望信标：受到的治疗取骰子最大值
        const maxed = target.effects.some((e) => e.maxHealing);
        const roll = await this.damageRoll({
          label: `${spell.name} 治疗${maxed ? '（希望信标：取最大值）' : ''}`,
          formula,
          damageType: 'radiant',
          actorId: casterId,
          targetId: target.id,
          maximize: maxed,
        });
        rolls.push(roll);
        let amount = roll.total;
        if (spell.effect.addMod) amount += abilityMod(caster.abilities[caster.spells.ability]);
        if ((caster.features ?? []).includes('disciple_of_life')) amount += 2 + useLevel;
        healed += await this.heal(target.id, amount);
        break;
      }
      case 'buff': {
        const e = spell.effect;
        if (teleportTo) {
          const from = caster.position!;
          caster.position = teleportTo;
          notes.push(`${caster.name} 从 ${this.describeCell(from)} 传送到 ${this.describeCell(teleportTo)}`);
          if (e.note) notes.push(e.note);
          break;
        }
        const wanted = targets.length ? targets : [caster];
        const list = wanted.slice(0, maxTargetsHere);
        for (const target of list) {
          // 免疫某状态的生物不受影响（难以抗拒之舞：免疫魅惑者）
          if (e.unlessImmuneTo && (target.conditionImmunities ?? []).includes(e.unlessImmuneTo)) {
            notes.push(`${target.name} 免疫${CONDITION_ZH[e.unlessImmuneTo]}，${spell.name}对它无效`);
            continue;
          }
          // 复活：只对死去的 PC 有效
          if (e.revive) {
            if (target.kind !== 'pc' || !target.deathSaves.dead) {
              notes.push(`${target.name} 不是死去的 PC，${spell.name} 没有效果`);
              continue;
            }
            target.deathSaves = freshDeathTrack();
            target.hp = e.revive === 'full' ? this.maxHpOf(target) : 1;
            this.wake(target);
            notes.push(`${target.name} 回到了人世（${target.hp} HP）`);
            continue;
          }
          // 解除状态
          if (e.removes) {
            const present = e.removes.conditions.filter((n) => this.hasCondition(target, n));
            const gone = e.removes.one ? present.slice(0, 1) : present;
            for (const n of gone) this.removeCondition(target, n);
            if (gone.length) notes.push(`${target.name} 摆脱了${gone.map((n) => CONDITION_ZH[n]).join('、')}`);
            else if (e.removes.exhaustion && this.exhaustion(target) > 0) {
              const ex = target.conditions.find((c) => c.name === 'exhaustion');
              if (ex) {
                ex.level = (ex.level ?? 1) - e.removes.exhaustion;
                if ((ex.level ?? 0) <= 0) this.removeCondition(target, 'exhaustion');
              }
              notes.push(`${target.name} 的力竭降低了 ${e.removes.exhaustion} 级`);
            } else notes.push(`${target.name} 身上没有能解除的状态`);
          }
          // 临时 HP（不叠加，取大的）；增强属性的熊之耐力由选项给
          const tempFormula = e.tempHp ?? choice?.fields.tempHp;
          if (tempFormula) {
            const roll = await this.damageRoll({ label: `${spell.name} 临时 HP`, formula: tempFormula, damageType: 'force', actorId: casterId, targetId: target.id });
            rolls.push(roll);
            const amount = roll.total + (spell.upcast?.tempHp ?? 0) * up;
            if (amount > target.tempHp) target.tempHp = amount;
            notes.push(`${target.name} 获得 ${amount} 点临时 HP`);
          }
          const bonus = e.bonusDamage
            ? {
                ...e.bonusDamage,
                dice: addDice(e.bonusDamage.dice, spell.upcast?.bonusDamage, up),
                ...(e.markTarget ? { against: target.id } : {}),
              }
            : undefined;
          const granted = e.grantsAttack
            ? { ...e.grantsAttack, dice: addDice(e.grantsAttack.dice, e.grantsAttack.upcastEvery2, Math.floor(up / 2)) }
            : undefined;
          if (granted) delete (granted as { upcastEvery2?: string }).upcastEvery2;
          const fields = {
            acBonus: e.acBonus,
            attackDice: e.attackDice,
            saveDice: e.saveDice,
            checkDice: e.checkDice,
            acBase: e.acBase,
            speedBonus: e.speedBonus,
            speedMultiplier: e.speedMultiplier,
            extraAction: e.extraAction,
            resistances: e.resistances,
            resistancesNonmagical: e.resistancesNonmagical,
            attackersDisadvantage: e.attackersDisadvantage,
            grantsAttackersAdvantage: e.grantsAttackersAdvantage,
            lethargyOnEnd: e.lethargyOnEnd,
            bonusDamage: bonus,
            grantsAttack: granted,
            ...resolveMods(rollModsOf(e), caster, target),
            ...resolveMods(rollModsOf(choice?.fields), caster, target),
          };
          const hasFields = Object.values(fields).some((v) => v !== undefined) || e.condition !== undefined || e.untilCasterTurn;
          // 只复活 / 解除 / 临时 HP 的法术不用留一个空效果；其它（含只有说明的）照旧留着，记持续时间和专注
          if (hasFields || !(e.removes || tempFormula)) {
            // 猎人印记之类：效果挂在施法者身上，只对被标记的目标生效
            applyEffect(e.markTarget ? caster : target, {
              name: choice ? `${spell.name}：${choice.label}` : spell.name,
              ...fields,
              condition: e.condition,
              note: e.note,
              untilCasterTurn: e.untilCasterTurn,
              armedNextTurn: e.armedNextTurn,
            });
          }
        }
        notes.push(e.note ?? `${spell.name} 已生效`);
        break;
      }
      case 'sleep': {
        const poolRoll = await this.damageRoll({
          label: `${spell.name} 生命值池`,
          formula: addDice(spell.effect.pool, spell.upcast?.pool, up),
          damageType: 'psychic',
          actorId: casterId,
        });
        rolls.push(poolRoll);
        let pool = poolRoll.total;
        const sorted = [...targets].filter((t) => t.hp > 0).sort((a, b) => a.hp - b.hp);
        for (const target of sorted) {
          if (target.hp > pool) continue;
          if (hasFeature(target, 'fey_ancestry')) {
            notes.push(`${target.name} 有妖精血统，不会被魔法睡眠影响`);
            continue;
          }
          pool -= target.hp;
          const applied = this.applyCondition(target.id, 'unconscious', { source: spellId, rounds: durationRounds(spell) });
          notes.push(applied ? `${target.name} 陷入魔法睡眠` : `${target.name} 不会被魔法睡眠影响`);
        }
        break;
      }
      case 'utility': {
        notes.push(spell.effect.note);
        break;
      }
    }

    // 引擎没结算的那部分（吸血、荆棘墙的后续伤害…）：把法术自己的补充说明交给调用方，GM 才看得到
    if (spell.note && spell.effect.kind !== 'utility' && spell.effect.kind !== 'buff') notes.push(spell.note);
    if (spell.effect.kind === 'save' && spell.effect.note) notes.push(spell.effect.note);
    if (['attack', 'save', 'auto'].includes(spell.effect.kind)) this.reveal(caster);
    if (spell.concentration) {
      caster.concentration = { spellId, effectIds };
    }
    return {
      ok: true,
      spell: spellId,
      slotLevel: useLevel,
      slotUsed: spell.level > 0,
      concentration: spell.concentration,
      rolls,
      damage: damageDealt,
      heal: healed,
      notes,
    };
  }

  // ---------------------------------------------------------------- 战斗
  async startCombat(
    actorIds: string[],
    opts: { surprised?: string[] } = {}
  ): Promise<{ actorId: string; initiative: number }[]> {
    const rolls: { actorId: string; initiative: number; dex: number }[] = [];
    for (const id of actorIds) {
      const actor = this.require(id);
      const mod = abilityMod(actor.abilities.dex);
      const derived = rollDerivation(this.conditionNames(actor), 'initiative', 'dex', this.exhaustion(actor));
      const r = await this.d20({
        kind: 'initiative',
        label: `${actor.name} 先攻`,
        modifier: mod,
        // 先攻是敏捷检定：强化属性（猫之敏捷）、预知术的优势也算
        advantage: mergeAdvantage([...derived.sources, ...this.checkEdges(actor, 'dex')]),
        actorId: id,
      });
      rolls.push({ actorId: id, initiative: r.total, dex: actor.abilities.dex });
    }
    rolls.sort((a, b) => b.initiative - a.initiative || b.dex - a.dex || a.actorId.localeCompare(b.actorId));
    const surprised = (opts.surprised ?? []).filter((id) => actorIds.includes(id));
    this.combat = { active: true, round: 1, order: rolls, index: 0, ...(surprised.length ? { surprised: [...surprised] } : {}) };
    for (const id of actorIds) this.beginTurn(id);
    // 被突袭的：第一回合不能行动，也不能用反应，直到那个回合过去
    for (const id of surprised) this.require(id).turn.reactionUsed = true;
    return rolls.map(({ actorId, initiative }) => ({ actorId, initiative }));
  }

  currentActor(): Actor | null {
    if (!this.combat.active) return null;
    const id = this.combat.order[this.combat.index]?.actorId;
    return id ? this.actors.get(id) ?? null : null;
  }

  nextTurn(): string | null {
    if (!this.combat.active || this.combat.order.length === 0) return null;
    const ending = this.currentActor();
    if (ending) this.endTurnOf(ending);
    this.combat.index += 1;
    if (this.combat.index >= this.combat.order.length) {
      this.combat.index = 0;
      this.combat.round += 1;
      this.tickDurations();
    }
    const id = this.combat.order[this.combat.index]?.actorId ?? null;
    if (id) this.beginTurn(id);
    return id;
  }

  /**
   * 换到下一个“真的能行动”的人：死了的跳过；怪物倒地就是死了；濒死的 PC 在自己的回合开始时自动掷一次死亡豁免
   * （自然 20 醒来，醒来就轮到 ta 行动），没醒就跳过；稳定的昏迷 PC 直接跳过。
   * 绕完一整圈都没人能动（全员倒地 / 全灭）就返回 actorId: null，由调用方结束战斗。
   */
  async advanceTurn(): Promise<TurnAdvance> {
    const out: TurnAdvance = { actorId: null, notes: [], rolls: [], deathSaves: [] };
    if (!this.combat.active || this.combat.order.length === 0) return out;
    const ending = this.currentActor();
    if (ending) await this.endOfTurnSaves(ending, out);
    for (let guard = 0; guard < this.combat.order.length; guard++) {
      const id = this.nextTurn();
      const actor = id ? this.actors.get(id) : undefined;
      if (!id || !actor) continue;
      if (actor.deathSaves.dead || (actor.kind === 'monster' && actor.hp <= 0)) continue;
      if (this.combat.round === 1 && this.combat.surprised?.includes(id)) {
        this.combat.surprised = this.combat.surprised.filter((s) => s !== id);
        out.notes.push(`${actor.name} 被突袭，这个回合动不了`);
        continue;
      }
      // 失能（麻痹、震慑、睡眠中…）的人这个回合动不了；回合结束时的豁免照样做
      if (actor.hp > 0 && namesIncapacitated(this.conditionNames(actor))) {
        out.notes.push(`${actor.name} ${incapacitatedBy(this.conditionNames(actor)) ?? '失能'}，这个回合动不了`);
        await this.endOfTurnSaves(actor, out);
        if (!namesIncapacitated(this.conditionNames(actor))) {
          // 回合结束的豁免让 ta 好了：下个回合才能行动，这个回合已经过去
        }
        continue;
      }
      if (actor.hp <= 0) {
        if (actor.deathSaves.stable) continue;
        const result = await this.rollDeathSave(actor.id);
        out.rolls.push(result.roll);
        out.deathSaves.push({ actorId: actor.id, outcome: result.outcome, roll: result.roll });
        out.notes.push(deathSaveNote(actor, result));
        if (result.outcome !== 'revive') continue;
      }
      out.actorId = id;
      return out;
    }
    return out;
  }

  /** 回合结束时：带豁免的状态（定身人类）再做一次豁免，成功就结束。 */
  private async endOfTurnSaves(actor: Actor, out: TurnAdvance): Promise<void> {
    for (const cond of [...actor.conditions]) {
      if (!cond.save) continue;
      const roll = await this.save(actor.id, cond.save.ability, cond.save.dc, {
        label: `${actor.name} 回合结束再豁免（${CONDITION_ZH[cond.name]}，DC ${cond.save.dc}）`,
      });
      out.rolls.push(roll);
      if (roll.success) {
        this.removeCondition(actor, cond.name);
        out.notes.push(`${actor.name} 摆脱了${CONDITION_ZH[cond.name]}`);
      }
    }
    // 带回合末豁免的效果（缓慢术）：成功就结束这个效果
    for (const eff of [...actor.effects]) {
      if (!eff.endSave) continue;
      const roll = await this.save(actor.id, eff.endSave.ability, eff.endSave.dc, {
        label: `${actor.name} 回合结束再豁免（${eff.name}，DC ${eff.endSave.dc}）`,
        magical: true,
      });
      out.rolls.push(roll);
      if (roll.success) {
        this.dropEffects((e) => e === eff);
        out.notes.push(`${actor.name} 摆脱了${eff.name}`);
      }
    }
  }

  /** 战况：还有怪物活着、PC 能不能动。给调用方决定要不要结束战斗。 */
  combatStatus(): 'ongoing' | 'victory' | 'defeat' {
    // 战斗里只数参战的：场上还藏着的、没被拉进先攻的生物（栏里的狼、没惊动的哨兵）不能让战斗永远打不赢
    const foes = this.combat.active ? this.livingMonsters().filter((a) => this.combat.order.some((o) => o.actorId === a.id)) : this.livingMonsters();
    if (foes.length === 0) return 'victory';
    const standing = this.party().some((p) => !p.deathSaves.dead && p.hp > 0);
    return standing ? 'ongoing' : 'defeat';
  }

  // ---------------------------------------------------------------- 经验值
  /**
   * 战斗结束的经验值：场上已经倒下（HP 0）、还没发过经验的怪物，按 CR 查表，总数平分给还没死的 PC
   * （昏迷的也分，已经死亡的不分；零头不发）。逃跑的怪物 HP 没掉到 0，不算。发过的怪物打上 xpAwarded，
   * 所以战斗结束和换场景各调一次也不会重复。没有可发的返回 null。
   */
  awardCombatXp(): XpAward | null {
    const down = [...this.actors.values()].filter((a) => a.kind === 'monster' && a.hp <= 0 && !a.xpAwarded && typeof a.cr === 'number');
    if (!down.length) return null;
    const defeated: XpDefeated[] = down.map((a) => ({ id: a.id, name: a.name, cr: a.cr as number, xp: xpForCr(a.cr as number) }));
    const award = this.splitXp(
      defeated.reduce((sum, d) => sum + d.xp, 0),
      `击败${defeated.map((d) => d.name).join('、')}`,
      defeated
    );
    // 队里没人能分（全员死亡）时先不打标记，留着以后再发
    if (award) for (const a of down) a.xpAwarded = true;
    return award;
  }

  /** 剧情经验（完成任务、识破阴谋…）：GM 给一个总数，平分给还没死的 PC。 */
  awardXp(total: number, reason: string): XpAward | null {
    if (!Number.isFinite(total) || total <= 0) return null;
    return this.splitXp(Math.floor(total), reason, []);
  }

  private splitXp(total: number, reason: string, defeated: XpDefeated[]): XpAward | null {
    const members = this.party().filter((p) => !p.deathSaves.dead);
    if (!members.length) return null;
    const share = Math.floor(total / members.length);
    const gains: XpGain[] = members.map((p) => {
      const before = p.xp ?? xpForLevel(p.level);
      p.xp = before + share;
      return { actorId: p.id, name: p.name, gained: share, total: p.xp, level: p.level, reachedLevel: levelForXp(p.xp) };
    });
    return { reason, total, share, defeated, gains };
  }

  endCombat(): void {
    this.combat = { active: false, round: 0, order: [], index: 0 };
    for (const actor of this.actors.values()) {
      actor.turn = emptyTurn();
      // 战斗结束，狂暴和鲁莽攻击的状态都结束；加速术的倦怠没有回合可数，也一起结束
      actor.effects = actor.effects.filter((e) => e.spellId !== 'rage' && e.spellId !== 'reckless' && e.spellId !== LETHARGY);
      actor.conditions = actor.conditions.filter((c) => c.source !== LETHARGY);
    }
  }

  // ---------------------------------------------------------------- 物品和金币
  /** 给一个角色一件东西（同名合并）。返回合并后的那一堆。 */
  giveItem(actorId: string, item: NewItem): ItemStack {
    return addItem(this.require(actorId), item);
  }

  /** 拿走一件东西（用掉 / 被抢 / 扔掉）。没有或数量不够返回 null。 */
  takeItem(actorId: string, ref: string, qty = 1): { item: ItemStack; left: number } | null {
    return removeItem(this.require(actorId), ref, qty);
  }

  giveCoins(actorId: string, cp: number): number {
    return addCoins(this.require(actorId), cp);
  }

  /** 付钱 / 被抢。不够返回 false，不动。 */
  takeCoins(actorId: string, cp: number): boolean {
    return spendCoins(this.require(actorId), cp);
  }

  /**
   * 使用背包里的一件东西。有规则效果的（治疗药水）花一个动作、用掉一件、掷骰回血，可以给相邻的队友喝（战斗里要贴着，探索不限）；
   * 没有规则效果的只返回一句说明，不花动作、不用掉（GM 裁定）。找不到 ok:false。
   */
  async useItem(actorId: string, ref: string, targetId?: string): Promise<ActionOutcome & { consumed: boolean }> {
    const actor = this.require(actorId);
    const item = findItem(inventoryOf(actor), ref);
    if (!item) return { ok: false, consumed: false, note: `${actor.name} 的背包里没有「${ref}」` };
    const use = item.use;
    if (!use?.heal && !use?.note) return { ok: true, consumed: false, note: `${actor.name} 拿出了${item.name}（没有规则效果，由 GM 裁定）` };
    const target = this.require(targetId ?? actorId);
    if (target.deathSaves.dead) return { ok: false, consumed: false, note: `${target.name} 已经死了，${item.name}没有用` };
    if (target.id !== actor.id && this.combat.active && actor.position && target.position && this.distanceFeet(actor.position, target.position) > CELL_FEET) {
      return { ok: false, consumed: false, note: `${target.name} 离得太远（要相邻才能喂药），${item.name}没有用掉` };
    }
    this.spendSimpleAction(actor, 'action');
    const who = target.id === actor.id ? `${actor.name} 喝下` : `${actor.name} 让 ${target.name} 喝下`;
    let roll: RollResult | undefined;
    let effect = use.note ?? '';
    if (use.heal) {
      roll = await this.roll(use.heal, `${who}${item.name}`);
      const healed = await this.heal(target.id, roll.total);
      effect = `${use.heal}=${roll.total}，恢复 ${healed} HP，现在 ${target.hp}/${this.maxHpOf(target)}`;
    }
    removeItem(actor, item.name, 1);
    return { ok: true, consumed: true, roll, note: `${who}${item.name}：${effect}` };
  }

  // ---------------------------------------------------------------- 探索回合（战斗外的回合计）
  /**
   * 战斗外的回合开始：这个人这一轮的动作、附赠动作、反应和移动恢复。
   * 战斗外原来没人重置这些，一个 PC 在探索里用过一次动作，之后一直显示“本回合动作已用”，直到下一场战斗才恢复。
   */
  beginExplorationTurn(actorId: string): void {
    if (this.combat.active || !this.actors.has(actorId)) return;
    this.beginTurn(actorId);
  }

  /** 战斗外的回合结束：回合末才发生的事（狂暴要有人维持、到回合结束的效果）和带豁免的状态再豁免一次。 */
  async finishExplorationTurn(actorId: string): Promise<TurnAdvance> {
    const out: TurnAdvance = { actorId: null, notes: [], rolls: [], deathSaves: [] };
    const actor = this.actors.get(actorId);
    if (this.combat.active || !actor || actor.deathSaves.dead || actor.hp <= 0) return out;
    this.endTurnOf(actor);
    await this.endOfTurnSaves(actor, out);
    return out;
  }

  /** 战斗外一轮约 1 分钟 = 10 个战斗轮：有“回合数”的状态和效果按这个往前走（原来战斗外它们永远不会到期）。 */
  advanceExplorationRound(): void {
    if (this.combat.active) return;
    for (let i = 0; i < EXPLORATION_ROUND_TICKS; i++) this.tickDurations();
  }

  private tickDurations(): void {
    const tired: Actor[] = [];
    for (const actor of this.actors.values()) {
      actor.conditions = actor.conditions.filter((c) => {
        if (c.rounds === undefined) return true;
        c.rounds -= 1;
        return c.rounds > 0;
      });
      const removed: string[] = [];
      actor.effects = actor.effects.filter((e) => {
        if (e.rounds === undefined) return true;
        e.rounds -= 1;
        if (e.rounds <= 0) {
          removed.push(e.id);
          if (e.lethargyOnEnd) tired.push(actor);
          return false;
        }
        return true;
      });
    }
    // 专注的法术到期：效果和状态都没了（含挂在别人身上的），专注也就结束了
    for (const actor of this.actors.values()) {
      if (actor.concentration && !this.concentrationAlive(actor)) actor.concentration = null;
    }
    // 加速术时间到：被加速的生物陷入一个回合的倦怠
    for (const holder of tired) this.startLethargy(holder);
  }

  // ---------------------------------------------------------------- 休息
  async shortRest(actorIds: string[] = this.party().map((a) => a.id), dicePerActor = 1): Promise<{ actorId: string; healed: number; dice: number }[]> {
    if (this.combat.active) throw new Error('战斗中不能短休');
    const out: { actorId: string; healed: number; dice: number }[] = [];
    for (const id of actorIds) {
      const actor = this.require(id);
      let healed = 0;
      let used = 0;
      for (let i = 0; i < dicePerActor; i++) {
        if (actor.hitDice.used >= actor.hitDice.total) break;
        actor.hitDice.used += 1;
        used += 1;
        const roll = await this.damageRoll({
          label: `${actor.name} 消耗生命骰`,
          formula: `1d${actor.hitDice.die}${signed(abilityMod(actor.abilities.con))}`,
          damageType: 'bludgeoning',
          actorId: id,
        });
        healed += await this.heal(id, roll.total);
      }
      for (const r of Object.values(actor.resources)) {
        if (r.recharge === 'short') r.used = 0;
      }
      // 契约魔法：法术位短休回满
      if (actor.spells?.pact) for (const slot of Object.values(actor.spells.slots)) slot.used = 0;
      // 兼职邪术师：契约位混在总表里，近似为恢复该环阶至多 count 个已用位
      const merged = actor.spells?.pactSlots;
      const mergedSlot = merged ? actor.spells!.slots[merged.level] : undefined;
      if (merged && mergedSlot) mergedSlot.used -= Math.min(mergedSlot.used, merged.count);
      // 奥术回复（法师）：每天一次，短休时取回总环阶 ≤ ceil(法师等级/2) 的法术位，单个不超过 5 环，先取高环
      if (hasFeature(actor, 'arcane_recovery') && this.resourceLeft(actor, 'arcane_recovery') > 0 && actor.spells) {
        let budget = Math.ceil(classLevelOr(actor, 'wizard') / 2);
        for (let lvl = 5; lvl >= 1 && budget > 0; lvl--) {
          const slot = actor.spells.slots[lvl];
          while (slot && slot.used > 0 && lvl <= budget) {
            slot.used -= 1;
            budget -= lvl;
          }
        }
        this.spendResource(actor, 'arcane_recovery');
      }
      out.push({ actorId: id, healed, dice: used });
    }
    return out;
  }

  async longRest(actorIds: string[] = this.party().map((a) => a.id)): Promise<void> {
    for (const id of actorIds) {
      const actor = this.require(id);
      // 死了的不会因为睡一觉就活过来（要复活术）
      if (actor.deathSaves.dead) continue;
      actor.conditions = actor.conditions.filter((c) => c.name === 'exhaustion');
      const ex = actor.conditions.find((c) => c.name === 'exhaustion');
      if (ex) {
        ex.level = (ex.level ?? 1) - 1;
        if ((ex.level ?? 0) <= 0) actor.conditions = actor.conditions.filter((c) => c !== ex);
      }
      actor.hp = this.maxHpOf(actor);
      actor.tempHp = 0;
      actor.deathSaves = freshDeathTrack();
      actor.concentration = null;
      actor.effects = [];
      actor.hitDice.used = Math.max(0, actor.hitDice.used - Math.floor(actor.hitDice.total / 2));
      for (const slot of Object.values(actor.spells?.slots ?? {})) slot.used = 0;
      for (const r of Object.values(actor.resources)) r.used = 0;
      actor.turn = emptyTurn();
    }
  }

  // ---------------------------------------------------------------- 给玩家看的合法动作
  legalActions(actorId: string): LegalAction[] {
    const actor = this.require(actorId);
    if (this.isIncapacitated(actor) || actor.deathSaves.dead) return [];
    const acts: LegalAction[] = [];
    const canAction = !actor.turn.actionUsed;
    const canBonus = !actor.turn.bonusUsed;
    const canReaction = this.canReact(actor);

    const swings = this.swingBudget(actor);
    const attackOpen = actor.turn.actionUsed && actor.turn.attacksMade > 0 && actor.turn.attacksMade < actor.turn.attacksAllowed;
    for (const def of actor.attacks) {
      const math = this.attackMath(actor, def);
      const name = def.name ?? (def.weaponId ? WEAPONS[def.weaponId]?.name : '攻击') ?? '攻击';
      const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
      const melee = this.defIsMelee(def);
      const range = def.range ?? weapon?.range;
      const reach = this.defReachFeet(def);
      const rangeText = melee
        ? `${reach === CELL_FEET ? '近战（需要相邻，5 尺）' : `近战（触及 ${reach} 尺）`}${weapon?.properties.includes('thrown') && weapon.range ? `，可投掷 ${weapon.range[0]}/${weapon.range[1]} 尺` : ''}`
        : range
          ? `射程 ${range[0]}/${range[1]} 尺`
          : '远程';
      const available = canAction || attackOpen || actor.turn.extraActions > 0;
      acts.push({
        kind: 'attack',
        name: `攻击：${name}`,
        detail:
          `命中 ${signed(math.attackBonus)}，伤害 ${math.damageFormula}（${math.damageType}，平均 ${formulaAverage(math.damageFormula)}）；${rangeText}` +
          (swings > 1 ? `；一个动作可连攻 ${swings} 次` : '') +
          (melee ? this.attackOptionHints(actor) : ''),
        cost: 'action',
        weaponId: def.weaponId,
        attackBonus: math.attackBonus,
        damage: math.damageFormula,
        available,
        reason: available ? undefined : '本回合动作已用',
      });
    }

    const slots = actor.spells?.slots ?? {};
    for (const spellId of actor.spells?.known ?? []) {
      const spell = SPELLS[spellId];
      if (!spell) continue;
      const cost = spell.castingTime;
      const baseAvailable = cost === 'action' ? canAction : cost === 'bonus' ? canBonus : canReaction;
      let available = baseAvailable;
      let reason = baseAvailable ? undefined : `本回合${cost === 'action' ? '动作' : cost === 'bonus' ? '附赠动作' : '反应'}已用`;
      if (spell.level > 0) {
        const slot = slots[spell.level];
        if (!slot || slot.used >= slot.max) {
          available = false;
          reason = `没有 ${spell.level} 环法术位`;
        }
      }
      acts.push({
        kind: 'cast',
        name: `施法：${spell.name}`,
        detail: `${spell.level === 0 ? '戏法' : `${spell.level} 环`}，${spell.range}${spell.concentration ? '，专注' : ''}；${spell.effect.kind === 'utility' ? spell.effect.note : describeSpell(spell)}${spell.choices?.length ? `；施法时写明选哪一种：${spell.choices.map((c) => c.label).join('、')}` : ''}`,
        cost,
        spellId,
        spellLevel: spell.level,
        available,
        reason,
      });
    }

    for (const [featureId, f] of Object.entries(USABLE_FEATURES)) {
      const owns = hasFeature(actor, featureId) || (featureId === 'turn_undead' && hasFeature(actor, 'channel_divinity')) || (featureId === 'preserve_life' && hasFeature(actor, 'channel_divinity_preserve_life'));
      if (!owns) continue;
      let available = f.cost === 'bonus' ? canBonus : f.cost === 'action' ? canAction || actor.turn.extraActions > 0 : true;
      let reason = available ? undefined : f.cost === 'bonus' ? '本回合附赠动作已用' : '本回合动作已用';
      if (available && f.resource && this.resourceLeft(actor, f.resource) <= 0) {
        available = false;
        reason = `${actor.resources[f.resource]?.name ?? f.resource}没有次数了`;
      }
      if (available && (featureId === 'flurry_of_blows' || featureId === 'martial_arts') && !(actor.turn.actionUsed && actor.turn.attacksMade > 0)) {
        available = false;
        reason = '要先用 Attack 动作攻击过';
      }
      if (available && featureId === 'rage' && this.isRaging(actor)) {
        available = false;
        reason = '已经在狂暴了';
      }
      const left = f.resource ? `（${actor.resources[f.resource]?.name ?? f.resource} 剩 ${this.resourceLeft(actor, f.resource)}）` : '';
      acts.push({
        kind: 'feature',
        name: `特性：${f.name}`,
        detail: `${f.hint}${left}；用法：action.type=feature，detail 以 ${featureId} 开头${f.needs ? `；${f.needs}` : ''}`,
        cost: f.cost,
        featureId,
        available,
        reason,
      });
    }

    for (const eff of actor.effects) {
      const g = eff.grantsAttack;
      if (!g) continue;
      const available = g.cost === 'bonus' ? canBonus : canAction || actor.turn.extraActions > 0;
      acts.push({
        kind: 'feature',
        name: `特性：${g.name}`,
        detail: `${eff.name}赋予的攻击：法术攻击，${g.dice}${g.addMod ? '+施法属性' : ''} ${g.damageType}，最远 ${g.rangeFeet} 尺；用法：action.type=feature，detail 以 ${eff.spellId} 开头，target 写目标`,
        cost: g.cost,
        featureId: `granted:${eff.spellId}`,
        available,
        reason: available ? undefined : g.cost === 'bonus' ? '本回合附赠动作已用' : '本回合动作已用',
      });
    }

    const budget = this.nearbyBudget(actor);
    const reachable = this.reachableCells(actor, 8);
    const reachText = reachable.length
      ? `；可到 ${reachable.map((c) => this.describeCell(c, actor.position ?? undefined)).join('、')}`
      : actor.position
        ? `；当前位置 ${this.describeCell(actor.position)}`
        : '';
    const speedNow = this.speedOf(actor) * (actor.turn.dashed ? 2 : 1);
    const proneText = this.hasCondition(actor, 'prone') && this.combat.active ? '；你倒在地上，移动前要先站起来（花一半速度）' : '';
    const budgetText = this.combat.active
      ? `本回合最多还能走 ${Math.max(0, speedNow - actor.turn.movementUsed)} 尺（${budget} 格）${proneText}`
      : `移动范围约 ${this.speedOf(actor)} 尺（${budget} 格，探索中不受回合速度限制）`;
    acts.push({
      kind: 'move',
      name: '移动',
      detail: `${budgetText}${reachText}；走出敌人的触及范围会引发借机攻击（撤离除外）`,
      cost: 'movement',
      available: !this.combat.active || actor.turn.movementUsed < speedNow,
    });
    const canSpend = canAction || actor.turn.extraActions > 0;
    acts.push({ kind: 'dash', name: '疾走', detail: '本回合多移动一次速度', cost: 'action', available: canSpend });
    acts.push({ kind: 'dodge', name: '闪避', detail: '直到下回合开始，对你的攻击有劣势，敏捷豁免有优势', cost: 'action', available: canSpend });
    acts.push({ kind: 'disengage', name: '撤离', detail: '本回合移动不引发借机攻击', cost: 'action', available: canSpend });
    acts.push({ kind: 'hide', name: '躲藏', detail: '隐匿检定对敌人的被动感知；成功后攻击有优势，攻击后现形', cost: 'action', available: canSpend });
    acts.push({ kind: 'help', name: '协助', detail: '给一个盟友对某个目标的下一次攻击优势，或协助一次检定', cost: 'action', available: canSpend });
    acts.push({ kind: 'item', name: '使用物品', detail: '喝药、掏东西、点灯等（只能用背包里有的东西）', cost: 'action', available: canSpend });
    for (const it of actor.inventory ?? []) {
      if (!it.use?.heal && !it.use?.note) continue;
      acts.push({
        kind: 'item',
        name: `使用：${it.name}${it.qty > 1 ? ` ×${it.qty}` : ''}`,
        detail: `${itemLine(it)}；action.type=item，detail 写物品名，target 写对象（给相邻队友喝就写他的名字，不写就是自己）`,
        cost: 'action',
        available: canSpend,
      });
    }
    acts.push({ kind: 'other', name: '擒抱', detail: '用 Attack 动作里的一击：运动对抗对方的运动或杂技，成功则目标速度变 0（action.type=grapple，target 写目标）', cost: 'action', available: canAction || attackOpen || actor.turn.extraActions > 0 });
    acts.push({ kind: 'other', name: '推撞', detail: '用 Attack 动作里的一击：运动对抗，成功则目标倒地或被推开 5 尺（action.type=shove，detail 写 push 就是推开，否则推倒）', cost: 'action', available: canAction || attackOpen || actor.turn.extraActions > 0 });
    if (this.hasCondition(actor, 'grappled')) {
      acts.push({ kind: 'other', name: '挣脱擒抱', detail: '用一个动作：运动或杂技对抗擒抱者（action.type=escape）', cost: 'action', available: canSpend });
    }
    acts.push({ kind: 'talk', name: '说话 / 交涉', detail: '不消耗动作（战斗里通常只能短句）', cost: 'free', available: true });
    acts.push({ kind: 'check', name: '尝试检定', detail: '描述你想做的事，GM 会要求检定', cost: 'action', available: canSpend });
    acts.push({ kind: 'other', name: '其他', detail: '任何规则允许的行动，GM 裁定', cost: 'action', available: canSpend });
    return acts;
  }

  /** 攻击动作上可以声明的选项（鲁莽攻击、神圣斩击、震慑拳、副手）：只列出这个角色真有的。 */
  private attackOptionHints(actor: Actor): string {
    const hints = ATTACK_OPTIONS.filter((o) => hasFeature(actor, o.feature)).map((o) => `在 detail 里写「${o.keyword}」：${o.hint}`);
    return hints.length ? `；可选声明——${hints.join('；')}` : '';
  }

  /** 给提示词用的紧凑动作列表 */
  legalActionsText(actorId: string): string {
    return this.legalActions(actorId)
      .filter((a) => a.available)
      .map((a) => `- [${a.cost}] ${a.name}：${a.detail}`)
      .join('\n');
  }

  // ---------------------------------------------------------------- 存档
  snapshot(): unknown {
    return {
      combat: this.combat,
      actors: [...this.actors.values()],
      rollLog: this.rollLog.slice(-100),
    };
  }

  load(snapshot: { combat: CombatState; actors: Actor[]; rollLog?: RollResult[] }): void {
    this.actors.clear();
    for (const a of snapshot.actors) {
      // 老存档的回合记录缺新字段：补默认值
      a.turn = { ...emptyTurn(), ...(a.turn ?? {}) };
      this.actors.set(a.id, a);
    }
    this.combat = snapshot.combat ?? { active: false, round: 0, order: [], index: 0 };
    this.rollLog = snapshot.rollLog ?? [];
    this.ensurePositions();
  }
}

function reconstructPath(parent: Map<string, string | null>, cells: Map<string, GridPos>, key: string): GridPos[] {
  const out: GridPos[] = [];
  let cur: string | null | undefined = key;
  while (cur) {
    const cell = cells.get(cur);
    if (cell) out.push(cell);
    cur = parent.get(cur) ?? null;
  }
  return out.reverse().slice(1);
}

function rangeDistance(cell: GridPos, range: CellRange): number {
  const dc = cell.col < range.col[0] ? range.col[0] - cell.col : cell.col > range.col[1] ? cell.col - range.col[1] : 0;
  const dr = cell.row < range.row[0] ? range.row[0] - cell.row : cell.row > range.row[1] ? cell.row - range.row[1] : 0;
  return Math.max(dc, dr);
}

function kindText(kind: 'standable' | 'water' | 'blocked' | 'outside'): string {
  switch (kind) {
    case 'water':
      return '是水面，需要游泳速度';
    case 'blocked':
      return '被障碍挡住';
    case 'outside':
      return '在地图可站立区域之外';
    default:
      return '可以站立';
  }
}

/** 公式整体乘 n：骰子个数和固定值都乘（魔法飞弹 n 枚："1d4+1" ×3 → "3d4+3"）。 */
function multiplyFormula(formula: string, n: number): string {
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(formula.replace(/\s+/g, '').toLowerCase());
  if (!m) return formula;
  const flat = m[3] ? Number(m[3]) * n : 0;
  return `${Number(m[1] || 1) * n}d${m[2]}${flat ? signed(flat) : ''}`;
}

/** 把公式里每一组骰子的个数乘 factor（戏法成长）："1d10" → "2d10"。 */
function scaleDice(formula: string, factor: number): string {
  if (factor <= 1) return formula;
  return formula.replace(/(\d*)d(\d+)/gi, (_, n: string, sides: string) => `${Number(n || 1) * factor}d${sides}`);
}

function addDice(base: string | undefined, extra: string | undefined, times: number): string {
  if (!base) return '0';
  if (!extra || times <= 0) return base;
  // 固定值升环（痊愈术每环 +10）
  if (/^[+-]?\d+$/.test(extra.trim())) return `${base}${signed(Number(extra) * times)}`;
  const m = /^(\d*)d(\d+)([+-]\d+)?$/.exec(extra.replace(/\s+/g, '').toLowerCase());
  if (!m) return base;
  const per = Number(m[1] || 1) * times;
  const flat = m[3] ? Number(m[3]) * times : 0;
  return `${base}+${per}d${m[2]}${flat ? signed(flat) : ''}`;
}

function durationRounds(spell: SpellDef): number | undefined {
  if (/立即/.test(spell.duration)) return undefined;
  if (/1 轮/.test(spell.duration)) return 1;
  if (/1 分钟/.test(spell.duration)) return 10;
  if (/10 分钟/.test(spell.duration)) return 100;
  if (/1 小时/.test(spell.duration)) return 600;
  return 10;
}

function describeSpell(spell: SpellDef): string {
  const e = spell.effect;
  switch (e.kind) {
    case 'attack':
      return `${e.attacks} 次法术攻击，伤害 ${e.damage} ${e.damageType}`;
    case 'save':
      return `${ABILITY_ZH[e.ability]}豁免 DC，${e.damage ? `${e.damage} ${e.damageType ?? ''}` : '无伤害'}${e.halfOnSave ? '，成功半伤' : ''}${e.condition ? `，失败${CONDITION_ZH[e.condition]}` : ''}`;
    case 'auto':
      return `必定命中，${e.damage} ${e.damageType}`;
    case 'heal':
      return `治疗 ${e.dice}${e.addMod ? '+施法属性' : ''}`;
    case 'buff':
      return e.note ?? '增益';
    case 'sleep':
      return `生命值池 ${e.pool}`;
    case 'utility':
      return e.note;
  }
}

/** 自动死亡豁免的一句话，给调用方发事件。 */
function deathSaveNote(actor: Actor, result: DeathSaveResult): string {
  const r = result.roll;
  const head = `${actor.name} 死亡豁免：d20=${r.natural ?? '?'}（总 ${r.total}）`;
  switch (result.outcome) {
    case 'revive':
      return `${head}，自然 20！${actor.name} 醒了过来，恢复 1 点 HP`;
    case 'stable':
      return `${head}，第三次成功，${actor.name} 稳定了（昏迷，0 HP）`;
    case 'dead':
      return `${head}，${actor.name} 没能撑过去，死了`;
    case 'success':
      return `${head}，成功（${describeTrack(result.track)}）`;
    default:
      return `${head}，失败（${describeTrack(result.track)}）`;
  }
}

/** 从怪物 id 建一个带唯一名字的怪物，方便一个场景里放多只。 */
export function spawnMonster(monsterId: string, label?: string): Actor {
  const def = MONSTERS[monsterId];
  if (!def) throw new Error(`没有这个怪物：${monsterId}`);
  const actor = actorFromMonster(def, label ? `${monsterId}:${label}` : monsterId);
  if (label) actor.name = label;
  return actor;
}
