// 自动检查演出框（v2：地图 + 主播区 + 棋子气泡）。
// 验收点：
//   1. 气泡完整显示：不裁字，不压字幕条，不出地图，不进主播区；
//   2. 气泡尾巴落点离对应棋子边缘 ≤24px；
//   3. 气泡两两不重叠；每句上屏的心里话标记为第一人称合格；
//   4. 地图区域和 atlas_player_frame 实际缩出来的 canvas 宿主一致；
//   5. 主播区是空的（只有纯色背景）。
// 用法：node scripts/check-overlay.mjs [--json out.json] [--wait 20]
import { writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const outPath = opt('--json', '');
const waitSec = Number(opt('--wait', '20'));

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json()).catch((e) => {
  console.error(`CDP 9222 不可用：${e.message}`);
  process.exit(2);
});
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const player = pages.find((p) => /Player view/i.test(p.title)) ?? pages.find((p) => /player/i.test(p.url));
const main = pages.find((p) => /app:\/\/obsidian\.md/.test(p.url)) ?? pages[0];
if (!main && !player) {
  console.error('没有可用的 Obsidian 页面。');
  process.exit(2);
}

async function connect(target) {
  const ws = new WebSocket(target.webSocketDebuggerUrl);
  let id = 0;
  const pending = new Map();
  await new Promise((resolve, reject) => {
    ws.addEventListener('open', resolve, { once: true });
    ws.addEventListener('error', (e) => reject(new Error(`websocket: ${e.message ?? 'unknown'}`)), { once: true });
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    }
  });
  const send = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const myId = ++id;
      pending.set(myId, { resolve, reject });
      ws.send(JSON.stringify({ id: myId, method, params }));
    });
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, allowUnsafeEvalBlockedByCSP: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text ?? 'evaluate exception');
    return r.result?.value;
  };
  return { evaluate, close: () => ws.close() };
}

// overlay 页面是 Electron 里的跨进程 iframe（OOPIF），它自己的 window.__overlayReport 在 player 页面里读不到。
// 报告由插件（playerFrame.attachMessages）经 postMessage 收下，存成玩家窗口的 __trpgOverlayReport；
// 这里只从那个变量读。玩家窗口的 window 可以从主窗口的 leaf 拿到，也可以直接连玩家页面。
const readFromWindow = `(function (win) {
  if (!win) return { error: '没有玩家窗口' };
  const report = win.__trpgOverlayReport ?? null;
  const doc = win.document;
  const content = doc.querySelector('.atlas-local-player-content');
  const iframe = doc.getElementById('trpg-player-frame-iframe');
  const rect = (el) => { if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; };
  return {
    report,
    at: report?.at ?? 0,
    reportReceivedAt: win.__trpgOverlayReportAt ?? 0,
    frameInfo: content ? { window: { w: win.innerWidth, h: win.innerHeight }, content: rect(content), iframe: rect(iframe) } : null,
  };
})`;
const viaMain = `${readFromWindow}(app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view?.containerEl?.ownerDocument?.defaultView)`;
const viaPlayer = `${readFromWindow}(window)`;

let result = null;
const conns = [];
if (main) conns.push({ conn: await connect(main), expr: viaMain });
if (player) conns.push({ conn: await connect(player), expr: viaPlayer });
const seen = Date.now();
while (Date.now() - seen < waitSec * 1000) {
  for (const { conn, expr } of conns) {
    try {
      result = await conn.evaluate(expr);
    } catch {
      result = null;
    }
    if (result?.report && Date.now() - (result.reportReceivedAt || result.at || 0) < 15000) break;
  }
  if (result?.report && Date.now() - (result.reportReceivedAt || result.at || 0) < 15000) break;
  await new Promise((r) => setTimeout(r, 500));
}
for (const { conn } of conns) conn.close();

if (!result?.report) {
  console.error('没有 overlay 自检报告：演出框没打开，或 iframe 还没连上。');
  process.exit(1);
}

const report = result.report;
const frameInfo = result.frameInfo;
const failures = [];
if (!report.ok) failures.push('report.ok=false');
for (const problem of report.checks?.problems ?? []) {
  failures.push(`气泡问题：${problem.seat ?? '-'}/${problem.kind ?? '-'}:${JSON.stringify(problem)}`);
}
for (const b of report.bubbles ?? []) {
  if (b.overflow) failures.push(`气泡裁字：${b.seat}/${b.kind}`);
  if (b.valid === false) failures.push(`心里话第一人称不合格：${b.seat}`);
  if (!b.token) failures.push(`气泡没有对应棋子：${b.seat}/${b.kind}`);
  if (b.rect && report.map) {
    const inMap = b.rect.x >= report.map.x - 2 && b.rect.y >= report.map.y - 2 && b.rect.x + b.rect.w <= report.map.x + report.map.w + 2 && b.rect.y + b.rect.h <= report.map.y + report.map.h + 2;
    if (!inMap) failures.push(`气泡出地图：${b.seat}/${b.kind}`);
  }
  if (b.rect && report.streamer && b.rect.x + b.rect.w > report.streamer.x + 1) failures.push(`气泡进主播区：${b.seat}/${b.kind}`);
  if (b.rect && report.subtitle && b.rect.y + b.rect.h > report.subtitle.y - 2) failures.push(`气泡压字幕条：${b.seat}/${b.kind}`);
  if (b.rect && b.token) {
    const d = Math.max(b.token.x - b.tailTip.x, b.tailTip.x - (b.token.x + b.token.w), b.token.y - b.tailTip.y, b.tailTip.y - (b.token.y + b.token.h), 0);
    if (d > 24) failures.push(`气泡尾巴离棋子 ${Math.round(d)}px：${b.seat}/${b.kind}`);
  }
}
for (let i = 0; i < (report.bubbles ?? []).length; i++) {
  for (let j = i + 1; j < (report.bubbles ?? []).length; j++) {
    const a = report.bubbles[i];
    const b = report.bubbles[j];
    const hit = a.rect && b.rect && a.rect.x < b.rect.x + b.rect.w && a.rect.x + a.rect.w > b.rect.x && a.rect.y < b.rect.y + b.rect.h && a.rect.y + a.rect.h > b.rect.y;
    if (hit) failures.push(`气泡重叠：${a.seat}/${a.kind} × ${b.seat}/${b.kind}`);
  }
}
for (const seat of ['player_a', 'player_b']) {
  const c = report.panels?.party?.[seat];
  if (!c) failures.push(`角色面板没有数据：${seat}`);
  else if (c.overflow) failures.push(`角色面板内容溢出：${seat}`);
}
if (report.panels?.story?.headOverflow) failures.push('滚动剧情的标题栏溢出');
if (frameInfo?.streamerText) failures.push(`主播区有文字：${frameInfo.streamerText.slice(0, 30)}`);
if (report.streamerText || report.streamerChildren) failures.push(`主播区不是空的：${report.streamerText?.slice(0, 30) ?? report.streamerChildren}`);

// 地图区域与 canvas 宿主一致
const scale = report.stage?.scale || 1;
const expected = {
  x: Math.round((report.map?.x ?? 0) * scale),
  y: Math.round((report.map?.y ?? 0) * scale),
  w: Math.round((report.map?.w ?? 0) * scale),
  h: Math.round((report.map?.h ?? 0) * scale),
};
let mapMatches = null;
if (scale > 0 && Number.isFinite(scale) && frameInfo?.content) {
  const c = frameInfo.content;
  mapMatches = Math.abs(c.x - expected.x) <= 3 && Math.abs(c.y - expected.y) <= 3 && Math.abs(c.w - expected.w) <= 3 && Math.abs(c.h - expected.h) <= 3;
  if (!mapMatches) failures.push(`地图区域不一致：canvas ${JSON.stringify(c)} vs overlay ${JSON.stringify(expected)}`);
}
if (!frameInfo?.iframe) failures.push('没有注入 iframe');
if (Date.now() - (report.at ?? 0) > 15000) failures.push(`报告太旧：${Math.round((Date.now() - (report.at ?? 0)) / 1000)}s`);

const summary = {
  ok: failures.length === 0,
  at: new Date(report.at).toISOString(),
  ageMs: Date.now() - report.at,
  stage: report.stage,
  map: report.map,
  streamer: report.streamer,
  subtitle: report.subtitle,
  characters: report.characters,
  panels: report.panels,
  viewport: report.viewport,
  bubbles: report.bubbles,
  tokens: report.tokens,
  frame: frameInfo ? { window: frameInfo.window, content: frameInfo.content, iframe: frameInfo.iframe } : null,
  expectedMapInWindow: expected,
  mapMatches,
  failures,
};
if (outPath) writeFileSync(outPath, JSON.stringify(summary, null, 2), 'utf8');
console.log(JSON.stringify(summary, null, 2));
process.exitCode = failures.length ? 1 : 0;
// 不用 process.exit：WebSocket 还没完全关时 libuv 会在 Windows 上断言失败
setTimeout(() => process.exit(process.exitCode), 150);
