import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logs } from '../log.js';
import type { TableLoop } from '../table/loop.js';
import type { TableEvent } from '../table/events.js';
import { characterPath } from '../table/characters.js';
import type { SeatKey } from '../table/types.js';

const ALLOWED_ORIGINS = new Set(['http://127.0.0.1:8099', 'http://localhost:8099']);
const SPRITES = new Set(['neutral', 'happy', 'smug', 'angry', 'scared', 'surprised', 'thinking', 'hurt']);

export interface OverlayServerOptions {
  port: number;
  loop: TableLoop;
  config: AppConfig;
  logs: Logs;
  root: string;
  /** 配音合成好的 wav 放哪里；没给就不提供 /overlay/tts/ */
  ttsDir?: string;
}

/**
 * overlay（127.0.0.1:8099）。只做显示：静态页 + SSE；没有任何写操作。
 * 立绘从 campaign-vault/sprites/<seat>/<expression>.png 读，改了文件不用重启（页面轮询清单）。
 */
export class OverlayServer {
  private server: Server | null = null;

  constructor(private readonly opts: OverlayServerOptions) {}

  private spriteDir(seat: string): string {
    return join(this.opts.config.paths.campaignVault, 'sprites', seat);
  }

  async start(): Promise<void> {
    const server = createServer((req, res) => {
      try {
        this.handle(req, res);
      } catch (e) {
        this.opts.logs.trace(`overlay 请求出错：${(e as Error).message}`);
        if (!res.headersSent) res.writeHead(500).end('overlay error');
      }
    });
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      const onError = (e: NodeJS.ErrnoException) => {
        server.off('listening', onListening);
        reject(
          e.code === 'EADDRINUSE'
            ? new Error(`端口 ${this.opts.port} 已被占用（overlay 需要独占）`)
            : e
        );
      };
      const onListening = () => {
        server.off('error', onError);
        this.opts.logs.trace(`overlay 已监听 http://127.0.0.1:${this.opts.port}/overlay`);
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

  address(): number | null {
    const addr = this.server?.address();
    return addr && typeof addr === 'object' ? addr.port : null;
  }

  private handle(req: IncomingMessage, res: ServerResponse): void {
    const host = (req.headers.host ?? '').replace(/:\d+$/, '');
    if (host !== '127.0.0.1' && host !== 'localhost') {
      res.writeHead(403).end('forbidden host');
      return;
    }
    const origin = req.headers.origin;
    if (origin && !ALLOWED_ORIGINS.has(origin)) {
      res.writeHead(403).end('forbidden origin');
      return;
    }
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (url.pathname === '/' || url.pathname === '/overlay' || url.pathname === '/overlay/') {
      this.serveFile(res, join(this.opts.root, 'overlay', 'index.html'), 'text/html; charset=utf-8');
      return;
    }
    if (url.pathname === '/overlay/app.js') {
      this.serveFile(res, join(this.opts.root, 'overlay', 'app.js'), 'text/javascript; charset=utf-8');
      return;
    }
    if (url.pathname === '/overlay/style.css') {
      this.serveFile(res, join(this.opts.root, 'overlay', 'style.css'), 'text/css; charset=utf-8');
      return;
    }
    if (url.pathname === '/overlay/config') {
      this.json(res, 200, this.opts.config.overlay);
      return;
    }
    if (url.pathname === '/overlay/sprites') {
      this.json(res, 200, this.spriteManifest());
      return;
    }
    if (url.pathname === '/overlay/demo') {
      this.json(res, 200, this.demoData());
      return;
    }
    if (url.pathname === '/overlay/events') {
      this.sse(req, res);
      return;
    }
    const tts = /^\/overlay\/tts\/([a-f0-9]{20})\.wav$/.exec(url.pathname);
    if (tts) {
      this.serveAudio(req, res, this.opts.ttsDir ? join(this.opts.ttsDir, `${tts[1]}.wav`) : '');
      return;
    }
    const m = /^\/sprites\/(player_[ab])\/([a-z]+)\.png$/.exec(url.pathname);
    if (m) {
      if (!SPRITES.has(m[2])) {
        res.writeHead(404).end('no sprite');
        return;
      }
      this.serveFile(res, join(this.spriteDir(m[1]), `${m[2]}.png`), 'image/png', true);
      return;
    }
    res.writeHead(404).end('not found');
  }

  private json(res: ServerResponse, status: number, body: unknown): void {
    const data = Buffer.from(JSON.stringify(body), 'utf8');
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(data.length),
      'cache-control': 'no-store',
    });
    res.end(data);
  }

  private serveFile(res: ServerResponse, path: string, type: string, noCache = false): void {
    if (!existsSync(path)) {
      if (type === 'image/png') {
        res.writeHead(404).end('missing');
      } else {
        res.writeHead(404).end('missing');
      }
      return;
    }
    const data = readFileSync(path);
    res.writeHead(200, {
      'content-type': type,
      'content-length': String(data.length),
      // 立绘要 no-cache（热更新），页面/脚本/样式要 no-store（改完立刻生效）
      'cache-control': noCache ? 'no-cache, max-age=0' : 'no-store',
    });
    res.end(data);
  }

  /** 配音的 wav：文件名是内容哈希，内容不会变，所以可以缓存；支持 Range（<audio> 常用）。 */
  private serveAudio(req: IncomingMessage, res: ServerResponse, path: string): void {
    if (!path || !existsSync(path)) {
      res.writeHead(404).end('missing');
      return;
    }
    const data = readFileSync(path);
    const headers = { 'content-type': 'audio/wav', 'accept-ranges': 'bytes', 'cache-control': 'public, max-age=86400, immutable' };
    const range = /^bytes=(\d*)-(\d*)$/.exec(String(req.headers.range ?? ''));
    if (range && (range[1] || range[2])) {
      const start = range[1] ? Number(range[1]) : Math.max(0, data.length - Number(range[2]));
      const end = range[1] && range[2] ? Math.min(Number(range[2]), data.length - 1) : data.length - 1;
      if (start >= data.length || start > end) {
        res.writeHead(416, { 'content-range': `bytes */${data.length}` }).end();
        return;
      }
      const part = data.subarray(start, end + 1);
      res.writeHead(206, { ...headers, 'content-range': `bytes ${start}-${end}/${data.length}`, 'content-length': String(part.length) });
      res.end(part);
      return;
    }
    res.writeHead(200, { ...headers, 'content-length': String(data.length) });
    res.end(data);
  }

  private spriteManifest(): Record<string, Record<string, number>> {
    const out: Record<string, Record<string, number>> = { player_a: {}, player_b: {} };
    for (const seat of ['player_a', 'player_b']) {
      for (const name of SPRITES) {
        const p = join(this.spriteDir(seat), `${name}.png`);
        try {
          out[seat][name] = Math.round(statSync(p).mtimeMs);
        } catch {
          /* 缺图 */
        }
      }
    }
    return out;
  }

  /**
   * 演示数据只做压力测试：按座位各取该座位最后一条真实 player_turn，
   * 绝不能把 A 的台词放到 B 的位置。画面会显示「演示数据」。
   */
  private demoData(): Record<string, unknown> {
    const out: Record<string, unknown> = { narration: '' };
    const file = join(this.opts.config.paths.logs, 'table.jsonl');
    if (!existsSync(file)) return out;
    const latest: Record<string, Record<string, unknown>> = {};
    let narration = '';
    for (const line of readFileSync(file, 'utf8').split(/\r?\n/)) {
      if (!line.trim()) continue;
      let rec: any;
      try {
        rec = JSON.parse(line);
      } catch {
        continue;
      }
      if (rec.kind === 'gm_turn' && rec.narration) narration = String(rec.narration);
      if (rec.kind === 'gm_narration' && rec.text) narration = String(rec.text);
      if (rec.kind !== 'player_turn' || !rec.seat || !rec.decision) continue;
      const bubble = String(rec.renderer?.bubble ?? rec.renderer?.beats?.[0]?.text ?? '').trim();
      latest[rec.seat] = {
        name: this.characterName(rec.seat),
        hp: 24,
        maxHp: 24,
        expression: rec.decision.expression ?? 'neutral',
        bubble,
        say: rec.decision.say ?? '',
      };
    }
    out.narration = narration;
    for (const seat of ['player_a', 'player_b']) if (latest[seat]) out[seat] = latest[seat];
    // 面板 / 章节 / 先攻用桌面此刻的真实状态（只有气泡和台词取自日志里各座位最后一个真实回合）
    try {
      const st = this.opts.loop.overlayState() as Record<string, any>;
      out.adventure = st.adventure ?? '';
      out.scene = st.scene ?? '';
      out.combat = !!st.combat;
      out.round = st.round ?? 1;
      out.combatRound = st.combatRound ?? null;
      out.beats = st.beats ?? null;
      out.initiative = st.initiative ?? [];
      out.activeSeat = st.activeSeat ?? null;
      if (!out.narration && st.narration) out.narration = st.narration;
      for (const p of (st.players ?? []) as Record<string, any>[]) {
        const seat = String(p.seat);
        const cur = (out[seat] ?? {}) as Record<string, unknown>;
        out[seat] = {
          ...cur,
          name: p.name ?? cur.name,
          role: p.role ?? '',
          hp: p.hp,
          maxHp: p.maxHp,
          ac: p.ac,
          gold: p.gold ?? '',
          conditions: p.conditions ?? [],
          tags: p.tags ?? [],
          expression: p.expression ?? cur.expression ?? 'neutral',
        };
      }
    } catch {
      /* 桌面还没起来：面板留空 */
    }
    return out;
  }

  private characterName(seat: string): string {
    const fallback = seat === 'player_b' ? '玩家 B' : '玩家 A';
    try {
      const raw = JSON.parse(
        readFileSync(characterPath(this.opts.config.paths.campaignVault, seat as SeatKey, this.opts.config.table.characterSet), 'utf8')
      );
      return String(raw.name ?? fallback);
    } catch {
      return fallback;
    }
  }

  private sse(req: IncomingMessage, res: ServerResponse): void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
      ...(req.headers.origin ? { 'access-control-allow-origin': req.headers.origin } : {}),
    });
    const write = (event: TableEvent | { seq: number; kind: string; text: string; at: number; data: unknown }) => {
      res.write(`id: ${event.seq}\n`);
      res.write(`event: ${event.kind}\n`);
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    // 首帧：当前状态（不发事件，不改 seq）
    const state = this.opts.loop.overlayState();
    write({
      seq: Number(state.seq ?? 0),
      kind: 'state',
      text: '初始状态',
      at: Date.now(),
      data: state,
    });

    const off = this.opts.loop.bus.subscribe((e) => {
      // gm_hint 是给 Helixus 的剧透、gm_decision 是给 Helixus 的导演稿，overlay 永远不显示（观众只看得到旁白）；
      // 原始思维链本来就不在事件里
      if (e.kind === 'gm_hint' || e.kind === 'gm_decision') return;
      write(e);
    });
    const keep = setInterval(() => res.write(': keep-alive\n\n'), 15_000);
    keep.unref?.();
    const close = () => {
      clearInterval(keep);
      off();
      try {
        res.end();
      } catch {
        /* 已断开 */
      }
    };
    req.on('close', close);
    req.on('error', close);
  }
}
