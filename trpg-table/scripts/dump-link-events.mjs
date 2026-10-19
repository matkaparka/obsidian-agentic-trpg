// 把 helixus-link 的事件流存成 jsonl（验收时对照「观众看到的」和「只有 Helixus 看到的」）。
// 用法：node scripts/dump-link-events.mjs --minutes 15 --out docs/checks/v2-link-events.jsonl
import { appendFileSync } from 'node:fs';

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf(n);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : d;
};
const minutes = Number(opt('--minutes', '15'));
const out = opt('--out', 'docs/checks/v2-link-events.jsonl');
const headers = { Host: '127.0.0.1:8098' };
let after = 0;
const end = Date.now() + minutes * 60_000;
let count = 0;
while (Date.now() < end) {
  try {
    const r = await fetch(`http://127.0.0.1:8098/events?after=${after}`, { headers });
    const body = await r.json();
    const events = body.events ?? body;
    for (const ev of Array.isArray(events) ? events : []) {
      appendFileSync(out, `${JSON.stringify(ev)}\n`, 'utf8');
      count += 1;
      after = Math.max(after, ev.seq ?? 0);
    }
  } catch {
    /* 服务器还没起来 */
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log(JSON.stringify({ count, lastSeq: after }));
process.exit(0);
