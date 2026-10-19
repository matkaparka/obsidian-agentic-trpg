// 费用止损：盯着 logs/usage.jsonl 里**从启动这一刻起**新增的真实调用，累计超过上限就先暂停桌面、再杀进程。
// 用法：node scripts/cost-guard.mjs --limit 2 --pid <trpg-table 的 pid> [--logs logs] [--interval 5] [--link http://127.0.0.1:8098] [--stop-after-scene]
// --stop-after-scene：场景一换（GM 调了 end_scene）就暂停桌面（不杀进程），守卫退出；用来「只跑当前这一幕」。
// 价格（美元 / 百万 token）：
//   anthropic claude-sonnet-5-5：2 / 10，缓存读 0.2（claude-api 文档写的）；缓存写文档没写，按输入价 1.25 倍 = 2.5 估
//   deepseek、gemini：沿用 scripts/cost-estimate.mjs 里的标价假设（没核实过，这两家占总花费的零头）
// 这是估算，不是账单；调用失败的不计（没有 token 数）。进程走了、或者超限杀掉之后，这个守卫自己退出。
import { closeSync, existsSync, openSync, readSync, statSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : dflt;
};
const limit = Number(opt('limit', '2'));
const pid = Number(opt('pid', '0'));
const logsDir = opt('logs', 'logs');
const intervalMs = Math.max(1, Number(opt('interval', '5'))) * 1000;
const link = new URL(opt('link', 'http://127.0.0.1:8098'));
const stopAfterScene = args.includes('--stop-after-scene');
if (!Number.isFinite(limit) || limit <= 0 || !pid) {
  console.error('usage: node scripts/cost-guard.mjs --limit <usd> --pid <pid> [--logs logs] [--interval 5] [--link http://127.0.0.1:8098]');
  process.exit(2);
}

const PRICES = {
  anthropic: { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  deepseek: { input: 0.55, output: 2.19, cacheRead: 0.14, cacheWrite: 0.55 },
  gemini: { input: 0.5, output: 3, cacheRead: 0.05, cacheWrite: 0.5 },
};
const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (...a) => console.log(stamp(), '[cost-guard]', ...a);

// 配音（百炼 qwen3-tts-flash）：北京地域约 0.8 元 / 万字符，汉字按 2 个字符算（用的是接口返回的 usage.characters）；汇率按 7.2
const TTS_USD_PER_CHAR = 0.8 / 10000 / 7.2;

// claude-haiku-5-5：$0.10 / $0.50 每百万 token（prompt ≤ 100K；claude-api 文档里的标价），缓存读 0.1 倍输入价、缓存写 1.25 倍（和 Sonnet 同比例的估算）
const HAIKU_55 = { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 };

export function costOf(row) {
  if (!row || row.ok === false) return 0;
  if (row.provider === 'dashscope') return (row.characters ?? 0) * TTS_USD_PER_CHAR;
  const p = row.provider === 'anthropic' && /haiku-5/.test(String(row.model ?? '')) ? HAIKU_55 : PRICES[row.provider];
  if (!p) return 0; // fake / 未知 provider：不计
  return (
    ((row.inputTokens ?? 0) * p.input + (row.outputTokens ?? 0) * p.output + (row.cacheReadTokens ?? 0) * p.cacheRead + (row.cacheWriteTokens ?? 0) * p.cacheWrite) / 1e6
  );
}

const path = join(logsDir, 'usage.jsonl');
let offset = existsSync(path) ? statSync(path).size : 0;
let pending = '';
let total = 0;
let calls = 0;
const byProvider = {};

function readNew() {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size < offset) offset = 0; // 被截断了：从头算
  if (size === offset) return;
  const fd = openSync(path, 'r');
  try {
    const buf = Buffer.alloc(size - offset);
    readSync(fd, buf, 0, buf.length, offset);
    offset = size;
    pending += buf.toString('utf8');
  } finally {
    closeSync(fd);
  }
  const lines = pending.split('\n');
  pending = lines.pop() ?? '';
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      const c = costOf(row);
      if (c > 0) {
        total += c;
        calls += 1;
        byProvider[row.provider] = (byProvider[row.provider] ?? 0) + c;
      }
    } catch {
      /* 半行 / 坏行：跳过 */
    }
  }
}

function alive() {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getStatus() {
  return new Promise((resolve) => {
    const req = request(
      { host: link.hostname, port: link.port, path: '/status', method: 'GET', timeout: 3000, headers: { Host: `${link.hostname}:${link.port}` } },
      (res) => {
        let data = '';
        res.on('data', (c) => (data += c));
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.end();
  });
}

function postPause() {
  return new Promise((resolve) => {
    const body = JSON.stringify({ paused: true });
    const req = request(
      { host: link.hostname, port: link.port, path: '/pause', method: 'POST', timeout: 3000, headers: { Host: `${link.hostname}:${link.port}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }
    );
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    req.write(body);
    req.end();
  });
}

log(`开始盯 pid ${pid}，止损上限 $${limit}，每 ${intervalMs / 1000}s 看一次 ${path}（只算这一刻之后新增的调用）`);
let lastPrinted = -1;
let startScene = null;
const timer = setInterval(async () => {
  readNew();
  if (!alive()) {
    log(`进程 ${pid} 已经不在了，累计 $${total.toFixed(4)}（${calls} 次调用）。守卫退出。`);
    clearInterval(timer);
    process.exit(0);
  }
  if (Math.floor(total * 20) !== lastPrinted) {
    lastPrinted = Math.floor(total * 20);
    log(`累计 $${total.toFixed(4)} / $${limit}（${calls} 次调用；${Object.entries(byProvider).map(([k, v]) => `${k} $${v.toFixed(3)}`).join('，') || '还没有'}）`);
  }
  if (stopAfterScene) {
    const st = await getStatus();
    const sid = st?.table?.sceneId ?? null;
    if (sid && startScene === null) {
      startScene = sid;
      log(`当前场景 ${sid}（${st.table.scene}），换场景就暂停`);
    } else if (sid && sid !== startScene) {
      log(`场景从 ${startScene} 换成了 ${sid}：暂停桌面，守卫退出（累计 $${total.toFixed(4)}，${calls} 次调用）`);
      clearInterval(timer);
      const code = await postPause();
      log(`暂停请求：${code ?? '没连上'}`);
      process.exit(0);
    }
  }
  if (total >= limit) {
    log(`超过止损线 $${limit}（累计 $${total.toFixed(4)}）：先暂停，再结束进程 ${pid}`);
    clearInterval(timer);
    const code = await postPause();
    log(`暂停请求：${code ?? '没连上'}`);
    await new Promise((r) => setTimeout(r, 2000));
    try {
      process.kill(pid);
      log(`已结束进程 ${pid}`);
    } catch (e) {
      log(`结束进程失败：${e.message}`);
    }
    process.exit(0);
  }
}, intervalMs);
