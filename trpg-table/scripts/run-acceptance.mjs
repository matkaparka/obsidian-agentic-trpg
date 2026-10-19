// 15-minute acceptance run helper.
// - unpauses trpg-table through helixus-link :8098
// - every 5 s runs check-overlay.mjs (text clipping, map overlap, face occlusion, map geometry)
// - archives frame_check records written by atlas_move_token
// - finds at least one player move whose input view used landmarks, and verifies the move
//   event's target cell matches the decision's cell
// Usage: node scripts/run-acceptance.mjs --minutes 15 [--out docs/checks/acceptance.json]
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const minutes = Number(opt('--minutes', '15'));
const outPath = opt('--out', path.join(ROOT, 'docs', 'checks', `acceptance-${new Date().toISOString().replace(/[:.]/g, '-')}.json`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
mkdirSync(path.dirname(outPath), { recursive: true });

async function status() {
  try {
    const r = await fetch('http://127.0.0.1:8098/status', { headers: { host: '127.0.0.1:8098' } });
    return await r.json();
  } catch {
    return null;
  }
}

async function pause(paused) {
  try {
    const r = await fetch('http://127.0.0.1:8098/pause', {
      method: 'POST',
      headers: { 'content-type': 'application/json', host: '127.0.0.1:8098' },
      body: JSON.stringify({ paused }),
    });
    return { status: r.status, body: await r.text() };
  } catch (e) {
    return { error: e?.message ?? String(e) };
  }
}

function readTableLog() {
  const file = path.join(ROOT, 'logs', 'table.jsonl');
  if (!existsSync(file)) return [];
  const out = [];
  for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      /* half-written line at the tail */
    }
  }
  return out;
}

const started = Date.now();
const deadline = started + minutes * 60_000;
const checks = [];
const statuses = [];
const initialPause = await pause(false);
console.log(`[acceptance] unpause -> ${JSON.stringify(initialPause)}; run ${minutes} min`);

let lastLogAt = 0;
while (Date.now() < deadline) {
  const run = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-overlay.mjs'), '--wait', '4'], {
    encoding: 'utf8',
    timeout: 20_000,
  });
  let parsed = null;
  try {
    parsed = JSON.parse(run.stdout);
  } catch {
    parsed = null;
  }
  const st = await status();
  const item = {
    at: new Date().toISOString(),
    ok: run.status === 0 && parsed?.ok !== false,
    status: st ? { paused: st.paused, phase: st.table?.phase, round: st.table?.round, turn: st.table?.turn, scene: st.table?.scene } : null,
    failures: parsed?.failures ?? [run.stderr?.slice(0, 500) ?? null].filter(Boolean),
    panels: parsed?.overflowPanels?.length ?? null,
    overlaps: parsed?.overlappingPanels?.length ?? null,
    faceObscured: parsed?.faceObscured?.length ?? null,
    mapMatches: parsed?.mapMatches ?? null,
  };
  checks.push(item);
  if (st) statuses.push({ at: item.at, ...item.status });
  if (!item.ok) console.log(`[acceptance] CHECK FAIL ${JSON.stringify(item.failures)}`);
  else if (checks.length % 12 === 0) console.log(`[acceptance] ${checks.length} checks OK; phase=${item.status?.phase} round=${item.status?.round} turn=${item.status?.turn}`);
  await sleep(5000);
}

const pauseResult = await pause(true);
const logs = readTableLog().filter((l) => l.at && Date.parse(l.at) >= started - 60_000);
const frameChecks = logs.filter((l) => l.kind === 'frame_check');
const moves = logs.filter((l) => l.kind === 'move');
const playerTurns = logs.filter((l) => l.kind === 'player_turn' && l.decision?.action?.cell);
const landmarkMoves = [];
for (const turn of playerTurns) {
  const cell = turn.decision.action.cell;
  const turnAt = Date.parse(turn.at);
  const sameCellMoves = moves.filter(
    (m) => m.to?.col === cell.col && m.to?.row === cell.row && Date.parse(m.at) >= turnAt - 1000 && Date.parse(m.at) <= turnAt + 90_000
  );
  const usedLandmark = /地标|货舱口|桅杆|货箱|船舷|左舷|右舷|船尾|尺/.test(String(turn.inputView ?? ''));
  if (sameCellMoves.length && usedLandmark) {
    landmarkMoves.push({
      seat: turn.seat,
      cell,
      move: sameCellMoves[0].text,
      inputUsedLandmark: true,
      action: turn.decision.action,
    });
  }
}
const failures = checks.filter((c) => !c.ok);
const report = {
  at: new Date().toISOString(),
  startedAt: new Date(started).toISOString(),
  minutes,
  pausedAtEnd: pauseResult,
  checks: { total: checks.length, ok: checks.length - failures.length, failed: failures.length, failures: failures.slice(0, 20) },
  frameChecks: {
    total: frameChecks.length,
    updated: frameChecks.filter((f) => f.updated).length,
    failed: frameChecks.filter((f) => f.updated === false),
    latencyMs: frameChecks.filter((f) => typeof f.latencyMs === 'number').map((f) => f.latencyMs).sort((a, b) => a - b),
  },
  moves: { total: moves.length, sample: moves.slice(-8) },
  landmarkMoves,
  statuses: statuses.slice(-20),
  lastChecks: checks.slice(-10),
};
writeFileSync(outPath, JSON.stringify(report, null, 2));
console.log(`[acceptance] done: ${report.checks.ok}/${report.checks.total} checks ok; frameChecks ${report.frameChecks.updated}/${report.frameChecks.total} updated; landmarkMoves=${landmarkMoves.length}`);
console.log(`[acceptance] report: ${outPath}`);
if (report.checks.failed || report.frameChecks.failed.length || !landmarkMoves.length) process.exitCode = 1;
