// 构建器数据表的形状。数据本身在同目录下的其它文件里（手写的和 ODM 生成的）。
import type { ClassId } from '../../contract.js';
import type { Ability, ConditionName, DamageType, Skill } from '../../types.js';

/** 一个特性的名字（英文，id 由 contract 的 featureId() 生成）、中文名和一句话说明（自己的话，不是 SRD 原文）。 */
export interface FeatureText {
  name: string;
  zh?: string;
  text: string;
}

export type ArmorCategory = 'light' | 'medium' | 'heavy' | 'shield';

/**
 * 数据出处：srd = SRD 5.1（CC-BY-4.0）里有的；odm = Open Dungeon Master 用自己的话复述的 2014 机制（非 SRD）；
 * custom = 非 SRD 的官方补充种族（Triton、Tabaxi），按用户给的角色卡写的，说明文字是自己的话。
 */
export type DataSource = 'srd' | 'odm' | 'custom';

export interface SubclassDef {
  id: string;
  classId: ClassId;
  name: string;
  zh?: string;
  source: DataSource;
  /** 输入时也认的别名（ODM 的 aliases），都已经是小写 */
  aliases: string[];
  desc: string;
  /** 键 = 职业等级 */
  features: Record<number, FeatureText[]>;
  /** 永久准备法术（领域 / 誓言 / 魔典 / 邪术师赠送法术表），键 = 职业等级，值 = 法术 id */
  spells?: Record<number, string[]>;
}

export type OptionKind =
  | 'invocation'
  | 'maneuver'
  | 'metamagic'
  | 'pact_boon'
  | 'discipline'
  | 'hunters_prey'
  | 'defensive_tactics'
  | 'hunter_multiattack'
  | 'superior_hunters_defense';

export interface OptionDef {
  kind: OptionKind;
  id: string;
  name: string;
  text: string;
  /** 前置条件的文字（给人看 / 做简单检查） */
  req?: string;
}

export interface FeatDef {
  id: string;
  name: string;
  prerequisite: string;
  text: string;
}

export interface BackgroundDef {
  id: string;
  name: string;
  skills: string[];
  tools: string[];
  /** 背景给几门自选语言 */
  languages: number;
  equipment: string[];
  feature: string;
  featureText: string;
  blurb: string;
}

export interface ClassDef {
  id: ClassId;
  name: string;
  zh: string;
  hitDie: 6 | 8 | 10 | 12;
  saves: [Ability, Ability];
  skillChoices: { count: number; from: Skill[] };
  armor: ArmorCategory[];
  /** 武器熟练：整类（simple / martial）加上指名的武器 id */
  weapons: { categories: ('simple' | 'martial')[]; ids: string[] };
  tools: string[];
  /** 自动升级属性时的优先顺序（排第一的是主属性） */
  asiPriority: Ability[];
  /** 兼职要求：外层是「或」，内层是「且」，都要 ≥13 */
  multiclassPrereq: Ability[][];
  /** 作为第二职业时得到的熟练项（从来没有豁免） */
  multiclassGrant: {
    armor: ArmorCategory[];
    weaponCategories: ('simple' | 'martial')[];
    weaponIds: string[];
    tools: string[];
    skills?: { count: number; from: Skill[] | 'any' };
  };
  caster: 'none' | 'full' | 'half' | 'pact';
  spellAbility?: Ability;
  spellStyle?: 'known' | 'prepared' | 'spellbook';
  /** 获得施法能力的职业等级（圣武士 / 游侠 2，其余 1） */
  spellcastingLevel: number;
  subclassLevel: number;
  /** 属性提升等级（职业等级）。战士 4 6 8 12 14 16 19，盗贼 4 8 10 12 16 19，其余 4 8 12 16 19 */
  asiLevels: number[];
  /** 职业特性，键 = 职业等级，值 = 本级获得的特性（占位用的 Fighting Style / 子职业入口也在里面，id 化时再处理） */
  features: Record<number, FeatureText[]>;
}

export interface RaceDef {
  id: string;
  name: string;
  zh: string;
  /** 亚种所属的基础种族 id（dwarf / elf / halfling / gnome），没有亚种的不填 */
  baseRace?: string;
  source: DataSource;
  size: 'Small' | 'Medium';
  speed: number;
  swimSpeed?: number;
  /** 固定的属性加值 */
  asi: Partial<Record<Ability, number>>;
  /** 自选属性加值：count 项各 +amount，exclude 里的不能选（半精灵不能再选魅力） */
  asiChoice?: { count: number; amount: number; exclude?: Ability[] };
  traits: FeatureText[];
  languages: string[];
  bonusLanguages?: number;
  skills?: Skill[];
  skillChoice?: { count: number };
  tools?: string[];
  toolChoice?: { count: number; from: string[] };
  armor?: ArmorCategory[];
  weaponIds?: string[];
  resistances?: DamageType[];
  conditionImmunities?: ConditionName[];
  /** 每级额外生命（丘陵矮人 1） */
  hpPerLevel?: number;
  /** 自选一个法师戏法（高等精灵） */
  wizardCantrip?: boolean;
  /** 天生法术：戏法直接会；有环阶的在对应角色等级获得，每次长休一次 */
  innateSpells?: {
    ability: Ability;
    cantrips: string[];
    spells: { id: string; level: number; castAt: number }[];
  };
  /** 变体人类：1 个 1 级专长 */
  startingFeat?: boolean;
  /** 龙裔：要选一种龙祖先 */
  dragonAncestry?: boolean;
  /** 种族自带的次数型资源（key 用 contract 里的） */
  resources?: { key: string; max: number; minLevel?: number }[];
  /** 天生武器（猫爪）：WEAPONS 里的 id，直接进攻击列表，不占装备 */
  naturalAttacks?: { weaponId: string; name: string }[];
}
