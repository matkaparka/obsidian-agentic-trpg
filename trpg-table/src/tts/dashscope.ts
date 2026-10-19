import { httpRequest } from '../llm/http.js';
import { scrub } from '../util.js';
import { fixWavHeader } from './wav.js';

export interface TtsResult {
  /** 24kHz 单声道 16 位 wav，头已经修正过 */
  wav: Buffer;
  /** 服务端计费的字符数（汉字按 2 个算） */
  characters: number;
}

export interface TtsClient {
  synth(text: string, voice: string): Promise<TtsResult>;
}

export interface DashscopeOptions {
  apiKey: string;
  model: string;
  endpoint: string;
  languageType: string;
  timeoutMs: number;
  maxRetries: number;
}

interface DashscopeResponse {
  status_code?: number;
  code?: string;
  message?: string;
  output?: { audio?: { url?: string; data?: string } };
  usage?: { characters?: number };
}

/**
 * 阿里云百炼 qwen3-tts-flash（非流式）：POST 一次拿到一个 24 小时有效的 wav 地址，再下载。
 * 不走代理（国内直连）。单次最多 600 个字符，汉字按 2 个算，所以调用方每段文字要切短（见 speech.ts）。
 * 音色名是 voice 参数的原样字符串：Kai、Marcus（陕西-秦川）、Eldric Sage（沧明子）……
 */
export class DashscopeTts implements TtsClient {
  constructor(private readonly opts: DashscopeOptions) {}

  async synth(text: string, voice: string): Promise<TtsResult> {
    const { response } = await httpRequest({
      url: this.opts.endpoint,
      method: 'POST',
      headers: { authorization: `Bearer ${this.opts.apiKey}`, 'content-type': 'application/json' },
      body: { model: this.opts.model, input: { text, voice, language_type: this.opts.languageType } },
      timeoutMs: this.opts.timeoutMs,
      proxy: null,
      maxRetries: this.opts.maxRetries,
      provider: 'dashscope',
      label: 'dashscope-tts',
    });
    const json = (await response.json().catch(() => null)) as DashscopeResponse | null;
    if (!json) throw new Error('dashscope-tts：返回的不是 JSON');
    if (json.code) throw new Error(`dashscope-tts：${json.code} ${scrub(json.message ?? '')}`.trim());
    const characters = json.usage?.characters ?? text.length * 2;
    const audio = json.output?.audio;
    if (audio?.url) {
      const dl = await httpRequest({
        url: audio.url,
        method: 'GET',
        timeoutMs: this.opts.timeoutMs,
        proxy: null,
        maxRetries: this.opts.maxRetries,
        provider: 'dashscope',
        label: 'dashscope-tts 下载音频',
      });
      return { wav: fixWavHeader(Buffer.from(await dl.response.arrayBuffer())), characters };
    }
    if (audio?.data) return { wav: fixWavHeader(Buffer.from(audio.data, 'base64')), characters };
    throw new Error('dashscope-tts：返回里没有音频地址');
  }
}
