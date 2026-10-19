// P0-1 evidence: main Obsidian window covered by another window, token moved, player
// picture captured before/after. Also records the frameCheck returned by atlas_move_token
// (pixel diff inside the player canvas) and the main window's visibility/rAF state.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'shots');
const CHECKS = path.join(ROOT, 'docs', 'checks');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(CHECKS, { recursive: true });
const dataPath = new URL('../../campaign-vault/.obsidian/plugins/atlas-agent-link/data.json', import.meta.url);
const token = JSON.parse(readFileSync(dataPath, 'utf8')).token;

async function mcp(name, args = {}) {
  const res = await fetch('http://127.0.0.1:27125/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const text = body?.result?.content?.find((c) => c.type === 'text')?.text;
  try { return JSON.parse(text); } catch { return text; }
}

const pages = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const main = pages.find((p) => p.type === 'page' && /app:\/\/obsidian\.md/.test(p.url));
const ws = new WebSocket(main.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', (e) => reject(new Error(`ws: ${e.message ?? 'unknown'}`)), { once: true });
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
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
  return r.result?.value;
};

// 1) Frame with demo data (so the panels are visible) and layout A.
await mcp('atlas_player_frame', {
  enabled: true,
  url: 'http://127.0.0.1:8099/overlay?bg=transparent&demo=1&layout=a',
  insets: { left: 484, right: 484, top: 0, bottom: 80 },
  hideAtlasInitiative: true,
  size: { w: 1920, h: 1080 },
  reload: true,
});
await new Promise((r) => setTimeout(r, 2200));
const tokens = await mcp('atlas_get_tokens');
const wx = tokens.tokens.find((t) => t.name === '薇克丝');
// Normalise the starting cell so the before/after picture is easy to read.
await mcp('atlas_move_token', { id: wx.id, cell: { col: 12, row: 8 } });
await new Promise((r) => setTimeout(r, 900));

// 2) Cover the main window with a separate Electron window (player window stays on top).
const cover = await evaluate(`(async () => {
  const req = typeof require === 'function' ? require : globalThis.require;
  const remote = req('electron').remote;
  const main = remote.getCurrentWindow();
  const player = remote.BrowserWindow.getAllWindows().find((w) => /Player view/i.test(String(w.getTitle?.() ?? '')));
  if (player) { player.setAlwaysOnTop(true); player.showInactive(); }
  if (globalThis.__cover) { globalThis.__cover.destroy(); globalThis.__cover = null; }
  const b = main.getBounds();
  const c = new remote.BrowserWindow({ x: b.x, y: b.y, width: b.width, height: b.height, frame: false, show: false, backgroundColor: '#101418', skipTaskbar: true });
  await c.loadURL('data:text/html,<body style="margin:0;background:%23101418;color:%23889;font:32px sans-serif;display:flex;align-items:center;justify-content:center">另一个窗口（盖住 Obsidian 主窗口）</body>');
  c.show(); c.focus(); main.blur();
  globalThis.__cover = c;
  return { main: main.getBounds(), cover: c.getBounds(), player: player?.getBounds() ?? null };
})()`);
await new Promise((r) => setTimeout(r, 600));

const stateBefore = await evaluate(`(async () => {
  let raf = 0; let stop = false;
  const loop = () => { raf++; if (!stop) requestAnimationFrame(loop); };
  requestAnimationFrame(loop);
  await new Promise((r) => setTimeout(r, 1200));
  stop = true;
  const m = ${JSON.stringify('main')};
  return { visibility: document.visibilityState, hidden: document.hidden, raf1_2s: raf };
})()`);

async function capture(name) {
  const shot = await evaluate(`(async () => {
    const req = typeof require === 'function' ? require : globalThis.require;
    const remote = req('electron').remote;
    const win = remote.BrowserWindow.getAllWindows().find((w) => /Player view/i.test(String(w.getTitle?.() ?? '')));
    if (!win) return { error: 'no player window' };
    const image = await win.webContents.capturePage();
    return { png: image.toPNG().toString('base64'), size: image.getSize() };
  })()`);
  const buf = Buffer.from(shot.png, 'base64');
  writeFileSync(path.join(SHOTS, name), buf);
  return { file: `docs/shots/${name}`, size: shot.size, sha256: createHash('sha256').update(buf).digest('hex') };
}

const before = await capture('frame-occluded-before.png');
const beforeTokens = await mcp('atlas_get_tokens');
const moved = await mcp('atlas_move_token', { id: wx.id, cell: { col: 9, row: 5 } });
await new Promise((r) => setTimeout(r, 1100));
const after = await capture('frame-occluded-after.png');
const afterTokens = await mcp('atlas_get_tokens');
const stateAfter = await evaluate(`(() => ({ visibility: document.visibilityState, minimized: require('electron').remote.getCurrentWindow().isMinimized(), throttle: require('electron').remote.getCurrentWindow().webContents.getBackgroundThrottling() }))()`);

const report = {
  at: new Date().toISOString(),
  mainCoveredByAnotherWindow: true,
  cover,
  mainState: { before: stateBefore, after: stateAfter },
  before: { shot: before, token: beforeTokens.tokens.find((t) => t.name === '薇克丝') },
  after: { shot: after, token: afterTokens.tokens.find((t) => t.name === '薇克丝') },
  move: moved?.frameCheck ?? null,
  picturesDiffer: before.sha256 !== after.sha256,
};
writeFileSync(path.join(CHECKS, 'p0-occluded-move.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
ws.close();
