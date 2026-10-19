// 引擎认识的特性清单：哪些是“要按下去”的主动特性（玩家行动里 type=feature，detail 写 id），
// 哪些是攻击时可以声明的选项，哪些是引擎自动生效的被动特性。给提示词和 legalActions 用。
// 具体怎么结算在 engine.ts 的 useFeature / attack / save 等处；这里只是索引。

export interface UsableFeature {
  /** 中文名 */
  name: string;
  cost: 'action' | 'bonus' | 'free';
  /** 要消耗的资源 key（resources 里的）；没有就是不限次数 */
  resource?: string;
  /** 额外要求的说明（给玩家看） */
  needs?: string;
  hint: string;
}

export const USABLE_FEATURES: Record<string, UsableFeature> = {
  second_wind: { name: '回气', cost: 'bonus', resource: 'second_wind', hint: '恢复 1d10+战士等级 点 HP' },
  action_surge: { name: '动作如潮', cost: 'free', resource: 'action_surge', hint: '这个回合多一个完整动作（可以再 Attack 一轮）' },
  rage: {
    name: '狂暴',
    cost: 'bonus',
    resource: 'rage',
    hint: '物理伤害抗性，近战力量攻击 +2~+4 伤害，力量检定和豁免优势；不能施法；整个回合不攻击也不受伤就结束',
  },
  lay_on_hands: {
    name: '圣疗',
    cost: 'action',
    resource: 'lay_on_hands',
    needs: 'target 写盟友名（碰得到的 5 尺内）；detail 里写要治疗多少点，如「lay_on_hands 治疗 7 点」；写「解毒」花 5 点解除中毒',
    hint: '从圣疗池里取点数治疗',
  },
  turn_undead: { name: '驱逐不死生物', cost: 'action', resource: 'channel_divinity', hint: '30 尺内的不死生物做感知豁免，失败则被驱逐（恐惧）；高等级直接摧毁低 CR 的' },
  preserve_life: {
    name: '保全生命',
    cost: 'action',
    resource: 'channel_divinity',
    needs: 'detail 写分配，如「preserve_life 布拉姆:6 薇克丝:4」',
    hint: '分配最多 5×牧师等级 点治疗，每人最多补到 HP 上限的一半',
  },
  flurry_of_blows: {
    name: '疾风连击',
    cost: 'bonus',
    resource: 'ki',
    needs: '要先用 Attack 动作攻击过；target 写目标',
    hint: '花 1 点气，附赠动作两次徒手打击',
  },
  martial_arts: { name: '武艺附赠打击', cost: 'bonus', needs: '要先用 Attack 动作攻击过；target 写目标', hint: '附赠动作一次徒手打击' },
  patient_defense: { name: '坚忍防御', cost: 'bonus', resource: 'ki', hint: '花 1 点气，附赠动作闪避' },
  step_of_the_wind: { name: '疾风步', cost: 'bonus', resource: 'ki', needs: 'detail 写 dash 或 disengage', hint: '花 1 点气，附赠动作疾走或撤离' },
  bardic_inspiration: {
    name: '诗人激励',
    cost: 'bonus',
    resource: 'bardic_inspiration',
    needs: 'target 写一位盟友（不是自己，60 尺内）',
    hint: '给盟友一个激励骰，他的攻击 / 检定 / 豁免差一点成功时自动加上',
  },
  breath_weapon: {
    name: '龙息',
    cost: 'action',
    resource: 'breath_weapon',
    needs: 'detail 里写要波及的目标名字（锥形 / 直线里的）',
    hint: '按龙裔祖先喷出元素吐息，目标做豁免，成功减半',
  },
};

/** 攻击动作上可以声明的选项：在 attack 的 detail 里写关键词，规则层会读到。 */
export const ATTACK_OPTIONS: { feature: string; keyword: string; hint: string }[] = [
  { feature: 'reckless_attack', keyword: '鲁莽攻击', hint: '回合内第一击上声明：本回合近战力量攻击有优势，但对你的攻击也有优势' },
  { feature: 'divine_smite', keyword: '神圣斩击', hint: '命中后用一个法术位多打光耀伤害（1 环 2d8，每高一环 +1d8，最多 5d8）；写「神圣斩击」就用最低的可用环' },
  { feature: 'stunning_strike', keyword: '震慑拳', hint: '命中后花 1 点气，目标体质豁免失败则震慑到你的下回合结束' },
  { feature: 'fighting_style_two_weapon_fighting', keyword: '副手', hint: '先用 Attack 动作攻击，再用附赠动作用另一把轻型近战武器打副手（写「副手」）' },
];

/** 引擎自动生效的被动特性：不用声明，满足条件就生效。id → 一句话说明。 */
export const AUTO_FEATURES: Record<string, string> = {
  extra_attack: '一个 Attack 动作可以攻击多次',
  sneak_attack: '每回合一次，有优势或目标 5 尺内有你的盟友时多打偷袭骰',
  improved_critical: '19–20 暴击',
  superior_critical: '18–20 暴击',
  brutal_critical: '近战暴击多掷武器骰',
  savage_attacks: '近战武器暴击多掷一个武器骰',
  jack_of_all_trades: '没有熟练的检定也加半个熟练加值',
  remarkable_athlete: '力量 / 敏捷 / 体质检定没熟练也加半个熟练加值',
  reliable_talent: '熟练的技能检定 d20 低于 10 当 10',
  expertise: '专精的技能熟练加值翻倍',
  evasion: '敏捷豁免的半伤效果：成功无伤，失败半伤',
  uncanny_dodge: '被看得见的攻击者命中时，用反应把伤害减半（自动）',
  danger_sense: '看得见的效果的敏捷豁免有优势',
  aura_of_protection: '你和 10 尺内的盟友豁免加魅力调整值',
  fey_ancestry: '对抗魅惑的豁免有优势，魔法无法使你入睡',
  brave: '对抗恐惧的豁免有优势',
  dwarven_resilience: '对抗毒素的豁免有优势',
  gnome_cunning: '对抗魔法的智力 / 感知 / 魅力豁免有优势',
  halfling_luck: '攻击 / 检定 / 豁免掷出 1 时重掷',
  relentless_endurance: '被打到 0 HP 时（不是即死）每次长休一次留 1 HP',
  indomitable: '失败的豁免可以重掷并加战士等级（自动用）',
  arcane_recovery: '短休时自动取回部分法术位',
  agonizing_blast: '魔能爆每道射线加魅力调整值',
  cunning_action: '附赠动作可以疾走、撤离或躲藏',
  fighting_style_archery: '远程武器攻击 +2',
  fighting_style_dueling: '单手近战武器伤害 +2',
  fighting_style_great_weapon_fighting: '双手近战武器伤害骰 1、2 重掷',
  fighting_style_defense: '穿着护甲时 AC +1（构建时已算进 AC）',
  fighting_style_two_weapon_fighting: '副手攻击的伤害加属性调整值',
  martial_arts: '徒手和武僧武器用武艺骰，敏捷或力量取高；攻击后可附赠一次徒手打击',
  disciple_of_life: '治疗法术额外恢复 2+法术环阶',
};
