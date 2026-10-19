// 格子几何：触及范围的进出（借机攻击）、夹击、遮挡、掩蔽。只用方格坐标，全是纯函数。
//
// leavesReachAt / entersReachAt / isFlanking / squaresBetween 改写自 Open Dungeon Master
// （MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman）的 dm/opportunity.ts、dm/attack-rules.ts、
// dm/attack-spatial.ts；terrainCover 是它 battlemap/los.ts coverBetween 的同一个近似，
// 换成我们的障碍格查询。见 ../NOTICE.md。

import type { GridPos } from '../types.js';

export const chebyshev = (a: GridPos, b: GridPos): number => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

/** 一次走位里，从 reactor 的触及范围里走出去时站的那一格；没走出去就是 null。steps 含起点，按顺序。 */
export function leavesReachAt(steps: GridPos[], reactor: GridPos, reachCells: number): GridPos | null {
  for (let i = 0; i + 1 < steps.length; i++) {
    if (chebyshev(steps[i], reactor) <= reachCells && chebyshev(steps[i + 1], reactor) > reachCells) return steps[i];
  }
  return null;
}

/** 走进触及范围时的第一格（长柄武器大师那种“进入触及”借机用）。 */
export function entersReachAt(steps: GridPos[], reactor: GridPos, reachCells: number): GridPos | null {
  for (let i = 0; i + 1 < steps.length; i++) {
    if (chebyshev(steps[i], reactor) > reachCells && chebyshev(steps[i + 1], reactor) <= reachCells) return steps[i + 1];
  }
  return null;
}

/** 夹击（DMG 可选规则）：能行动的盟友站在目标的正对面，并且都在目标 5 尺内。 */
export function isFlanking(attacker: GridPos, target: GridPos, allies: GridPos[]): boolean {
  if (chebyshev(attacker, target) !== 1) return false;
  const mine = { x: Math.sign(attacker.col - target.col), y: Math.sign(attacker.row - target.row) };
  return allies.some((ally) => {
    if (chebyshev(ally, target) !== 1) return false;
    const theirs = { x: Math.sign(ally.col - target.col), y: Math.sign(ally.row - target.row) };
    return theirs.x === -mine.x && theirs.y === -mine.y;
  });
}

/** 两格之间（不含两端）的连线经过的格子（Bresenham）。 */
export function squaresBetween(from: GridPos, to: GridPos): GridPos[] {
  const out: GridPos[] = [];
  let x = from.col;
  let y = from.row;
  const dx = Math.abs(to.col - from.col);
  const dy = -Math.abs(to.row - from.row);
  const sx = from.col < to.col ? 1 : -1;
  const sy = from.row < to.row ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    if (x === to.col && y === to.row) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      x += sx;
    }
    if (e2 <= dx) {
      err += dx;
      y += sy;
    }
    if (x === to.col && y === to.row) break;
    out.push({ col: x, row: y });
  }
  return out;
}

/**
 * 另一个生物站在连线上 → 目标有半掩蔽（SRD：其它生物也算）。贴身时中间没有格子。
 */
export function creatureCover(attacker: GridPos, target: GridPos, others: GridPos[]): boolean {
  if (chebyshev(attacker, target) <= 1) return false;
  const line = squaresBetween(attacker, target);
  return others.some((o) => line.some((s) => s.col === o.col && s.row === o.row));
}

/**
 * 地形掩蔽：目标正交相邻、且在攻击者这一侧的障碍格，一个 = 半掩蔽（+2），两个（拐角）= 四分之三掩蔽（+5）。
 * 够便宜、可复现，也符合玩家直觉。贴身时没有掩蔽。
 */
export function terrainCover(blocked: (cell: GridPos) => boolean, from: GridPos, to: GridPos): 0 | 2 | 5 {
  if (chebyshev(from, to) <= 1) return 0;
  const towardX = Math.sign(from.col - to.col);
  const towardY = Math.sign(from.row - to.row);
  let shields = 0;
  for (const [dx, dy] of [
    [towardX, 0],
    [0, towardY],
  ] as [number, number][]) {
    if (dx === 0 && dy === 0) continue;
    if (blocked({ col: to.col + dx, row: to.row + dy })) shields += 1;
  }
  if (shields === 0) return 0;
  return shields === 1 ? 2 : 5;
}
