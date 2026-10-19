import type { WeaponDef } from '../types.js';

const w = (
  id: string,
  name: string,
  nameEn: string,
  category: 'simple' | 'martial',
  kind: 'melee' | 'ranged',
  damage: string,
  damageType: WeaponDef['damageType'],
  properties: string[],
  extra: Partial<WeaponDef> = {}
): [string, WeaponDef] => [id, { id, name: `${name}（${nameEn}）`, category, kind, damage, damageType, properties, ...extra }];

/** SRD 5.1 武器表（2014）。数值取自 SRD，未实现 2024 的 Weapon Mastery。 */
export const WEAPONS: Record<string, WeaponDef> = Object.fromEntries([
  // 徒手打击：1 + 力量调整值钝击伤害；武僧用武艺骰、敏捷或力量（见 features/passive.ts）
  w('unarmed', '徒手打击', 'Unarmed Strike', 'simple', 'melee', '1', 'bludgeoning', []),
  // 猫爪：Tabaxi 的天生武器（种族 naturalAttacks 用，不在 SRD 武器表里）
  w('claws', '猫爪', "Cat's Claws", 'simple', 'melee', '1d4', 'slashing', []),
  w('club', '短棒', 'Club', 'simple', 'melee', '1d4', 'bludgeoning', ['light']),
  w('dagger', '匕首', 'Dagger', 'simple', 'melee', '1d4', 'piercing', ['finesse', 'light', 'thrown'], { range: [20, 60] }),
  w('greatclub', '巨棒', 'Greatclub', 'simple', 'melee', '1d8', 'bludgeoning', ['two-handed']),
  w('handaxe', '手斧', 'Handaxe', 'simple', 'melee', '1d6', 'slashing', ['light', 'thrown'], { range: [20, 60] }),
  w('javelin', '标枪', 'Javelin', 'simple', 'melee', '1d6', 'piercing', ['thrown'], { range: [30, 120] }),
  w('light_hammer', '轻锤', 'Light hammer', 'simple', 'melee', '1d4', 'bludgeoning', ['light', 'thrown'], { range: [20, 60] }),
  w('mace', '钉头锤', 'Mace', 'simple', 'melee', '1d6', 'bludgeoning', []),
  w('quarterstaff', '长棍', 'Quarterstaff', 'simple', 'melee', '1d6', 'bludgeoning', ['versatile'], { versatile: '1d8' }),
  w('sickle', '镰刀', 'Sickle', 'simple', 'melee', '1d4', 'slashing', ['light']),
  w('spear', '矛', 'Spear', 'simple', 'melee', '1d6', 'piercing', ['thrown', 'versatile'], { versatile: '1d8', range: [20, 60] }),
  w('light_crossbow', '轻弩', 'Light crossbow', 'simple', 'ranged', '1d8', 'piercing', ['ammunition', 'loading', 'two-handed'], { range: [80, 320] }),
  w('dart', '飞镖', 'Dart', 'simple', 'ranged', '1d4', 'piercing', ['finesse', 'thrown'], { range: [20, 60] }),
  w('shortbow', '短弓', 'Shortbow', 'simple', 'ranged', '1d6', 'piercing', ['ammunition', 'two-handed'], { range: [80, 320] }),
  w('sling', '投石索', 'Sling', 'simple', 'ranged', '1d4', 'bludgeoning', ['ammunition'], { range: [30, 120] }),

  w('battleaxe', '战斧', 'Battleaxe', 'martial', 'melee', '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
  w('flail', '连枷', 'Flail', 'martial', 'melee', '1d8', 'bludgeoning', []),
  w('glaive', '长刀', 'Glaive', 'martial', 'melee', '1d10', 'slashing', ['heavy', 'reach', 'two-handed']),
  w('greataxe', '巨斧', 'Greataxe', 'martial', 'melee', '1d12', 'slashing', ['heavy', 'two-handed']),
  w('greatsword', '巨剑', 'Greatsword', 'martial', 'melee', '2d6', 'slashing', ['heavy', 'two-handed']),
  w('halberd', '戟', 'Halberd', 'martial', 'melee', '1d10', 'slashing', ['heavy', 'reach', 'two-handed']),
  w('longsword', '长剑', 'Longsword', 'martial', 'melee', '1d8', 'slashing', ['versatile'], { versatile: '1d10' }),
  w('maul', '大槌', 'Maul', 'martial', 'melee', '2d6', 'bludgeoning', ['heavy', 'two-handed']),
  w('morningstar', '流星锤', 'Morningstar', 'martial', 'melee', '1d8', 'piercing', []),
  w('pike', '长枪', 'Pike', 'martial', 'melee', '1d10', 'piercing', ['heavy', 'reach', 'two-handed']),
  w('rapier', '刺剑', 'Rapier', 'martial', 'melee', '1d8', 'piercing', ['finesse']),
  w('scimitar', '弯刀', 'Scimitar', 'martial', 'melee', '1d6', 'slashing', ['finesse', 'light']),
  w('shortsword', '短剑', 'Shortsword', 'martial', 'melee', '1d6', 'piercing', ['finesse', 'light']),
  w('trident', '三叉戟', 'Trident', 'martial', 'melee', '1d6', 'piercing', ['thrown', 'versatile'], { versatile: '1d8', range: [20, 60] }),
  w('war_pick', '战镐', 'War pick', 'martial', 'melee', '1d8', 'piercing', []),
  w('warhammer', '战锤', 'Warhammer', 'martial', 'melee', '1d8', 'bludgeoning', ['versatile'], { versatile: '1d10' }),
  w('whip', '鞭', 'Whip', 'martial', 'melee', '1d4', 'slashing', ['finesse', 'reach']),
  w('hand_crossbow', '手弩', 'Hand crossbow', 'martial', 'ranged', '1d6', 'piercing', ['ammunition', 'light', 'loading'], { range: [30, 120] }),
  w('heavy_crossbow', '重弩', 'Heavy crossbow', 'martial', 'ranged', '1d10', 'piercing', ['ammunition', 'heavy', 'loading', 'two-handed'], { range: [100, 400] }),
  w('longbow', '长弓', 'Longbow', 'martial', 'ranged', '1d8', 'piercing', ['ammunition', 'heavy', 'two-handed'], { range: [150, 600] }),
]);

export const ARMOR: Record<string, { name: string; ac: number; type: 'light' | 'medium' | 'heavy' | 'shield'; maxDex?: number }> = {
  padded: { name: '皮甲（衬垫）', ac: 11, type: 'light' },
  leather: { name: '皮甲', ac: 11, type: 'light' },
  studded_leather: { name: '镶钉皮甲', ac: 12, type: 'light' },
  hide: { name: '兽皮甲', ac: 12, type: 'medium' },
  chain_shirt: { name: '链甲衫', ac: 13, type: 'medium' },
  scale_mail: { name: '鳞甲', ac: 14, type: 'medium' },
  breastplate: { name: '胸甲', ac: 14, type: 'medium' },
  half_plate: { name: '半身板甲', ac: 15, type: 'medium' },
  ring_mail: { name: '环甲', ac: 14, type: 'heavy' },
  chain_mail: { name: '链甲', ac: 16, type: 'heavy' },
  splint: { name: '板条甲', ac: 17, type: 'heavy' },
  plate: { name: '板甲', ac: 18, type: 'heavy' },
  shield: { name: '盾牌', ac: 2, type: 'shield' },
};
