// 在 Obsidian 主进程里临时开一个 Electron 窗口加载 overlay，用 webContents.capturePage 截图。
// 比 CDP Page.captureScreenshot 可靠（Electron 不支持 Target.createTarget）。
// 用法：node scripts/electron-shot.mjs <url> <out.png> [port]
import { writeFileSync } from 'node:fs';

const [url, out, portArg] = process.argv.slice(2);
const port = Number(portArg ?? 9222);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const page = targets.find((t) => t.type === 'page' && t.title.includes('campaign-vault'));
if (!page) throw new Error('Obsidian main window target not found');

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const myId = ++id;
    pending.set(myId, { resolve, reject });
    ws.send(JSON.stringify({ id: myId, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(JSON.stringify(msg.error))) : resolve(msg.result);
  }
});
await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

const expression = `(async () => {
  const { remote } = require('electron');
  const transparent = ${JSON.stringify(url.includes('bg=transparent'))};
  const win = new remote.BrowserWindow({
    width: 1920, height: 1080, useContentSize: true, show: true, frame: false, alwaysOnTop: true,
    transparent, hasShadow: false,
    backgroundColor: transparent ? '#00000000' : '#0a1018',
    webPreferences: { contextIsolation: false, nodeIntegration: false },
  });
  try {
    await win.loadURL(${JSON.stringify(url)});
    win.setContentSize(1920, 1080);
    win.webContents.setZoomFactor(1);
    await new Promise((r) => setTimeout(r, 6000));
    const diag = await win.webContents.executeJavaScript(\`(() => {
      const c = document.querySelector('#side-player_a .decision-card');
      const s = c ? c.querySelector('.say') : null;
      const t = document.querySelector('#side-player_a .thought-card');
      return {
        decisionH: c ? c.clientHeight : null,
        decisionScroll: c ? c.scrollHeight : null,
        sayH: s ? s.clientHeight : null,
        sayScroll: s ? s.scrollHeight : null,
        sayLine: s ? getComputedStyle(s).webkitLineClamp : null,
        sayDisplay: s ? getComputedStyle(s).display : null,
        thoughtH: t ? t.clientHeight : null,
        thoughtScroll: t ? t.scrollHeight : null,
      };
    })()\`);
    const img = await win.webContents.capturePage();
    return { png: img.toPNG().toString('base64'), size: win.getContentSize(), diag };
  } finally {
    win.destroy();
  }
})()`;

const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? r.exceptionDetails.text);
const value = r.result?.value;
if (!value?.png) throw new Error('no png returned');
writeFileSync(out, Buffer.from(value.png, 'base64'));
console.log('written', out, 'size', JSON.stringify(value.size), 'diag', JSON.stringify(value.diag));
ws.close();
