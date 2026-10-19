// 状态对攻击、检定、豁免、速度的实际影响：优势/劣势合并、自动暴击、力竭表。
// 全是纯函数：输入是状态名字符串数组（小写英文名），不碰引擎状态。
//
// 改写自 Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman）
// 的 src/lib/dm/condition-logic.ts。见 ../NOTICE.md。

import type { Advantage } from '../types.js';

export const INCAPACITATING = ['incapacitated', 'paralyzed', 'stunned', 'unconscious', 'petrified'];
/** 这些状态原文都写了“速度 0 / 不能移动”；单独的“失能”只拿走动作和反应。 */
export const SPEED_ZERO = ['grappled', 'restrained', 'paralyzed', 'stunned', 'unconscious', 'petrified'];
export const AUTO_FAIL_STR_DEX = ['paralyzed', 'stunned', 'unconscious', 'petrified'];
/** 对它的攻击有优势（原文各自写了；单独的“失能”不算） */
export const TARGET_GRANTS_ADVANTAGE = ['restrained', 'blinded', 'paralyzed', 'stunned', 'unconscious', 'petrified'];
/** 5 尺内的近战命中自动暴击 */
export const AUTO_CRIT_TARGETS = ['paralyzed', 'unconscious'];
/** 攻击者自己的攻击检定有劣势（SRD：倒地、束缚、中毒、目盲、恐惧；倒地是所有攻击，不止远程） */
export const ATTACKER_DISADVANTAGE = ['prone', 'restrained', 'poisoned', 'blinded', 'frightened'];
/** 属性检定有劣势（中毒、恐惧）。豁免不受影响。 */
export const CHECK_DISADVANTAGE = ['poisoned', 'frightened'];
/** 闪避动作的“状态名”；引擎在构造状态列表时按 turn.dodging 加进去 */
export const DODGING = 'dodging';

const has = (conditions: string[], names: string[]): string | null => {
  const lowered = conditions.map((c) => c.toLowerCase());
  return names.find((n) => lowered.includes(n)) ?? null;
};

export const isIncapacitated = (conditions: string[]): boolean => has(conditions, INCAPACITATING) !== null;
export const incapacitatedBy = (conditions: string[]): string | null => has(conditions, INCAPACITATING);

/** 优势和劣势只要各有一个来源就互相抵消，不管各有几个（SRD 5.1）。 */
export function mergeAdvantage(sources: Advantage[]): Advantage {
  const adv = sources.includes('adv');
  const dis = sources.includes('dis');
  if (adv && dis) return 'none';
  return adv ? 'adv' : dis ? 'dis' : 'none';
}

export interface AttackContextInput {
  attackerConditions: string[];
  targetConditions: string[];
  /** 攻击者在目标 5 尺内 */
  adjacent: boolean;
  /** 调用者显式要求的优势/劣势（GM 声明） */
  requested?: Advantage;
  /** 远程攻击（武器或法术）时，攻击者 5 尺内有能看见他的敌对生物 */
  rangedWithHostileNear?: boolean;
  /** 超出正常射程 */
  beyondNormalRange?: boolean;
  /** 群体战术：有盟友在目标 5 尺内且没失能 */
  packTactics?: boolean;
  /** 夹击（可选规则） */
  flanking?: boolean;
  /** 协助 / 光导箭一类“只用一次”的优势来源 */
  extraAdvantage?: string[];
  /** 目标身上的效果带来的优势/劣势来源（妖火、目标隐形被看穿等由调用者折算） */
  effectSources?: { state: Advantage; note: string }[];
  /** 目标“看穿隐形”（妖火 / 真视术）：不再因为隐形而劣势 */
  attackerSeesInvisible?: boolean;
  targetSeesInvisible?: boolean;
}

export interface AttackContext {
  advantage: Advantage;
  sources: Advantage[];
  autoCrit: boolean;
  notes: string[];
}

/**
 * 一次攻击的优势/劣势/自动暴击，由双方状态推出。
 * 所有来源都攒起来一次合并（不要把合并结果再和别的来源合并）。
 */
export function attackContext(input: AttackContextInput): AttackContext {
  const sources: Advantage[] = [];
  const notes: string[] = [];
  const push = (state: Advantage, note: string) => {
    sources.push(state);
    notes.push(note);
  };
  if (input.requested && input.requested !== 'none') push(input.requested, input.requested === 'adv' ? '调用方声明：优势' : '调用方声明：劣势');

  const attackerDown = has(input.attackerConditions, ATTACKER_DISADVANTAGE);
  if (attackerDown) push('dis', `攻击者${attackerDown}：劣势`);
  if (has(input.attackerConditions, ['invisible']) && !input.targetSeesInvisible) push('adv', '攻击者隐形：优势');
  if (has(input.attackerConditions, ['hidden'])) push('adv', '攻击者躲藏中：优势（攻击后现形）');

  // 昏迷的生物已经倒地
  if (has(input.targetConditions, ['prone', 'unconscious'])) {
    push(input.adjacent ? 'adv' : 'dis', input.adjacent ? '目标倒地：近处优势' : '目标倒地：远处劣势');
  }
  const open = has(input.targetConditions, TARGET_GRANTS_ADVANTAGE);
  if (open) push('adv', `目标${open}：优势`);
  if (has(input.targetConditions, ['invisible']) && !input.attackerSeesInvisible) push('dis', '目标隐形：劣势');
  if (has(input.targetConditions, ['hidden'])) push('dis', '目标躲藏中，看不见：劣势');
  if (has(input.targetConditions, [DODGING]) && !isIncapacitated(input.targetConditions)) push('dis', '目标在闪避：劣势');

  if (input.rangedWithHostileNear) push('dis', '5 尺内有敌对生物：远程攻击劣势');
  if (input.beyondNormalRange) push('dis', '超出正常射程：劣势');
  if (input.packTactics) push('adv', '群体战术：优势');
  if (input.flanking) push('adv', '夹击：优势');
  for (const note of input.extraAdvantage ?? []) push('adv', note);
  for (const e of input.effectSources ?? []) push(e.state, e.note);

  const critName = has(input.targetConditions, AUTO_CRIT_TARGETS);
  const autoCrit = Boolean(critName && input.adjacent);
  if (autoCrit) notes.push(`目标${critName}：5 尺内命中即暴击`);
  return { advantage: mergeAdvantage(sources), sources, autoCrit, notes };
}

export type RollKind = 'skill_check' | 'ability_check' | 'saving_throw' | 'initiative' | 'attack';

export interface RollDerivation {
  advantage: Advantage;
  sources: Advantage[];
  autoFail: boolean;
  notes: string[];
}

/**
 * 状态对检定 / 豁免 / 先攻的影响。豁免只受：瘫痪等的力量敏捷自动失败、束缚的敏捷劣势、闪避的敏捷优势、
 * 力竭 3；中毒和恐惧只管攻击和属性检定，不管豁免。
 */
export function rollDerivation(
  conditions: string[],
  kind: Exclude<RollKind, 'attack'>,
  ability?: string,
  exhaustion = 0
): RollDerivation {
  const sources: Advantage[] = [];
  const notes: string[] = [];
  if (kind === 'saving_throw') {
    const failed = has(conditions, AUTO_FAIL_STR_DEX);
    if ((ability === 'str' || ability === 'dex') && failed) {
      return { advantage: 'none', sources: [], autoFail: true, notes: [`${failed}：${ability.toUpperCase()} 豁免自动失败`] };
    }
    if (ability === 'dex' && has(conditions, ['restrained'])) {
      sources.push('dis');
      notes.push('束缚：敏捷豁免劣势');
    }
    if (ability === 'dex' && has(conditions, [DODGING]) && !isIncapacitated(conditions)) {
      sources.push('adv');
      notes.push('闪避：敏捷豁免优势');
    }
  } else {
    const down = has(conditions, CHECK_DISADVANTAGE);
    if (down) {
      sources.push('dis');
      notes.push(`${down}：属性检定劣势`);
    }
  }
  const ex = exhaustionRollState(exhaustion, kind);
  if (ex.advantage !== 'none') {
    sources.push(ex.advantage);
    if (ex.note) notes.push(ex.note);
  }
  return { advantage: mergeAdvantage(sources), sources, autoFail: false, notes };
}

// ---- 力竭（2014）：1 检定劣势；2 速度减半；3 攻击和豁免劣势；4 HP 上限减半；5 速度 0；6 死亡 ----

export function exhaustionSpeed(level: number, baseSpeed: number): number {
  if (level >= 5) return 0;
  if (level >= 2) return Math.floor(baseSpeed / 2);
  return baseSpeed;
}

export function exhaustionMaxHp(level: number, maxHp: number): number {
  return level >= 4 ? Math.max(1, Math.floor(maxHp / 2)) : maxHp;
}

export function exhaustionRollState(level: number, kind: RollKind): { advantage: Advantage; note: string | null } {
  if (level >= 3 && (kind === 'saving_throw' || kind === 'attack')) {
    return { advantage: 'dis', note: `力竭 ${level} 级：${kind === 'attack' ? '攻击检定' : '豁免'}劣势` };
  }
  if (level >= 1 && (kind === 'skill_check' || kind === 'ability_check' || kind === 'initiative')) {
    return { advantage: 'dis', note: `力竭 ${level} 级：属性检定劣势` };
  }
  return { advantage: 'none', note: null };
}

/** 状态 + 力竭 + 基础速度 → 实际速度（尺）。不含疾走。 */
export function effectiveSpeed(conditions: string[], baseSpeed: number, exhaustion = 0): number {
  if (has(conditions, SPEED_ZERO)) return 0;
  return exhaustionSpeed(exhaustion, baseSpeed);
}
