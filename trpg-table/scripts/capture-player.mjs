// Capture the Atlas player window (the stream picture) to a PNG through Electron.
// Usage: node scripts/capture-player.mjs <out.png> [--resize 1920x1080] [--no-raise]
// Requires Obsidian started with --remote-debugging-port=9222. Does not minimise or resize the
// window; raises it briefly like atlas_screenshot does, then restores always-on-top.
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
if (!out) {
  console.error('usage: node scripts/capture-player.mjs <out.png> [--resize WxH] [--no-raise]');
  process.exit(2);
}
const resizeArg = (() => {
  const i = args.indexOf('--resize');
  const v = i >= 0 ? args[i + 1] : '';
  const m = /^(\d+)x(\d+)$/.exec(v ?? '');
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
})();
const raise = !args.includes('--no-raise');

const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const target = pages.find((p) => /app:\/\/obsidian\.md/.test(p.url)) ?? pages[0];
if (!target) throw new Error('no page target on CDP 9222');

const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', (e) => reject(new Error(`CDP websocket error: ${e.message ?? 'unknown'}`)), { once: true });
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

const expression = `(async () => {
  const req = typeof require === 'function' ? require : globalThis.require;
  const remote = req('electron').remote;
  const fs = req('node:fs');
  const wins = remote.BrowserWindow.getAllWindows();
  const win = wins.find((w) => /Player view/.test(String(w.getTitle?.() ?? '')));
  if (!win) return { error: 'no player window' };
  const before = { onTop: !!win.isAlwaysOnTop?.() };
  ${raise ? `win.showInactive?.(); win.moveTop?.(); win.setAlwaysOnTop?.(true); await new Promise((r) => setTimeout(r, 700));` : ''}
  const first = await win.webContents.capturePage().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 250));
  const image = await win.webContents.capturePage();
  if (!image || image.isEmpty?.()) return { error: 'empty capture', size: image?.getSize?.() ?? null };
  const size = image.getSize();
  let final = image;
  const resize = ${JSON.stringify(resizeArg)};
  if (resize) {
    const longest = Math.max(size.width, size.height);
    const k = Math.min(resize.w / size.width, resize.h / size.height);
    final = image.resize({ width: Math.round(size.width * k), height: Math.round(size.height * k), quality: 'best' });
  }
  const buffer = final.toPNG();
  fs.writeFileSync(${JSON.stringify(resolve(out).replace(/\\/g, '/'))}, buffer);
  win.setAlwaysOnTop?.(before.onTop);
  return { ok: true, captured: size, written: final.getSize(), bytes: buffer.length, contentSize: win.getContentSize(), title: win.getTitle() };
})()`;

const result = await send('Runtime.evaluate', {
  expression,
  awaitPromise: true,
  returnByValue: true,
  userGesture: true,
  allowUnsafeEvalBlockedByCSP: true,
});
ws.close();
if (result.exceptionDetails) {
  const text = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text;
  console.error(`CDP_ERROR: ${String(text).split('\n').slice(0, 6).join('\n')}`);
  process.exit(1);
}
const value = result.result?.value;
if (value?.error) {
  console.error(`CAPTURE_ERROR: ${value.error}`);
  process.exit(1);
}
console.log(JSON.stringify(value, null, 2));
