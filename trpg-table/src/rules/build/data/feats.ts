// 专长：说明文字来自 ODM（feats.gen.ts，自己的话复述的 2014 专长），这里补上构建器要算的那部分机制
// （半专长的 +1 属性、护甲熟练、每级生命、速度、资源、前置条件）和中文名。
import type { Ability } from '../../types.js';
import { FEAT_DEFS } from './feats.gen.js';
import type { ArmorCategory, FeatDef } from './schema.js';

export interface FeatMech {
  zh?: string;
  /** 半专长：从这些属性里选一项 +1（上限 20） */
  asi?: Ability[];
  /** 半专长：任意一项属性（坚韧 / 技能专家） */
  asiAny?: boolean;
  /** 坚韧：得到所选属性的豁免熟练 */
  saveProf?: boolean;
  armor?: ArmorCategory[];
  /** 每个角色等级额外生命（强韧 +2） */
  hpPerLevel?: number;
  /** 速度加值（灵动 +10） */
  speed?: number;
  /** 技能娴熟：自选几个技能 */
  skills?: number;
  /** 武器大师：自选几件武器 */
  weapons?: number;
  resource?: { key: string; max: number; recharge: 'short' | 'long' | 'none' };
  prereq?: {
    /** 外层「或」，内层「且」：属性 ≥ 值 */
    abilities?: { ability: Ability; min: number }[][];
    armor?: ArmorCategory;
    caster?: boolean;
    /** 基础种族 / 种族 id 之一 */
    race?: string[];
    text: string;
  };
}

const STR_DEX: Ability[] = ['str', 'dex'];
const MENTAL: Ability[] = ['int', 'wis', 'cha'];

export const FEAT_MECH: Record<string, FeatMech> = {
  actor: { zh: '演员', asi: ['cha'] },
  alert: { zh: '警觉' },
  athlete: { zh: '运动员', asi: STR_DEX },
  charger: { zh: '冲锋手' },
  chef: { asi: ['con', 'wis'] },
  crossbow_expert: { zh: '弩专家' },
  crusher: { asi: ['str', 'con'] },
  defensive_duelist: { zh: '防御决斗家', prereq: { abilities: [[{ ability: 'dex', min: 13 }]], text: '敏捷 13' } },
  dual_wielder: { zh: '双武器大师' },
  dungeon_delver: { zh: '地城探索者' },
  durable: { zh: '耐久', asi: ['con'] },
  elemental_adept: { zh: '元素专精', prereq: { caster: true, text: '能施放至少一个法术' } },
  elven_accuracy: { asi: ['dex', 'int', 'wis', 'cha'], prereq: { race: ['elf', 'half_elf'], text: '精灵或半精灵' } },
  eldritch_adept: { prereq: { caster: true, text: '有施法或契约魔法' } },
  fey_touched: { asi: MENTAL },
  great_weapon_master: { zh: '巨武器大师' },
  gunner: { asi: ['dex'] },
  healer: { zh: '医者' },
  heavily_armored: { zh: '重甲训练', asi: ['str'], armor: ['heavy'], prereq: { armor: 'medium', text: '中甲熟练' } },
  heavy_armor_master: { zh: '重甲大师', asi: ['str'], prereq: { armor: 'heavy', text: '重甲熟练' } },
  inspiring_leader: { zh: '鼓舞领袖', prereq: { abilities: [[{ ability: 'cha', min: 13 }]], text: '魅力 13' } },
  keen_mind: { zh: '敏锐头脑', asi: ['int'] },
  lightly_armored: { zh: '轻甲训练', asi: STR_DEX, armor: ['light'] },
  linguist: { zh: '语言学家', asi: ['int'] },
  lucky: { zh: '幸运', resource: { key: 'luck', max: 3, recharge: 'long' } },
  mage_slayer: { zh: '法师杀手' },
  magic_initiate: { zh: '魔法学徒' },
  martial_adept: { zh: '战技学徒' },
  medium_armor_master: { zh: '中甲大师', prereq: { armor: 'medium', text: '中甲熟练' } },
  metamagic_adept: { prereq: { caster: true, text: '有施法或契约魔法' } },
  mobile: { zh: '灵动', speed: 10 },
  moderately_armored: { zh: '中甲训练', asi: STR_DEX, armor: ['medium', 'shield'], prereq: { armor: 'light', text: '轻甲熟练' } },
  mounted_combatant: { zh: '骑乘战斗者' },
  observant: { zh: '机敏', asi: ['int', 'wis'] },
  piercer: { asi: STR_DEX },
  polearm_master: { zh: '长柄武器大师' },
  resilient: { zh: '坚韧', asiAny: true, saveProf: true },
  ritual_caster: {
    zh: '仪式施法者',
    prereq: {
      abilities: [[{ ability: 'int', min: 13 }], [{ ability: 'wis', min: 13 }]],
      text: '智力或感知 13',
    },
  },
  sentinel: { zh: '哨兵' },
  shadow_touched: { asi: MENTAL },
  sharpshooter: { zh: '神射手' },
  shield_master: { zh: '盾牌大师' },
  skill_expert: { asiAny: true },
  skilled: { zh: '技能娴熟', skills: 3 },
  skulker: { zh: '潜行者', prereq: { abilities: [[{ ability: 'dex', min: 13 }]], text: '敏捷 13' } },
  slasher: { asi: STR_DEX },
  spell_sniper: { zh: '法术狙击手', prereq: { caster: true, text: '能施放至少一个法术' } },
  tavern_brawler: { zh: '酒馆斗殴者', asi: ['str', 'con'] },
  telekinetic: { asi: MENTAL },
  telepathic: { asi: MENTAL },
  tough: { zh: '强韧', hpPerLevel: 2 },
  war_caster: { zh: '战争施法者', prereq: { caster: true, text: '能施放至少一个法术' } },
  weapon_master: { zh: '武器大师', asi: STR_DEX, weapons: 4 },
};

export const FEATS: Record<string, FeatDef & FeatMech> = Object.fromEntries(FEAT_DEFS.map((d) => [d.id, { ...d, ...(FEAT_MECH[d.id] ?? {}) }]));
