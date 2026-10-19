import type { ProviderConfig, SeatConfig } from '../config.js';
import { apiKeyFor } from '../config.js';
import { httpRequest, sseFrames } from './http.js';
import {
  LLMError,
  type ChatClient,
  type CompleteRequest,
  type CompleteResult,
  type ContentPart,
  type Message,
  type Usage,
} from './types.js';

interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | unknown[] | null;
  tool_calls?: {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }[];
  tool_call_id?: string;
  reasoning_content?: string;
}

interface OpenAIChoice {
  message?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: { id?: string; function?: { name?: string; arguments?: string } }[];
  };
  delta?: {
    content?: string | null;
    reasoning_content?: string | null;
    tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[];
  };
  finish_reason?: string | null;
}

interface OpenAIResponse {
  choices?: OpenAIChoice[];
  usage?: Record<string, number> & { completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string; type?: string; code?: string | number };
}

function toOpenAIMessages(system: string | undefined, messages: Message[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = [];
  if (system) out.push({ role: 'system', content: system });
  for (const m of messages) {
    if (typeof m.content === 'string') {
      out.push({ role: m.role, content: m.content });
      continue;
    }
    const texts: string[] = [];
    const images: unknown[] = [];
    const toolUses: NonNullable<OpenAIMessage['tool_calls']> = [];
    const toolResults: { id: string; content: string }[] = [];
    for (const p of m.content as ContentPart[]) {
      if (p.type === 'text') texts.push(p.text);
      else if (p.type === 'image') {
        images.push({ type: 'image_url', image_url: { url: `data:${p.mimeType};base64,${p.data}` } });
      } else if (p.type === 'tool_use') {
        toolUses.push({ id: p.id, type: 'function', function: { name: p.name, arguments: JSON.stringify(p.input) } });
      } else if (p.type === 'tool_result') {
        toolResults.push({ id: p.toolUseId, content: p.content });
      }
    }
    const joined = texts.join('\n');
    if (toolResults.length) {
      for (const r of toolResults) out.push({ role: 'tool', tool_call_id: r.id, content: r.content });
      if (joined) out.push({ role: 'user', content: joined });
    } else if (m.role === 'assistant') {
      out.push({ role: 'assistant', content: joined || null, ...(toolUses.length ? { tool_calls: toolUses } : {}) });
    } else if (images.length) {
      out.push({ role: 'user', content: [...(joined ? [{ type: 'text', text: joined }] : []), ...images] });
    } else {
      out.push({ role: 'user', content: joined });
    }
  }
  return out;
}

function usageFrom(u: OpenAIResponse['usage']): Usage {
  return {
    inputTokens: u?.prompt_tokens ?? 0,
    outputTokens: u?.completion_tokens ?? 0,
    reasoningTokens: u?.completion_tokens_details?.reasoning_tokens,
    cacheReadTokens: u?.prompt_cache_hit_tokens,
  };
}

function errorKind(status: number, message: string): 'bad_request' | 'auth' | 'rate_limit' | 'server' {
  if (status === 401 || status === 403) return 'auth';
  if (status === 429) return 'rate_limit';
  if (status >= 500) return 'server';
  if (/insufficient|balance|quota|余额/i.test(message)) return 'bad_request';
  return 'bad_request';
}

export class OpenAICompatibleClient implements ChatClient {
  readonly provider: string;
  readonly kind = 'openai_compatible';
  private readonly key: string;

  constructor(
    providerName: string,
    private readonly cfg: ProviderConfig,
    private readonly seat: SeatConfig
  ) {
    this.provider = providerName;
    this.key = apiKeyFor(providerName, cfg);
  }

  private buildBody(req: CompleteRequest, stream: boolean): Record<string, unknown> {
    const temperature = req.temperature ?? this.seat.temperature;
    return {
      model: req.model ?? this.seat.model,
      messages: toOpenAIMessages(req.system, req.messages),
      max_tokens: req.maxTokens ?? this.seat.maxTokens,
      ...(temperature === null ? {} : { temperature }),
      ...(req.tools?.length
        ? {
            tools: req.tools.map((t) => ({
              type: 'function',
              function: { name: t.name, description: t.description, parameters: t.inputSchema },
            })),
          }
        : {}),
      ...(stream ? { stream: true, stream_options: { include_usage: true } } : {}),
    };
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const stream = !!req.stream;
    const timeoutMs = req.timeoutMs ?? this.seat.timeoutMs ?? this.cfg.timeoutMs;
    const res = await httpRequest({
      url: `${this.cfg.baseUrl}/chat/completions`,
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${this.key}` },
      body: this.buildBody(req, stream),
      timeoutMs,
      proxy: this.cfg.proxy,
      maxRetries: this.cfg.maxRetries,
      provider: this.provider,
      signal: req.signal,
      holdOpen: stream,
      label: `openai_compatible ${this.seat.model}`,
    });

    try {
      if (!stream) {
        const json = (await res.response.json()) as OpenAIResponse;
        if (json.error) {
          const msg = json.error.message ?? 'unknown error';
          throw new LLMError({ kind: errorKind(200, msg), provider: this.provider, message: `openai_compatible: ${msg}` });
        }
        const choice = json.choices?.[0];
        if (!choice?.message) {
          throw new LLMError({ kind: 'bad_response', provider: this.provider, message: '返回没有 choices' });
        }
        const text = choice.message.content ?? '';
        const reasoning = choice.message.reasoning_content ?? '';
        const toolCalls = (choice.message.tool_calls ?? []).map((t, i) => ({
          id: t.id ?? `call_${i}`,
          name: t.function?.name ?? '',
          input: parseArgs(t.function?.arguments),
        }));
        if (!text && !toolCalls.length) {
          throw new LLMError({ kind: 'bad_response', provider: this.provider, message: '返回空内容' });
        }
        return {
          text,
          reasoning: reasoning || null,
          reasoningKind: reasoning ? 'raw' : null,
          toolCalls,
          usage: usageFrom(json.usage),
          latencyMs: Date.now() - started,
          model: this.seat.model,
          provider: this.provider,
          stopReason: choice.finish_reason ?? null,
          attempts: res.attempts,
          requestId: res.requestId,
        };
      }

      let text = '';
      let reasoning = '';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      let finishReason: string | null = null;
      const tools = new Map<number, { id: string; name: string; args: string }>();

      for await (const frame of sseFrames(res.response)) {
        if (!frame.data || frame.data === '[DONE]') continue;
        let json: OpenAIResponse;
        try {
          json = JSON.parse(frame.data) as OpenAIResponse;
        } catch {
          continue;
        }
        if (json.error) {
          throw new LLMError({
            kind: errorKind(200, json.error.message ?? ''),
            provider: this.provider,
            message: `openai_compatible 流错误：${json.error.message ?? 'unknown'}`,
          });
        }
        if (json.usage) usage = usageFrom(json.usage);
        const choice = json.choices?.[0];
        if (!choice) continue;
        if (choice.finish_reason) finishReason = choice.finish_reason;
        const d = choice.delta;
        if (!d) continue;
        if (d.content) {
          text += d.content;
          req.onDelta?.({ text: d.content });
        }
        if (d.reasoning_content) {
          reasoning += d.reasoning_content;
          req.onDelta?.({ reasoning: d.reasoning_content });
        }
        for (const tc of d.tool_calls ?? []) {
          const idx = tc.index ?? 0;
          const cur = tools.get(idx) ?? { id: tc.id ?? `call_${idx}`, name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          tools.set(idx, cur);
        }
      }

      const toolCalls = [...tools.values()].map((t) => ({
        id: t.id,
        name: t.name,
        input: parseArgs(t.args),
      }));
      if (!text && !toolCalls.length) {
        throw new LLMError({ kind: 'bad_response', provider: this.provider, message: '流式返回空内容' });
      }
      return {
        text,
        reasoning: reasoning || null,
        reasoningKind: reasoning ? 'raw' : null,
        toolCalls,
        usage,
        latencyMs: Date.now() - started,
        model: this.seat.model,
        provider: this.provider,
        stopReason: finishReason,
        attempts: res.attempts,
        requestId: res.requestId,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      throw new LLMError({
        kind: 'bad_response',
        provider: this.provider,
        message: `openai_compatible 响应解析失败：${(e as Error).message}`,
      });
    } finally {
      res.cleanup();
    }
  }
}

function parseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    throw new LLMError({
      kind: 'bad_response',
      provider: 'openai_compatible',
      message: '工具参数不是合法 JSON',
    });
  }
}
