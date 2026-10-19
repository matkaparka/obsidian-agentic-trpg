import type { AppConfig, SeatConfig, SeatId } from '../config.js';
import type { Logs } from '../log.js';
import { AnthropicClient } from './anthropic.js';
import { GeminiClient } from './gemini.js';
import { OpenAICompatibleClient } from './openai.js';
import type { ChatClient, CompleteRequest, CompleteResult } from './types.js';
import { LLMError } from './types.js';

export * from './types.js';
export { LLMError } from './types.js';

export function createClient(seat: SeatConfig, config: AppConfig): ChatClient {
  const provider = config.models.providers[seat.provider];
  if (!provider) throw new LLMError({ kind: 'config', provider: seat.provider, message: `未知 provider「${seat.provider}」` });
  switch (provider.kind) {
    case 'anthropic':
      return new AnthropicClient(seat.provider, provider, seat);
    case 'gemini':
      return new GeminiClient(seat.provider, provider, seat);
    case 'openai_compatible':
      return new OpenAICompatibleClient(seat.provider, provider, seat);
    default:
      throw new LLMError({
        kind: 'config',
        provider: seat.provider,
        message: `不支持的 provider kind：${provider.kind as string}`,
      });
  }
}

/**
 * 所有模型调用的唯一入口：按座位取客户端、记 usage、统一的错误类型。
 * 密钥只在客户端内部，不经过这里，也不进日志。
 */
export class LLM {
  private readonly clients = new Map<SeatId, ChatClient>();

  constructor(
    private readonly config: AppConfig,
    private readonly logs?: Logs
  ) {}

  seat(id: SeatId): SeatConfig {
    return this.config.models.seats[id];
  }

  client(id: SeatId): ChatClient {
    let c = this.clients.get(id);
    if (!c) {
      c = createClient(this.seat(id), this.config);
      this.clients.set(id, c);
    }
    return c;
  }

  async complete(id: SeatId, req: CompleteRequest, purpose: string): Promise<CompleteResult> {
    const seat = this.seat(id);
    const started = Date.now();
    try {
      const result = await this.client(id).complete(req);
      this.logs?.usage.record({
        seat: id,
        purpose,
        provider: result.provider,
        model: result.model,
        inputTokens: result.usage.inputTokens,
        outputTokens: result.usage.outputTokens,
        reasoningTokens: result.usage.reasoningTokens ?? null,
        cacheReadTokens: result.usage.cacheReadTokens ?? null,
        cacheWriteTokens: result.usage.cacheWriteTokens ?? null,
        latencyMs: result.latencyMs,
        attempts: result.attempts,
        ok: true,
        reasoningKind: result.reasoningKind,
      });
      return result;
    } catch (e) {
      const err = e instanceof LLMError ? e : new LLMError({ kind: 'bad_response', provider: seat.provider, message: String(e) });
      this.logs?.usage.record({
        seat: id,
        purpose,
        provider: seat.provider,
        model: seat.model,
        inputTokens: 0,
        outputTokens: 0,
        latencyMs: Date.now() - started,
        attempts: err.attempts,
        ok: false,
        errorKind: err.kind,
        error: err.message.slice(0, 300),
      });
      throw err;
    }
  }
}
