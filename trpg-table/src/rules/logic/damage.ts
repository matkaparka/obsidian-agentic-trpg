// 抗性 / 易伤 / 免疫对伤害数字的作用。
//
// 改写自 Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman）
// 的 src/lib/dm/damage-logic.ts 的 damageAdjust。见 ../NOTICE.md。

import type { DamageType } from '../types.js';

export const PHYSICAL_TYPES: DamageType[] = ['bludgeoning', 'piercing', 'slashing'];

export interface DamageDefenses {
  resistances: DamageType[];
  vulnerabilities: DamageType[];
  immunities: DamageType[];
  /** 只对非魔法攻击生效的抗性（只有三种物理伤害会是有条件的） */
  resistancesNonmagical?: DamageType[];
}

export interface DamageAdjustOptions {
  /** 来自法术、魔法武器，或视为魔法的攻击：“非魔法”条件不适用 */
  magical?: boolean;
  /** 对一切类型抗性（石化） */
  resistAll?: boolean;
}

/**
 * 免疫 = 0，且优先于另外两个。抗性减半（向下取整，没有下限）；易伤翻倍。
 * 同时有抗性和易伤时先减半再翻倍（SRD 5.1）：25 → 12 → 24。
 */
export function damageAdjust(
  amount: number,
  type: DamageType,
  defenses: DamageDefenses,
  options: DamageAdjustOptions = {}
): { amount: number; note: string | null } {
  if (defenses.immunities.includes(type)) return { amount: 0, note: `免疫${type}伤害：无伤害` };
  const conditional =
    !options.magical && PHYSICAL_TYPES.includes(type) && (defenses.resistancesNonmagical ?? []).includes(type);
  const resisted = options.resistAll === true || defenses.resistances.includes(type) || conditional;
  const vulnerable = defenses.vulnerabilities.includes(type);
  if (resisted && vulnerable) return { amount: Math.floor(amount / 2) * 2, note: `既抗性又易伤${type}：先减半再翻倍` };
  if (resisted) return { amount: Math.floor(amount / 2), note: `抗性${type}：减半` };
  if (vulnerable) return { amount: amount * 2, note: `易伤${type}：翻倍` };
  return { amount, note: null };
}
