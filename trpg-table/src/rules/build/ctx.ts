// 构建过程中各个步骤共享的状态。每一步只往里填自己的那部分。
import type { ArmorDef } from './data/equipment.js';
import type { ArmorCategory, ClassDef, RaceDef, SubclassDef } from './data/schema.js';
import type { FeatDef } from './data/schema.js';
import type { FeatMech } from './data/feats.js';
import type { BackgroundInfo } from './lookup.js';
import type { BuildFeature, CharacterBuild, FeatChoice } from './types.js';
import type { Ability, Skill } from '../types.js';
import { abilityMod, ABILITIES } from '../types.js';

export interface ResolvedWeapon {
  id: string;
  name?: string;
  magicBonus?: number;
  twoHanded?: boolean;
}

export interface ResolvedEquipment {
  armor?: ArmorDef;
  armorBonus: number;
  shield: boolean;
  shieldBonus: number;
  weapons: ResolvedWeapon[];
  acBonus: number;
}

export interface ResolvedClass {
  def: ClassDef;
  level: number;
  index: number;
  subclass?: SubclassDef;
}

export interface ResolvedFeat {
  def: FeatDef & FeatMech;
  /** 来源：职业 id、'race' */
  from: string;
  /** 获得时的职业等级 */
  level: number;
  choice?: FeatChoice;
  ability?: Ability;
}

export interface Ctx {
  build: CharacterBuild;
  errors: string[];
  warnings: string[];
  race: RaceDef;
  background: BackgroundInfo;
  classes: ResolvedClass[];
  totalLevel: number;
  pb: number;
  /** 最终属性 */
  abilities: Record<Ability, number>;
  feats: ResolvedFeat[];
  asiLog: { classId: string; level: number; summary: string; auto: boolean }[];
  features: BuildFeature[];
  featureIds: Set<string>;
  /** 熟练项 */
  saves: Set<Ability>;
  skills: Set<Skill>;
  expertise: Skill[];
  armorProf: Set<ArmorCategory>;
  weaponCategories: Set<'simple' | 'martial'>;
  weaponIds: Set<string>;
  tools: string[];
  languages: string[];
  /** 选定的战斗风格 id */
  fightingStyles: string[];
  /** 选定的选项（invocation_agonizing_blast 这种 kind + id） */
  options: { kind: string; id: string }[];
  /** 龙裔 / 龙族血脉的龙种 */
  dragonAncestry?: string;
  sorcererAncestor?: string;
  landCircle?: string;
  notes: string[];
  equip?: ResolvedEquipment;
  /** 神秘秘法：法术环阶 → 法术 id */
  arcanum: Record<number, string>;
}

export const mod = (ctx: Ctx, a: Ability): number => abilityMod(ctx.abilities[a]);

export const warn = (ctx: Ctx, msg: string): void => {
  if (!ctx.warnings.includes(msg)) ctx.warnings.push(msg);
};
export const err = (ctx: Ctx, msg: string): void => {
  if (!ctx.errors.includes(msg)) ctx.errors.push(msg);
};

export const classLevel = (ctx: Ctx, id: string): number => ctx.classes.find((c) => c.def.id === id)?.level ?? 0;
export const hasSubclass = (ctx: Ctx, classId: string, subId: string): boolean =>
  ctx.classes.some((c) => c.def.id === classId && c.subclass?.id === subId && c.level >= c.def.subclassLevel);
/** 这个职业条目的子职业是否已经生效（等级够了）。 */
export const activeSubclass = (c: ResolvedClass): SubclassDef | undefined => (c.subclass && c.level >= c.def.subclassLevel ? c.subclass : undefined);

export const hasFeat = (ctx: Ctx, featId: string): boolean => ctx.feats.some((f) => f.def.id === featId);

export const ABILITY_LIST = ABILITIES;
