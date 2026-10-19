// 汇总一次跑团运行的指标：turn 数、renderer 超时/依据率、GM 工具调用、token/缓存。
// 用法：node scripts/run-stats.mjs [logsDir]
import { readFileSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2] ?? 'logs';
const since = process.argv[3] ? Date.parse(process.argv[3]) : 0;
const outPath = process.argv[4] && !process.argv[4].startsWith('--') ? process.argv[4] : '';
const tablePath = join(dir, 'table.jsonl');
const usagePath = join(dir, 'usage.jsonl');
if (!existsSync(tablePath)) {
  console.error(`no ${tablePath}`);
  process.exit(2);
}
const rows = readFileSync(tablePath, 'utf8')
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
  .filter((r) => !since || Date.parse(r.at) >= since);

const playerTurns = rows.filter((r) => r.kind === 'player_turn');
const gmTurns = rows.filter((r) => r.kind === 'gm_turn');
const renderers = playerTurns.map((r) => r.rendererMeta ?? {});
const ok = renderers.filter((r) => r.ok);
const timeout = renderers.filter((r) => r.reason === 'timeout');
const grounded = playerTurns.filter((r) => (r.renderer?.beats?.length ?? 0) > 0);
const dropped = renderers.reduce((s, r) => s + (r.droppedBeats ?? 0), 0);
const lat = renderers.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
const p = (q) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor((lat.length - 1) * q))] : 0);
const playerLat = playerTurns.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
const gmLat = gmTurns.map((r) => r.latencyMs ?? 0).sort((a, b) => a - b);
const calls = {};
for (const g of gmTurns) for (const c of g.toolCalls ?? []) calls[c.name] = (calls[c.name] ?? 0) + 1;

const usage = existsSync(usagePath)
  ? readFileSync(usagePath, 'utf8')
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
      .filter((u) => !since || Date.parse(u.at) >= since)
  : [];
const byModel = {};
for (const u of usage) {
  const k = `${u.provider}:${u.model}`;
  byModel[k] ??= { calls: 0, input: 0, cacheRead: 0, output: 0 };
  byModel[k].calls += 1;
  byModel[k].input += u.inputTokens ?? 0;
  byModel[k].cacheRead += u.cacheReadTokens ?? 0;
  byModel[k].output += u.outputTokens ?? 0;
}

const pct = (n, d) => (d ? `${Math.round((n / d) * 100)}%` : '0%');
const report = {
  playerTurns: playerTurns.length,
  gmTurns: gmTurns.length,
  renderer: {
    ok: ok.length,
    timeout: timeout.length,
    grounded: grounded.length,
    groundedRate: pct(grounded.length, playerTurns.length),
    timeoutRate: pct(timeout.length, playerTurns.length),
    droppedBeats: dropped,
    latencyMs: { p50: p(0.5), p90: p(0.9), max: lat.at(-1) ?? 0 },
  },
  playerLatencyMs: { p50: playerLat[Math.floor(playerLat.length / 2)] ?? 0, max: playerLat.at(-1) ?? 0 },
  gmLatencyMs: { p50: gmLat[Math.floor(gmLat.length / 2)] ?? 0, max: gmLat.at(-1) ?? 0 },
  gmToolCalls: calls,
  usageByModel: byModel,
};
const text = JSON.stringify(report, null, 2);
console.log(text);
if (outPath) writeFileSync(outPath, text, 'utf8');
