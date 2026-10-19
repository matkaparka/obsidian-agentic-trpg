/**
 * The only network surface: a loopback HTTP server for MCP plus an SSE event stream.
 *
 * Hardening (deliberately not relaxed):
 *  - binds 127.0.0.1 only — nothing on the LAN can reach it;
 *  - every request needs the bearer token, compared in constant time;
 *  - the Host header must be a loopback name (defeats DNS rebinding) and any browser Origin is
 *    rejected outright (no CORS, so a web page cannot drive the bridge even with the token);
 *  - request bodies are capped, requests are rate limited, and POST needs JSON content type.
 */
import { createServer, type Server, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { McpServer } from './mcp/server';
import type { EventBus } from './events';

export interface HttpOpts {
  port: number;
  token: string;
  mcp: McpServer;
  bus: EventBus;
  maxPerMinute?: number;
  maxBodyBytes?: number;
  /** Extra info for /health. */
  status?: () => Record<string, unknown>;
}

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function hostOf(value: string | undefined): string {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return '';
  if (raw.startsWith('[')) return raw.slice(0, raw.indexOf(']') + 1);
  return raw.replace(/:\d+$/, '');
}

export function startHttp(o: HttpOpts): Promise<Server> {
  const hits: number[] = [];
  const limit = o.maxPerMinute ?? 120;
  const maxBody = o.maxBodyBytes ?? 1_000_000;

  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const send = (code: number, body: unknown, headers: Record<string, string> = {}) => {
      const payload = body === undefined ? '' : JSON.stringify(body);
      res.writeHead(code, {
        'content-type': 'application/json; charset=utf-8',
        'content-length': Buffer.byteLength(payload),
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
        ...headers,
      });
      res.end(payload);
    };

    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const path = url.pathname;

      // DNS rebinding + browser guards.
      if (!LOOPBACK.has(hostOf(req.headers.host))) return send(403, { error: 'bad host header (loopback only)' });
      if (req.headers.origin !== undefined) return send(403, { error: 'browser origins are not allowed' });
      if (req.method === 'OPTIONS') return send(403, { error: 'CORS is not enabled' });

      const auth = String(req.headers.authorization ?? '');
      const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : (url.searchParams.get('token') ?? '').trim();
      if (!token || !safeEq(token, o.token)) {
        return send(401, { error: 'unauthorized', hint: 'send Authorization: Bearer <token> (the token is in the plugin settings)' }, { 'www-authenticate': 'Bearer' });
      }

      if (req.method === 'GET' && path === '/health') {
        return send(200, {
          ok: true,
          pid: process.pid,
          events: o.bus.size(),
          oldestSeq: o.bus.oldest(),
          ...(o.status?.() ?? {}),
        });
      }

      if (req.method === 'GET' && path === '/events') {
        const lastId = Number(req.headers['last-event-id'] ?? url.searchParams.get('since') ?? 0);
        res.writeHead(200, {
          'content-type': 'text/event-stream; charset=utf-8',
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        });
        res.write('retry: 3000\n\n');
        const write = (e: any) => res.write(`id: ${e.seq}\nevent: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`);
        const missed = Number.isFinite(lastId) && lastId > 0 && lastId < o.bus.oldest() - 1;
        if (missed) res.write(`event: gap\ndata: ${JSON.stringify({ type: 'gap', requestedFrom: lastId, oldestSeq: o.bus.oldest() })}\n\n`);
        o.bus.since(Number.isFinite(lastId) ? lastId : 0).forEach(write);
        const off = o.bus.on(write);
        const keepAlive = setInterval(() => res.write(': keep-alive\n\n'), 15000);
        const close = () => { off(); clearInterval(keepAlive); };
        req.on('close', close);
        req.on('error', close);
        return;
      }

      if (path === '/mcp' && req.method === 'POST') {
        const now = Date.now();
        while (hits.length && hits[0] < now - 60_000) hits.shift();
        if (hits.length >= limit) return send(429, { error: 'rate limit', limit, windowSeconds: 60 });
        hits.push(now);

        const type = String(req.headers['content-type'] ?? '');
        if (!type.includes('application/json')) return send(415, { error: 'content-type must be application/json' });

        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of req) {
          size += (chunk as Buffer).length;
          if (size > maxBody) return send(413, { error: 'request body too large', maxBody });
          chunks.push(chunk as Buffer);
        }
        let msg: unknown;
        try {
          msg = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return send(400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
        }
        const reply = await o.mcp.handle(msg);
        if (reply === null) {
          res.writeHead(202, { 'content-length': 0 });
          res.end();
          return;
        }
        return send(200, reply);
      }

      if (path === '/mcp') {
        return send(405, { error: 'use POST for MCP; GET /events for the event stream', allow: 'POST' });
      }
      return send(404, { error: 'not found', paths: ['/mcp', '/events', '/health'] });
    } catch (e: any) {
      try { send(500, { error: e?.message ?? 'internal error' }); } catch { /* response already gone */ }
    }
  });

  server.headersTimeout = 20_000;
  server.requestTimeout = 30_000;
  server.keepAliveTimeout = 15_000;

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(o.port, '127.0.0.1', () => resolve(server));
  });
}
