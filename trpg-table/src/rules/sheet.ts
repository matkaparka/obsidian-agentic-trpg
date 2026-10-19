import type { SeatId } from '../config.js';
import { monsterById, type MonsterDef } from './data/monsters.js';
import { halfProficiencyBonus } from './features/passive.js';
import { xpForLevel } from './xp.js';
import {
  ABILITIES,
  abilityMod,
  emptyTurn,
  proficiency,
  type Ability,
  type Actor,
  type AttackDef,
  type ClassLevel,
  type ConditionName,
  type DamageType,
  type Skill,
  type SlotState,
} from './types.js';

export interface CharacterFile {
  seat?: SeatId;
  name: string;
  class?: string;
  level: number;
  abilities: Record<Ability, number>;
  proficiencyBonus?: number;
  saves?: Ability[];
  skills?: Skill[];
  expertise?: Skill[];
  ac: number;
  maxHp: number;
  speed?: number;
  /** 游泳速度（尺）；玩家默认 0 */
  swimSpeed?: number;
  attacks?: AttackDef[];
  spells?: {
    ability: Ability;
    known: string[];
    slots?: Record<string, { max: number; used: number }>;
    /** 契约魔法：法术位短休恢复 */
    pact?: boolean;
    /** 兼职时并进总表的契约位（短休恢复同环阶的 count 个），见 Spellcasting.pactSlots */
    pactSlots?: { level: number; count: number };
  };
  resources?: Record<string, { name?: string; max: number; used?: number; recharge?: 'short' | 'long' | 'none' }>;
  hitDice?: { die: number; total: number; used?: number };
  sneakAttackDice?: number;
  resistances?: DamageType[];
  vulnerabilities?: DamageType[];
  immunities?: DamageType[];
  /** 特性 id（职业 / 子职业 / 种族 / 专长 / 战斗风格），命名规则见 contract.ts 的 featureId() */
  features?: string[];
  persona?: string;
  /** 英文思考原文里可能出现的名字（Vex / Vix），看点渲染校验用；没有就空 */
  aliases?: string[];
  notes?: string;
  /** 以下由角色构建器（build/）算好写进来；手写角色卡可以不管 */
  race?: string;
  background?: string;
  classes?: ClassLevel[];
  /** 每个 Attack 动作几次攻击（额外攻击） */
  attacksPerAction?: number;
  resistancesNonmagical?: DamageType[];
  conditionImmunities?: ConditionName[];
  size?: string;
  /** 穿着金属护甲（电爪对其有优势）；构建器按护甲写，手写角色卡自己填 */
  metalArmor?: boolean;
  /** 起始经验值；没写就是这个等级的门槛值（3 级 = 900） */
  xp?: number;
}

function slotsFrom(raw: CharacterFile['spells']): Record<number, SlotState> {
  const out: Record<number, SlotState> = {};
  for (const [level, s] of Object.entries(raw?.slots ?? {})) {
    const n = Number(level);
    if (Number.isFinite(n)) out[n] = { max: s.max, used: s.used ?? 0 };
  }
  return out;
}

export function actorFromCharacter(file: CharacterFile, id: string, seat?: SeatId): Actor {
  const level = file.level;
  return {
    id,
    name: file.name,
    kind: 'pc',
    seat: seat ?? file.seat,
    level,
    xp: file.xp ?? xpForLevel(level),
    abilities: { ...file.abilities },
    proficiencyBonus: file.proficiencyBonus ?? proficiency(level),
    saves: file.saves ?? [],
    skills: file.skills ?? [],
    expertise: file.expertise ?? [],
    ac: file.ac,
    maxHp: file.maxHp,
    hp: file.maxHp,
    tempHp: 0,
    speed: file.speed ?? 30,
    swimSpeed: file.swimSpeed ?? 0,
    attacks: file.attacks ?? [],
    spells: file.spells
      ? {
          ability: file.spells.ability,
          known: [...file.spells.known],
          slots: slotsFrom(file.spells),
          ...(file.spells.pact ? { pact: true } : {}),
          ...(file.spells.pactSlots ? { pactSlots: { ...file.spells.pactSlots } } : {}),
        }
      : undefined,
    conditions: [],
    effects: [],
    concentration: null,
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    resources: Object.fromEntries(
      Object.entries(file.resources ?? {}).map(([k, r]) => [
        k,
        { name: r.name ?? k, max: r.max, used: r.used ?? 0, recharge: r.recharge ?? 'long' as const },
      ])
    ),
    resistances: file.resistances ?? [],
    vulnerabilities: file.vulnerabilities ?? [],
    immunities: file.immunities ?? [],
    ...(file.resistancesNonmagical ? { resistancesNonmagical: file.resistancesNonmagical } : {}),
    ...(file.conditionImmunities ? { conditionImmunities: file.conditionImmunities } : {}),
    ...(file.attacksPerAction ? { attacksPerAction: file.attacksPerAction } : {}),
    ...(file.classes ? { classes: file.classes.map((c) => ({ ...c })) } : {}),
    ...(file.race ? { race: file.race } : {}),
    ...(file.background ? { background: file.background } : {}),
    ...(file.size ? { size: file.size } : {}),
    ...(file.metalArmor ? { metalArmor: true } : {}),
    hitDice: { die: file.hitDice?.die ?? 8, total: file.hitDice?.total ?? level, used: file.hitDice?.used ?? 0 },
    sneakAttackDice: file.sneakAttackDice ?? 0,
    turn: emptyTurn(),
    features: file.features ?? [],
    notes: file.notes,
    persona: file.persona,
    ...(file.aliases?.length ? { aliases: [...file.aliases] } : {}),
    charClass: file.class,
  } as Actor & { persona?: string; features?: string[] };
}

export interface LevelUpDelta {
  fromLevel: number;
  toLevel: number;
  hpGain: number;
  /** 新增的特性 id（升级前没有、升级后有的） */
  newFeatures: string[];
}

/**
 * 用重新构建出来的角色卡（高一级）覆盖一个已经在玩的 PC，保留正在发生的事：
 * 当前 HP（加上最大 HP 的增量，倒下时不加）、状态、效果、专注、死亡豁免、本回合行动、位置、
 * 已经用掉的法术位和资源（超过新上限的截断）、生命骰已用数，以及人设 / 备注 / 别名 / 名字 / 经验值。
 */
export function applyCharacterFile(actor: Actor, file: CharacterFile): LevelUpDelta {
  const fromLevel = actor.level;
  const oldFeatures = new Set(actor.features ?? []);
  const fresh = actorFromCharacter(file, actor.id, actor.seat);
  const hpGain = fresh.maxHp - actor.maxHp;

  if (fresh.spells) {
    for (const [lvl, slot] of Object.entries(fresh.spells.slots)) {
      slot.used = Math.min(actor.spells?.slots[Number(lvl)]?.used ?? 0, slot.max);
    }
  }
  for (const [key, res] of Object.entries(fresh.resources)) {
    res.used = Math.min(actor.resources[key]?.used ?? 0, res.max);
  }
  fresh.hitDice.used = Math.min(actor.hitDice.used, fresh.hitDice.total);

  const keep: Partial<Actor> = {
    name: actor.name,
    kind: actor.kind,
    seat: actor.seat,
    position: actor.position,
    xp: actor.xp ?? fresh.xp,
    tempHp: actor.tempHp,
    conditions: actor.conditions,
    effects: actor.effects,
    concentration: actor.concentration,
    deathSaves: actor.deathSaves,
    turn: actor.turn,
    persona: actor.persona ?? fresh.persona,
    notes: actor.notes ?? fresh.notes,
    aliases: actor.aliases ?? fresh.aliases,
    hp: actor.hp > 0 ? Math.min(fresh.maxHp, actor.hp + Math.max(0, hpGain)) : actor.hp,
  };
  // 没有值的键不要覆盖成 undefined
  for (const k of Object.keys(keep) as (keyof Actor)[]) if (keep[k] === undefined) delete keep[k];
  Object.assign(actor, fresh, keep);
  return {
    fromLevel,
    toLevel: actor.level,
    hpGain,
    newFeatures: (actor.features ?? []).filter((f) => !oldFeatures.has(f)),
  };
}

/** 怪物的熟练加值随 CR：0–4 → +2，5–8 → +3，每 4 级 +1，到 29+ 的 +9 */
export function crProficiencyBonus(cr: number): number {
  return 2 + Math.max(0, Math.ceil((cr - 4) / 4));
}

export function actorFromMonster(def: MonsterDef, id: string): Actor {
  return {
    id,
    name: def.name,
    kind: 'monster',
    level: Math.max(1, Math.ceil(def.cr)),
    abilities: { ...def.abilities },
    proficiencyBonus: crProficiencyBonus(def.cr),
    saves: def.saves ?? [],
    skills: def.skills ?? [],
    expertise: def.expertise ?? [],
    ac: def.ac,
    maxHp: def.hp,
    hp: def.hp,
    tempHp: 0,
    speed: def.speed,
    swimSpeed: def.swimSpeed ?? 0,
    attacks: def.attacks,
    routines: def.routines,
    traits: def.traits,
    creatureType: def.creatureType,
    ...(def.metalArmor ? { metalArmor: true } : {}),
    cr: def.cr,
    conditions: [],
    effects: [],
    concentration: null,
    deathSaves: { successes: 0, failures: 0, stable: false, dead: false },
    resources: {},
    resistances: def.resistances ?? [],
    vulnerabilities: def.vulnerabilities ?? [],
    immunities: def.immunities ?? [],
    resistancesNonmagical: def.resistancesNonmagical,
    conditionImmunities: def.conditionImmunities,
    hitDice: { die: 8, total: 1, used: 0 },
    sneakAttackDice: 0,
    turn: emptyTurn(),
    notes: def.notes,
  };
}

export function makeMonster(id: string, name?: string): Actor {
  const def = monsterById(id);
  if (!def) throw new Error(`没有这个怪物：${id}`);
  const actor = actorFromMonster(def, name ? `${id}#${name}` : id);
  if (name) actor.name = name;
  return actor;
}

/** 3 级、互补的两人小队草稿（用户在 campaign-vault/characters 定稿前，dry-run 用这套）。 */
export const DEFAULT_PARTY: Record<'player_a' | 'player_b', CharacterFile> = {
  player_a: {
    seat: 'player_a',
    name: '薇克丝',
    class: '盗贼（Rogue / Thief）3',
    level: 3,
    abilities: { str: 10, dex: 17, con: 14, int: 12, wis: 10, cha: 14 },
    saves: ['dex', 'int'],
    skills: ['acrobatics', 'deception', 'investigation', 'perception', 'sleight_of_hand', 'stealth'],
    expertise: ['stealth', 'sleight_of_hand'],
    ac: 15,
    maxHp: 24,
    speed: 30,
    attacks: [
      { weaponId: 'rapier', name: '刺剑' },
      { weaponId: 'shortbow', name: '短弓' },
    ],
    hitDice: { die: 8, total: 3 },
    sneakAttackDice: 2,
    features: [],
    persona:
      '提夫林盗贼，嘴硬、贪财、多疑。相信“先到手的东西才是自己的”，对队友的善意第一反应是“他图什么”。' +
      '遇到值钱的东西会先算怎么独吞；但真到要命的时候，又会用尖刻的话掩饰自己在乎同伴。说话短、带刺。',
    notes: '专长：潜行与巧手（Expertise）。偷袭 2d6。',
    aliases: ['Vex', 'Vix'],
  },
  player_b: {
    seat: 'player_b',
    name: '布拉姆',
    class: '生命领域牧师（Cleric / Life Domain）3',
    level: 3,
    abilities: { str: 14, dex: 8, con: 14, int: 10, wis: 16, cha: 12 },
    saves: ['wis', 'cha'],
    skills: ['insight', 'medicine', 'persuasion', 'religion'],
    ac: 18,
    maxHp: 24,
    speed: 30,
    attacks: [{ weaponId: 'mace', name: '钉头锤' }],
    spells: {
      ability: 'wis',
      known: [
        'sacred_flame',
        'toll_the_dead',
        'guidance',
        'light',
        'bless',
        'cure_wounds',
        'healing_word',
        'guiding_bolt',
        'shield_of_faith',
        'hold_person',
        'spiritual_weapon',
      ],
      slots: { '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } },
    },
    resources: {
      channel_divinity: { name: '引导神力：保命之光', max: 1, used: 0, recharge: 'short' },
    },
    hitDice: { die: 8, total: 3 },
    features: ['disciple_of_life'],
    metalArmor: true,
    persona:
      '人类生命牧师，温和、爱说教，实际上非常怕死。相信“活着才有资格谈信仰”，遇到危险会先算退路，' +
      '然后用神意包装自己的胆怯。对队友的鲁莽会皱眉，但不会丢下他们。说话慢，喜欢引用祷词。',
    notes: '生命领域：治疗法术额外恢复 2+法术环阶 HP（引擎已实现）。AC 18（链甲+盾）。',
    aliases: ['Bram', 'Brum'],
  },
};

export function makeDefaultParty(): { a: Actor; b: Actor } {
  return {
    a: actorFromCharacter(DEFAULT_PARTY.player_a, 'player_a', 'player_a'),
    b: actorFromCharacter(DEFAULT_PARTY.player_b, 'player_b', 'player_b'),
  };
}

/** 计算技能/豁免的加值，给提示词和 legalActions 用 */
export function skillBonus(actor: Actor, skill: Skill): number {
  const ability = skillAbility(skill);
  let bonus = abilityMod(actor.abilities[ability]);
  if (actor.expertise.includes(skill)) bonus += actor.proficiencyBonus * 2;
  else if (actor.skills.includes(skill)) bonus += actor.proficiencyBonus;
  else bonus += halfProficiencyBonus(actor, ability); // 杂艺、超凡运动员
  return bonus;
}

function skillAbility(skill: Skill): Ability {
  // 避免循环 import：这里只做映射
  const map: Record<Skill, Ability> = {
    acrobatics: 'dex',
    animal_handling: 'wis',
    arcana: 'int',
    athletics: 'str',
    deception: 'cha',
    history: 'int',
    insight: 'wis',
    intimidation: 'cha',
    investigation: 'int',
    medicine: 'wis',
    nature: 'int',
    perception: 'wis',
    performance: 'cha',
    persuasion: 'cha',
    religion: 'int',
    sleight_of_hand: 'dex',
    stealth: 'dex',
    survival: 'wis',
  };
  return map[skill];
}

export function abilityNames(actor: Actor): string {
  return ABILITIES.map((a) => `${a.toUpperCase()} ${actor.abilities[a]}`).join(' / ');
}
