import { uuid } from '../util.js';

export interface AtlasTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface AtlasToolResult {
  ok: boolean;
  text: string;
  image?: { mimeType: string; data: string };
  error?: string;
}

export interface AtlasClientOptions {
  url: string;
  token: string;
  timeoutMs?: number;
}

interface RpcResponse {
  jsonrpc?: string;
  id?: string;
  result?: unknown;
  error?: { code?: number; message?: string; data?: unknown };
}

/**
 * 直接跟 atlas-agent-link 的 MCP over HTTP 说话（协议见它的 docs/INTEGRATION.md）。
 * 没有 SDK：JSON-RPC 2.0 + fetch。token 只在 header 里，不打印。
 */
export class AtlasClient {
  private readonly url: string;
  private readonly token: string;
  private readonly timeoutMs: number;
  private seq = 0;

  constructor(opts: AtlasClientOptions) {
    this.url = opts.url.replace(/\/+$/, '');
    this.token = opts.token;
    this.timeoutMs = opts.timeoutMs ?? 15000;
  }

  private async rpc(method: string, params?: unknown): Promise<unknown> {
    const id = `trpg-${++this.seq}-${uuid().slice(0, 8)}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), this.timeoutMs);
    try {
      const res = await fetch(`${this.url}/mcp`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          authorization: `Bearer ${this.token}`,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
        signal: controller.signal,
      });
      if (res.status === 202) return null;
      const text = await res.text();
      if (!res.ok) {
        throw new Error(`Atlas HTTP ${res.status}：${text.slice(0, 300)}`);
      }
      // 正常情况下是 JSON；如果 Atlas 回了 SSE，就取最后一个 data 帧
      let body: RpcResponse;
      if (text.trimStart().startsWith('{')) {
        body = JSON.parse(text) as RpcResponse;
      } else {
        const frames = text
          .split(/\n\n/)
          .map((f) => f.split(/\n/).find((l) => l.startsWith('data:'))?.slice(5).trim())
          .filter((x): x is string => !!x);
        const last = frames[frames.length - 1];
        if (!last) throw new Error('Atlas 返回了空响应');
        body = JSON.parse(last) as RpcResponse;
      }
      if (body.error) throw new Error(`Atlas JSON-RPC ${body.error.code ?? ''}: ${body.error.message ?? ''}`);
      return body.result;
    } finally {
      clearTimeout(timer);
    }
  }

  async health(): Promise<{ ok: boolean; writes?: boolean; atlasVersion?: string; mapPath?: string; events?: number }> {
    const res = await fetch(`${this.url}/health`, {
      headers: { authorization: `Bearer ${this.token}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`Atlas /health HTTP ${res.status}`);
    return (await res.json()) as { ok: boolean; writes?: boolean; atlasVersion?: string; mapPath?: string; events?: number };
  }

  async listTools(): Promise<AtlasTool[]> {
    const result = (await this.rpc('tools/list', {})) as { tools?: AtlasTool[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown> = {}): Promise<AtlasToolResult> {
    const result = (await this.rpc('tools/call', { name, arguments: args })) as
      | { content?: { type: string; text?: string; data?: string; mimeType?: string }[]; isError?: boolean }
      | undefined;
    const text = result?.content?.find((c) => c.type === 'text')?.text ?? '';
    const image = result?.content?.find((c) => c.type === 'image');
    if (result?.isError) {
      return { ok: false, text, error: text };
    }
    return {
      ok: true,
      text,
      ...(image?.data ? { image: { mimeType: image.mimeType ?? 'image/png', data: image.data } } : {}),
    };
  }

  async callJson<T = Record<string, unknown>>(name: string, args: Record<string, unknown> = {}): Promise<T> {
    const r = await this.callTool(name, args);
    if (!r.ok) throw new Error(r.error || `${name} 失败`);
    try {
      return (r.text ? JSON.parse(r.text) : {}) as T;
    } catch {
      throw new Error(`${name} 的返回不是 JSON`);
    }
  }
}
