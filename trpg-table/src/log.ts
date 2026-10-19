import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { nowIso, scrub } from './util.js';

/**
 * 追加式 JSONL。一条一行，进程崩了也不丢已写入的行。
 * 写入串行化，避免并发调用交错出半行。
 */
export class JsonlLog {
  private stream: WriteStream | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  record(value: Record<string, unknown>): void {
    const line = JSON.stringify({ at: nowIso(), ...value }) + '\n';
    this.queue = this.queue
      .then(
        () =>
          new Promise<void>((resolve, reject) => {
            if (!this.stream) {
              mkdirSync(dirname(this.path), { recursive: true });
              this.stream = createWriteStream(this.path, { flags: 'a', encoding: 'utf8' });
            }
            this.stream.write(line, (err) => (err ? reject(err) : resolve()));
          })
      )
      .catch((e) => {
        // 日志失败不能拖垮桌面
        console.error(`[log] 写 ${this.path} 失败：${(e as Error).message}`);
      });
  }

  async flush(): Promise<void> {
    await this.queue;
  }
}

export interface Logs {
  root: string;
  table: JsonlLog;
  usage: JsonlLog;
  /** 人读的 trace（stderr/stdout），不含内容、不含密钥 */
  trace(message: string): void;
  /** 最近 N 条 trace，给 /trace 用 */
  traceLines(limit?: number): string[];
}

export function createLogs(root: string): Logs {
  const dir = join(root, 'logs');
  mkdirSync(dir, { recursive: true });
  const ring: string[] = [];
  return {
    root: dir,
    table: new JsonlLog(join(dir, 'table.jsonl')),
    usage: new JsonlLog(join(dir, 'usage.jsonl')),
    trace(message: string): void {
      const line = `${new Date().toLocaleTimeString('zh-CN', { hour12: false })} ${scrub(message)}`;
      ring.push(line);
      if (ring.length > 300) ring.splice(0, ring.length - 300);
      console.log(line);
    },
    traceLines(limit = 50): string[] {
      return ring.slice(-Math.max(1, Math.min(300, limit)));
    },
  };
}
