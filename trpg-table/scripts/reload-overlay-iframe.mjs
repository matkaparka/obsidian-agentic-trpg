// 改完 overlay/*.js|css|html 后，让玩家窗口里的 iframe 重新载入（不用重启 Obsidian / trpg-table）。
const list = await fetch('http://127.0.0.1:9222/json/list').then((r) => r.json());
const main = list.find((t) => t.type === 'page' && /app:\/\/obsidian\.md/.test(t.url));
if (!main) {
  console.error('没有 Obsidian 主窗口');
  process.exit(2);
}
const ws = new WebSocket(main.webSocketDebuggerUrl);
await new Promise((resolve) => ws.addEventListener('open', resolve, { once: true }));
const expression = `(function () {
  const win = app.workspace.getLeavesOfType('atlas-vtt-local-player')[0]?.view?.containerEl?.ownerDocument?.defaultView;
  const iframe = win?.document.getElementById('trpg-player-frame-iframe');
  if (!iframe) return 'no iframe';
  const u = new URL(iframe.src);
  u.searchParams.set('t', String(Date.now()));
  iframe.src = u.toString();
  return 'reloaded ' + u.toString();
})()`;
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression, returnByValue: true } }));
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id === 1) {
    console.log(msg.result?.result?.value ?? JSON.stringify(msg));
    ws.close();
    setTimeout(() => process.exit(0), 100);
  }
});
