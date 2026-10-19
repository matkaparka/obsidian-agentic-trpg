// 角色构建器（build/）、职业特性引擎（features/）和 table 层之间的数据契约。
// 改这里要同时改三边；每一边都只通过这里约定的名字交流。

export const CLASS_IDS = [
  'barbarian',
  'bard',
  'cleric',
  'druid',
  'fighter',
  'monk',
  'paladin',
  'ranger',
  'rogue',
  'sorcerer',
  'warlock',
  'wizard',
] as const;
export type ClassId = (typeof CLASS_IDS)[number];

/**
 * 特性 id：英文名转小写 snake_case，去掉括号里的东西和末尾的数字 / 罗马数字。
 * "Second Wind" → second_wind；"Extra Attack (2)" → extra_attack；"Action Surge (1 use)" → action_surge；
 * "Fighting Style: Dueling"（选了风格的）→ fighting_style_dueling；种族 "Dwarven Resilience (adv. vs poison)" → dwarven_resilience。
 */
export function featureId(name: string): string {
  return name
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .replace(/_(?:\d+|i{1,3}|iv|v)$/i, '')
    .toLowerCase();
}

export interface ResourceSpec {
  /** 显示名 */
  name: string;
  recharge: 'short' | 'long' | 'none';
}

/**
 * 角色卡里 resources 的 key 约定（构建器填 max，引擎按 key 找）。
 * max 的算法在 build/resources.ts；用多少、什么时候恢复在 features/ 里。
 */
export const RESOURCE_SPECS: Record<string, ResourceSpec> = {
  second_wind: { name: '回气', recharge: 'short' },
  action_surge: { name: '动作如潮', recharge: 'short' },
  indomitable: { name: '不屈', recharge: 'long' },
  rage: { name: '狂暴', recharge: 'long' },
  ki: { name: '气', recharge: 'short' },
  bardic_inspiration: { name: '诗人激励', recharge: 'long' }, // 5 级起短休恢复，由构建器改写 recharge
  channel_divinity: { name: '引导神力', recharge: 'short' },
  lay_on_hands: { name: '圣疗池', recharge: 'long' },
  divine_sense: { name: '神圣感知', recharge: 'long' },
  sorcery_points: { name: '术法点', recharge: 'long' },
  wild_shape: { name: '野性变形', recharge: 'short' },
  arcane_recovery: { name: '奥术回复', recharge: 'long' },
  superiority_dice: { name: '卓越骰', recharge: 'short' },
  favored_foe: { name: '宿敌', recharge: 'long' },
  breath_weapon: { name: '龙息', recharge: 'short' },
  relentless_endurance: { name: '不屈耐力', recharge: 'long' },
  healing_hands: { name: '治愈之手', recharge: 'long' },
  stones_endurance: { name: '岩石耐力', recharge: 'short' },
  luck: { name: '幸运', recharge: 'long' },
  natural_recovery: { name: '自然回复', recharge: 'long' },
  cleansing_touch: { name: '净化之触', recharge: 'long' },
  stroke_of_luck: { name: '幸运一击', recharge: 'short' },
  wholeness_of_body: { name: '身心合一', recharge: 'long' },
  dark_ones_own_luck: { name: '黑暗幸运', recharge: 'short' },
  hurl_through_hell: { name: '地狱放逐', recharge: 'long' },
};
