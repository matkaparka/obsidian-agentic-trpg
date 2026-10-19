// Minimal Chrome DevTools Protocol client for driving the running Obsidian window.
// Usage:
//   node scripts/cdp.mjs --list
//   node scripts/cdp.mjs --expr "1+1"
//   node scripts/cdp.mjs --file scripts/probe.js
//   node scripts/cdp.mjs --file probe.js --wait-for "window.app?.plugins?.isEnabled" --timeout 60000
// The expression is evaluated in the Obsidian renderer with awaitPromise, so `await` works
// when the expression is wrapped as an async IIFE. `app` is Obsidian's global.
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, dflt) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};

const PORT = Number(opt('--port', '9222'));
const OUT = opt('--out', '');
const base = `http://127.0.0.1:${PORT}`;

async function targets() {
  const res = await fetch(`${base}/json/list`);
  if (!res.ok) throw new Error(`CDP list failed: HTTP ${res.status}`);
  return res.json();
}

async function pickTarget() {
  const list = await targets();
  const pages = list.filter((t) => t.type === 'page' && t.webSocketDebuggerUrl);
  const wanted = opt('--target', '');
  const main = pages.find((p) => wanted ? p.url.includes(wanted) : true) ?? pages[0];
  if (!main) throw new Error(`No page target. Targets: ${list.map((t) => `${t.type}:${t.url}`).join(', ')}`);
  return main;
}

function connect(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const pending = new Map();
  const events = [];
  const ready = new Promise((resolve, reject) => {
    ws.addEventListener('open', () => resolve());
    ws.addEventListener('error', (e) => reject(new Error(`WebSocket error: ${e.message ?? 'unknown'}`)));
  });
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve, reject } = pending.get(msg.id);
      pending.delete(msg.id);
      msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
    } else if (msg.method) events.push(msg);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
  return { ready, send, events, close: () => ws.close() };
}

async function evaluate(cdp, expression) {
  const r = await cdp.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: true,
    replMode: false,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    const text = d.exception?.description ?? d.exception?.value ?? d.text ?? 'exception';
    const err = new Error(String(text).split('\n').slice(0, 6).join('\n'));
    err.cdpStack = d.stackTrace;
    throw err;
  }
  return r.result?.value ?? r.result?.description ?? null;
}

const main = async () => {
  if (flag('--list')) {
    console.log(JSON.stringify(await targets(), null, 2));
    return;
  }
  const file = opt('--file', '');
  const expr = file ? readFileSync(file, 'utf8') : opt('--expr', '');
  if (!expr) throw new Error('Pass --expr, --file or --list');

  const target = await pickTarget();
  const cdp = connect(target.webSocketDebuggerUrl);
  await cdp.ready;

  const waitFor = opt('--wait-for', '');
  const timeout = Number(opt('--timeout', '30000'));
  if (waitFor) {
    const t0 = Date.now();
    for (;;) {
      const ok = await evaluate(cdp, `(async () => { try { return !!(${waitFor}); } catch { return false; } })()`).catch(() => false);
      if (ok) break;
      if (Date.now() - t0 > timeout) throw new Error(`--wait-for timed out after ${timeout}ms: ${waitFor}`);
      await new Promise((r) => setTimeout(r, 250));
    }
  }

  try {
    const result = await evaluate(cdp, expr);
    const text = typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    if (OUT) {
      writeFileSync(OUT, text, 'utf8');
      console.log(`written: ${OUT} (${text.length} chars)`);
    } else {
      console.log(text);
    }
  } finally {
    cdp.close();
  }
};

main().catch((e) => {
  console.error(`CDP_ERROR: ${e.message}`);
  process.exit(1);
});
