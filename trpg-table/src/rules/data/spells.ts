import type { Ability, ConditionName, DamageType, RollModFields } from '../types.js';
import { SRD_SPELLS } from './spellsSrd.js';

export type SpellSchool = '塑能' | '防护' | '咒法' | '预言' | '附魔' | '幻术' | '死灵' | '变化';

export type SpellEffect =
  | {
      kind: 'attack';
      attacks: number;
      damage: string;
      damageType: DamageType;
      addMod?: boolean;
      /** 目标穿金属护甲时这次攻击有优势（电爪） */
      advantageIfMetalArmor?: boolean;
      /** 命中后挂在目标身上的效果（如光导箭） */
      rider?: {
        name: string;
        grantsAttackersAdvantage?: boolean;
        /** 对目标的下一次攻击有优势，用一次就没（光导箭） */
        grantsAdvantageOnce?: boolean;
        rounds?: number;
        /** 到施法者下回合开始前 */
        untilCasterTurn?: boolean;
        /** 到目标自己下回合开始前（电爪：不能反应） */
        untilTargetTurn?: boolean;
        /** 目标不能用反应 */
        noReactions?: boolean;
        note?: string;
      };
    }
  | {
      kind: 'save';
      ability: Ability;
      damage?: string;
      damageType?: DamageType;
      halfOnSave?: boolean;
      /** 失败时附加的状态 */
      condition?: ConditionName;
      conditionRounds?: number;
      /** 无视掩蔽（圣火）：不吃掩蔽的敏捷豁免加值 */
      ignoreCover?: boolean;
      /** 附上的状态，每个回合结束时目标可以再做一次同样的豁免，成功就结束（定身人类） */
      repeatSave?: boolean;
      /** 附上的状态，目标可以用一个动作做这个属性的检定（对施法豁免 DC）摆脱（蛛网术：力量） */
      escapeAbility?: Ability;
      /** 豁免失败时挂上的效果（妖火的勾勒：对它的攻击有优势、不能隐形；灾祸术：攻击和豁免 -1d4） */
      failEffect?: {
        name: string;
        grantsAttackersAdvantage?: boolean;
        blocksInvisibility?: boolean;
        attackDice?: string;
        saveDice?: string;
        checkDice?: string;
        acBonus?: number;
        speedMultiplier?: number;
        /** 效果在目标自己下一个回合结束时结束（恶言相加） */
        untilTargetTurnEnd?: boolean;
        /** 目标每个回合结束再做一次同属性、同 DC 的豁免，成功就结束这个效果（缓慢术） */
        repeatSave?: boolean;
      } & RollModFields;
      /** 豁免失败的目标被推离施法者这么多尺（雷鸣波 10） */
      pushFeet?: number;
      /** 按生物类型（creatureType）区别对待：豁免劣势 / 完全不受影响 / 受到最大伤害（枯萎术、日爆术、粉碎音波） */
      typeRules?: { disadvantage?: string[]; immune?: string[]; maxDamage?: string[] };
      note?: string;
    }
  | {
      kind: 'auto';
      damage: string;
      damageType: DamageType;
      note?: string;
      /** 飞弹数和每枚的伤害（魔法飞弹）：给了就按枚结算，可以分给多个目标，升环每环多一枚 */
      darts?: number;
      dartDamage?: string;
    }
  | { kind: 'heal'; dice: string; addMod?: boolean }
  | ({
      kind: 'buff';
      acBonus?: number;
      attackDice?: string;
      saveDice?: string;
      checkDice?: string;
      condition?: ConditionName;
      /** 到施法者下回合开始前结束（护盾术） */
      untilCasterTurn?: boolean;
      /** AC 基础值（法师护甲）或下限（树肤术） */
      acBase?: { base: number; addDex: boolean };
      /** 临时 HP 公式（虚假生命）；升环每环加 upcast.tempHp */
      tempHp?: string;
      speedBonus?: number;
      speedMultiplier?: number;
      /** 每回合多一个动作（加速术） */
      extraAction?: boolean;
      resistances?: DamageType[];
      resistancesNonmagical?: DamageType[];
      /** 对目标的攻击检定有劣势（朦胧术） */
      attackersDisadvantage?: boolean;
      /** 其他生物对目标的攻击检定有优势（难以抗拒之舞） */
      grantsAttackersAdvantage?: boolean;
      /** 效果结束（专注断了 / 时间到）时，目标陷入一个回合的失能 + 速度 0（加速术） */
      lethargyOnEnd?: boolean;
      /** 免疫这个状态的生物不受影响（难以抗拒之舞：免疫魅惑者） */
      unlessImmuneTo?: ConditionName;
      /** 效果等到施法者的下一个回合才生效，并在那个回合结束时结束（克敌先击）；挂在施法者身上时配合 markTarget */
      armedNextTurn?: boolean;
      /** 武器命中时的额外伤害；markTarget = 只对这个法术的第一个目标生效（猎人印记）；once = 用一次就结束（惩击类） */
      bonusDamage?: { dice: string; damageType?: DamageType; once?: boolean };
      markTarget?: boolean;
      /** 之后每个回合还能用的攻击；upcastEvery2 = 比法术本环每高两环多加的骰 */
      grantsAttack?: import('../types.js').GrantedAttack & { upcastEvery2?: string };
      /** 解除状态：one = 只解除一个；exhaustion = 降低几级力竭（没有可解除的状态时） */
      removes?: { conditions: ConditionName[]; one?: boolean; exhaustion?: number };
      /** 复活死去的 PC：hp1 = 1 HP，full = 满血 */
      revive?: 'hp1' | 'full';
      /** 把施法者自己传送到这么多尺内的空格（迷踪步 30、任意门 500）；施法时要给 destination */
      teleportFeet?: number;
      note?: string;
    } & RollModFields)
  | { kind: 'sleep'; pool: string; note?: string }
  | { kind: 'utility'; note: string };

/** 施法时的一个选项。fields 里的掷骰修正会并进效果（buff 挂在目标上，save 挂在失败的目标上；onCaster 挂在施法者身上）。 */
export interface SpellChoice {
  key: string;
  label: string;
  /** option 文本里出现任何一个关键词（小写比较）就选这一项；靠前的选项先匹配 */
  match: string[];
  fields: RollModFields & {
    bonusDamage?: { dice: string; damageType?: DamageType };
    /** 临时 HP 骰（熊之耐力 2d6） */
    tempHp?: string;
  };
  /** 效果挂在施法者身上（降咒术：你的攻击对它额外伤害），bonusDamage 自动只对这个目标生效 */
  onCaster?: boolean;
  note?: string;
}

export interface SpellDef {
  id: string;
  name: string;
  level: number;
  school: SpellSchool;
  castingTime: 'action' | 'bonus' | 'reaction';
  range: string;
  components: string;
  duration: string;
  concentration: boolean;
  effect: SpellEffect;
  /** 升环：在高一环比基础多出来的东西 */
  upcast?: {
    damage?: string;
    attacks?: number;
    heal?: string;
    targets?: number;
    pool?: string;
    /** 临时 HP：每高一环加这么多（虚假生命 5） */
    tempHp?: number;
    /** 武器附加伤害：每高一环加的骰（辉煌惩击 1d6） */
    bonusDamage?: string;
  };
  classes: ('cleric' | 'wizard' | 'druid' | 'bard' | 'sorcerer' | 'warlock' | 'paladin' | 'ranger')[];
  /** 需要目标（攻击/单体伤害/治疗） */
  needsTarget?: boolean;
  /** 范围法术：施法者给出的所有目标都受影响（燃烧之手、蛛网术） */
  aoe?: boolean;
  /** 最多影响几个目标（祝福术 3 个） */
  maxTargets?: number;
  /** 没给目标时，作用于施法者这么多尺内所有存活的盟友（含自己）——「你选定的任意数量生物」（无痕步、希望信标、圣洁光环） */
  allyRadius?: number;
  /** 施法时要选的模式（增强属性、降咒术）；施法者在 option 文本里写出关键词，引擎据此认出来。没认出来就拒绝施法（不扣法术位） */
  choices?: SpellChoice[];
  /** 戏法随施法者等级成长：5 / 11 / 17 级伤害骰 ×2 / ×3 / ×4（魔能爆是射线数）；引擎在 castSpell 里算 */
  cantripScaling?: boolean;
  /** 仪式施法：比正常施法多花 10 分钟，不耗法术位 */
  ritual?: boolean;
  /**
   * 补充说明：自动结算之外 GM 要裁定的部分、真实时长等（一行中文，压缩改写，不是 SRD 原文）。
   * utility / buff 的完整说明在 effect.note 里，这里只给 attack / save / auto / heal / sleep 用。
   */
  note?: string;
  /** 引擎还没有的机制：用来统计下一步该给引擎补什么（只是标签，引擎不读） */
  needs?: SpellMechanic[];
}

/** 引擎还没有的机制标签。标在 utility、只带说明的 buff、以及只部分自动结算的法术上。 */
export type SpellMechanic =
  /** 持续区域：区域内每回合伤害 / 进入触发 / 难行地形 / 遮蔽 / 墙 */
  | 'zone'
  /**
   * 优势、劣势、减值骰、固定加值。通用字段已经有（types.ts 的 RollModFields：攻击 / 豁免 / 检定的优势劣势、技能加值、
   * 不能反应、治疗取最大值、按生物类型的劣势…），带这个标签的是还没接上的：衰弱射线（无伤害的法术攻击 + 力量武器伤害减半）、
   * 灼热金属（持握者攻击和检定劣势）、瘟疫术（选疾病）、魔法圈（区域内）。
   */
  | 'roll_modifier'
  /** 召唤 / 造物 / 随从：需要在地图上放一个有数据的单位 */
  | 'summon'
  /** 每回合或受伤后重新豁免的复杂规则（引擎的 repeatSave 只支持同属性同 DC 的回合末重试） */
  | 'repeat_save'
  /** 持续时间内之后的回合还能再用动作 / 附赠动作触发（灵体武器类攻击、移动的区域、再劈一道雷） */
  | 'repeat_action'
  /** 传送、位面移除、放逐、传送门 */
  | 'teleport'
  /** 速度 / 飞行 / 攀爬 / 游泳 / 跳跃 / 无视难行地形 */
  | 'movement'
  /** 强制行动 / 支配 / 暗示：受术者怎么行动由施法者指定 */
  | 'mind_control'
  /** 多段、延迟、多类型伤害，或伤害与豁免无关（酸箭、冰风暴、火焰打击、流星爆、弱智术） */
  | 'multi_damage'
  /** 移除状态、疾病、诅咒、属性损伤 */
  | 'remove_condition'
  /** 授予伤害抗性 / 免疫 */
  | 'resistance'
  /** AC 基础值或下限（法师护甲 13+敏捷、树肤术 AC 不低于 16），不是加值 */
  | 'ac_base'
  /** 状态在受到伤害时解除（催眠图纹；睡眠术的昏迷在引擎里也没有受伤即醒） */
  | 'end_on_damage'
  /** 复活、稳定濒死 */
  | 'revive'
  /** 条件触发的防护或反击（庇护术、火焰盾、死亡防护、符文、无敌法球） */
  | 'trigger_ward'
  /** 强制位移：推、拉、击退、抓走 */
  | 'forced_move'
  /** 变形 / 体型变化 */
  | 'polymorph'
  /** 临时 HP / 最大 HP 增减 */
  | 'temp_hp'
  /** 武器附加伤害 / 魔化武器 / 惩击类（下一次或每次武器命中额外伤害） */
  | 'weapon_enhance'
  /** 授予对魅惑、恐惧等状态的免疫 */
  | 'condition_immunity'
  /** 光照、黑暗、特殊视觉（黑暗视觉、真视、识破隐形） */
  | 'light_vision'
  /** 群体治疗：heal 只能治疗一个目标 */
  | 'mass_heal'
  /** 反制 / 解除魔法 */
  | 'counterspell'
  /** 施法时要选模式或类型，数据里只能取默认值 */
  | 'choose_option'
  /** 升环增加目标数，但法术是 aoe + maxTargets（maxTargets 不随升环增长） */
  | 'upcast_targets'
  /** 按目标当前 HP 判定是否生效（律令死亡、律令震慑、神圣言语） */
  | 'hp_threshold'
  /** 额外动作 / 额外回合 */
  | 'extra_action'
  /** 命中后附带的次要效果（不能反应、不能恢复 HP），数据里只挂了标记 */
  | 'rider_effect'
  /** 生命值池类效果（七彩喷射；sleep 种类只会挂昏迷） */
  | 'hp_pool'
  /** 伤害分担（守护契约） */
  | 'damage_share'
  /** 吸血回复 */
  | 'lifesteal'
  /** 持续再生 */
  | 'regen'
  /** 升环加固定值（引擎的升环只认骰子公式，如痊愈术每环 +10） */
  | 'upcast_flat';

const s = (def: Omit<SpellDef, 'id'> & { id: string }): [string, SpellDef] => [def.id, def];

/** 手写的核心法术（3 级角色常用的 SRD 5.1 子集，外加亡者丧钟）。只实现能自动结算的部分，其余标为 utility 并在描述里说清楚。 */
const CORE_SPELLS: Record<string, SpellDef> = Object.fromEntries([
  s({
    id: 'fire_bolt',
    name: '火焰箭',
    level: 0,
    school: '塑能',
    castingTime: 'action',
    range: '120 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'attack', attacks: 1, damage: '1d10', damageType: 'fire' },
    classes: ['wizard', 'sorcerer'],
    needsTarget: true,
    cantripScaling: true,
  }),
  s({
    id: 'ray_of_frost',
    name: '寒冰射线',
    level: 0,
    school: '塑能',
    castingTime: 'action',
    range: '60 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'attack', attacks: 1, damage: '1d8', damageType: 'cold' },
    classes: ['wizard', 'sorcerer'],
    needsTarget: true,
    cantripScaling: true,
  }),
  s({
    id: 'sacred_flame',
    name: '圣火',
    level: 0,
    school: '塑能',
    castingTime: 'action',
    range: '60 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'save', ability: 'dex', damage: '1d8', damageType: 'radiant', ignoreCover: true, note: '目标不能从半掩蔽/四分之三掩蔽中获益' },
    classes: ['cleric'],
    needsTarget: true,
    cantripScaling: true,
  }),
  s({
    id: 'toll_the_dead',
    name: '亡者丧钟',
    level: 0,
    school: '死灵',
    castingTime: 'action',
    range: '60 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'save', ability: 'wis', damage: '1d8', damageType: 'necrotic', note: '目标已受伤时伤害为 1d12（需 GM 声明 damaged）' },
    classes: ['cleric', 'warlock', 'wizard'],
    needsTarget: true,
    cantripScaling: true,
  }),
  s({
    id: 'guidance',
    name: '指引',
    level: 0,
    school: '预言',
    castingTime: 'action',
    range: '触碰',
    components: 'V, S',
    duration: '1 分钟',
    concentration: true,
    effect: { kind: 'buff', checkDice: '1d4', note: '一次属性检定加 1d4（引擎按一次检定处理，未自动消耗）' },
    classes: ['cleric', 'druid'],
  }),
  s({
    id: 'mage_hand',
    name: '法师之手',
    level: 0,
    school: '咒法',
    castingTime: 'action',
    range: '30 尺',
    components: 'V, S',
    duration: '1 分钟',
    concentration: false,
    effect: { kind: 'utility', note: '操纵 10 磅以内的物体；不需要掷骰，由 GM 裁定' },
    classes: ['wizard', 'bard', 'sorcerer', 'warlock'],
  }),
  s({
    id: 'minor_illusion',
    name: '次级幻影',
    level: 0,
    school: '幻术',
    castingTime: 'action',
    range: '30 尺',
    components: 'S, M',
    duration: '1 分钟',
    concentration: false,
    effect: { kind: 'utility', note: '制造声音或影像；由 GM 裁定是否骗过目标' },
    classes: ['wizard', 'bard', 'sorcerer', 'warlock'],
  }),
  s({
    id: 'light',
    name: '光亮术',
    level: 0,
    school: '塑能',
    castingTime: 'action',
    range: '触碰',
    components: 'V, M',
    duration: '1 小时',
    concentration: false,
    effect: { kind: 'utility', note: '物体发出 20 尺亮光 + 20 尺微光' },
    classes: ['cleric', 'wizard', 'bard', 'sorcerer'],
  }),
  s({
    id: 'bless',
    name: '祝福术',
    level: 1,
    school: '附魔',
    castingTime: 'action',
    range: '30 尺',
    components: 'V, S, M',
    duration: '1 分钟',
    concentration: true,
    effect: { kind: 'buff', attackDice: '1d4', saveDice: '1d4', note: '最多 3 个目标；攻击检定和豁免 +1d4' },
    maxTargets: 3,
    upcast: { targets: 1 },
    classes: ['cleric', 'paladin'],
  }),
  s({
    id: 'shield',
    name: '护盾术',
    level: 1,
    school: '防护',
    castingTime: 'reaction',
    range: '自身',
    components: 'V, S',
    duration: '1 轮',
    concentration: false,
    effect: { kind: 'buff', acBonus: 5, untilCasterTurn: true, note: '直到你下回合开始，AC +5' },
    classes: ['wizard', 'sorcerer'],
  }),
  s({
    id: 'shield_of_faith',
    name: '信仰之盾',
    level: 1,
    school: '防护',
    castingTime: 'bonus',
    range: '60 尺',
    components: 'V, S, M',
    duration: '10 分钟',
    concentration: true,
    effect: { kind: 'buff', acBonus: 2, note: '射程内一个生物 AC +2，持续 10 分钟（专注）' },
    classes: ['cleric', 'paladin'],
  }),
  s({
    id: 'magic_missile',
    name: '魔法飞弹',
    level: 1,
    school: '塑能',
    castingTime: 'action',
    range: '120 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'auto', damage: '3d4+3', damageType: 'force', darts: 3, dartDamage: '1d4+1', note: '三枚飞弹各 1d4+1，必定命中；可以分给多个目标；升环每环多一枚' },
    upcast: { damage: '1d4+1' },
    classes: ['wizard', 'sorcerer'],
    needsTarget: true,
  }),
  s({
    id: 'burning_hands',
    name: '燃烧之手',
    level: 1,
    school: '塑能',
    castingTime: 'action',
    range: '自身（15 尺锥形）',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'save', ability: 'dex', damage: '3d6', damageType: 'fire', halfOnSave: true },
    aoe: true,
    upcast: { damage: '1d6' },
    classes: ['wizard', 'sorcerer'],
  }),
  s({
    id: 'cure_wounds',
    name: '治疗伤害',
    level: 1,
    school: '塑能',
    castingTime: 'action',
    range: '触碰',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'heal', dice: '1d8', addMod: true },
    upcast: { heal: '1d8' },
    classes: ['cleric', 'druid', 'bard', 'paladin', 'ranger'],
    needsTarget: true,
  }),
  s({
    id: 'healing_word',
    name: '治愈真言',
    level: 1,
    school: '塑能',
    castingTime: 'bonus',
    range: '60 尺',
    components: 'V',
    duration: '立即',
    concentration: false,
    effect: { kind: 'heal', dice: '1d4', addMod: true },
    upcast: { heal: '1d4' },
    classes: ['cleric', 'druid', 'bard'],
    needsTarget: true,
  }),
  s({
    id: 'guiding_bolt',
    name: '光导箭',
    level: 1,
    school: '塑能',
    castingTime: 'action',
    range: '120 尺',
    components: 'V, S',
    duration: '1 轮',
    concentration: false,
    effect: {
      kind: 'attack',
      attacks: 1,
      damage: '4d6',
      damageType: 'radiant',
      rider: { name: '光导', grantsAdvantageOnce: true, untilCasterTurn: true, note: '下一次对目标的攻击检定有优势' },
    },
    upcast: { damage: '1d6' },
    classes: ['cleric'],
    needsTarget: true,
  }),
  s({
    id: 'faerie_fire',
    name: '妖火',
    level: 1,
    school: '塑能',
    castingTime: 'action',
    range: '60 尺',
    components: 'V',
    duration: '1 分钟',
    concentration: true,
    effect: {
      kind: 'save',
      ability: 'dex',
      failEffect: { name: '被妖火勾勒', grantsAttackersAdvantage: true, blocksInvisibility: true },
      note: '目标敏捷豁免失败则被勾勒：对它的攻击有优势，且不能隐形',
    },
    aoe: true,
    classes: ['druid', 'bard'],
  }),
  s({
    id: 'sleep',
    name: '睡眠术',
    level: 1,
    school: '附魔',
    castingTime: 'action',
    range: '90 尺',
    components: 'V, S, M',
    duration: '1 分钟',
    concentration: false,
    effect: { kind: 'sleep', pool: '5d8', note: '按当前 HP 从低到高生效，剩余 HP 不够的不受影响' },
    upcast: { pool: '2d8' },
    classes: ['wizard', 'bard', 'sorcerer'],
  }),
  s({
    id: 'spiritual_weapon',
    name: '灵体武器',
    level: 2,
    school: '塑能',
    castingTime: 'bonus',
    range: '60 尺',
    components: 'V, S',
    duration: '1 分钟',
    concentration: false,
    effect: { kind: 'buff', grantsAttack: { name: '灵体武器', cost: 'bonus', dice: '1d8', damageType: 'force', addMod: true, melee: true, rangeFeet: 80, floating: true, upcastEvery2: '1d8' }, note: '召唤一把灵体武器（附赠动作施放，1 分钟，不用专注）：之后每回合可以用附赠动作让它攻击 60 尺内的目标（它先飞 20 尺），法术攻击，1d8+施法属性调整值力场伤害；升环每高两环 +1d8' },
    classes: ['cleric'],
  }),
  s({
    id: 'hold_person',
    name: '定身人类',
    level: 2,
    school: '附魔',
    castingTime: 'action',
    range: '60 尺',
    components: 'V, S, M',
    duration: '1 分钟',
    concentration: true,
    effect: { kind: 'save', ability: 'wis', condition: 'paralyzed', conditionRounds: 10, repeatSave: true, note: '每回合结束可再豁免' },
    upcast: { targets: 1 },
    classes: ['cleric', 'bard', 'druid', 'sorcerer', 'wizard', 'warlock'],
    needsTarget: true,
  }),
  s({
    id: 'web',
    name: '蛛网术',
    level: 2,
    school: '咒法',
    castingTime: 'action',
    range: '60 尺',
    components: 'V, S, M',
    duration: '1 小时',
    concentration: true,
    effect: { kind: 'save', ability: 'dex', condition: 'restrained', conditionRounds: 10, escapeAbility: 'str', note: '被困的生物可以用动作做力量检定（对施法 DC）摆脱；区域为 20 尺立方' },
    aoe: true,
    classes: ['wizard', 'sorcerer'],
  }),
  s({
    id: 'misty_step',
    name: '迷踪步',
    level: 2,
    school: '咒法',
    castingTime: 'bonus',
    range: '自身',
    components: 'V',
    duration: '立即',
    concentration: false,
    effect: { kind: 'buff', teleportFeet: 30, note: '附赠动作传送到 30 尺内能看见的空位（施法时要给目的地格子）' },
    classes: ['wizard', 'sorcerer', 'warlock'],
  }),
  s({
    id: 'scorching_ray',
    name: '灼热射线',
    level: 2,
    school: '塑能',
    castingTime: 'action',
    range: '120 尺',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'attack', attacks: 3, damage: '2d6', damageType: 'fire' },
    upcast: { attacks: 1 },
    classes: ['wizard', 'sorcerer'],
    needsTarget: true,
  }),
  s({
    id: 'invisibility',
    name: '隐形术',
    level: 2,
    school: '幻术',
    castingTime: 'action',
    range: '触碰',
    components: 'V, S, M',
    duration: '1 小时',
    concentration: true,
    effect: { kind: 'buff', condition: 'invisible', note: '目标隐形；攻击或施法后结束' },
    classes: ['wizard', 'bard', 'sorcerer', 'warlock'],
  }),
  s({
    id: 'mirror_image',
    name: '镜影术',
    level: 2,
    school: '幻术',
    castingTime: 'action',
    range: '自身',
    components: 'V, S',
    duration: '1 分钟',
    concentration: false,
    effect: { kind: 'utility', note: '三个分身；被攻击时按 GM 掷骰决定是否打中分身（引擎未自动化）' },
    classes: ['wizard', 'sorcerer', 'warlock'],
  }),
  s({
    id: 'lesser_restoration',
    name: '次级复原术',
    level: 2,
    school: '防护',
    castingTime: 'action',
    range: '触碰',
    components: 'V, S',
    duration: '立即',
    concentration: false,
    effect: { kind: 'buff', removes: { conditions: ['blinded', 'deafened', 'paralyzed', 'poisoned'], one: true }, note: '触碰一个生物：移除它身上的目盲、耳聋、麻痹或中毒之一' },
    classes: ['cleric', 'druid', 'bard', 'paladin', 'ranger'],
  }),
  s({
    id: 'silence',
    name: '沉默术',
    level: 2,
    school: '幻术',
    castingTime: 'action',
    range: '120 尺',
    components: 'V, S',
    duration: '10 分钟',
    concentration: true,
    effect: { kind: 'utility', note: '20 尺半径内不能发出声音，也不能施展有言语成分的法术' },
    classes: ['cleric', 'bard', 'ranger'],
    ritual: true,
  }),
]);

/** 手写的核心法术（27 个）加上 spellsSrd.ts 里的 SRD 5.1 全表；id 重复时手写的优先（test/spells.test.ts 会检查不重复）。 */
export const SPELLS: Record<string, SpellDef> = { ...SRD_SPELLS, ...CORE_SPELLS };

export const spellById = (id: string): SpellDef | undefined => SPELLS[id];
