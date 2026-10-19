import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Logs } from '../log.js';
import type { EventBus } from '../table/events.js';
import { scrub, sleep } from '../util.js';
import type { TtsClient } from './dashscope.js';
import { parseWav } from './wav.js';

/** 谁在说话：旁白（GM）和两个座位 */
export type SpeakerKey = 'narrator' | 'player_a' | 'player_b';

export interface VoiceSetting {
  /** 服务端的音色名，原样传给 TTS（Kai / Marcus / Eldric Sage …） */
  voice: string;
  /** 播放倍速（浏览器 playbackRate，保持音高）；1 = 原速 */
  rate: number;
  volume: number;
}

export interface SpeechOptions {
  client: TtsClient;
  bus: EventBus;
  logs: Logs;
  /** 合成好的 wav 放这里，文件名是内容哈希（同一句话、同一个音色只合成一次），overlay 从这里取 */
  cacheDir: string;
  voices: Record<SpeakerKey, VoiceSetting>;
  model: string;
  /** idle() 最多等多久（毫秒）：合成失败或网络慢时不能把桌面卡死 */
  waitCapMs: number;
  /** 一段文字最多多少个字就切开单独合成（越短首段出声越快） */
  maxChars?: number;
  /** 同时发出的合成请求数 */
  concurrency?: number;
  /** 心里话相对说话的音量倍数（默认 0.7，听上去像在心里想） */
  thoughtVolume?: number;
}

/** 已经开始合成、还没放出去的一句话。release() 之后 overlay 才会收到 tts 事件开始播。 */
export interface Prepared {
  /** 清洗后的字数 */
  readonly chars: number;
  /** 按顺序把它的每一段放进播放队列；返回的 Promise 在最后一段放出去（或失败）之后结束。可以重复调用。 */
  release(): Promise<void>;
}

interface Clip {
  id: string;
  durationMs: number;
}

/** 两段之间留的小空隙（毫秒），播放估算用 */
const GAP_MS = 150;

/**
 * 清洗要读的文字：去掉 markdown 记号、表情符号、书名号 / 引号；换行变句号；清洗后没有字就返回空串。
 * 不改标点（TTS 靠标点断句）。
 */
export function cleanForSpeech(text: string): string {
  let t = String(text ?? '');
  t = t.replace(/```[\s\S]*?```/g, ' ');
  t = t.replace(/\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/^[ \t]*[#>]+[ \t]*/gm, '');
  t = t.replace(/[*_`~]+/g, '');
  t = t.replace(/[「」『』“”"]/g, '');
  t = t.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '');
  t = t.replace(/\s*\n+\s*/g, (m, offset: number, whole: string) => (/[。！？!?；;，,…]$/.test(whole.slice(0, offset)) ? '' : '。'));
  t = t.replace(/[ \t　]+/g, ' ').trim();
  return /[\p{L}\p{N}]/u.test(t) ? t : '';
}

/** 按句子切成不超过 max 个字的几段（句号、问号、感叹号、分号优先；一句太长再按逗号切，最后硬切）。 */
export function splitForSpeech(text: string, max = 110): string[] {
  const sentences = text.match(/[^。！？!?；;]+[。！？!?；;]*/g) ?? [text];
  const pieces: string[] = [];
  for (const s of sentences) {
    if (s.length <= max) {
      pieces.push(s);
      continue;
    }
    // 一句太长：先按逗号 / 顿号 / 冒号切，再不行硬切
    let buf = '';
    for (const part of s.match(/[^，,、：:]+[，,、：:]*/g) ?? [s]) {
      if (buf && buf.length + part.length > max) {
        pieces.push(buf);
        buf = '';
      }
      buf += part;
      while (buf.length > max) {
        pieces.push(buf.slice(0, max));
        buf = buf.slice(max);
      }
    }
    if (buf) pieces.push(buf);
  }
  const out: string[] = [];
  for (const p of pieces) {
    const last = out[out.length - 1];
    if (last !== undefined && last.length + p.length <= max) out[out.length - 1] = last + p;
    else out.push(p);
  }
  return out.map((s) => s.trim()).filter(Boolean);
}

/**
 * 配音：把旁白和两个角色的台词合成语音，按顺序交给 overlay 播放（overlay 收到 `tts` 事件，从
 * /overlay/tts/<id>.wav 取音频）。
 * 桌面循环用两件事和它配合：
 *   - prepare() 在台词确定的那一刻就开始合成，release() 在字幕 / 气泡出现的同一刻放出去，声音和字幕基本同步；
 *   - idle() 等「已经放出去的音频估计播完」，让桌面别比声音跑得快。合成失败只记日志、不影响桌面。
 */
export class SpeechService {
  private readonly maxChars: number;
  private readonly slots: number;
  private active = 0;
  private readonly waiting: (() => void)[] = [];
  private readonly inflight = new Map<string, Promise<Clip | null>>();
  /** 放出去的音频估计播到什么时候（毫秒时间戳）；overlay 是按顺序一段一段播的 */
  private endAt = 0;
  private pending = 0;

  /** 旁白 / 角色的配音还有声音在放或在排队（估计）。Helixus 的页面看这个，别和它们叠着说话。 */
  get busy(): boolean {
    return this.pending > 0 || Date.now() < this.endAt;
  }

  private chain: Promise<void> = Promise.resolve();
  private warned = false;

  constructor(private readonly opts: SpeechOptions) {
    this.maxChars = opts.maxChars ?? 110;
    this.slots = Math.max(1, opts.concurrency ?? 3);
    mkdirSync(opts.cacheDir, { recursive: true });
  }

  /**
   * thought = true：心里话。同一个音色，音量压低（thoughtVolume，默认 0.7），overlay 里按 kind 'thought'
   * 延长的是思考云而不是说话气泡。
   */
  prepare(who: SpeakerKey, text: string, opts: { thought?: boolean } = {}): Prepared | null {
    const clean = cleanForSpeech(text);
    if (!clean) return null;
    const base = this.opts.voices[who];
    const setting = opts.thought ? { ...base, volume: base.volume * (this.opts.thoughtVolume ?? 0.7) } : base;
    const chunks = splitForSpeech(clean, this.maxChars);
    const jobs = chunks.map((c) => this.synthChunk(who, base.voice, c));
    let released: Promise<void> | null = null;
    return {
      chars: clean.length,
      release: () => {
        if (!released) released = this.enqueue(who, setting, chunks, jobs, !!opts.thought);
        return released;
      },
    };
  }

  /** prepare + release：旁白用，文字一出来就合成、合成好就放。 */
  say(who: SpeakerKey, text: string): void {
    void this.prepare(who, text)?.release();
  }

  /** 等已经放出去的音频估计播完（最多等 capMs，默认 waitCapMs）。 */
  async idle(capMs = this.opts.waitCapMs): Promise<void> {
    const deadline = Date.now() + Math.max(0, capMs);
    for (;;) {
      const now = Date.now();
      if (now >= deadline) return;
      const remain = this.endAt - now;
      if (this.pending === 0 && remain <= 0) return;
      await sleep(Math.min(250, this.pending > 0 ? 250 : remain, deadline - now));
    }
  }

  /** 排队放出一句话的各段：整句按顺序、句与句之间也按顺序（chain），overlay 收到的顺序就是播放顺序。 */
  private enqueue(who: SpeakerKey, setting: VoiceSetting, chunks: string[], jobs: Promise<Clip | null>[], thought = false): Promise<void> {
    this.pending += 1;
    const run = async () => {
      try {
        for (let i = 0; i < jobs.length; i++) {
          const clip = await jobs[i];
          if (!clip) continue;
          const durationMs = Math.round(clip.durationMs / setting.rate);
          const start = Math.max(Date.now(), this.endAt);
          this.endAt = start + durationMs + GAP_MS;
          this.opts.bus.publish('tts', chunks[i], 'soon', {
            id: clip.id,
            url: `/overlay/tts/${clip.id}.wav`,
            who,
            seat: who === 'narrator' ? null : who,
            kind: thought ? 'thought' : who === 'narrator' ? 'narration' : 'speech',
            rate: setting.rate,
            volume: setting.volume,
            durationMs,
          });
        }
      } finally {
        this.pending -= 1;
      }
    };
    const p = this.chain.then(run, run);
    this.chain = p.catch(() => undefined);
    return p.catch(() => undefined);
  }

  private async acquire(): Promise<void> {
    if (this.active < this.slots) {
      this.active += 1;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve));
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.active -= 1;
  }

  private synthChunk(who: SpeakerKey, voice: string, text: string): Promise<Clip | null> {
    const id = createHash('sha1').update(`${this.opts.model}\n${voice}\n${text}`).digest('hex').slice(0, 20);
    const existing = this.inflight.get(id);
    if (existing) return existing;
    const job = (async (): Promise<Clip | null> => {
      const file = join(this.opts.cacheDir, `${id}.wav`);
      if (existsSync(file)) {
        const info = parseWav(readFileSync(file));
        if (info) return { id, durationMs: info.durationMs };
      }
      await this.acquire();
      const started = Date.now();
      try {
        const res = await this.opts.client.synth(text, voice);
        const info = parseWav(res.wav);
        if (!info) throw new Error('返回的不是 wav');
        const tmp = `${file}.tmp`;
        writeFileSync(tmp, res.wav);
        renameSync(tmp, file);
        this.opts.logs.usage.record({
          seat: `tts:${who}`,
          purpose: 'tts',
          provider: 'dashscope',
          model: this.opts.model,
          voice,
          characters: res.characters,
          ok: true,
          latencyMs: Date.now() - started,
        });
        return { id, durationMs: info.durationMs };
      } catch (e) {
        const message = scrub((e as Error).message ?? String(e));
        this.opts.logs.usage.record({
          seat: `tts:${who}`,
          purpose: 'tts',
          provider: 'dashscope',
          model: this.opts.model,
          voice,
          ok: false,
          error: message.slice(0, 200),
          latencyMs: Date.now() - started,
        });
        // 同一种失败只在 trace 里提醒一次，免得网络断了刷屏
        if (!this.warned) {
          this.warned = true;
          this.opts.logs.trace(`配音合成失败（之后同类失败不再提醒，详情见 logs/usage.jsonl）：${message.slice(0, 160)}`);
        }
        return null;
      } finally {
        this.release();
        this.inflight.delete(id);
      }
    })();
    this.inflight.set(id, job);
    return job;
  }
}
