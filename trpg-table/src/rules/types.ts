import type { ItemStack } from './inventory.js';
import type { SeatId } from '../config.js';

export const ABILITIES = ['str', 'dex', 'con', 'int', 'wis', 'cha'] as const;
export type Ability = (typeof ABILITIES)[number];

export const ABILITY_ZH: Record<Ability, string> = {
  str: '力量',
  dex: '敏捷',
  con: '体质',
  int: '智力',
  wis: '感知',
  cha: '魅力',
};

export const SKILLS = [
  'acrobatics',
  'animal_handling',
  'arcana',
  'athletics',
  'deception',
  'history',
  'insight',
  'intimidation',
  'investigation',
  'medicine',
  'nature',
  'perception',
  'performance',
  'persuasion',
  'religion',
  'sleight_of_hand',
  'stealth',
  'survival',
] as const;
export type Skill = (typeof SKILLS)[number];

export const SKILL_ABILITY: Record<Skill, Ability> = {
  acrobatics: 'dex',
  animal_handling: 'wis',
  arcana: 'int',
  athletics: 'str',
  deception: 'cha',
  history: 'int',
  insight: 'wis',
  intimidation: 'cha',
  investigation: 'int',
  medicine: 'wis',
  nature: 'int',
  perception: 'wis',
  performance: 'cha',
  persuasion: 'cha',
  religion: 'int',
  sleight_of_hand: 'dex',
  stealth: 'dex',
  survival: 'wis',
};

export const SKILL_ZH: Record<Skill, string> = {
  acrobatics: '杂技',
  animal_handling: '驯兽',
  arcana: '奥秘',
  athletics: '运动',
  deception: '欺瞒',
  history: '历史',
  insight: '洞察',
  intimidation: '威吓',
  investigation: '调查',
  medicine: '医药',
  nature: '自然',
  perception: '感知',
  performance: '表演',
  persuasion: '说服',
  religion: '宗教',
  sleight_of_hand: '巧手',
  stealth: '隐匿',
  survival: '求生',
};

export const DAMAGE_TYPES = [
  'acid',
  'bludgeoning',
  'cold',
  'fire',
  'force',
  'lightning',
  'necrotic',
  'piercing',
  'poison',
  'psychic',
  'radiant',
  'slashing',
  'thunder',
] as const;
export type DamageType = (typeof DAMAGE_TYPES)[number];

export const DAMAGE_ZH: Record<DamageType, string> = {
  acid: '强酸',
  bludgeoning: '钝击',
  cold: '寒冷',
  fire: '火焰',
  force: '力场',
  lightning: '闪电',
  necrotic: '黯蚀',
  piercing: '穿刺',
  poison: '毒素',
  psychic: '心灵',
  radiant: '光耀',
  slashing: '挥砍',
  thunder: '雷鸣',
};

export const CONDITION_NAMES = [
  'blinded',
  'charmed',
  'deafened',
  'frightened',
  'grappled',
  'incapacitated',
  'invisible',
  'paralyzed',
  'petrified',
  'poisoned',
  'prone',
  'restrained',
  'stunned',
  'unconscious',
  'exhaustion',
  /** 躲藏中：攻击有优势，攻击后现形；对它的攻击有劣势（看不见） */
  'hidden',
] as const;
export type ConditionName = (typeof CONDITION_NAMES)[number];

export const CONDITION_ZH: Record<ConditionName, string> = {
  blinded: '目盲',
  charmed: '魅惑',
  deafened: '耳聋',
  frightened: '恐惧',
  grappled: '被擒抱',
  incapacitated: '失能',
  invisible: '隐形',
  paralyzed: '麻痹',
  petrified: '石化',
  poisoned: '中毒',
  prone: '倒地',
  restrained: '束缚',
  stunned: '震慑',
  unconscious: '昏迷',
  exhaustion: '力竭',
  hidden: '躲藏',
};

export interface ConditionInstance {
  name: ConditionName;
  /** 力竭的等级 1-6 */
  level?: number;
  source?: string;
  /** 持续到什么时候；不填 = 直到手动移除/本次遭遇结束 */
  rounds?: number;
  save?: { ability: Ability; dc: number };
  note?: string;
  /** 这个状态是谁专注维持的（专注断了，状态跟着没）。 */
  concentrationOf?: string;
  /** 擒抱：谁在擒抱；擒抱者失能 / 倒下时擒抱结束 */
  grapplerId?: string;
  /** 擒抱 / 被困：固定的脱逃 DC（怪物擒抱、蛛网术的施法 DC） */
  escapeDc?: number;
  /** 被困：摆脱用的属性检定（蛛网术：力量） */
  escapeAbility?: Ability;
}

/** 效果给的优势 / 劣势（不含 none；有优势又有劣势由 mergeAdvantage 抵消）。 */
export type RollEdge = 'adv' | 'dis';

/**
 * 效果带来的"掷骰修正"：优势 / 劣势 / 固定加值。
 * 法术数据（buff、failEffect、choices）和 ActiveEffect 共用这一组字段；引擎在 attackSituation / check / save /
 * rollDeathSave / heal / 反应判定里读它们。
 */
export interface RollModFields {
  /** 持有者自己的攻击掷骰有优势 / 劣势；once = 用掉一次攻击就结束；against = 只对这个目标（id）生效（克敌先击、恶言相加、降咒术、预知术） */
  attackRoll?: { state: RollEdge; once?: boolean; against?: string };
  /** 生物类型在这个列表里的攻击者打持有者时劣势（防护善恶与邪恶、驱散善恶） */
  attackersDisadvantageFrom?: string[];
  /**
   * 持有者的豁免优势 / 劣势。abilities：属性名；'all' = 所有豁免（含死亡豁免）；'death' = 只管死亡豁免。
   * against 给了就只对这些来源（状态名 / 伤害类型，如 poisoned、poison）生效。
   */
  saveEdges?: { abilities: (Ability | 'all' | 'death')[]; state: RollEdge; against?: string[] }[];
  /** 持有者的属性检定优势 / 劣势：abilities 'all' = 所有检定（含先攻）；skills 给了就只管这些技能的检定 */
  checkEdges?: { abilities?: (Ability | 'all')[]; skills?: Skill[]; state: RollEdge }[];
  /** 技能检定的固定加值（无痕步：隐匿 +10） */
  skillBonuses?: Partial<Record<Skill, number>>;
  /** 某属性豁免的固定加值（缓慢术：敏捷 -2） */
  saveBonuses?: Partial<Record<Ability, number>>;
  /** 受到的法术治疗取骰子最大值（希望信标） */
  maxHealing?: boolean;
  /** 不能用反应（缓慢术、电爪） */
  noReactions?: boolean;
  /** 每个 Attack 动作最多几次攻击（缓慢术 1） */
  maxSwings?: number;
}

export interface ActiveEffect extends RollModFields {
  id: string;
  spellId: string;
  name: string;
  concentration: boolean;
  acBonus?: number;
  attackBonus?: number;
  saveBonus?: number;
  damageBonus?: number;
  /** 加到攻击检定上的额外骰（祝福术 1d4） */
  attackDice?: string;
  /** 加到豁免上的额外骰 */
  saveDice?: string;
  /** 加到属性检定上的额外骰（指引 1d4） */
  checkDice?: string;
  /** 针对这个效果的攻击掷骰有优势（faerie_fire 等） */
  grantsAttackersAdvantage?: boolean;
  /** 对挂着它的角色的下一次攻击掷骰有优势，之后移除（光导箭） */
  grantsAdvantageOnce?: boolean;
  /** 挂着它的角色自己的下一次攻击掷骰有优势，之后移除（协助动作）；against 指定只对某个目标有效 */
  advantageOnNextAttack?: { against?: string };
  /** 不能隐形（妖火） */
  blocksInvisibility?: boolean;
  /** 效果期间额外获得的伤害抗性（狂暴） */
  resistances?: DamageType[];
  /** 狂暴：自上个回合结束以来是否攻击过 / 受过伤；整个回合没有就结束狂暴 */
  stoked?: boolean;
  /** 诗人激励：持有者可以把这个骰（面数）加到一次攻击 / 检定 / 豁免上，用掉就没 */
  inspirationDie?: number;
  /** AC 基础值（法师护甲 13+敏捷、树肤术 16）：AC 取它和原来的较大者，不是加值 */
  acBase?: { base: number; addDex: boolean };
  /** 速度加值（尺）：大步奔行 +10 */
  speedBonus?: number;
  /** 速度倍数：加速术 ×2 */
  speedMultiplier?: number;
  /** 每个回合开始多一个动作（加速术） */
  extraAction?: boolean;
  /** 只对非魔法攻击生效的抗性（石肤术） */
  resistancesNonmagical?: DamageType[];
  /** 对持有者的攻击检定有劣势（朦胧术） */
  attackersDisadvantage?: boolean;
  /** 持有者的武器攻击命中时额外造成的伤害：猎人印记（只对被标记的）、神恩术、惩击类（once 用一次就结束） */
  bonusDamage?: { dice: string; damageType?: DamageType; against?: string; once?: boolean; spellAttacks?: boolean };
  /** 持有者之后每个回合都能用的攻击（灵体武器、火焰之刃） */
  grantsAttack?: GrantedAttack;
  /** 到哪个角色的回合开始时结束（护盾术、协助）；不填就按 rounds / 手动 */
  untilTurnOf?: string;
  /** 到哪个角色的回合结束时结束（恶言相加：目标自己的下回合结束）；armedAtTurnOf 还没清掉时不算 */
  untilEndOfTurnOf?: string;
  /** 这个效果要等到该角色下一个回合开始才生效（克敌先击：你的下一回合）；beginTurn 时清掉 */
  armedAtTurnOf?: string;
  /** 持有者每个回合结束再做一次这个豁免，成功就结束这个效果（缓慢术） */
  endSave?: { ability: Ability; dc: number };
  /** 效果结束（专注断了 / 时间到）时，持有者陷入一个回合的失能 + 速度 0（加速术） */
  lethargyOnEnd?: boolean;
  note?: string;
  rounds?: number;
}

/** 效果赋予的一个"之后每个回合都能用"的攻击（灵体武器、火焰之刃…） */
export interface GrantedAttack {
  name: string;
  cost: 'bonus' | 'action';
  dice: string;
  damageType: DamageType;
  /** 伤害加施法属性调整值 */
  addMod: boolean;
  /** 近战法术攻击（不吃"5 尺内有敌人远程劣势"） */
  melee: boolean;
  /** 能打多远（尺）；火焰之刃这类拿在手里的写 5 */
  rangeFeet: number;
  /** 武器自己飘过去打（灵体武器）：按贴身算，不按施法者的距离算优势 / 劣势 */
  floating?: boolean;
}

export type Advantage = 'none' | 'adv' | 'dis';

export interface DieRoll {
  sides: number;
  value: number;
  kept: boolean;
}

export type RollKind =
  | 'check'
  | 'save'
  | 'attack'
  | 'damage'
  | 'initiative'
  | 'death_save'
  | 'hit_die'
  | 'spell'
  | 'other';

export interface RollResult {
  id: string;
  at: number;
  kind: RollKind;
  label: string;
  actorId?: string;
  targetId?: string;
  formula: string;
  dice: DieRoll[];
  modifier: number;
  total: number;
  /** d20 的原始点数；伤害/治疗骰为 null */
  natural: number | null;
  dc?: number;
  success?: boolean;
  crit: boolean;
  fumble: boolean;
  advantage: Advantage;
  damageType?: DamageType;
  /** 骰子是谁掷的：local（dry-run）或 atlas（真实桌面） */
  source: string;
}

export interface RollOutcome {
  formula: string;
  dice: DieRoll[];
  modifiers: number;
  total: number;
  source: string;
}

export interface RollRequest {
  formula: string;
  label: string;
  /** 给 Atlas 的 token（可选） */
  tokenId?: string;
  /** 谁掷的（给 Atlas 的骰子日志） */
  player?: string;
}

export interface RollSource {
  readonly name: string;
  roll(req: RollRequest): Promise<RollOutcome>;
}

export interface WeaponDef {
  id: string;
  name: string;
  category: 'simple' | 'martial';
  kind: 'melee' | 'ranged';
  damage: string;
  damageType: DamageType;
  /** versatile 时的双手伤害 */
  versatile?: string;
  properties: string[];
  /** 正常/远射程（尺） */
  range?: [number, number];
  attackAbility?: 'str' | 'dex' | 'finesse';
  /** 攻击加值里的魔法加值 */
  magicBonus?: number;
}

export interface AttackDef {
  /** 玩家武器：引用 WEAPONS；怪物可以不填 */
  weaponId?: string;
  /** 覆盖显示名，比如“精灵短剑”或“啮咬” */
  name?: string;
  magicBonus?: number;
  proficient?: boolean;
  /** 怪物/天生武器：直接给加值和伤害公式 */
  attackBonus?: number;
  damage?: string;
  damageType?: DamageType;
  /** 怪物/天生武器：近战还是远程；不填 = 近战 */
  mode?: 'melee' | 'ranged';
  /** 怪物/天生武器：近战触及（尺），不填 5 */
  reach?: number;
  /** 怪物/天生武器：远程正常/远射程（尺） */
  range?: [number, number];
  /** 命中后才会进行的套路步骤（食尸鬼的爪击跟在啮咬后） */
  onlyIfHit?: boolean;
  /** 额外伤害（毒、光耀等），命中后追加；给了 save 就是“豁免失败全额、成功减半” */
  extraDamage?: { formula: string; damageType: DamageType; note?: string; save?: { ability: Ability; dc: number } };
  /** 命中后的状态（狼的撞倒、食尸鬼的麻痹）：给了 save 就是豁免失败才中 */
  onHit?: {
    condition: ConditionName;
    rounds?: number;
    save?: { ability: Ability; dc: number };
    /** 擒抱的脱逃 DC */
    escapeDc?: number;
    note?: string;
  };
  /** versatile 武器用双手伤害 */
  twoHanded?: boolean;
}

export interface SlotState {
  max: number;
  used: number;
}

export interface Spellcasting {
  ability: Ability;
  /** 现在能施放的法术 id：已知法术，或今天准备好的法术（含领域/誓言的永久准备法术）。戏法也放这里。 */
  known: string[];
  slots: Record<number, SlotState>;
  /** 契约魔法（邪术师）：法术位短休就恢复，不用等长休 */
  pact?: boolean;
  /**
   * 邪术师和别的施法职业兼职时，契约位已经并进了 slots 总表；这里记着其中有几个、几环是契约位，
   * 短休时按这个数恢复同环阶的已用位（总表分不清哪个位是谁的，所以是近似：恢复 min(已用, count) 个）。
   */
  pactSlots?: { level: number; count: number };
}

/** 职业与等级（兼职时有多条）。 */
export interface ClassLevel {
  /** 职业 id：barbarian / bard / cleric / druid / fighter / monk / paladin / ranger / rogue / sorcerer / warlock / wizard */
  id: string;
  level: number;
  /** 子职业名（SRD 的：champion、life_domain、evocation …） */
  subclass?: string;
}

export interface DeathSaves {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
}

export interface ResourceState {
  name: string;
  max: number;
  used: number;
  recharge: 'short' | 'long' | 'none';
}

export interface TurnEconomy {
  actionUsed: boolean;
  bonusUsed: boolean;
  reactionUsed: boolean;
  movementUsed: number;
  sneakUsed: boolean;
  /** Attack 动作里已经打出几次攻击 */
  attacksMade: number;
  /** Attack 动作一共允许几次（额外攻击 / 怪物多攻） */
  attacksAllowed: number;
  /** 疾走：本回合移动力翻倍 */
  dashed: boolean;
  /** 撤离：本回合移动不引发借机攻击 */
  disengaged: boolean;
  /** 闪避：到自己下回合开始前，对自己的攻击有劣势、敏捷豁免有优势 */
  dodging: boolean;
  /** 额外动作（动作如潮等），每个都是完整的一个动作 */
  extraActions: number;
  /** 每回合一次的东西（偷袭以外），按 key 记 */
  oncePerTurn: string[];
  /** 鲁莽攻击：本回合近战力量攻击有优势 */
  reckless: boolean;
}

/** 怪物多攻套路的一步：count 次 attack（按名字匹配 attacks[]）。 */
export interface RoutineStep {
  attack: string;
  count: number;
  /** 只在前一击命中后才打（食尸鬼的爪击） */
  ifHit?: boolean;
}

/** 格子坐标（方格）。5 尺 = 1 格。 */
export interface GridPos {
  col: number;
  row: number;
}

/** 格子范围（含端点）。 */
export interface CellRange {
  col: [number, number];
  row: [number, number];
}

/** 地图坐标点。格子的中心是 (col + 0.5, row + 0.5)。 */
export type MapPoint = [number, number];

export interface StandableRegion {
  name: string;
  /** 例如 deck / floor，给显示用，可省略 */
  kind?: string;
  polygon: MapPoint[];
}

export interface WaterRegion {
  name: string;
  polygon: MapPoint[];
}

export interface BlockedRegion {
  name: string;
  cells: CellRange;
}

export interface Landmark {
  id?: string;
  name: string;
  cells: CellRange;
  note?: string;
}

/**
 * 场景地图信息（从剧本 markdown 的 `## 地图信息` 里读）。
 * 没有地图数据时 `wholeBoard` 为 true：整个棋盘都能站，也没有地标。
 */
export interface MapInfo {
  standable: StandableRegion[];
  water: WaterRegion[];
  blocked: BlockedRegion[];
  landmarks: Landmark[];
  wholeBoard?: boolean;
  /** 场景开始时每个 PC 站的格子（座位 → 格子）；没写的座位保持原位置。引擎只在格子不合法时挪到最近的合法格 */
  start?: Partial<Record<SeatId, GridPos>>;
  /** 怪物默认出场格：怪物 id → 格子列表，按生成顺序取；没写就用老的默认格（8,7）附近 */
  spawns?: Record<string, GridPos[]>;
}

export interface Actor {
  id: string;
  name: string;
  kind: 'pc' | 'monster';
  seat?: SeatId;
  /** 规则层记录的位置；Atlas token 跟着它走。没位置的老存档会在 init 时补默认格。 */
  position?: GridPos;
  level: number;
  abilities: Record<Ability, number>;
  proficiencyBonus: number;
  saves: Ability[];
  skills: Skill[];
  expertise: Skill[];
  ac: number;
  maxHp: number;
  hp: number;
  tempHp: number;
  speed: number;
  /** 游泳速度（尺）。没有就是 0，不能站在水面上。 */
  swimSpeed?: number;
  attacks: AttackDef[];
  spells?: Spellcasting;
  conditions: ConditionInstance[];
  effects: ActiveEffect[];
  concentration: { spellId: string; effectIds: string[] } | null;
  deathSaves: DeathSaves;
  resources: Record<string, ResourceState>;
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  /** 只对非魔法攻击生效的抗性（“非魔法武器造成的钝击、穿刺和挥砍伤害”） */
  resistancesNonmagical?: DamageType[];
  /** 免疫的状态（怪物数据里的 conditionImmunities），加不上 */
  conditionImmunities?: ConditionName[];
  /** 每个 Attack 动作的攻击次数（额外攻击）；怪物看 routines。默认 1 */
  attacksPerAction?: number;
  /** 怪物多攻套路；不填就只有 attacksPerAction 次同一个攻击 */
  routines?: RoutineStep[][];
  /** 怪物特性（名字 + 说明），引擎按名字认出群体战术、灵巧逃脱等 */
  traits?: { name: string; text: string }[];
  hitDice: { die: number; total: number; used: number };
  /** 盗贼的偷袭骰数（d6），没有就是 0 */
  sneakAttackDice: number;
  turn: TurnEconomy;
  /** 怪物 AI / 剧情用 */
  notes?: string;
  /** 职业/种族特性标记（如 disciple_of_life） */
  features?: string[];
  /** 人设（内容层，不参与规则计算） */
  persona?: string;
  /** 这个角色在英文思考原文里可能被叫成的名字（看点渲染做第一人称校验用） */
  aliases?: string[];
  /** 职业/等级一行，给 overlay / 提示词显示 */
  charClass?: string;
  /** 职业与等级（兼职多条）；规则里按这个算特性的成长（狂暴伤害、圣疗池、神圣斩击骰数…） */
  classes?: ClassLevel[];
  race?: string;
  background?: string;
  /** 体型：Small / Medium / Large …；擒抱和推撞看体型 */
  size?: string;
  /** 生物类型：undead / humanoid / beast / construct …（驱逐不死生物、定身人类这类按类型生效的东西用） */
  creatureType?: string;
  /** 怪物挑战等级（驱逐不死生物 5 级起摧毁低 CR 的不死生物） */
  cr?: number;
  /** 穿着金属护甲（电爪对穿金属护甲的目标攻击有优势） */
  metalArmor?: boolean;
  /** PC 的经验值总数；没写就是这个等级的门槛值（见 xp.ts）。怪物没有 */
  xp?: number;
  /** 背包（只有 PC 用；规则见 inventory.ts）。没写就是空 */
  inventory?: ItemStack[];
  /** 钱，铜币总数（1 gp = 100 cp）。没写就是 0 */
  coinsCp?: number;
  /** 怪物：击败它的经验值已经发过了（避免战斗结束和换场景各发一次） */
  xpAwarded?: boolean;
}

export interface CombatState {
  active: boolean;
  round: number;
  /** 突袭：这些角色第一回合不能行动（也不能用反应，直到那个回合过去） */
  surprised?: string[];
  order: { actorId: string; initiative: number; dex: number }[];
  index: number;
}

export interface CheckOptions {
  advantage?: Advantage;
  /** 环境/工具加值 */
  bonus?: number;
  reason?: string;
}

export interface AttackOptions extends CheckOptions {
  /** 非魔法武器的抗性等 */
  magical?: boolean;
  /** 强制本次偷袭生效 / 关闭；不填则按规则判断 */
  sneakAttack?: boolean;
  /** 双手握持 versatile 武器 */
  twoHanded?: boolean;
  /** 这一击是反应（借机攻击）：占反应，不占动作 */
  reaction?: boolean;
  /** 这一击是附赠动作（双武器战斗的副手、武僧疾风连击）：占附赠动作 */
  bonusAction?: boolean;
  /** 这一击不占任何动作 / 反应槽（疾风连击的第二击等，由调用方保证资格） */
  noSlot?: boolean;
  /** 副手攻击：伤害不加属性调整值（除非有双武器战斗风格）；要求副手是轻型近战武器 */
  offhand?: boolean;
  /** 鲁莽攻击：本回合近战力量攻击有优势，对你的攻击也有优势（回合内第一击上声明） */
  reckless?: boolean;
  /** 命中后用这个环阶的法术位施放神圣斩击 */
  smite?: number;
  /** 命中后花 1 点气使出震慑拳 */
  stunningStrike?: boolean;
}

export interface AttackResult {
  attack: RollResult;
  hit: boolean;
  crit: boolean;
  fumble: boolean;
  damage: RollResult | null;
  appliedDamage: number;
  targetDown: boolean;
  sneakAttack: boolean;
  /** 打的是哪个 AC（含掩蔽） */
  targetAc: number;
  /** 优势/劣势/暴击/掩蔽的来源说明 */
  notes?: string[];
  coverBonus?: number;
  /** 借机攻击 */
  reaction?: boolean;
  /** 命中后追加的豁免等（调用方要一起发给观众） */
  extraRolls?: RollResult[];
  /** 命中后挂上了什么状态 */
  conditionApplied?: ConditionName;
}

export interface CastResult {
  ok: boolean;
  error?: string;
  spell: string;
  slotLevel: number;
  slotUsed: boolean;
  concentration: boolean;
  rolls: RollResult[];
  damage: number;
  heal: number;
  notes: string[];
}

export type LegalActionKind =
  | 'attack'
  | 'cast'
  | 'move'
  | 'dash'
  | 'dodge'
  | 'disengage'
  | 'hide'
  | 'help'
  | 'item'
  | 'talk'
  | 'check'
  | 'feature'
  | 'other';

export interface LegalAction {
  kind: LegalActionKind;
  name: string;
  detail: string;
  /** 消耗什么动作 */
  cost: 'action' | 'bonus' | 'reaction' | 'movement' | 'free';
  weaponId?: string;
  spellId?: string;
  spellLevel?: number;
  /** 主动特性的 id（kind = feature） */
  featureId?: string;
  attackBonus?: number;
  damage?: string;
  available: boolean;
  reason?: string;
}

export interface AttackMath {
  attackBonus: number;
  damageFormula: string;
  damageType: DamageType;
  ability: Ability;
  proficient: boolean;
}

export const emptyTurn = (): TurnEconomy => ({
  actionUsed: false,
  bonusUsed: false,
  reactionUsed: false,
  movementUsed: 0,
  sneakUsed: false,
  attacksMade: 0,
  attacksAllowed: 1,
  dashed: false,
  disengaged: false,
  dodging: false,
  extraActions: 0,
  oncePerTurn: [],
  reckless: false,
});

export const abilityMod = (score: number): number => Math.floor((score - 10) / 2);

export const proficiency = (level: number): number => 2 + Math.floor((level - 1) / 4);
