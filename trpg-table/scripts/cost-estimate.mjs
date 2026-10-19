// 按 logs/usage.jsonl 的真实调用量估算费用。价格是公开标价（美元 / 百万 token），
// 不是账单；模型别名（claude-sonnet-5-5 等）按同代常见价位假设，改这里就能重算。
// 用法：node scripts/cost-estimate.mjs [logsDir] [sinceISO] [untilISO]
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const outPath = (() => {
  const i = args.indexOf('--out');
  return i >= 0 && i + 1 < args.length ? args[i + 1] : '';
})();
const dir = args[0] ?? 'logs';
const since = args[1] ? Date.parse(args[1]) : 0;
const until = args[2] ? Date.parse(args[2]) : Date.now();
const path = join(dir, 'usage.jsonl');
if (!existsSync(path)) {
  console.error(`no ${path}`);
  process.exit(2);
}

// USD per 1M tokens.
const PRICES = {
  // Claude Sonnet 系列（3 / 15；缓存读 0.1x，缓存写 1.25x）
  anthropic: { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  // DeepSeek reasoner / chat 官方标价（cache miss / output）
  deepseek: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  // Gemini Flash 量级
  gemini: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 },
};

const rows = readFileSync(path, 'utf8')
  .trim()
  .split(/\n/)
  .filter(Boolean)
  .map((l) => {
    try {
      return JSON.parse(l);
    } catch {
      return null;
    }
  })
  .filter(Boolean)
  .filter((r) => {
    const at = Date.parse(r.at);
    return at >= since && at <= until;
  });

const agg = {};
for (const r of rows) {
  if (!r.ok) continue;
  const provider = String(r.provider ?? '');
  const key = `${provider}:${r.model}`;
  agg[key] ??= { calls: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, price: PRICES[provider] ?? { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const a = agg[key];
  a.calls += 1;
  a.input += r.inputTokens ?? 0;
  a.output += r.outputTokens ?? 0;
  a.cacheRead += r.cacheReadTokens ?? 0;
  a.cacheWrite += r.cacheWriteTokens ?? 0;
}

const usd = (n) => `$${n.toFixed(4)}`;
let total = 0;
const out = [];
for (const [key, a] of Object.entries(agg).sort((x, y) => y[1].calls - x[1].calls)) {
  const cost =
    (a.input / 1e6) * a.price.input +
    (a.output / 1e6) * a.price.output +
    (a.cacheRead / 1e6) * a.price.cacheRead +
    (a.cacheWrite / 1e6) * a.price.cacheWrite;
  total += cost;
  out.push({
    model: key,
    calls: a.calls,
    input: a.input,
    cacheRead: a.cacheRead,
    cacheWrite: a.cacheWrite,
    output: a.output,
    usd: +cost.toFixed(4),
  });
}
const minutes = since ? Math.max(0.01, (Math.min(until, Date.now()) - since) / 60000) : 0;
const report = {
  window: { since: since ? new Date(since).toISOString() : 'all', until: new Date(until).toISOString(), minutes: +minutes.toFixed(1) },
  byModel: out,
  totalUsd: +total.toFixed(4),
  perHourUsd: minutes ? +(total * (60 / minutes)).toFixed(2) : null,
  pricingUsdPerMTok: PRICES,
  note: '公开标价估算，不是账单；模型别名按同代价位假设。',
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (outPath) writeFileSync(outPath, text, 'utf8');
