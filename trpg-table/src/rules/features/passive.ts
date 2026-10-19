// 职业 / 种族特性里不需要玩家“按下去”的那部分：被动加值、暴击范围、风格修正、成长表。
// 全是纯函数，输入 Actor 与武器信息；引擎在相应时点调用。特性 id 的命名见 ../contract.ts 的 featureId()。

import type { WeaponDef } from '../types.js';
import { WEAPONS } from '../data/weapons.js';
import type { Actor, AttackDef } from '../types.js';

export const hasFeature = (actor: Actor, id: string): boolean => (actor.features ?? []).includes(id);

/** 某个职业的等级；没有 classes 信息的手写角色卡，退回按总等级 + charClass 文字猜不了，就是 0。 */
export function classLevel(actor: Actor, classId: string): number {
  return (actor.classes ?? []).filter((c) => c.id === classId).reduce((s, c) => s + c.level, 0);
}

/** 职业等级；角色卡没写 classes（手写卡）时按总等级算。 */
export function classLevelOr(actor: Actor, classId: string): number {
  if (!actor.classes) return actor.level;
  return classLevel(actor, classId);
}

/** 暴击范围：额外暴击 19–20（冠军 3 级），卓越暴击 18–20（15 级）。 */
export function critThreshold(actor: Actor): number {
  if (hasFeature(actor, 'superior_critical')) return 18;
  if (hasFeature(actor, 'improved_critical')) return 19;
  return 20;
}

/** 狂暴伤害加值：1–8 级 +2，9–15 级 +3，16 级起 +4。 */
export const rageDamage = (barbarianLevel: number): number => (barbarianLevel >= 16 ? 4 : barbarianLevel >= 9 ? 3 : 2);

/** 野蛮暴击：13 级起多 1 个武器骰，17 级 2 个，（SRD：9 级 1、13 级 2、17 级 3）。 */
export const brutalCriticDice = (barbarianLevel: number): number => (barbarianLevel >= 17 ? 3 : barbarianLevel >= 13 ? 2 : barbarianLevel >= 9 ? 1 : 0);

/** 武僧武艺骰：1–4 级 d4，5–10 级 d6，11–16 级 d8，17 级起 d10。 */
export const martialArtsDie = (monkLevel: number): number => (monkLevel >= 17 ? 10 : monkLevel >= 11 ? 8 : monkLevel >= 5 ? 6 : 4);

/** 诗人激励骰：1–4 级 d6，5–9 级 d8，10–14 级 d10，15 级起 d12。 */
export const bardicDie = (bardLevel: number): number => (bardLevel >= 15 ? 12 : bardLevel >= 10 ? 10 : bardLevel >= 5 ? 8 : 6);

/** 龙裔龙息伤害骰数：1–5 级 2d6，6–10 级 3d6，11–15 级 4d6，16 级起 5d6。 */
export const breathDice = (level: number): number => (level >= 16 ? 5 : level >= 11 ? 4 : level >= 6 ? 3 : 2);

/** 龙裔祖先 → 龙息的伤害类型和豁免属性。 */
export const DRACONIC_ANCESTRY: Record<string, { damage: Actor['resistances'][number]; save: 'dex' | 'con' }> = {
  black: { damage: 'acid', save: 'dex' },
  blue: { damage: 'lightning', save: 'dex' },
  brass: { damage: 'fire', save: 'dex' },
  bronze: { damage: 'lightning', save: 'dex' },
  copper: { damage: 'acid', save: 'dex' },
  gold: { damage: 'fire', save: 'dex' },
  green: { damage: 'poison', save: 'con' },
  red: { damage: 'fire', save: 'dex' },
  silver: { damage: 'cold', save: 'con' },
  white: { damage: 'cold', save: 'con' },
};

/** 神圣斩击骰数：1 环 2d8，每高一环 +1d8，最多 5d8。 */
export const smiteDice = (slotLevel: number): number => Math.min(5, 1 + Math.max(1, slotLevel));

export interface WeaponContext {
  weapon: WeaponDef | undefined;
  def: AttackDef;
  melee: boolean;
  ranged: boolean;
  /** 双手握持（双手武器，或 versatile 且选了双手） */
  twoHanded: boolean;
}

export function weaponContext(def: AttackDef, melee: boolean): WeaponContext {
  const weapon = def.weaponId ? WEAPONS[def.weaponId] : undefined;
  const twoHanded = !!weapon && (weapon.properties.includes('two-handed') || (weapon.properties.includes('versatile') && def.twoHanded === true));
  return { weapon, def, melee, ranged: !melee, twoHanded };
}

/** 战斗风格带来的命中加值：弓箭手 +2（远程武器攻击）。 */
export function styleAttackBonus(actor: Actor, ctx: WeaponContext): number {
  if (ctx.weapon && ctx.weapon.kind === 'ranged' && hasFeature(actor, 'fighting_style_archery')) return 2;
  return 0;
}

/** 战斗风格带来的伤害加值：决斗 +2（单手近战武器）。 */
export function styleDamageBonus(actor: Actor, ctx: WeaponContext): number {
  if (ctx.melee && ctx.weapon && !ctx.twoHanded && !ctx.weapon.properties.includes('two-handed') && hasFeature(actor, 'fighting_style_dueling')) return 2;
  return 0;
}

/** 巨武器战斗：近战双手握持时伤害骰 1、2 重掷。返回要重掷的阈值（0 = 不重掷）。 */
export function greatWeaponRerollBelow(actor: Actor, ctx: WeaponContext): number {
  if (ctx.melee && ctx.twoHanded && hasFeature(actor, 'fighting_style_great_weapon_fighting')) return 2;
  return 0;
}

/** 武僧武器：简易近战武器（没有双手、重型），或短剑。 */
export function isMonkWeapon(weapon: WeaponDef | undefined): boolean {
  if (!weapon) return true; // 徒手
  if (weapon.id === 'shortsword') return true;
  return weapon.category === 'simple' && weapon.kind === 'melee' && !weapon.properties.includes('two-handed') && !weapon.properties.includes('heavy');
}

/** 半熟练：杂艺（所有没熟练的检定 +半熟练，向下取整）、超凡运动员（力量/敏捷/体质检定 +半熟练，向上取整）。 */
export function halfProficiencyBonus(actor: Actor, ability: 'str' | 'dex' | 'con' | 'int' | 'wis' | 'cha'): number {
  const pb = actor.proficiencyBonus;
  if (hasFeature(actor, 'jack_of_all_trades')) return Math.floor(pb / 2);
  if (hasFeature(actor, 'remarkable_athlete') && (ability === 'str' || ability === 'dex' || ability === 'con')) return Math.ceil(pb / 2);
  return 0;
}

