import { createHash, randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** 项目根目录：从本文件向上找 package.json（name=trpg-table）；找不到就用 cwd。 */
export function projectRoot(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const pkg = join(dir, 'package.json');
    if (existsSync(pkg)) {
      try {
        // 同步读：只在启动时调用一次
        const text = requireText(pkg);
        if (/"name"\s*:\s*"trpg-table"/.test(text)) return dir;
      } catch {
        /* 继续向上 */
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return process.cwd();
}

function requireText(path: string): string {
  return readFileSync(path, 'utf8');
}

export const nowMs = () => Date.now();
export const nowIso = () => new Date().toISOString();

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('aborted', 'AbortError'));
      return;
    }
    const t = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(new DOMException('aborted', 'AbortError'));
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** 按码点裁剪，不切断 emoji / 代理对。 */
export function clip(s: string, max: number): string {
  const chars = [...(s ?? '')];
  return chars.length > max ? chars.slice(0, max).join('') + '…' : s ?? '';
}

export function countChars(s: string): number {
  return [...(s ?? '')].length;
}

export async function ensureDir(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export async function atomicWrite(path: string, data: string): Promise<void> {
  await ensureDir(dirname(path));
  const tmp = `${path}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  await writeFile(tmp, data, 'utf8');
  try {
    await rename(tmp, path);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    // Windows / 杀毒软件有时会拒绝 rename 覆盖：退回直接写，别让存档丢掉。
    if (code === 'EPERM' || code === 'EACCES' || code === 'EEXIST') {
      await rm(tmp, { force: true });
      await writeFile(path, data, 'utf8');
      return;
    }
    await rm(tmp, { force: true });
    throw e;
  }
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWrite(path, JSON.stringify(value, null, 2) + '\n');
}

export async function readJsonIfExists<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw e;
  }
}

/** 简单的 .env 读取：KEY=VALUE，支持引号与 # 注释；不覆盖已存在的进程环境变量。 */
export function loadEnvFile(path: string): { loaded: string[]; missingFile: boolean } {
  if (!existsSync(path)) return { loaded: [], missingFile: true };
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return { loaded: [], missingFile: false };
  }
  const loaded: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const m = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (!m) continue;
    const key = m[1];
    let value = m[2].trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash >= 0) value = value.slice(0, hash).trim();
    }
    if (process.env[key] === undefined) {
      process.env[key] = value;
      loaded.push(key);
    }
  }
  return { loaded, missingFile: false };
}

export function uuid(): string {
  return randomUUID();
}

export function shortHash(s: string, len = 10): string {
  return createHash('sha256').update(s).digest('hex').slice(0, len);
}

/** 日志里禁止出现密钥形态的字符串。 */
export function scrub(text: string): string {
  return String(text)
    .replace(/\bsk-[A-Za-z0-9_.-]{8,}/g, 'sk-***') // 带点的新格式（sk-ws-xxx.yyy.zzz）也要盖住
    .replace(/\bAIza[0-9A-Za-z_-]{20,}/g, 'AIza***')
    .replace(/(Bearer\s+)[A-Za-z0-9._-]{10,}/gi, '$1***')
    .replace(/((?:api[_-]?key|token)["'\s:=]+)[A-Za-z0-9._-]{12,}/gi, '$1***');
}

export function parseBool(v: string | undefined, fallback = false): boolean {
  if (v === undefined) return fallback;
  return /^(1|true|yes|on)$/i.test(v.trim());
}

export const isLoopbackHost = (hostname: string): boolean =>
  hostname === '127.0.0.1' || hostname === 'localhost' || hostname === '::1' || hostname === '[::1]';

export function shuffle<T>(items: T[]): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
