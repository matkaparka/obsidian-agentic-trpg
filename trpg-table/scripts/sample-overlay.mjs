// 连续检查：每 N 秒从主窗口读一次玩家窗口里的 overlay 自检报告（见 check-overlay.mjs），
// 把每次采样写进 jsonl；遇到「新情形」自动截一张玩家窗口的图。
// 新情形 = 出现了没截过的（气泡组合 / 骰子 / 贴边翻转）。
// 用法：node scripts/sample-overlay.mjs --minutes 15 --out docs/checks/v2-live.jsonl --shots docs/shots --prefix v2live
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const minutes = Number(opt('--minutes', '15'));
const intervalMs = Number(opt('--interval', '1000'));
const outPath = opt('--out', 'docs/checks/v2-live.jsonl');
const shotsDir = opt('--shots', 'docs/shots');
const prefix = opt('--prefix', 'v2live');
const maxShots = Number(opt('--max-shots', '40'));
mkdirSync(shotsDir, { recursive: true });

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const main = list.find((t) => t.type === 'page' && /app:\/\/obsidian\.md/.test(t.url));
if (!main) {
  console.error('没有 Obsidian 主窗口。');
  process.exit(2);
}
const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', () => reject(new Error('websocket')), { once: true });
});
let nextId = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
const evaluate = (expression) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, {
      resolve: (r) => (r.exceptionDetails ? reject(new Error(r.exceptionDetails.exception?.description ?? 'exception')) : resolve(r.result?.value)),
      reject,
    });
    ws.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });

const readExpr = `(function () {
  const win = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view?.containerEl?.ownerDocument?.defaultView;
  if (!win) return null;
  const report = win.__trpgOverlayReport ?? null;
  const content = win.document.querySelector('.atlas-local-player-content');
  const r = content ? content.getBoundingClientRect() : null;
  return { report, receivedAt: win.__trpgOverlayReportAt ?? 0, hidden: document.visibilityState, content: r ? { x: r.x, y: r.y, w: r.width, h: r.height } : null };
})()`;

const shotExpr = `(async () => {
  const req = (typeof require === 'function' && require) || window.require;
  const remote = req('electron').remote;
  const win = remote.BrowserWindow.getAllWindows().find((w) => /Player view/i.test(String(w.getTitle?.() ?? '')));
  if (!win) return null;
  const image = await win.webContents.capturePage();
  return image.toPNG().toString('base64');
})()`;

const seenShots = new Set();
let shots = 0;
let samples = 0;
let bad = 0;
let lastSignature = '';
const startedAt = Date.now();
const fails = new Map();
const hiddenCounts = { visible: 0, hidden: 0 };

function problemsOf(report) {
  const out = [];
  for (const p of report.checks?.problems ?? []) out.push(JSON.stringify(p));
  for (const b of report.bubbles ?? []) {
    if (b.overflow) out.push(`clipped:${b.seat}/${b.kind}`);
    if (b.valid === false) out.push(`not-first-person:${b.seat}`);
    if (!b.token) out.push(`no-token:${b.seat}/${b.kind}`);
  }
  if (report.streamerText || report.streamerChildren) out.push('streamer-not-empty');
  for (const [seat, c] of Object.entries(report.panels?.party ?? {})) if (c.overflow) out.push(`party-overflow:${seat}`);
  if (report.panels?.story?.headOverflow) out.push('story-head-overflow');
  // 骰子数字压在气泡上（骰子会上浮 ≤58px，所以这里量的是此刻的矩形）
  for (const d of report.dice ?? []) {
    for (const b of report.bubbles ?? []) {
      if (!b.rect) continue;
      if (d.x < b.rect.x + b.rect.w && d.x + d.w > b.rect.x && d.y < b.rect.y + b.rect.h && d.y + d.h > b.rect.y) {
        out.push(`dice-over-bubble:${b.seat}/${b.kind}`);
      }
    }
  }
  return [...new Set(out)];
}

function signature(report) {
  // a/b = 座位，t/s = 云朵/说话，p = 位置（above/below/left/right），! = 云朵里是「…」动点（还在想）
  const kinds = (report.bubbles ?? [])
    .map((b) => `${b.seat[7]}${b.kind[0]}${b.placement[0]}${b.kind === 'thought' && !b.text ? '!' : ''}`)
    .sort()
    .join(',');
  // D = 骰子数字在画面上
  return (report.dice ?? []).length ? `${kinds}${kinds ? ',' : ''}D` : kinds;
}

while (Date.now() - startedAt < minutes * 60_000) {
  let state = null;
  try {
    state = await evaluate(readExpr);
  } catch (e) {
    state = { error: e.message };
  }
  samples += 1;
  const row = { t: new Date().toISOString(), samples };
  if (!state?.report) {
    row.error = state?.error ?? 'no report';
    bad += 1;
  } else {
    const report = state.report;
    const age = Date.now() - (state.receivedAt || report.at || 0);
    const problems = problemsOf(report);
    if (age > 15000) problems.push(`stale-${Math.round(age / 1000)}s`);
    row.mainVisibility = state.hidden;
    hiddenCounts[state.hidden === 'hidden' ? 'hidden' : 'visible'] += 1;
    row.bubbles = (report.bubbles ?? []).map((b) => ({
      seat: b.seat,
      kind: b.kind,
      text: b.text,
      placement: b.placement,
      rect: b.rect,
      tail: b.tailTip,
      token: b.token ? { x: b.token.x, y: b.token.y, w: b.token.w, h: b.token.h } : null,
    }));
    row.tokens = (report.tokens ?? []).length;
    row.problems = problems;
    row.seq = report.seq;
    if (problems.length) {
      bad += 1;
      for (const p of problems) fails.set(p.replace(/\d+/g, 'N'), (fails.get(p.replace(/\d+/g, 'N')) ?? 0) + 1);
    }
    const sig = signature(report);
    const key = sig;
    if (sig && sig !== lastSignature && !seenShots.has(key) && shots < maxShots) {
      seenShots.add(key);
      try {
        const png = await evaluate(shotExpr);
        if (png) {
          const file = join(shotsDir, `${prefix}-${String(++shots).padStart(2, '0')}-${sig.replace(/,/g, '_') || 'none'}.png`);
          writeFileSync(file, Buffer.from(png, 'base64'));
          row.shot = file;
        }
      } catch (e) {
        row.shotError = e.message;
      }
    }
    lastSignature = sig;
  }
  appendFileSync(outPath, `${JSON.stringify(row)}\n`, 'utf8');
  await new Promise((r) => setTimeout(r, intervalMs));
}

const summary = { samples, badSamples: bad, shots, mainVisibility: hiddenCounts, failures: Object.fromEntries(fails) };
appendFileSync(outPath, `${JSON.stringify({ summary })}\n`, 'utf8');
console.log(JSON.stringify(summary, null, 2));
ws.close();
setTimeout(() => process.exit(bad ? 1 : 0), 100);
