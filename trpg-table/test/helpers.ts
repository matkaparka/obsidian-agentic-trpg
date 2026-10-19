import type { DieRoll, RollOutcome, RollRequest, RollSource } from '../src/rules/types.js';

/**
 * 测试用：按预设的 d20 点数掷骰，其它骰子取最大值。
 * 这样攻击/豁免/检定的结果完全可预期，同时仍然走引擎的真实结算路径。
 */
export class ScriptedRollSource implements RollSource {
  readonly name = 'scripted';
  /** 依次消费的 d20 点数（优势/劣势会一次消费两个） */
  d20: number[] = [];
  /** 非 d20 骰子用最大值（默认 true） */
  maxOtherDice = true;
  calls: RollRequest[] = [];

  async roll(req: RollRequest): Promise<RollOutcome> {
    this.calls.push(req);
    const clean = req.formula.replace(/\s+/g, '').toLowerCase();
    const terms = clean.match(/[+-]?[^+-]+/g) ?? [];
    const dice: DieRoll[] = [];
    let modifiers = 0;

    for (const term of terms) {
      const m = /^([+-]?)(\d*)d(\d+)(?:k([hl])(\d+))?$/.exec(term);
      if (!m) {
        if (/^[+-]?\d+$/.test(term)) modifiers += Number(term);
        continue;
      }
      const sign = m[1] === '-' ? -1 : 1;
      const count = Number(m[2] || 1);
      const sides = Number(m[3]);
      const values: number[] = [];
      for (let i = 0; i < count; i++) {
        if (sides === 20) {
          values.push(this.d20.shift() ?? 10);
        } else {
          values.push(this.maxOtherDice ? sides : 1);
        }
      }
      const keep = values.map(() => true);
      if (m[4]) {
        const k = Math.max(1, Math.min(count, Number(m[5])));
        const ordered = values.map((v, i) => ({ v, i })).sort((a, b) => (m[4] === 'h' ? b.v - a.v : a.v - b.v));
        const kept = new Set(ordered.slice(0, k).map((x) => x.i));
        for (let i = 0; i < keep.length; i++) keep[i] = kept.has(i);
      }
      for (let i = 0; i < values.length; i++) {
        dice.push({ sides, value: values[i], kept: keep[i] });
        if (keep[i]) modifiers += values[i] * sign;
      }
    }
    return { formula: clean, dice, modifiers, total: modifiers, source: this.name };
  }
}
