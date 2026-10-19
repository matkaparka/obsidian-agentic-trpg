// Capture the three sprite-layout candidates from the real Atlas player window.
// Usage: node scripts/capture-layouts.mjs [a b c]
// Requires: Obsidian with the campaign vault + CDP 9222, overlay :8099 running.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import path from 'node:path';

const layouts = process.argv.slice(2).length ? process.argv.slice(2) : ['a', 'b', 'c'];
const ROOT = path.resolve(import.meta.dirname, '..');
const SHOTS = path.join(ROOT, 'docs', 'shots');
const CHECKS = path.join(ROOT, 'docs', 'checks');
mkdirSync(SHOTS, { recursive: true });
mkdirSync(CHECKS, { recursive: true });
const dataPath = new URL('../../campaign-vault/.obsidian/plugins/atlas-agent-link/data.json', import.meta.url);
const token = JSON.parse(readFileSync(dataPath, 'utf8')).token;

async function mcp(name, args) {
  const res = await fetch('http://127.0.0.1:27125/mcp', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }),
  });
  const body = await res.json();
  const text = body?.result?.content?.find((c) => c.type === 'text')?.text;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

const pages = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const main = pages.find((p) => p.type === 'page' && /app:\/\/obsidian\.md/.test(p.url));
if (!main) throw new Error('no Obsidian main target on 9222');
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

const summary = [];
for (const layout of layouts) {
  const url = `http://127.0.0.1:8099/overlay?bg=transparent&demo=1&layout=${layout}`;
  const applied = await mcp('atlas_player_frame', {
    enabled: true,
    url,
    insets: { left: 484, right: 484, top: 0, bottom: 80 },
    hideAtlasInitiative: true,
    size: { w: 1920, h: 1080 },
    reload: true,
  });
  await new Promise((r) => setTimeout(r, 2600));
  // Wait until the overlay reports a fresh frame for this layout.
  let report = null;
  for (let i = 0; i < 20; i++) {
    report = await evaluate(`(() => {
      const leaf = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0];
      const win = leaf?.view?.containerEl?.ownerDocument?.defaultView;
      return win?.__trpgOverlayReport ?? null;
    })()`);
    if (report && report.layout === layout) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  const shot = await evaluate(`(async () => {
    const req = typeof require === 'function' ? require : globalThis.require;
    const remote = req('electron').remote;
    const win = remote.BrowserWindow.getAllWindows().find((w) => /Player view/i.test(String(w.getTitle?.() ?? '')));
    if (!win) return { error: 'no player window' };
    const image = await win.webContents.capturePage();
    const size = image.getSize();
    return { png: image.toPNG().toString('base64'), size };
  })()`);
  if (shot?.png) {
    const file = path.join(SHOTS, `layout-${layout}.png`);
    writeFileSync(file, Buffer.from(shot.png, 'base64'));
    writeFileSync(path.join(CHECKS, `layout-${layout}.json`), JSON.stringify({ layout, report, shot: shot.size }, null, 2));
    summary.push({ layout, file: `docs/shots/layout-${layout}.png`, size: shot.size, report: report ? { ok: report.ok, panels: report.panels?.length ?? 0, overlaps: report.overlaps?.length ?? 0, layout: report.layout } : null });
  } else {
    summary.push({ layout, error: shot?.error ?? 'capture failed' });
  }
}
ws.close();
console.log(JSON.stringify(summary, null, 2));
