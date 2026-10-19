// 把玩家窗口里的 overlay iframe 临时切到 demo 预览（真实棋子位置 + 日志里的真实台词），再截一张图。
// 用法：node scripts/preview-real.mjs <out.png> [querystring，例如 "hp_a=9&active=player_a"] ；不给 query 就恢复正常。
import { writeFileSync } from 'node:fs';
const out = process.argv[2];
const query = process.argv[3] ?? '';
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const main = list.find((t) => t.type === 'page' && /app:\/\/obsidian\.md/.test(t.url));
const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) pending.get(m.id)(m.result);
});
const evaluate = (expression) =>
  new Promise((resolve) => {
    const i = ++id;
    pending.set(i, (r) => resolve(r?.result?.value));
    ws.send(JSON.stringify({ id: i, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }));
  });
const base = 'http://127.0.0.1:8099/overlay?bg=transparent';
const url = query ? `${base}&demo=1&hold=1&${query}` : base;
console.log(await evaluate(`(function(){const win=app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view?.containerEl?.ownerDocument?.defaultView;const f=win?.document.getElementById('trpg-player-frame-iframe');if(!f)return 'no iframe';f.src=${JSON.stringify(url)}+'&t='+Date.now();return 'iframe -> '+f.src})()`));
await new Promise((r) => setTimeout(r, 3500));
if (out) {
  const png = await evaluate(`(async()=>{const remote=require('electron').remote;const w=remote.BrowserWindow.getAllWindows().find(x=>/Player view/i.test(x.getTitle()));if(!w)return null;const img=await w.webContents.capturePage();return img.toPNG().toString('base64')})()`);
  if (png) {
    writeFileSync(out, Buffer.from(png, 'base64'));
    console.log('saved', out);
  }
}
ws.close();
setTimeout(() => process.exit(0), 100);
