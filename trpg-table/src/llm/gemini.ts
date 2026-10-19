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

interface GeminiPart {
  text?: string;
  thought?: boolean;
  functionCall?: { name?: string; args?: Record<string, unknown> };
  functionResponse?: { name?: string; response?: unknown };
  inlineData?: { mimeType?: string; data?: string };
}

interface GeminiCandidate {
  content?: { parts?: GeminiPart[]; role?: string };
  finishReason?: string;
}

interface GeminiResponse {
  candidates?: GeminiCandidate[];
  usageMetadata?: Record<string, number>;
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

function modelId(model: string): string {
  return model.replace(/^models\//, '');
}

function toGeminiParts(parts: string | ContentPart[]): GeminiPart[] {
  if (typeof parts === 'string') return parts ? [{ text: parts }] : [];
  const out: GeminiPart[] = [];
  for (const p of parts) {
    switch (p.type) {
      case 'text':
        out.push({ text: p.text });
        break;
      case 'image':
        out.push({ inlineData: { mimeType: p.mimeType, data: p.data } });
        break;
      case 'tool_use':
        out.push({ functionCall: { name: p.name, args: p.input } });
        break;
      case 'tool_result':
        out.push({
          functionResponse: {
            name: p.name ?? p.toolUseId,
            response: { result: p.content, ...(p.isError ? { error: true } : {}) },
          },
        });
        break;
    }
  }
  return out;
}

function toContents(messages: Message[]): { role: 'user' | 'model'; parts: GeminiPart[] }[] {
  const out: { role: 'user' | 'model'; parts: GeminiPart[] }[] = [];
  for (const m of messages) {
    const role = m.role === 'assistant' ? 'model' : 'user';
    const parts = toGeminiParts(m.content);
    const last = out[out.length - 1];
    if (last && last.role === role) last.parts.push(...parts);
    else out.push({ role, parts });
  }
  // Gemini 要求对话以 user 开头
  if (out.length === 0 || out[0].role !== 'user') out.unshift({ role: 'user', parts: [{ text: '(开始)' }] });
  return out;
}

function usageFrom(u: Record<string, number> | undefined): Usage {
  return {
    inputTokens: u?.promptTokenCount ?? 0,
    outputTokens: u?.candidatesTokenCount ?? 0,
    reasoningTokens: u?.thoughtsTokenCount,
    cacheReadTokens: u?.cachedContentTokenCount,
  };
}

export class GeminiClient implements ChatClient {
  readonly provider: string;
  readonly kind = 'gemini';
  private readonly key: string;

  constructor(
    providerName: string,
    private readonly cfg: ProviderConfig,
    private readonly seat: SeatConfig
  ) {
    this.provider = providerName;
    this.key = apiKeyFor(providerName, cfg);
  }

  private buildBody(req: CompleteRequest): Record<string, unknown> {
    const wantThoughts = this.seat.reasoning !== 'none';
    const temperature = req.temperature ?? this.seat.temperature;
    return {
      ...(req.system ? { systemInstruction: { parts: [{ text: req.system }] } } : {}),
      contents: toContents(req.messages),
      generationConfig: {
        maxOutputTokens: req.maxTokens ?? this.seat.maxTokens,
        ...(temperature === null ? {} : { temperature }),
        ...(wantThoughts
          ? {
              thinkingConfig: {
                includeThoughts: true,
                ...(this.seat.thinkingBudget ? { thinkingBudget: this.seat.thinkingBudget } : {}),
              },
            }
          : {}),
      },
      ...(req.tools?.length
        ? {
            tools: [
              {
                functionDeclarations: req.tools.map((t) => ({
                  name: t.name,
                  description: t.description,
                  parameters: t.inputSchema,
                })),
              },
            ],
          }
        : {}),
    };
  }

  async complete(req: CompleteRequest): Promise<CompleteResult> {
    const started = Date.now();
    const stream = !!req.stream;
    const timeoutMs = req.timeoutMs ?? this.seat.timeoutMs ?? this.cfg.timeoutMs;
    const version = this.cfg.apiVersion ?? 'v1beta';
    const model = modelId(req.model ?? this.seat.model);
    const method = stream ? 'streamGenerateContent' : 'generateContent';
    const url = `${this.cfg.baseUrl}/${version}/models/${encodeURIComponent(model)}:${method}${stream ? '?alt=sse' : ''}`;

    const res = await httpRequest({
      url,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': this.key },
      body: this.buildBody(req),
      timeoutMs,
      proxy: this.cfg.proxy,
      maxRetries: this.cfg.maxRetries,
      provider: this.provider,
      signal: req.signal,
      holdOpen: stream,
      label: `gemini ${model}`,
    });

    try {
      if (!stream) {
        const json = (await res.response.json()) as GeminiResponse;
        if (json.error) {
          throw new LLMError({
            kind: 'bad_request',
            provider: this.provider,
            message: `gemini: ${json.error.message ?? 'unknown error'}`,
          });
        }
        return this.finishSingle(json, started, res.attempts, model);
      }

      let text = '';
      let reasoning = '';
      let usage: Usage = { inputTokens: 0, outputTokens: 0 };
      let finishReason: string | null = null;
      const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];

      for await (const frame of sseFrames(res.response)) {
        if (!frame.data || frame.data === '[DONE]') continue;
        let json: GeminiResponse;
        try {
          json = JSON.parse(frame.data) as GeminiResponse;
        } catch {
          continue;
        }
        if (json.error) {
          throw new LLMError({
            kind: 'bad_request',
            provider: this.provider,
            message: `gemini 流错误：${json.error.message ?? 'unknown'}`,
          });
        }
        if (json.usageMetadata) usage = usageFrom(json.usageMetadata);
        const cand = json.candidates?.[0];
        if (!cand) continue;
        if (cand.finishReason) finishReason = cand.finishReason;
        for (const part of cand.content?.parts ?? []) {
          if (typeof part.text === 'string' && part.text) {
            if (part.thought) {
              reasoning += part.text;
              req.onDelta?.({ reasoning: part.text });
            } else {
              text += part.text;
              req.onDelta?.({ text: part.text });
            }
          }
          if (part.functionCall?.name) {
            toolCalls.push({
              id: `gemini_${toolCalls.length}_${Date.now()}`,
              name: part.functionCall.name,
              input: part.functionCall.args ?? {},
            });
          }
        }
      }

      if (!text && toolCalls.length === 0) {
        throw new LLMError({ kind: 'bad_response', provider: this.provider, message: 'gemini 流式返回空内容' });
      }
      return {
        text,
        // 文档与界面都照实写：Gemini 给的是思考摘要，不是原文
        reasoning: reasoning || null,
        reasoningKind: reasoning ? 'summary' : null,
        toolCalls,
        usage,
        latencyMs: Date.now() - started,
        model,
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
        message: `gemini 响应解析失败：${(e as Error).message}`,
      });
    } finally {
      res.cleanup();
    }
  }

  private finishSingle(json: GeminiResponse, started: number, attempts: number, model: string): CompleteResult {
    const cand = json.candidates?.[0];
    if (!cand) {
      const block = json.promptFeedback?.blockReason;
      throw new LLMError({
        kind: 'bad_response',
        provider: this.provider,
        message: block ? `gemini 拒绝了请求：${block}` : 'gemini 返回没有 candidates',
      });
    }
    let text = '';
    let reasoning = '';
    const toolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
    for (const part of cand.content?.parts ?? []) {
      if (typeof part.text === 'string' && part.text) {
        if (part.thought) reasoning += part.text;
        else text += part.text;
      }
      if (part.functionCall?.name) {
        toolCalls.push({
          id: `gemini_${toolCalls.length}_${Date.now()}`,
          name: part.functionCall.name,
          input: part.functionCall.args ?? {},
        });
      }
    }
    if (!text && toolCalls.length === 0) {
      throw new LLMError({
        kind: 'bad_response',
        provider: this.provider,
        message: `gemini 返回空内容（finishReason=${cand.finishReason ?? '?'}）`,
      });
    }
    return {
      text,
      reasoning: reasoning || null,
      reasoningKind: reasoning ? 'summary' : null,
      toolCalls,
      usage: usageFrom(json.usageMetadata),
      latencyMs: Date.now() - started,
      model,
      provider: this.provider,
      stopReason: cand.finishReason ?? null,
      attempts,
    };
  }
}
