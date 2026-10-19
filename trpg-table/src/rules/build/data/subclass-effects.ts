// 子职业里构建器要算数的那部分：额外熟练项、自选技能、额外攻击、额外戏法、生命、无甲 AC。
// 只覆盖 PHB 和少数常见子职业；没列在这里的子职业只有特性（id + 说明），没有数值效果。
// 键是 "职业/子职业 id"。
import type { ConditionName, Skill } from '../../types.js';
import type { ArmorCategory } from './schema.js';

export interface SubclassEffects {
  /** 子职业的等级条件已经满足时才生效（取 classLevel ≥ 子职业入口等级，除非另写 level） */
  armor?: ArmorCategory[];
  weaponCategories?: ('simple' | 'martial')[];
  weaponIds?: string[];
  tools?: string[];
  /** 固定给的技能 */
  skills?: Skill[];
  /** 自选技能，从 bonusSkills 池里取 */
  skillPick?: { count: number; from: Skill[] | 'any' };
  /** 子职业给的额外攻击：职业等级 ≥ level 时每个攻击动作 2 次 */
  extraAttackLevel?: number;
  /** 额外戏法（不占职业戏法数）：从 list 职业的戏法里选 count 个 */
  extraCantrips?: { count: number; list: 'druid' | 'wizard' };
  /** 白送的戏法 */
  freeCantrips?: string[];
  /** 每个该职业等级 +1 生命（龙族韧性） */
  hpPerClassLevel?: number;
  /** 无甲时 AC = base + 敏捷（可以持盾） */
  unarmoredBase?: number;
  /** 职业等级 ≥ level 时免疫的状态 / 伤害 */
  conditionImmunities?: { level: number; condition: ConditionName }[];
  damageImmunities?: { level: number; type: 'poison' }[];
}

const HEAVY: ArmorCategory[] = ['heavy'];

export const SUBCLASS_EFFECTS: Record<string, SubclassEffects> = {
  'cleric/life_domain': { armor: HEAVY },
  'cleric/war_domain': { armor: HEAVY, weaponCategories: ['martial'] },
  'cleric/tempest_domain': { armor: HEAVY, weaponCategories: ['martial'] },
  'cleric/twilight_domain': { armor: HEAVY, weaponCategories: ['martial'] },
  'cleric/nature_domain': { armor: HEAVY, skillPick: { count: 1, from: ['animal_handling', 'nature', 'survival'] }, extraCantrips: { count: 1, list: 'druid' } },
  'cleric/forge_domain': { armor: HEAVY, tools: ["smith's tools"] },
  'cleric/order_domain': { armor: HEAVY, skillPick: { count: 1, from: ['intimidation', 'persuasion'] } },
  'cleric/death_domain': { weaponCategories: ['martial'] },
  'cleric/knowledge_domain': { skillPick: { count: 2, from: ['arcana', 'history', 'nature', 'religion'] } },
  'cleric/light_domain': { freeCantrips: ['light'] },
  'cleric/arcana_domain': { skills: ['arcana'], extraCantrips: { count: 2, list: 'wizard' } },
  'bard/lore': { skillPick: { count: 3, from: 'any' } },
  'bard/valor': { armor: ['medium', 'shield'], weaponCategories: ['martial'], extraAttackLevel: 6 },
  'bard/swords': { armor: ['medium'], weaponIds: ['scimitar'], extraAttackLevel: 6 },
  'warlock/hexblade': { armor: ['medium', 'shield'], weaponCategories: ['martial'] },
  'wizard/bladesinging': { armor: ['light'], skills: ['performance'], extraAttackLevel: 6 },
  'druid/land': { extraCantrips: { count: 1, list: 'druid' }, conditionImmunities: [{ level: 10, condition: 'poisoned' }], damageImmunities: [{ level: 10, type: 'poison' }] },
  'monk/drunken_master': { skills: ['performance'], tools: ["brewer's supplies"] },
  'monk/mercy': { skills: ['insight', 'medicine'], tools: ['herbalism kit'] },
  'rogue/assassin': { tools: ['disguise kit', "poisoner's kit"] },
  'rogue/mastermind': { tools: ['disguise kit', 'forgery kit'] },
  'fighter/samurai': { skillPick: { count: 1, from: ['history', 'insight', 'performance', 'persuasion'] } },
  'fighter/cavalier': { skillPick: { count: 1, from: ['animal_handling', 'history', 'insight', 'performance', 'persuasion'] } },
  'sorcerer/draconic_bloodline': { hpPerClassLevel: 1, unarmoredBase: 13 },
  'paladin/devotion': { conditionImmunities: [{ level: 7, condition: 'charmed' }] },
};

/** 职业本身的免疫（纯净之躯、勇气光环）。 */
export const CLASS_IMMUNITIES: Record<string, { conditionImmunities?: { level: number; condition: ConditionName }[]; damageImmunities?: { level: number; type: 'poison' }[] }> = {
  monk: { conditionImmunities: [{ level: 10, condition: 'poisoned' }], damageImmunities: [{ level: 10, type: 'poison' }] },
  paladin: { conditionImmunities: [{ level: 10, condition: 'frightened' }] },
};
