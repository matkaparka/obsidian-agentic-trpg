// 开发用监督进程：改了 src/ 就重新构建并重启 trpg-table；改了 config/、角色卡、剧本就直接重启。
// - 构建失败（类型错）就保留旧进程继续跑，错误写日志，不会把直播桌面弄挂；
// - 重启前记下“是不是暂停中”，新进程起来后原样恢复（正在跑的，重启后自动继续）；
// - 存档在 state/table.json，重启不丢进度。
//
// 用法（在 trpg-table 目录）：  node scripts/dev-watch.mjs
// 停：结束这个进程（它会带着 trpg-table 一起退出）。

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, existsSync, openSync, watch } from 'node:fs';
import { request } from 'node:http';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');
const logPath = join(root, 'run-dev.log');
const LINK = { host: '127.0.0.1', port: 8098, headers: { Host: '127.0.0.1:8098', 'Content-Type': 'application/json' } };
const DEBOUNCE_MS = 1500;

const stamp = () => new Date().toLocaleTimeString('zh-CN', { hour12: false });
const log = (...a) => console.log(stamp(), '[dev-watch]', ...a);

function http(method, path, body) {
  return new Promise((resolve) => {
    const req = request({ ...LINK, method, path, timeout: 3000 }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.on('timeout', () => {
      req.destroy();
      resolve(null);
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

let app = null;
let logFd = null;

function startApp() {
  logFd = openSync(logPath, 'a');
  app = spawn(process.execPath, ['dist/main.js'], {
    cwd: root,
    env: { ...process.env, NO_PROXY: '127.0.0.1,localhost' },
    stdio: ['ignore', logFd, logFd],
  });
  const mine = app;
  app.on('exit', (code) => {
    log(`trpg-table 退出（code ${code}）`);
    if (app === mine) app = null;
    if (logFd !== null) {
      try {
        closeSync(logFd);
      } catch {
        // 已经关了
      }
      logFd = null;
    }
  });
  log(`trpg-table 已启动（pid ${app.pid}），输出写进 run-dev.log`);
}

async function stopApp() {
  if (!app) return;
  const mine = app;
  const exited = new Promise((resolve) => mine.once('exit', resolve));
  mine.kill();
  await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
}

async function waitOnline(ms = 25000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const s = await http('GET', '/status');
    if (s?.online) return s;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}

/** 构建；失败返回 false 并把错误打出来。 */
function build() {
  const r = spawnSync(process.execPath, [tsc, '-p', 'tsconfig.build.json', '--noEmitOnError'], { cwd: root, encoding: 'utf8' });
  if (r.status === 0) return true;
  log('构建失败，保留旧进程继续跑：');
  for (const line of `${r.stdout ?? ''}${r.stderr ?? ''}`.split('\n').filter(Boolean).slice(0, 12)) console.log('    ', line);
  return false;
}

let running = false;
let dirty = false;
let needBuild = false;
const reasons = new Set();

async function cycle() {
  if (running) {
    dirty = true;
    return;
  }
  running = true;
  try {
    do {
      dirty = false;
      const why = [...reasons].slice(0, 4).join('、') + (reasons.size > 4 ? ` 等 ${reasons.size} 个文件` : '');
      const doBuild = needBuild;
      reasons.clear();
      needBuild = false;
      log(`检测到改动：${why}`);
      if (doBuild && !build()) continue;
      const before = await http('GET', '/status');
      const wasPaused = before?.paused ?? true;
      await stopApp();
      startApp();
      const status = await waitOnline();
      if (!status) {
        log('新进程 25 秒内没起来，看 run-dev.log');
        continue;
      }
      if (!wasPaused) {
        await http('POST', '/pause', { paused: false });
        log('重启前是在跑的：已恢复运行');
      } else {
        log('重启前是暂停的：保持暂停（页面 Ctrl+Alt+K 开始）');
      }
    } while (dirty);
  } finally {
    running = false;
  }
}

let timer = null;
function onChange(kind, base, file) {
  if (!file) return;
  const rel = relative(root, join(base, file)).replaceAll('\\', '/');
  if (/\.(map|log)$/.test(rel) || /(^|\/)\.[^/]+/.test(rel)) return;
  if (kind === 'src' && !/\.ts$/.test(rel)) return;
  reasons.add(rel);
  if (kind === 'src') needBuild = true;
  clearTimeout(timer);
  timer = setTimeout(() => void cycle(), DEBOUNCE_MS);
}

const watched = [
  ['src', join(root, 'src')],
  ['config', join(root, 'config')],
  ['vault', join(root, '..', 'campaign-vault', 'characters')],
  ['vault', join(root, '..', 'campaign-vault', 'adventures')],
];
for (const [kind, dir] of watched) {
  if (!existsSync(dir)) continue;
  watch(dir, { recursive: true }, (_event, file) => onChange(kind, dir, file));
  log(`监视 ${relative(root, dir).replaceAll('\\', '/') || '.'}`);
}

async function shutdown() {
  log('退出：先停 trpg-table');
  await stopApp();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown());
process.on('SIGTERM', () => void shutdown());

// 启动：先构建一次保证 dist 是新的，再起进程
if (!build()) log('首次构建失败，用现有 dist 启动');
startApp();
void waitOnline().then((s) => log(s ? `就绪（${s.control?.mode ?? '?'}，${s.paused ? '暂停中' : '运行中'}）` : '启动超时，看 run-dev.log'));
