// Wait for the next trpg-table `roll` event, then capture the Atlas player window.
// Usage: node scripts/capture-on-roll.mjs <out.png> [--timeout 120] [--resize 1920x1080]
import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const args = process.argv.slice(2);
const out = args[0];
if (!out) {
  console.error('usage: node scripts/capture-on-roll.mjs <out.png> [--timeout sec] [--resize WxH]');
  process.exit(2);
}
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const timeout = Number(opt('--timeout', '180'));
const match = new RegExp(opt('--match', 'd20=\\d'));
const resizeArg = (() => {
  const m = /^(\d+)x(\d+)$/.exec(opt('--resize', '1920x1080'));
  return m ? { w: Number(m[1]), h: Number(m[2]) } : null;
})();

const status = await fetch('http://127.0.0.1:8098/status').then((r) => r.json());
let after = Number(opt('--after', String(Math.max(0, (status.latestEventSeq ?? 0) - 5))));
const t0 = Date.now();
let hit = null;
while (Date.now() - t0 < timeout * 1000 && !hit) {
  const batch = await fetch(`http://127.0.0.1:8098/events?after=${after}`).then((r) => r.json());
  for (const ev of batch.events ?? []) {
    after = Math.max(after, ev.seq);
    if (ev.kind === 'roll' && match.test(String(ev.text ?? ''))) hit = ev;
  }
  if (!hit) await new Promise((r) => setTimeout(r, 250));
}
if (!hit) {
  console.error(`no roll event within ${timeout}s`);
  process.exit(1);
}
// The decision card / narration get the roll immediately after the event; give it one frame.
await new Promise((r) => setTimeout(r, 350));

// --- capture the player window through CDP (same approach as capture-player.mjs) ---
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
const target = pages.find((p) => /app:\/\/obsidian\.md/.test(p.url)) ?? pages[0];
const ws = new WebSocket(target.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', (e) => reject(new Error(`CDP: ${e.message ?? 'unknown'}`)), { once: true });
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
  const win = remote.BrowserWindow.getAllWindows().find((w) => /Player view/i.test(String(w.getTitle?.() ?? '')));
  if (!win) return { error: 'no player window' };
  const onTop = !!win.isAlwaysOnTop?.();
  win.showInactive?.(); win.moveTop?.(); win.setAlwaysOnTop?.(true);
  await new Promise((r) => setTimeout(r, 500));
  await win.webContents.capturePage().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 200));
  const image = await win.webContents.capturePage();
  const resize = ${JSON.stringify(resizeArg)};
  let final = image;
  if (resize) {
    const s = image.getSize();
    const k = Math.min(resize.w / s.width, resize.h / s.height);
    final = image.resize({ width: Math.round(s.width * k), height: Math.round(s.height * k), quality: 'best' });
  }
  fs.writeFileSync(${JSON.stringify(resolve(out).replace(/\\/g, '/'))}, final.toPNG());
  win.setAlwaysOnTop?.(onTop);
  return { ok: true, written: final.getSize(), event: ${JSON.stringify({ seq: hit.seq, text: hit.text })}, at: Date.now() };
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
  console.error(`CDP_ERROR: ${result.exceptionDetails.exception?.description ?? result.exceptionDetails.text}`);
  process.exit(1);
}
const value = result.result?.value;
if (value?.error) {
  console.error(`CAPTURE_ERROR: ${value.error}`);
  process.exit(1);
}
console.log(JSON.stringify(value, null, 2));
