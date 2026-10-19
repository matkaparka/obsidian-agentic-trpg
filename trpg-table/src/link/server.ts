import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { Logs } from '../log.js';
import type { TableLoop } from '../table/loop.js';
import type { LinkEventKind } from '../table/events.js';

const ALLOWED_ORIGINS = new Set(['http://localhost:3000', 'http://127.0.0.1:3000']);

/** 只有这些事件进 helixus-link；思考过程中的状态只留在 overlay。 */
const LINK_KINDS: Record<string, LinkEventKind> = {
  scene: 'scene',
  gm_narration: 'gm_narration',
  thought_beat: 'thought_beat',
  decision: 'decision',
  contrast: 'contrast',
  roll: 'roll',
  combat_start: 'combat_start',
  combat_end: 'combat_end',
  suggestion_result: 'suggestion_result',
  system: 'system',
  // 拿到 / 付出东西和钱：给 Helixus 当一条系统消息，他可以顺口说一句
  loot: 'system',
  gm_hint: 'gm_hint',
  // GM 写好并执行完的决定（导演稿）：给 Helixus 当「他自己的决定」去讲，观众看不到
  gm_decision: 'gm_decision',
  // 移动按「GM 叙述」给 Helixus：他需要知道 token 真的动了，但不改动 link 协议的事件种类。
  move: 'gm_narration',
};

export interface LinkServerOptions {
  port: number;
  loop: TableLoop;
  logs: Logs;
}

/**
 * helixus-link（127.0.0.1:8098）。协议与 vtuberplay README 一致：
 * GET /status、/events?after=、/trace；POST /command、/pause、/forget。
 * 只听回环、校验 Host、CORS 白名单、独占端口。
 */
export class LinkServer {
  private server: Server | null = null;

  constructor(private readonly opts: LinkServerOptions) {}

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      this.handle(req, res).catch((e) => {
        this.opts.logs.trace(`link 处理请求出错：${(e as Error).message}`);
        if (!res.headersSent) this.send(res, req, 500, { ok: false, code: 'internal_error' });
        else res.end();
      });
    });
    this.server = server;
    server.requestTimeout = 10_000;
    server.headersTimeout = 5_000;
    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(
          e.code === 'EADDRINUSE'
            ? new Error(`端口 ${this.opts.port} 已被占用（同一时间只能有一个游戏代理，先把旧的关掉）`)
            : e
        );
      };
      const onListening = () => {
        server.off('error', onError);
        this.opts.logs.trace(`helixus-link 已监听 http://127.0.0.1:${this.opts.port}`);
        resolve();
      };
      server.once('error', onError);
      server.once('listening', onListening);
      server.listen({ port: this.opts.port, host: '127.0.0.1', exclusive: true });
    });
  }

  async stop(): Promise<void> {
    const s = this.server;
    this.server = null;
    if (!s) return;
    await new Promise<void>((resolve) => s.close(() => resolve()));
  }

  /** 测试用：实际监听端口（port=0 时由系统分配） */
  address(): number | null {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? addr.port : null;
  }

  private hostOk(req: IncomingMessage): boolean {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    return host === '127.0.0.1' || host === 'localhost';
  }

  private originOk(req: IncomingMessage): { ok: boolean; origin?: string } {
    const origin = req.headers.origin;
    if (!origin) return { ok: true };
    return { ok: ALLOWED_ORIGINS.has(origin), origin };
  }

  private send(res: ServerResponse, req: IncomingMessage, status: number, body: unknown, origin?: string): void {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(data.length),
      'cache-control': 'no-store',
      ...(origin && ALLOWED_ORIGINS.has(origin)
        ? {
            'access-control-allow-origin': origin,
            vary: 'Origin',
            'access-control-allow-headers': 'Content-Type',
            'access-control-allow-methods': 'GET, POST, OPTIONS',
          }
        : {}),
    });
    res.end(data);
  }

  private async readJson(req: IncomingMessage, limit = 4096): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      const buf = chunk as Buffer;
      size += buf.length;
      if (size > limit) throw new Error('too_large');
      chunks.push(buf);
    }
    if (!size) return {};
    try {
      const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
      return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      throw new Error('bad_json');
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (!this.hostOk(req)) {
      this.send(res, req, 403, { ok: false, code: 'forbidden_host' });
      return;
    }
    const originState = this.originOk(req);
    if (!originState.ok) {
      this.send(res, req, 403, { ok: false, code: 'forbidden_origin' });
      return;
    }
    const origin = originState.origin;
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    const path = url.pathname;

    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        ...(origin
          ? {
              'access-control-allow-origin': origin,
              vary: 'Origin',
              'access-control-allow-headers': 'Content-Type',
              'access-control-allow-methods': 'GET, POST, OPTIONS',
            }
          : {}),
      });
      res.end();
      return;
    }

    if (req.method === 'GET') {
      if (path === '/status') {
        this.send(res, req, 200, this.opts.loop.status(), origin);
        return;
      }
      if (path === '/events') {
        const after = Number(url.searchParams.get('after') ?? '0');
        const { events, latest } = this.opts.loop.eventsAfter(Number.isFinite(after) ? Math.max(0, after) : 0);
        const mapped = events
          .map((e) => {
            const kind = LINK_KINDS[e.kind] ?? (e.kind === 'pause' ? 'system' : null);
            if (!kind) return null;
            return {
              seq: e.seq,
              at: e.at,
              kind,
              text: String(e.data?.linkText ?? e.text),
              urgency: e.urgency,
            };
          })
          .filter((e): e is NonNullable<typeof e> => !!e)
          .slice(-50);
        this.send(res, req, 200, { events: mapped, latest }, origin);
        return;
      }
      if (path === '/trace') {
        const limit = Number(url.searchParams.get('limit') ?? '50');
        this.send(res, req, 200, { trace: this.opts.logs.traceLines(Number.isFinite(limit) ? limit : 50) }, origin);
        return;
      }
      if (path === '/health') {
        this.send(res, req, 200, { ok: true, game: 'trpg', seq: this.opts.loop.status().latestEventSeq }, origin);
        return;
      }
      this.send(res, req, 404, { ok: false, code: 'not_found' }, origin);
      return;
    }

    if (req.method === 'POST') {
      let body: Record<string, unknown>;
      try {
        body = await this.readJson(req);
      } catch (e) {
        const code = (e as Error).message === 'too_large' ? 413 : 400;
        this.send(res, req, code, { ok: false, code: (e as Error).message }, origin);
        return;
      }
      if (path === '/command') {
        const text = typeof body.text === 'string' ? body.text : '';
        const r = this.opts.loop.addSuggestion(text);
        this.send(res, req, r.status, r.body, origin);
        return;
      }
      if (path === '/pause') {
        const paused = body.paused === true;
        this.opts.loop.setPaused(paused);
        this.send(res, req, 200, { ok: true, paused }, origin);
        return;
      }
      if (path === '/forget') {
        this.opts.loop.forget();
        this.send(res, req, 200, { ok: true }, origin);
        return;
      }
      this.send(res, req, 404, { ok: false, code: 'not_found' }, origin);
      return;
    }

    this.send(res, req, 405, { ok: false, code: 'method_not_allowed' }, origin);
  }
}
