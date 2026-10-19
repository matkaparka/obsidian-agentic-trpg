// 怪物多攻：一次“攻击”动作里按套路打出哪些攻击。
//
// 改写自 Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman）
// 的 src/lib/dm/enemy-profile.ts 的 plannedSwings。见 ../NOTICE.md。

import type { AttackDef, RoutineStep } from '../types.js';

const norm = (s: string): string => s.replace(/[（(][^）)]*[）)]/g, '').replace(/\s+/g, '').toLowerCase();

const raw = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

export function findAttack(attacks: AttackDef[], wanted: string): AttackDef | null {
  const key = norm(wanted);
  if (!key) return null;
  const name = (a: AttackDef) => norm(a.name ?? a.weaponId ?? '');
  // 先按原文整句精确匹配（“匕首”和“匕首（投掷）”是两个攻击），再去掉括号匹配
  const exact = attacks.find((a) => raw(a.name ?? a.weaponId ?? '') === raw(wanted));
  if (exact) return exact;
  return (
    attacks.find((a) => name(a) === key) ??
    attacks.find((a) => name(a).includes(key)) ??
    attacks.find((a) => key.includes(name(a)) && name(a).length > 0) ??
    null
  );
}

function expand(routine: RoutineStep[], attacks: AttackDef[]): AttackDef[] {
  return routine.flatMap((step) => {
    const found = findAttack(attacks, step.attack);
    if (!found) return [];
    const def: AttackDef = step.ifHit ? { ...found, onlyIfHit: true } : found;
    return new Array<AttackDef>(Math.max(1, Math.min(10, step.count))).fill(def);
  });
}

/**
 * 一次“攻击”动作打出的攻击，按顺序。有套路就走包含所问攻击的那个套路（没问就走第一个）；
 * 套路里没有的攻击就是单独一击（传奇动作的攻击那样）；没有套路就用 count 次所问的攻击。
 */
export function plannedSwings(
  attacks: AttackDef[],
  routines: RoutineStep[][] | undefined,
  requested: string | undefined,
  count = 1,
  options: { single?: boolean } = {}
): AttackDef[] {
  if (!attacks.length) return [];
  const asked = requested ? findAttack(attacks, requested) : null;
  if (options.single) return [asked ?? attacks[0]];
  const expanded = (routines ?? []).map((r) => expand(r, attacks)).filter((s) => s.length);
  if (expanded.length) {
    if (!asked) return expanded[0];
    const holding = expanded.find((swings) => swings.some((s) => s.name === asked.name && s.weaponId === asked.weaponId));
    return holding ?? [asked];
  }
  const n = Math.max(1, Math.min(10, Math.floor(count)));
  return new Array<AttackDef>(n).fill(asked ?? attacks[0]);
}

/** 一个 Attack 动作最多几击：套路里最长的，或 attacksPerAction。 */
export function swingsPerAction(
  attacks: AttackDef[],
  routines: RoutineStep[][] | undefined,
  attacksPerAction = 1
): number {
  const longest = Math.max(0, ...(routines ?? []).map((r) => expand(r, attacks).length));
  return Math.max(1, longest, Math.floor(attacksPerAction));
}
