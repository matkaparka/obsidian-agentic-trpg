// 经验值：SRD 5.1 / PHB 的「CR → XP」和「等级门槛」。数值是公开的规则数字，不是 WotC 的表述。

/** 挑战等级 → 击败一只怪物的经验值（CR 0 取 10；CR 30 以上不收） */
const XP_BY_CR: readonly (readonly [cr: number, xp: number])[] = [
  [0, 10],
  [0.125, 25],
  [0.25, 50],
  [0.5, 100],
  [1, 200],
  [2, 450],
  [3, 700],
  [4, 1100],
  [5, 1800],
  [6, 2300],
  [7, 2900],
  [8, 3900],
  [9, 5000],
  [10, 5900],
  [11, 7200],
  [12, 8400],
  [13, 10000],
  [14, 11500],
  [15, 13000],
  [16, 15000],
  [17, 18000],
  [18, 20000],
  [19, 22000],
  [20, 25000],
  [21, 33000],
  [22, 41000],
  [23, 50000],
  [24, 62000],
  [25, 75000],
  [26, 90000],
  [27, 105000],
  [28, 120000],
  [29, 135000],
  [30, 155000],
];

/** 到达第 N 级所需的总经验值（下标 = 等级 - 1） */
export const LEVEL_XP: readonly number[] = [
  0, 300, 900, 2700, 6500, 14000, 23000, 34000, 48000, 64000, 85000, 100000, 120000, 140000, 165000, 195000, 225000, 265000, 305000, 355000,
];

export const MAX_LEVEL = LEVEL_XP.length;

/** 一只怪物值多少经验；CR 不在表里（比如 0.75）取不超过它的最近一档 */
export function xpForCr(cr: number): number {
  let xp = 0;
  for (const [c, x] of XP_BY_CR) {
    if (c <= cr) xp = x;
    else break;
  }
  return xp;
}

/** 到达这个等级所需的总经验值（1 级 0；超出 1–20 的按边界算） */
export function xpForLevel(level: number): number {
  return LEVEL_XP[Math.max(1, Math.min(MAX_LEVEL, Math.floor(level))) - 1];
}

/** 这么多经验值对应几级（最高 20） */
export function levelForXp(xp: number): number {
  let level = 1;
  for (let i = 0; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) level = i + 1;
  return level;
}

/** 升到下一级还差多少总经验；已经 20 级返回 null */
export function nextLevelXp(level: number): number | null {
  return level >= MAX_LEVEL ? null : LEVEL_XP[level];
}

export interface XpDefeated {
  id: string;
  name: string;
  cr: number;
  xp: number;
}

export interface XpGain {
  actorId: string;
  name: string;
  /** 这次分到多少 */
  gained: number;
  /** 分完之后的总经验值 */
  total: number;
  /** 分之前的等级 */
  level: number;
  /** 总经验值对应的等级；比 level 大就该升级了 */
  reachedLevel: number;
}

export interface XpAward {
  /** 为什么发：「击败 地精、地精」或 GM 给的理由 */
  reason: string;
  /** 总共多少，平分前 */
  total: number;
  /** 每个人分到的（向下取整，零头不发） */
  share: number;
  defeated: XpDefeated[];
  gains: XpGain[];
}
