export type ChatRole = 'user' | 'assistant';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mimeType: string; data: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; toolUseId: string; name?: string; content: string; isError?: boolean };

export interface Message {
  role: ChatRole;
  content: string | ContentPart[];
}

export interface ToolSpec {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type ReasoningKind = 'raw' | 'summary';

export interface Delta {
  text?: string;
  reasoning?: string;
}

export interface CompleteRequest {
  /** 覆盖座位配置的模型 ID（探测时用） */
  model?: string;
  system?: string;
  messages: Message[];
  tools?: ToolSpec[];
  maxTokens?: number;
  /** null = provider 不发 temperature（新版 Claude 已弃用） */
  temperature?: number | null;
  stream?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  onDelta?: (delta: Delta) => void;
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
  reasoningTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface CompleteResult {
  text: string;
  /** 只有 provider 真给了才非 null；Gemini 的是摘要，不是原文 */
  reasoning: string | null;
  reasoningKind: ReasoningKind | null;
  toolCalls: ToolCall[];
  usage: Usage;
  latencyMs: number;
  model: string;
  provider: string;
  stopReason: string | null;
  attempts: number;
  requestId?: string;
}

export type LLMErrorKind =
  | 'auth'
  | 'rate_limit'
  | 'timeout'
  | 'network'
  | 'bad_request'
  | 'server'
  | 'bad_response'
  | 'unsupported'
  | 'cancelled'
  | 'config';

const RETRYABLE: ReadonlySet<LLMErrorKind> = new Set(['rate_limit', 'timeout', 'network', 'server', 'bad_response']);

export class LLMError extends Error {
  readonly kind: LLMErrorKind;
  readonly provider: string;
  readonly status?: number;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly detail?: string;

  constructor(opts: {
    kind: LLMErrorKind;
    provider: string;
    message: string;
    status?: number;
    attempts?: number;
    detail?: string;
  }) {
    super(opts.message);
    this.name = 'LLMError';
    this.kind = opts.kind;
    this.provider = opts.provider;
    this.status = opts.status;
    this.retryable = RETRYABLE.has(opts.kind);
    this.attempts = opts.attempts ?? 1;
    this.detail = opts.detail;
  }

  /** 给用户看的短句（不含请求内容和密钥） */
  userHint(): string {
    switch (this.kind) {
      case 'auth':
        return `「${this.provider}」鉴权失败：检查 .env 里的密钥是否有效`;
      case 'rate_limit':
        return `「${this.provider}」限流：稍等再试`;
      case 'timeout':
        return `「${this.provider}」超时`;
      case 'network':
        return `「${this.provider}」网络不通（本地请求不能走代理；Gemini 经代理时若报 User location is not supported，是节点地区问题）`;
      case 'server':
        return `「${this.provider}」服务端错误`;
      case 'bad_request':
        return `「${this.provider}」请求被拒绝：模型 ID 或参数可能不对`;
      case 'bad_response':
        return `「${this.provider}」返回内容无法解析`;
      case 'unsupported':
        return `「${this.provider}」不支持这个用法`;
      case 'config':
        return this.message;
      default:
        return `「${this.provider}」调用被取消`;
    }
  }
}

export interface ChatClient {
  readonly provider: string;
  readonly kind: string;
  complete(req: CompleteRequest): Promise<CompleteResult>;
}
