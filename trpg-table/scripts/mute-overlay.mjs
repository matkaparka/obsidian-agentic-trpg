// 紧急「闭嘴」：刷新 Obsidian（带调试口 9222）里的 overlay 页面，正在播和排队的配音立刻没了；
// 页面重连后只收新事件（服务端不回放旧事件），桌面状态不受影响。桌面本身要停另用 POST /pause。
// 用法：node scripts/mute-overlay.mjs [调试口，默认 9222]
const port = Number(process.argv[2] ?? 9222);
const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
const hits = targets.filter((x) => x.type === 'iframe' && String(x.url).includes('/overlay'));
if (!hits.length) {
  console.log(`没找到 overlay 页面（Obsidian 要用 start_obsidian_trpg.bat debug 开，调试口 ${port}）`);
  process.exit(1);
}
for (const t of hits) {
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((resolve) => (ws.onopen = resolve));
  ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: 'location.reload(); 1' } }));
  await new Promise((resolve) => setTimeout(resolve, 300));
  ws.close();
}
console.log(`已刷新 ${hits.length} 个 overlay 页面：配音队列清空。`);
