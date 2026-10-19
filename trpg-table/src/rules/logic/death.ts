// 5e 死亡豁免的纯逻辑：重伤即死、0 HP 再受伤、死亡豁免掷骰结果、稳定。
//
// 改写自 Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman）
// 的 src/lib/dm/death-logic.ts 与 vitals-logic.ts。见 ../NOTICE.md。

export interface DeathTrack {
  successes: number;
  failures: number;
  stable: boolean;
  dead: boolean;
}

export const freshDeathTrack = (): DeathTrack => ({ successes: 0, failures: 0, stable: false, dead: false });

/** 稳定：不再掷死亡豁免，成功/失败计数清零。不管怎么稳定的（第三次成功、医药检定、维稳术）。 */
export const stableDeathTrack = (): DeathTrack => ({ successes: 0, failures: 0, stable: true, dead: false });

/** 即死：把角色打到 0 的那一击，溢出的伤害 ≥ 最大 HP（SRD 5.1，Instant Death）。 */
export function isMassiveDamage(overkill: number, maxHp: number): boolean {
  return overkill >= Math.max(1, maxHp);
}

/**
 * 已经在 0 HP 时再受伤：自动记 1 次失败（暴击 2 次）；稳定的角色重新开始濒死。
 */
export function onDamageAtZero(track: DeathTrack, crit: boolean): DeathTrack {
  if (track.dead) return track;
  const failures = Math.min(3, track.failures + (crit ? 2 : 1));
  return { ...track, stable: false, failures, dead: failures >= 3 };
}

export type DeathSaveOutcome = 'revive' | 'success' | 'stable' | 'failure' | 'dead';

/**
 * 一次死亡豁免：自然 20 在 1 HP 醒来；自然 1 算 2 次失败；总值 ≥10 成功（三次成功稳定）；
 * 否则失败（三次失败死亡）。1 和 20 看自然点数，10 看总值（祝福术、圣武士灵光会改总值）。
 */
export function applyDeathSaveRoll(
  track: DeathTrack,
  natural: number,
  total: number = natural
): { track: DeathTrack; outcome: DeathSaveOutcome } {
  if (track.dead || track.stable) {
    return { track, outcome: track.dead ? 'dead' : 'stable' };
  }
  if (natural === 20) return { track: freshDeathTrack(), outcome: 'revive' };
  if (natural === 1) {
    const failures = Math.min(3, track.failures + 2);
    const next = { ...track, failures, dead: failures >= 3 };
    return { track: next, outcome: next.dead ? 'dead' : 'failure' };
  }
  if (total >= 10) {
    const successes = Math.min(3, track.successes + 1);
    if (successes >= 3) return { track: stableDeathTrack(), outcome: 'stable' };
    return { track: { ...track, successes }, outcome: 'success' };
  }
  const failures = Math.min(3, track.failures + 1);
  const next = { ...track, failures, dead: failures >= 3 };
  return { track: next, outcome: next.dead ? 'dead' : 'failure' };
}

export function describeTrack(track: DeathTrack): string {
  if (track.dead) return '死亡';
  if (track.stable) return '已稳定（昏迷，0 HP）';
  return `濒死：${track.successes} 次成功，${track.failures} 次失败`;
}

/** 稳定的生物 1d4 小时后恢复 1 点 HP（SRD 5.1，Stabilizing a Creature）。 */
export const STABILIZE_DC = 10;
