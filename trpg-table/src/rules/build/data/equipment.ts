// 护甲表和职业起始装备。武器表在 ../../data/weapons.ts（引擎共用的 WEAPONS），这里不重复。
import type { ClassId } from '../../contract.js';
import type { ArmorCategory } from './schema.js';

export interface ArmorDef {
  id: string;
  name: string;
  zh: string;
  category: ArmorCategory;
  /** 盾牌是 +2；其它护甲是基础 AC */
  baseAc: number;
  /** 敏捷调整值上限：不填 = 不限（轻甲），中甲 2，重甲 0 */
  dexCap?: number;
  strReq?: number;
  stealthDisadvantage?: boolean;
  /** 德鲁伊不穿金属护甲 */
  metal: boolean;
}

/** SRD 5.1 护甲表（id 和 ../../data/weapons.ts 的 ARMOR 一致）。 */
export const ARMOR_DEFS: Record<string, ArmorDef> = Object.fromEntries(
  (
    [
      { id: 'padded', name: 'Padded', zh: '衬垫甲', category: 'light', baseAc: 11, stealthDisadvantage: true, metal: false },
      { id: 'leather', name: 'Leather', zh: '皮甲', category: 'light', baseAc: 11, metal: false },
      { id: 'studded_leather', name: 'Studded Leather', zh: '镶钉皮甲', category: 'light', baseAc: 12, metal: false },
      { id: 'hide', name: 'Hide', zh: '兽皮甲', category: 'medium', baseAc: 12, dexCap: 2, metal: false },
      { id: 'chain_shirt', name: 'Chain Shirt', zh: '链甲衫', category: 'medium', baseAc: 13, dexCap: 2, metal: true },
      { id: 'scale_mail', name: 'Scale Mail', zh: '鳞甲', category: 'medium', baseAc: 14, dexCap: 2, stealthDisadvantage: true, metal: true },
      { id: 'breastplate', name: 'Breastplate', zh: '胸甲', category: 'medium', baseAc: 14, dexCap: 2, metal: true },
      { id: 'half_plate', name: 'Half Plate', zh: '半身板甲', category: 'medium', baseAc: 15, dexCap: 2, stealthDisadvantage: true, metal: true },
      { id: 'ring_mail', name: 'Ring Mail', zh: '环甲', category: 'heavy', baseAc: 14, dexCap: 0, stealthDisadvantage: true, metal: true },
      { id: 'chain_mail', name: 'Chain Mail', zh: '链甲', category: 'heavy', baseAc: 16, dexCap: 0, strReq: 13, stealthDisadvantage: true, metal: true },
      { id: 'splint', name: 'Splint', zh: '板条甲', category: 'heavy', baseAc: 17, dexCap: 0, strReq: 15, stealthDisadvantage: true, metal: true },
      { id: 'plate', name: 'Plate', zh: '板甲', category: 'heavy', baseAc: 18, dexCap: 0, strReq: 15, stealthDisadvantage: true, metal: true },
      { id: 'shield', name: 'Shield', zh: '盾牌', category: 'shield', baseAc: 2, metal: true },
    ] as ArmorDef[]
  ).map((a) => [a.id, a])
);

export interface StarterKit {
  armor: string | null;
  shield: boolean;
  weapons: string[];
}

/**
 * 职业起始装备（每个「A 或 B」的选择都按固定规则选好，见 README）。
 * 战士在敏捷高于力量时会换成 DEX_KITS 里轻甲 + 弓的那套，见 starterKitFor()。
 */
export const STARTER_KITS: Record<ClassId, StarterKit> = {
  barbarian: { armor: null, shield: false, weapons: ['greataxe', 'handaxe', 'javelin'] },
  bard: { armor: 'leather', shield: false, weapons: ['rapier', 'dagger'] },
  cleric: { armor: 'scale_mail', shield: true, weapons: ['mace', 'light_crossbow'] },
  druid: { armor: 'leather', shield: true, weapons: ['scimitar'] },
  fighter: { armor: 'chain_mail', shield: true, weapons: ['longsword', 'light_crossbow'] },
  monk: { armor: null, shield: false, weapons: ['shortsword', 'dart'] },
  paladin: { armor: 'chain_mail', shield: true, weapons: ['longsword', 'javelin'] },
  ranger: { armor: 'scale_mail', shield: false, weapons: ['shortsword', 'longbow'] },
  rogue: { armor: 'leather', shield: false, weapons: ['rapier', 'shortbow', 'dagger'] },
  sorcerer: { armor: null, shield: false, weapons: ['dagger', 'light_crossbow'] },
  warlock: { armor: 'leather', shield: false, weapons: ['light_crossbow', 'dagger'] },
  wizard: { armor: null, shield: false, weapons: ['quarterstaff', 'dagger'] },
};

/** 敏捷型战士的起始装备：皮甲 + 长弓 + 灵巧武器（就是「皮甲、长弓、箭」那一项加两件军用武器里的刺剑）。 */
export const DEX_KITS: Partial<Record<ClassId, StarterKit>> = {
  fighter: { armor: 'leather', shield: false, weapons: ['rapier', 'longbow'] },
};

/** 战斗风格（SRD 5.1 的六种）：id（接在 fighting_style_ 后面）→ 名字，以及哪些职业能选。 */
export const FIGHTING_STYLES: Record<string, { name: string; zh: string; text: string; classes: ClassId[] }> = {
  archery: { name: 'Archery', zh: '箭术', text: 'You gain a +2 bonus to attack rolls you make with ranged weapons.', classes: ['fighter', 'ranger'] },
  defense: { name: 'Defense', zh: '防御', text: 'While you are wearing armor, you gain a +1 bonus to AC.', classes: ['fighter', 'paladin', 'ranger'] },
  dueling: { name: 'Dueling', zh: '决斗', text: 'When you wield a melee weapon in one hand and no other weapons, you gain +2 to damage rolls with it.', classes: ['fighter', 'paladin', 'ranger'] },
  great_weapon_fighting: {
    name: 'Great Weapon Fighting',
    zh: '巨武器战斗',
    text: 'When you roll a 1 or 2 on a damage die with a two-handed or versatile melee weapon, you can reroll the die and must use the new roll.',
    classes: ['fighter', 'paladin'],
  },
  protection: { name: 'Protection', zh: '保护', text: 'With a shield, use your reaction to impose disadvantage on an attack against an adjacent ally.', classes: ['fighter', 'paladin'] },
  two_weapon_fighting: {
    name: 'Two-Weapon Fighting',
    zh: '双武器战斗',
    text: 'When you fight with two weapons, you can add your ability modifier to the damage of the second attack.',
    classes: ['fighter', 'ranger'],
  },
};
