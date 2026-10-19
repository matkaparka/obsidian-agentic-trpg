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

const ANTHROPIC_VERSION = '2023-06-01';

interface AnthropicContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
}

function toAnthropicContent(parts: string | ContentPart[]): unknown {
  if (typeof parts === 'string') return parts;
  return parts.map((p) => {
    switch (p.type) {
      case 'text':
        return { type: 'text', text: p.text };
      case 'image':
        return { type: 'image', source: { type: 'base64', media_type: p.mimeType, data: p.data } };
      case 'tool_use':
        return { type: 'tool_use', id: p.id, name: p.name, input: p.input };
      case 'tool_result':
        return {
          type: 'tool_result',
          tool_use_id: p.toolUseId,
          content: p.content,
          ...(p.isError ? { is_error: true } : {}),
        };
      default:
        return { type: 'text', text: '' };
    }
  });
}

export class AnthropicClient implements ChatClient {
  readonly provider: string;
  readonly kind = 'anthropic';
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
    const tools = req.tools?.map((t, i) => ({
      name: t.name,
      description: t.description,
      input_schema: t.inputSchema,
      // 最后一个工具打缓存点：GM 的工具 schema 很大，同一场对话里重复使用能省 90% 输入。
      ...(i === (req.tools?.length ?? 0) - 1 ? { cache_control: { type: 'ephemeral' } } : {}),
    }));
    return {
      model: req.model ?? this.seat.model,
      max_tokens: req.maxTokens ?? this.seat.maxTokens,
      ...(temperature === null ? {} : { temperature }),
      ...(req.system
        ? { system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }] }
        : {}),
      messages: req.messages.map((m: Message) => ({
        role: m.role,
        content: toAnthropicContent(m.content),
      })),
      ...(tools?.length ? { tools } : {}),
      ...(stream ? { stream: true } : {}),
    };
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const stream = !!req.stream;
    const timeoutMs = req.timeoutMs ?? this.seat.timeoutMs ?? this.cfg.timeoutMs;
    const res = await httpRequest({
      url: `${this.cfg.baseUrl}/v1/messages`,
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': this.key,
        'anthropic-version': this.cfg.apiVersion ?? ANTHROPIC_VERSION,
      },
      body: this.buildBody(req, stream),
      timeoutMs,
      proxy: this.cfg.proxy,
      maxRetries: this.cfg.maxRetries,
      provider: this.provider,
      signal: req.signal,
      holdOpen: stream,
      label: `anthropic ${this.seat.model}`,
    });

    try {
      if (!stream) {
        const json = (await res.response.json()) as {
          content?: AnthropicContentBlock[];
          usage?: Record<string, number>;
          stop_reason?: string | null;
        };
        const blocks = json.content ?? [];
        const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('');
        const reasoning = blocks.filter((b) => b.type === 'thinking').map((b) => b.thinking ?? '').join('');
        const toolCalls = blocks
          .filter((b) => b.type === 'tool_use')
          .map((b) => ({ id: b.id ?? '', name: b.name ?? '', input: b.input ?? {} }));
        const usage = usageFrom(json.usage);
        if (!text && toolCalls.length === 0) {
          throw new LLMError({ kind: 'bad_response', provider: this.provider, message: 'anthropic 返回空内容' });
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
          stopReason: json.stop_reason ?? null,
          attempts: res.attempts,
          requestId: res.requestId,
        };
      }

      let text = '';
      let reasoning = '';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      let stopReason: string | null = null;
      const toolBlocks = new Map<number, { id: string; name: string; json: string }>();
      let requestId = res.requestId;

      for await (const frame of sseFrames(res.response)) {
        if (!frame.data || frame.data === '[DONE]') continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(frame.data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const type = ev.type as string;
        if (type === 'message_start') {
          const msg = ev.message as { id?: string; usage?: Record<string, number> } | undefined;
          if (msg?.usage) usage = usageFrom(msg.usage);
          if (msg?.id) requestId = msg.id;
        } else if (type === 'content_block_start') {
          const idx = ev.index as number;
          const block = ev.content_block as AnthropicContentBlock;
          if (block?.type === 'tool_use') {
            toolBlocks.set(idx, { id: block.id ?? '', name: block.name ?? '', json: '' });
          }
        } else if (type === 'content_block_delta') {
          const idx = ev.index as number;
          const delta = ev.delta as { type?: string; text?: string; thinking?: string; partial_json?: string };
          if (delta?.type === 'text_delta' && delta.text) {
            text += delta.text;
            req.onDelta?.({ text: delta.text });
          } else if (delta?.type === 'thinking_delta' && delta.thinking) {
            reasoning += delta.thinking;
            req.onDelta?.({ reasoning: delta.thinking });
          } else if (delta?.type === 'input_json_delta' && delta.partial_json) {
            const b = toolBlocks.get(idx);
            if (b) b.json += delta.partial_json;
          }
        } else if (type === 'message_delta') {
          const d = ev.delta as { stop_reason?: string } | undefined;
          if (d?.stop_reason) stopReason = d.stop_reason;
          const u = ev.usage as Record<string, number> | undefined;
          if (u?.output_tokens !== undefined) usage = { ...usage, outputTokens: u.output_tokens };
        } else if (type === 'error') {
          const err = ev.error as { type?: string; message?: string } | undefined;
          const kind = err?.type === 'rate_limit_error' ? 'rate_limit' : err?.type === 'authentication_error' ? 'auth' : 'server';
          throw new LLMError({
            kind,
            provider: this.provider,
            message: `anthropic 流错误：${err?.message ?? 'unknown'}`,
          });
        }
      }

      const toolCalls = [...toolBlocks.values()].map((b) => {
        let input: Record<string, unknown> = {};
        if (b.json) {
          try {
            input = JSON.parse(b.json) as Record<string, unknown>;
          } catch {
            throw new LLMError({
              kind: 'bad_response',
              provider: this.provider,
              message: 'anthropic 工具参数不是合法 JSON',
            });
          }
        }
        return { id: b.id, name: b.name, input };
      });

      if (!text && toolCalls.length === 0) {
        throw new LLMError({ kind: 'bad_response', provider: this.provider, message: 'anthropic 流式返回空内容' });
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
        stopReason,
        attempts: res.attempts,
        requestId,
      };
    } catch (e) {
      if (e instanceof LLMError) throw e;
      throw new LLMError({
        kind: 'bad_response',
        provider: this.provider,
        message: `anthropic 响应解析失败：${(e as Error).message}`,
      });
    } finally {
      res.cleanup();
    }
  }
}

function usageFrom(u: Record<string, number> | undefined): Usage {
  return {
    inputTokens: u?.input_tokens ?? 0,
    outputTokens: u?.output_tokens ?? 0,
    cacheReadTokens: u?.cache_read_input_tokens,
    cacheWriteTokens: u?.cache_creation_input_tokens,
  };
}
