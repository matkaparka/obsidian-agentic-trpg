// 角色构建器的输入（CharacterBuild）和输出（BuildResult）。字段说明和默认值规则见 README.md。
import type { SeatId } from '../../config.js';
import type { CharacterFile } from '../sheet.js';
import type { Ability, Skill } from '../types.js';

export type HpMethod = 'average' | 'max' | 'rolled';

/** 一个职业条目。第一个条目是起始职业（1 级的熟练项、豁免、满骰都按它）。 */
export interface ClassBuild {
  /** barbarian / bard / cleric / druid / fighter / monk / paladin / ranger / rogue / sorcerer / warlock / wizard */
  id: string;
  /** 这个职业的等级（1–20；所有职业加起来 ≤ 20） */
  level: number;
  /** 子职业：id、英文名或别名都行（champion、life_domain、"Life Domain"、"battle-master"…）。到了选择等级不填会自动选 SRD 那个并给 warning */
  subclass?: string;
}

/** 专长附带的选择（没有选择的专长不用填）。 */
export interface FeatChoice {
  /** 半专长（+1 属性）选哪一项；坚韧（Resilient）选哪项属性（同时得到该属性的豁免熟练） */
  ability?: Ability;
  /** 技能娴熟（Skilled）：3 个技能 */
  skills?: Skill[];
  /** 武器大师（Weapon Master）：4 件武器的 id */
  weapons?: string[];
}

/** 一次属性提升或专长。 */
export interface AsiChoice {
  /** 属性提升：{ str: 2 } 或 { str: 1, dex: 1 }，总和必须是 2，单项最多 +2 */
  abilities?: Partial<Record<Ability, number>>;
  /** 或者选一个专长（id，如 alert、tough、great_weapon_master；可选的见 data/feats.gen.ts） */
  feat?: string;
  featChoice?: FeatChoice;
}

export interface RaceOptions {
  /** 半精灵（除魅力外 2 项）/ 变体人类（任意 2 项）：各 +1 的属性 */
  abilityBonuses?: Ability[];
  /** 半精灵 2 个 / 变体人类 1 个自选技能 */
  skills?: Skill[];
  /** 变体人类的 1 级专长 */
  feat?: string;
  featChoice?: FeatChoice;
  /** 龙裔的龙祖先：black blue brass bronze copper gold green red silver white */
  dragonAncestry?: string;
  /** 高等精灵的 1 个法师戏法（法术 id） */
  cantrip?: string;
  /** 自选语言 / 工具，只写进 notes */
  languages?: string[];
  tools?: string[];
}

export interface WeaponPick {
  /** WEAPONS 里的 id（src/rules/data/weapons.ts） */
  id: string;
  /** 显示名（例如 "精灵短剑"） */
  name?: string;
  /** 魔法武器加值 +1/+2/+3 */
  magicBonus?: number;
  /** versatile 武器双手握持（用双手伤害骰） */
  twoHanded?: boolean;
}

export interface EquipmentBuild {
  /** ARMOR 里的 id（chain_mail、leather…）；null = 不穿甲；不给 = 职业起始装备 */
  armor?: string | null;
  /** 魔法护甲加值 */
  armorBonus?: number;
  /** 持盾；不给 = 职业起始装备 */
  shield?: boolean;
  shieldBonus?: number;
  /** 武器；不给 = 职业起始装备 */
  weapons?: (string | WeaponPick)[];
  /** 其它来源的 AC 加值（防护戒指之类） */
  acBonus?: number;
}

/** 一个施法职业的法术选择。不给的项目按确定的默认规则自动选（并在 warnings 里写清选了什么）。 */
export interface ClassSpellChoice {
  /** 戏法（法术 id） */
  cantrips?: string[];
  /** 已知型（诗人 术士 邪术师 游侠 奥法骑士 诡术师）：已知的有环法术 */
  known?: string[];
  /** 准备型（牧师 德鲁伊 圣武士）：今天准备的法术（不含领域 / 誓言 / 结社的永久准备法术）；法师：从法术书里准备的 */
  prepared?: string[];
  /** 法师的法术书 */
  spellbook?: string[];
}

export interface ClassOptions {
  /** 邪术师的魔能祈唤（id，如 agonizing_blast） */
  invocations?: string[];
  /** 契约恩赐：pact_of_the_blade / pact_of_the_chain / pact_of_the_tome / pact_of_the_talisman */
  pactBoon?: string;
  /** 战斗大师的战技（id，如 riposte） */
  maneuvers?: string[];
  /** 术士的超魔（id，如 quickened_spell） */
  metamagic?: string[];
  /** 四象宗的元素修行 */
  disciplines?: string[];
  /** 游侠猎人的四个选择 */
  hunter?: { prey?: string; defensiveTactics?: string; multiattack?: string; superiorDefense?: string };
  /** 龙族血脉术士的龙种（同 dragonAncestry 的取值） */
  dragonAncestor?: string;
  /** 邪术师神秘秘法：{ 6: 'mass_suggestion' } */
  mysticArcanum?: Partial<Record<6 | 7 | 8 | 9, string>>;
  /** 大地结社德鲁伊的地貌：arctic coast desert forest grassland mountain swamp underdark */
  landCircle?: string;
}

export interface CharacterBuild {
  name: string;
  seat?: SeatId;
  persona?: string;
  /** 种族或亚种 id：hill_dwarf mountain_dwarf high_elf wood_elf drow lightfoot_halfling stout_halfling human variant_human dragonborn rock_gnome forest_gnome half_elf half_orc tiefling triton tabaxi */
  race: string;
  raceOptions?: RaceOptions;
  /** 背景 id：acolyte charlatan criminal entertainer folk_hero guild_artisan hermit noble outlander sage sailor soldier urchin */
  background: string;
  /** 职业与等级，第一个是起始职业，可以兼职 */
  classes: ClassBuild[];
  /** 种族加值之前的基础属性（点购 / 标准数组 / 掷骰由调用方定），每项 1–20 */
  abilityScores: Record<Ability, number>;
  /** 起始职业的技能选择（数量由职业规定） */
  skills?: Skill[];
  /** 其它来源的自选技能池：兼职（诗人 / 游侠 / 盗贼各 1）、子职业（学识学院 3）、背景和种族重复时的补位。按需要依次取用 */
  bonusSkills?: Skill[];
  /** 专精（盗贼 1/6 级各 2 个，诗人 3/10 级各 2 个），按获得顺序；盗贼可以写 thieves_tools */
  expertise?: (Skill | 'thieves_tools')[];
  /**
   * 属性提升 / 专长：键是「等级」（起始职业的职业等级，如 "4"），或「职业:等级」（如 "wizard:4"，兼职时用）。
   * 到了提升等级没有给的，按职业主属性自动 +2。
   */
  asi?: Record<string, AsiChoice>;
  /** 战斗风格（id：archery defense dueling great_weapon_fighting protection two_weapon_fighting），按获得顺序 */
  fightingStyles?: string[];
  equipment?: EquipmentBuild;
  /** 第一个施法职业的法术选择 */
  spells?: ClassSpellChoice;
  /** 兼职多个施法职业时按职业给 */
  spellsByClass?: Record<string, ClassSpellChoice>;
  options?: ClassOptions;
  hp?: {
    /** average（默认）：之后每级取平均值；max：每级满骰；rolled：用 rolls 里的点数。1 级永远是满骰 */
    method?: HpMethod;
    /** rolled：1 级以后每一级一个骰点，按职业顺序、等级顺序排 */
    rolls?: number[];
  };
  /** 补充说明，原样加到 notes 末尾 */
  notes?: string;
}

/** 构建出来的一个特性（给提示词 / 面板展示用）。 */
export interface BuildFeature {
  /** contract.ts 的 featureId(英文名) */
  id: string;
  name: string;
  zh?: string;
  /** class:fighter | subclass:champion | race:hill_dwarf | background:soldier | fighting_style | feat | option:invocation … */
  source: string;
  /** 获得时的职业等级（种族 / 背景 = 1） */
  level: number;
  text: string;
}

export interface ClassSpellInfo {
  classId: string;
  style: 'known' | 'prepared' | 'spellbook';
  ability: Ability;
  cantripsMax: number;
  /** 已知型：已知法术上限；准备型：准备数上限（不含永久准备）；法师：准备数上限 */
  spellsMax: number;
  /** 法师的法术书容量（6 + 2 × (等级 - 1)） */
  spellbookMax?: number;
  /** 这个职业最高能学 / 准备的法术环阶 */
  maxSpellLevel: number;
  cantrips: string[];
  /** 选定的有环法术（已知型 = 已知；准备型 / 法师 = 准备的），过滤 SPELLS 之前 */
  spells: string[];
  /** 永久准备的法术（领域、誓言、结社…），不占上限 */
  alwaysPrepared: string[];
  spellbook?: string[];
}

export interface BuildInfo {
  totalLevel: number;
  proficiencyBonus: number;
  /** 最终属性（种族加值、提升、专长都加完，已按上限截断） */
  abilities: Record<Ability, number>;
  hp: { max: number; method: HpMethod; perLevelBonus: number };
  ac: { value: number; formula: string };
  speed: number;
  armorProficiencies: string[];
  weaponProficiencies: string[];
  toolProficiencies: string[];
  languages: string[];
  /** 本次构建里实际发生的属性提升 / 专长（含自动选的） */
  asi: { classId: string; level: number; summary: string; auto: boolean }[];
  spellcasting?: {
    /** 引擎只支持一个施法属性：取第一个施法职业的 */
    ability: Ability;
    byClass: Record<string, ClassSpellInfo>;
    /** SPELLS 里还没有、被丢掉的法术 id */
    droppedSpells: string[];
    /** 种族天生法术（卓尔、提夫林…），引擎还不能按「每长休一次」施放，只在 notes 里记着 */
    racialSpells: string[];
  };
}

export interface BuildResult {
  /** 能直接交给 actorFromCharacter 的角色卡。有 errors 时是尽力而为的结果，不要拿去玩 */
  file: CharacterFile;
  /** 不能用：输入非法（属性范围、等级、技能数量、法术超限、兼职属性不够…） */
  errors: string[];
  /** 能用但要注意：自动选了什么、规则近似、缺数据 */
  warnings: string[];
  /** 所有已获得特性的明细 */
  features: BuildFeature[];
  info: BuildInfo;
}
