import type { Ability, AttackDef, ConditionName, DamageType, RoutineStep, Skill } from '../types.js';

export interface MonsterDef {
  id: string;
  name: string;
  nameEn: string;
  cr: number;
  ac: number;
  hp: number;
  hitDice: string;
  speed: number;
  /** 游泳速度（尺）；没有就是 0 */
  swimSpeed?: number;
  abilities: Record<Ability, number>;
  saves?: Ability[];
  skills?: Skill[];
  /** 双倍熟练的技能（SRD 里加值 = 属性 + 2 × 熟练加值 的那几项）。不用另外写进 skills */
  expertise?: Skill[];
  attacks: AttackDef[];
  /** 多攻套路：每个子数组是一种选择（“啮咬 + 爪击或矛”写成两个套路）。不写 = 一次一击 */
  routines?: RoutineStep[][];
  resistances?: DamageType[];
  vulnerabilities?: DamageType[];
  immunities?: DamageType[];
  /** 只对非魔法攻击生效的抗性 */
  resistancesNonmagical?: DamageType[];
  conditionImmunities?: ConditionName[];
  /** 生物类型：undead / humanoid / beast / construct … */
  creatureType?: string;
  /** 穿着金属护甲（电爪对其有优势） */
  metalArmor?: boolean;
  traits?: { name: string; text: string }[];
  notes?: string;
}

const m = (def: MonsterDef): [string, MonsterDef] => [def.id, def];

/** SRD 5.1 怪物（2014 数值）。只收 1-2 小时 one-shot 用得上的一小撮。 */
export const MONSTERS: Record<string, MonsterDef> = Object.fromEntries([
  m({
    id: 'goblin',
    creatureType: 'humanoid',
    name: '地精',
    nameEn: 'Goblin',
    cr: 0.25,
    ac: 15,
    hp: 7,
    hitDice: '2d6',
    speed: 30,
    abilities: { str: 8, dex: 14, con: 10, int: 10, wis: 8, cha: 8 },
    expertise: ['stealth'],
    attacks: [
      { name: '弯刀', attackBonus: 4, damage: '1d6+2', damageType: 'slashing' },
      { name: '短弓', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', mode: 'ranged', range: [80, 320] },
    ],
    traits: [{ name: '灵巧逃脱', text: '每回合可以用附赠动作撤离或躲藏' }],
    notes: '小体型，黑暗视觉 60 尺',
  }),
  m({
    id: 'bandit',
    creatureType: 'humanoid',
    name: '强盗',
    nameEn: 'Bandit',
    cr: 0.125,
    ac: 12,
    hp: 11,
    hitDice: '2d8+2',
    speed: 30,
    abilities: { str: 11, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
    attacks: [
      { name: '弯刀', attackBonus: 3, damage: '1d6+1', damageType: 'slashing' },
      { name: '轻弩', attackBonus: 3, damage: '1d8+1', damageType: 'piercing', mode: 'ranged', range: [80, 320] },
    ],
  }),
  m({
    id: 'bandit_captain',
    creatureType: 'humanoid',
    name: '强盗首领',
    nameEn: 'Bandit Captain',
    cr: 2,
    ac: 15,
    hp: 65,
    hitDice: '10d8+20',
    speed: 30,
    abilities: { str: 15, dex: 16, con: 14, int: 14, wis: 11, cha: 14 },
    saves: ['str', 'dex', 'wis'],
    skills: ['athletics', 'deception'],
    attacks: [
      { name: '弯刀', attackBonus: 5, damage: '1d6+3', damageType: 'slashing' },
      { name: '匕首', attackBonus: 5, damage: '1d4+3', damageType: 'piercing' },
      { name: '匕首（投掷）', attackBonus: 5, damage: '1d4+3', damageType: 'piercing', mode: 'ranged', range: [20, 60] },
    ],
    routines: [
      [
        { attack: '弯刀', count: 2 },
        { attack: '匕首', count: 1 },
      ],
      [{ attack: '匕首（投掷）', count: 2 }],
    ],
    traits: [
      { name: '多攻', text: '三次近战攻击：两次弯刀、一次匕首；或两次匕首投掷' },
      { name: '格挡', text: '反应：被近战攻击命中时 AC +2（引擎未自动结算）' },
    ],
    notes: 'CR 2；适合当 one-shot 的小头目',
  }),
  m({
    id: 'wolf',
    creatureType: 'beast',
    name: '狼',
    nameEn: 'Wolf',
    cr: 0.25,
    ac: 13,
    hp: 11,
    hitDice: '2d8+2',
    speed: 40,
    abilities: { str: 12, dex: 15, con: 12, int: 3, wis: 12, cha: 6 },
    skills: ['perception', 'stealth'],
    attacks: [
      {
        name: '啮咬',
        attackBonus: 4,
        damage: '2d4+2',
        damageType: 'piercing',
        onHit: { condition: 'prone', save: { ability: 'str', dc: 11 }, note: 'DC 11 力量豁免，失败被撞倒' },
      },
    ],
    traits: [
      { name: '群体战术', text: '有盟友在目标 5 尺内且没失能时，攻击有优势' },
      { name: '敏锐听觉与嗅觉', text: '依赖听觉/嗅觉的感知检定有优势' },
    ],
  }),
  m({
    id: 'skeleton',
    creatureType: 'undead',
    name: '骷髅',
    nameEn: 'Skeleton',
    cr: 0.25,
    ac: 13,
    hp: 13,
    hitDice: '2d8+4',
    speed: 30,
    abilities: { str: 10, dex: 14, con: 15, int: 6, wis: 8, cha: 5 },
    attacks: [
      { name: '短剑', attackBonus: 4, damage: '1d6+2', damageType: 'piercing' },
      { name: '短弓', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', mode: 'ranged', range: [80, 320] },
    ],
    vulnerabilities: ['bludgeoning'],
    immunities: ['poison'],
    conditionImmunities: ['poisoned', 'exhaustion'],
    notes: '易伤：钝击；免疫毒素',
  }),
  m({
    id: 'zombie',
    creatureType: 'undead',
    name: '丧尸',
    nameEn: 'Zombie',
    cr: 0.25,
    ac: 8,
    hp: 22,
    hitDice: '3d8+9',
    speed: 20,
    abilities: { str: 13, dex: 6, con: 16, int: 3, wis: 6, cha: 5 },
    saves: ['wis'],
    attacks: [{ name: '猛击', attackBonus: 3, damage: '1d6+1', damageType: 'bludgeoning' }],
    immunities: ['poison'],
    conditionImmunities: ['poisoned'],
    traits: [{ name: '不死坚韧', text: '受致命伤害时 DC 5+伤害 的体质豁免，成功则剩 1 HP（引擎未自动结算）' }],
  }),
  m({
    id: 'cultist',
    creatureType: 'humanoid',
    name: '邪教徒',
    nameEn: 'Cultist',
    cr: 0.125,
    ac: 12,
    hp: 9,
    hitDice: '2d8',
    speed: 30,
    abilities: { str: 11, dex: 12, con: 10, int: 10, wis: 11, cha: 10 },
    skills: ['deception', 'religion'],
    attacks: [{ name: '弯刀', attackBonus: 3, damage: '1d6+1', damageType: 'slashing' }],
    traits: [{ name: '黑暗虔诚', text: '对抗魅惑和恐惧的豁免有优势（引擎未自动结算）' }],
  }),
  m({
    id: 'scout',
    creatureType: 'humanoid',
    name: '斥候',
    nameEn: 'Scout',
    cr: 0.5,
    ac: 13,
    hp: 16,
    hitDice: '3d8+3',
    speed: 30,
    abilities: { str: 11, dex: 14, con: 12, int: 11, wis: 13, cha: 11 },
    expertise: ['nature', 'perception', 'stealth', 'survival'],
    attacks: [
      { name: '短剑', attackBonus: 4, damage: '1d6+2', damageType: 'piercing' },
      { name: '长弓', attackBonus: 4, damage: '1d8+2', damageType: 'piercing', mode: 'ranged', range: [150, 600] },
    ],
    routines: [[{ attack: '短剑', count: 2 }], [{ attack: '长弓', count: 2 }]],
    traits: [
      { name: '多攻', text: '两次近战攻击或两次远程攻击' },
      { name: '敏锐听觉与视觉', text: '依赖听觉/视觉的感知检定有优势' },
    ],
  }),
  m({
    id: 'sahuagin',
    creatureType: 'humanoid',
    name: '沙华鱼人',
    nameEn: 'Sahuagin',
    cr: 0.5,
    ac: 12,
    hp: 22,
    hitDice: '4d8+4',
    speed: 30,
    swimSpeed: 40,
    abilities: { str: 13, dex: 11, con: 12, int: 12, wis: 13, cha: 9 },
    expertise: ['perception'],
    attacks: [
      { name: '啮咬', attackBonus: 3, damage: '1d4+1', damageType: 'piercing' },
      { name: '爪击', attackBonus: 3, damage: '1d4+1', damageType: 'slashing' },
      { name: '矛', attackBonus: 3, damage: '1d6+1', damageType: 'piercing' },
    ],
    routines: [
      [
        { attack: '啮咬', count: 1 },
        { attack: '爪击', count: 1 },
      ],
      [
        { attack: '啮咬', count: 1 },
        { attack: '矛', count: 1 },
      ],
    ],
    traits: [
      { name: '多攻', text: '两次近战攻击：啮咬一次，爪击或矛一次' },
      { name: '血之狂热', text: '对 HP 不满的目标攻击有优势（引擎未自动结算）' },
      { name: '有限两栖', text: '离开水 4 小时会窒息' },
    ],
    notes: '黑暗视觉 120 尺；鲨鱼感知',
  }),
  m({
    id: 'giant_crab',
    creatureType: 'beast',
    name: '巨蟹',
    nameEn: 'Giant Crab',
    cr: 0.125,
    ac: 15,
    hp: 13,
    hitDice: '3d8',
    speed: 30,
    swimSpeed: 30,
    abilities: { str: 13, dex: 15, con: 11, int: 1, wis: 9, cha: 3 },
    skills: ['stealth'],
    attacks: [
      {
        name: '钳击',
        attackBonus: 3,
        damage: '1d6+1',
        damageType: 'bludgeoning',
        onHit: { condition: 'grappled', escapeDc: 11, note: '命中后目标被擒抱（脱逃 DC 11）' },
      },
    ],
    traits: [{ name: '钳住', text: '命中后目标被擒抱（脱逃 DC 11）；巨蟹钳着一个目标时不能再钳别人' }],
    notes: '盲视 30 尺',
  }),
  m({
    id: 'swarm_of_rats',
    creatureType: 'beast',
    name: '鼠群',
    nameEn: 'Swarm of Rats',
    cr: 0.25,
    ac: 10,
    hp: 24,
    hitDice: '7d8-7',
    speed: 30,
    abilities: { str: 9, dex: 11, con: 9, int: 2, wis: 10, cha: 3 },
    attacks: [{ name: '啃咬', attackBonus: 2, damage: '2d6', damageType: 'piercing' }],
    resistances: ['bludgeoning', 'piercing', 'slashing'],
    conditionImmunities: ['charmed', 'frightened', 'grappled', 'paralyzed', 'petrified', 'prone', 'restrained', 'stunned'],
    notes: '半血以下啃咬改为 1d6；不能恢复 HP',
  }),
  m({
    id: 'animated_armor',
    creatureType: 'construct',
    metalArmor: true,
    name: '活化盔甲',
    nameEn: 'Animated Armor',
    cr: 1,
    ac: 18,
    hp: 33,
    hitDice: '6d8+6',
    speed: 25,
    abilities: { str: 14, dex: 11, con: 13, int: 1, wis: 3, cha: 1 },
    attacks: [{ name: '猛击', attackBonus: 4, damage: '1d6+2', damageType: 'bludgeoning' }],
    routines: [[{ attack: '猛击', count: 2 }]],
    immunities: ['poison', 'psychic'],
    conditionImmunities: ['blinded', 'charmed', 'deafened', 'exhaustion', 'frightened', 'paralyzed', 'petrified', 'poisoned'],
    traits: [
      { name: '多攻', text: '两次近战攻击' },
      { name: '反魔法敏感', text: '在反魔法场里失能' },
    ],
    notes: '适合搁浅船上的“守卫”',
  }),
  m({
    id: 'ghoul',
    creatureType: 'undead',
    name: '食尸鬼',
    nameEn: 'Ghoul',
    cr: 1,
    ac: 12,
    hp: 22,
    hitDice: '5d8',
    speed: 30,
    abilities: { str: 13, dex: 15, con: 10, int: 7, wis: 10, cha: 6 },
    attacks: [
      { name: '啮咬', attackBonus: 2, damage: '2d6+2', damageType: 'piercing' },
      {
        name: '爪击',
        attackBonus: 4,
        damage: '2d4+2',
        damageType: 'slashing',
        onHit: { condition: 'paralyzed', rounds: 10, save: { ability: 'con', dc: 10 }, note: '非精灵、非不死目标 DC 10 体质豁免，失败麻痹 1 分钟' },
      },
    ],
    immunities: ['poison'],
    conditionImmunities: ['charmed', 'exhaustion', 'poisoned'],
    notes: '爪击的麻痹对精灵和不死生物无效（引擎不判，GM 自己注意）',
  }),
  m({
    id: 'bugbear',
    creatureType: 'humanoid',
    name: '熊地精',
    nameEn: 'Bugbear',
    cr: 1,
    ac: 16,
    hp: 27,
    hitDice: '5d8+5',
    speed: 30,
    abilities: { str: 15, dex: 14, con: 13, int: 8, wis: 11, cha: 9 },
    skills: ['survival'],
    expertise: ['stealth'],
    attacks: [
      { name: '晨星', attackBonus: 4, damage: '2d8+2', damageType: 'piercing' },
      { name: '标枪', attackBonus: 4, damage: '2d6+2', damageType: 'piercing' },
      { name: '标枪（投掷）', attackBonus: 4, damage: '1d6+2', damageType: 'piercing', mode: 'ranged', range: [30, 120] },
    ],
    traits: [
      { name: '蛮力', text: '近战武器命中多掷一个伤害骰（已经算进晨星 2d8、标枪 2d6）' },
      { name: '偷袭', text: '第一轮里偷袭到一个生物并命中，目标额外受 2d6 伤害（引擎未自动结算，GM 自己加）' },
    ],
    notes: '黑暗视觉 60 尺；地精类',
  }),
  m({
    id: 'giant_spider',
    creatureType: 'beast',
    name: '巨蜘蛛',
    nameEn: 'Giant Spider',
    cr: 1,
    ac: 14,
    hp: 26,
    hitDice: '4d10+4',
    speed: 30,
    abilities: { str: 14, dex: 16, con: 12, int: 2, wis: 11, cha: 4 },
    expertise: ['stealth'],
    attacks: [
      {
        name: '啮咬',
        attackBonus: 5,
        damage: '1d8+3',
        damageType: 'piercing',
        extraDamage: {
          formula: '2d8',
          damageType: 'poison',
          note: 'DC 11 体质豁免，失败受全额毒伤，成功减半',
          save: { ability: 'con', dc: 11 },
        },
      },
    ],
    traits: [
      { name: '蛛行', text: '可以攀爬墙壁和天花板' },
      { name: '网行者', text: '无视蛛网造成的移动限制' },
    ],
    notes: '黑暗视觉 60 尺；盲视 10 尺；蛛网（充能 5-6）引擎未实现',
  }),
]);

export const monsterById = (id: string): MonsterDef | undefined => MONSTERS[id];
