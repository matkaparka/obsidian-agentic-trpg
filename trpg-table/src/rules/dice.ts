import { randomInt } from 'node:crypto';
import type { DieRoll, RollOutcome, RollRequest, RollSource } from './types.js';

export type Rng = () => number;

/** 可复现的伪随机（测试 / 回放用） */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 默认熵源：crypto，避免 Math.random 的可预测性 */
export const cryptoRng: Rng = () => randomInt(0, 2 ** 32) / 2 ** 32;

const TERM = /^[+-]?(\d*)d(\d+)(?:k([hl])(\d+))?$/i;

export interface ParsedRoll {
  dice: DieRoll[];
  modifiers: number;
  total: number;
  formula: string;
}

/** 解析并掷骰。支持 "1d20+5"、"2d20kh1+3"、"3d6"、"1d20-1d4"、"2d6+1d4+3"。 */
export function rollFormula(formula: string, rng: Rng): ParsedRoll {
  const clean = formula.replace(/\s+/g, '').toLowerCase();
  if (!clean) throw new Error('空的骰子公式');
  if (clean.length > 64) throw new Error('骰子公式太长（最多 64 字符）');
  const terms = clean.match(/[+-]?[^+-]+/g) ?? [];
  if (terms.join('') !== clean) throw new Error(`骰子公式格式不对：${formula}`);
  if (terms.length > 10) throw new Error('骰子项太多（最多 10 项）');
  if (!/^[+-]?\d/.test(terms[0] ?? '')) throw new Error(`骰子公式格式不对：${formula}`);

  const dice: DieRoll[] = [];
  let modifiers = 0;

  for (const term of terms) {
    const m = TERM.exec(term);
    if (!m) {
      if (!/^[+-]?\d+$/.test(term)) throw new Error(`不支持的骰子项「${term}」`);
      modifiers += Number(term);
      continue;
    }
    const sign = term.startsWith('-') ? -1 : 1;
    const count = Number(m[1] || 1);
    const sides = Number(m[2]);
    if (count < 1 || count > 100) throw new Error('骰子个数必须在 1..100');
    if (sides < 1 || sides > 1000) throw new Error('骰子面数必须在 1..1000');
    const values = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
    const keep = values.map(() => true);
    if (m[3]) {
      const k = Math.max(1, Math.min(count, Number(m[4])));
      const ordered = values.map((v, i) => ({ v, i })).sort((a, b) => (m[3] === 'h' ? b.v - a.v : a.v - b.v));
      const kept = new Set(ordered.slice(0, k).map((x) => x.i));
      for (let i = 0; i < keep.length; i++) keep[i] = kept.has(i);
    }
    for (let i = 0; i < values.length; i++) {
      dice.push({ sides, value: values[i], kept: keep[i] });
      if (keep[i]) modifiers += values[i] * sign;
    }
  }

  const total = modifiers;
  return { dice, modifiers, total, formula: clean };
}

export function diceTotal(dice: DieRoll[]): number {
  return dice.filter((d) => d.kept).reduce((s, d) => s + d.value, 0);
}

/** 一次 d20 的原始点数（优势/劣势取保留的那颗） */
export function d20Natural(dice: DieRoll[]): number | null {
  const d20 = dice.filter((d) => d.sides === 20);
  if (!d20.length) return null;
  const kept = d20.filter((d) => d.kept);
  if (!kept.length) return d20[0].value;
  return Math.max(...kept.map((d) => d.value));
}

export class LocalRollSource implements RollSource {
  readonly name = 'local';
  constructor(private readonly rng: Rng = cryptoRng) {}

  async roll(req: RollRequest): Promise<RollOutcome> {
    const parsed = rollFormula(req.formula, this.rng);
    return {
      formula: parsed.formula,
      dice: parsed.dice,
      modifiers: parsed.modifiers,
      total: parsed.total,
      source: this.name,
    };
  }
}

/** "2d6" -> "4d6"；"1d8+3" -> "2d8+3"（暴击翻倍伤害骰，不翻倍加值） */
export function doubleDiceFormula(formula: string): string {
  return formula.replace(/(\d*)d(\d+)/gi, (_, n: string, sides: string) => `${Number(n || 1) * 2}d${sides}`);
}

/** "1d8+3" 的期望值，给 legalActions 显示用 */
export function formulaAverage(formula: string): number {
  const clean = formula.replace(/\s+/g, '').toLowerCase();
  const terms = clean.match(/[+-]?[^+-]+/g) ?? [];
  let sum = 0;
  for (const term of terms) {
    const m = TERM.exec(term);
    if (!m) {
      if (/^[+-]?\d+$/.test(term)) sum += Number(term);
      continue;
    }
    const sign = term.startsWith('-') ? -1 : 1;
    const count = Number(m[1] || 1);
    const sides = Number(m[2]);
    sum += sign * count * ((sides + 1) / 2);
  }
  return Math.round(sum * 10) / 10;
}
