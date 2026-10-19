/**
 * Small helpers shared by the tools. No Atlas knowledge here on purpose.
 */

/** Removes functions, breaks cycles, bounds depth/size so any store snapshot is JSON-safe. */
export function sanitize(value: unknown, maxDepth = 6, maxItems = 500): unknown {
  const seen = new WeakSet<object>();
  const walk = (v: unknown, d: number): unknown => {
    if (typeof v === 'function' || typeof v === 'symbol' || v === undefined) return undefined;
    if (v === null || typeof v !== 'object') return typeof v === 'bigint' ? v.toString() : v;
    if (seen.has(v as object)) return '[circular]';
    if (d >= maxDepth) return Array.isArray(v) ? `[array(${v.length})]` : '[object]';
    seen.add(v as object);
    if (v instanceof Map) return walk(Object.fromEntries(v), d);
    if (v instanceof Set) return walk([...v], d);
    if (Array.isArray(v)) {
      const out = v.slice(0, maxItems).map((x) => walk(x, d + 1) ?? null);
      if (v.length > maxItems) out.push(`[+${v.length - maxItems} more]`);
      return out;
    }
    const out: Record<string, unknown> = {};
    let n = 0;
    for (const [k, x] of Object.entries(v as object)) {
      const w = walk(x, d + 1);
      if (w === undefined) continue;
      if (++n > maxItems) { out['…'] = 'truncated'; break; }
      out[k] = w;
    }
    return out;
  };
  return walk(value, 0);
}

/** `a.b.0.c` lookup, used by atlas_get_scene. */
export function getPath(obj: unknown, path: string): unknown {
  if (!path) return obj;
  let cur: any = obj;
  for (const seg of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[seg];
  }
  return cur;
}

let counter = 0;
/** Locally unique enough for one renderer: time + counter + a little randomness. */
export function localId(prefix: string): string {
  counter = (counter + 1) % 1_000_000;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export interface RolledPart {
  term: string;
  rolls?: number[];
  kept?: number[];
  subtotal: number;
}

export interface RollOutcome {
  formula: string;
  total: number;
  /* The dice as Atlas' dice log wants them (tools/diceFormula.ts `RolledDie`). */
  dice: { die: string; value: number; max: number; dropped?: true; negative?: true }[];
  modifiers: number;
  parts: RolledPart[];
}

const TERM = /^[+-]?(\d*d\d+(?:k[hl]\d+)?|\d+)$/;

/**
 * Dice are rolled HERE, in code, so an LLM cannot invent a result.
 *
 * Grammar (a subset of Atlas' own, which the log then renders): `[+-]?NdM` with optional
 * `kh/kl N`, or a constant. `2d20kh1+5-1d4` is fine. Anything else is rejected loudly.
 */
export function rollFormula(formula: string, rng: () => number = Math.random): RollOutcome {
  const clean = formula.replace(/\s+/g, '').toLowerCase();
  if (!clean) throw new Error('Empty dice formula');
  if (clean.length > 64) throw new Error('Dice formula too long (max 64 characters)');
  const terms = clean.match(/[+-]?[^+-]+/g) ?? [];
  // A trailing or doubled operator would otherwise be dropped silently ("2d6+" would roll 2d6).
  if (terms.join('') !== clean) throw new Error(`Malformed dice formula: ${formula}`);
  if (terms.length > 10) throw new Error('Too many dice terms (max 10)');
  let total = 0;
  const parts: RolledPart[] = [];
  const dice: RollOutcome['dice'] = [];
  let modifiers = 0;
  for (const term of terms) {
    if (!TERM.test(term)) throw new Error(`Unsupported dice term "${term}" in "${formula}"`);
    const sign = term.startsWith('-') ? -1 : 1;
    const body = term.replace(/^[+-]/, '');
    const m = body.match(/^(\d*)d(\d+)(?:k([hl])(\d+))?$/);
    if (!m) {
      const n = Number(body) * sign;
      total += n;
      modifiers += n;
      parts.push({ term, subtotal: n });
      continue;
    }
    const count = Number(m[1] || 1);
    const sides = Number(m[2]);
    if (count < 1 || count > 100) throw new Error('Dice count must be 1..100');
    if (sides < 1 || sides > 1000) throw new Error('Dice faces must be 1..1000');
    const rolls = Array.from({ length: count }, () => 1 + Math.floor(rng() * sides));
    let keep: boolean[] = rolls.map(() => true);
    if (m[3]) {
      const k = Math.max(1, Math.min(count, Number(m[4])));
      const ordered = rolls.map((v, i) => ({ v, i })).sort((a, b) => (m[3] === 'h' ? b.v - a.v : a.v - b.v));
      const kept = new Set(ordered.slice(0, k).map((x) => x.i));
      keep = rolls.map((_, i) => kept.has(i));
    }
    const kept = rolls.filter((_, i) => keep[i]);
    const subtotal = sign * kept.reduce((a, b) => a + b, 0);
    total += subtotal;
    parts.push({ term, rolls, kept, subtotal });
    rolls.forEach((value, i) => dice.push({
      die: `d${sides}`,
      value,
      max: sides,
      ...(keep[i] ? {} : { dropped: true as const }),
      ...(sign < 0 ? { negative: true as const } : {}),
    }));
  }
  return { formula: clean, total, dice, modifiers, parts };
}
