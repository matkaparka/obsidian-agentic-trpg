import { ProxyAgent, fetch as undiciFetch } from 'undici';
import { LLMError } from './types.js';
import { isLoopbackHost, scrub, sleep } from '../util.js';

const proxyAgents = new Map<string, ProxyAgent>();

/**
 * 每个 provider 自己决定走不走代理；回环地址永远不走。
 * 不读系统代理（Node 默认也不读，这里再钉死一次）。
 */
export function dispatcherFor(url: string, proxy: string | null): ProxyAgent | undefined {
  if (!proxy) return undefined;
  let host: string;
  try {
    host = new URL(url).hostname;
  } catch {
    return undefined;
  }
  if (isLoopbackHost(host)) return undefined;
  let agent = proxyAgents.get(proxy);
  if (!agent) {
    agent = new ProxyAgent(proxy);
    proxyAgents.set(proxy, agent);
  }
  return agent;
}

export interface HttpRequest {
  url: string;
  method?: 'GET' | 'POST';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs: number;
  proxy: string | null;
  maxRetries: number;
  provider: string;
  signal?: AbortSignal;
  /** 流式请求：把超时定时器留到读流结束（调用方负责调用 cleanup） */
  holdOpen?: boolean;
  /** 用于日志的去标识；不要放密钥或完整提示词 */
  label: string;
}

export interface HttpResult {
  response: Response;
  attempts: number;
  requestId?: string;
  cleanup: () => void;
}

class RetryableHttpError extends Error {
  constructor(
    readonly kind: 'timeout' | 'network' | 'server' | 'rate_limit',
    message: string,
    readonly status?: number,
    readonly retryAfterMs?: number
  ) {
    super(message);
  }
}

function retryDelayMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs && retryAfterMs > 0) return Math.min(retryAfterMs, 30_000);
  const base = 600 * 2 ** (attempt - 1);
  return Math.min(30_000, base + Math.floor(Math.random() * 400));
}

async function once(req: HttpRequest): Promise<HttpResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), req.timeoutMs);
  const external = req.signal;
  const onAbort = () => controller.abort(external?.reason);
  if (external) {
    if (external.aborted) controller.abort(external.reason);
    else external.addEventListener('abort', onAbort, { once: true });
  }
  const cleanup = () => {
    clearTimeout(timer);
    external?.removeEventListener('abort', onAbort);
  };
  try {
    const dispatcher = dispatcherFor(req.url, req.proxy);
    const init: Parameters<typeof undiciFetch>[1] = {
      method: req.method ?? 'POST',
      headers: req.headers,
      body: req.body === undefined ? undefined : JSON.stringify(req.body),
      signal: controller.signal,
      ...(dispatcher ? { dispatcher } : {}),
    };
    let response: Response;
    try {
      response = (await undiciFetch(req.url, init)) as unknown as Response;
    } catch (e) {
      if (external?.aborted) {
        throw new LLMError({ kind: 'cancelled', provider: req.provider, message: '已取消' });
      }
      if (controller.signal.aborted) {
        throw new RetryableHttpError('timeout', `请求超时（${req.timeoutMs}ms）`);
      }
      throw new RetryableHttpError('network', `网络错误：${(e as Error).message}`);
    }
    const requestId = response.headers.get('request-id') ?? response.headers.get('x-request-id') ?? undefined;
    if (response.ok) {
      if (!req.holdOpen) cleanup();
      return { response, attempts: 1, requestId, cleanup };
    }

    const text = await response.text().catch(() => '');
    const brief = scrub(text).slice(0, 500);
    if (response.status === 401 || response.status === 403) {
      throw new LLMError({
        kind: 'auth',
        provider: req.provider,
        status: response.status,
        message: `${req.label}: HTTP ${response.status} ${brief}`,
      });
    }
    if (response.status === 429) {
      const ra = Number(response.headers.get('retry-after') ?? '0') * 1000;
      throw new RetryableHttpError('rate_limit', `${req.label}: HTTP 429 ${brief}`, 429, ra || undefined);
    }
    if (response.status >= 500) {
      throw new RetryableHttpError('server', `${req.label}: HTTP ${response.status} ${brief}`, response.status);
    }
    if (response.status === 408) {
      throw new RetryableHttpError('timeout', `${req.label}: HTTP 408 ${brief}`, 408);
    }
    throw new LLMError({
      kind: 'bad_request',
      provider: req.provider,
      status: response.status,
      message: `${req.label}: HTTP ${response.status} ${brief}`,
    });
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** 发请求，带指数退避重试（最多 maxRetries 次重试）。 */
export async function httpRequest(req: HttpRequest): Promise<HttpResult> {
  let last: unknown;
  for (let attempt = 1; attempt <= req.maxRetries + 1; attempt++) {
    try {
      const result = await once(req);
      return { ...result, attempts: attempt };
    } catch (e) {
      last = e;
      if (e instanceof LLMError) throw e;
      if (!(e instanceof RetryableHttpError) || attempt > req.maxRetries) break;
      await sleep(retryDelayMs(attempt, e.retryAfterMs), req.signal);
    }
  }
  if (last instanceof LLMError) throw last;
  const err = last as RetryableHttpError;
  throw new LLMError({
    kind: err.kind,
    provider: req.provider,
    message: err.message,
    status: err.status,
    attempts: req.maxRetries + 1,
  });
}

export interface SseFrame {
  event?: string;
  data: string;
}

/** 读 SSE：按空行切帧，支持多行 data 与 \r\n。 */
export async function* sseFrames(response: Response): AsyncGenerator<SseFrame> {
  if (!response.body) return;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      buffer = buffer.replace(/\r\n/g, '\n');
      let cut: number;
      while ((cut = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, cut);
        buffer = buffer.slice(cut + 2);
        let event: string | undefined;
        const data: string[] = [];
        for (const line of frame.split('\n')) {
          if (!line || line.startsWith(':')) continue;
          if (line.startsWith('event:')) event = line.slice(6).trim();
          else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
        }
        if (data.length) yield { event, data: data.join('\n') };
      }
    }
  } finally {
    reader.releaseLock();
  }
}
