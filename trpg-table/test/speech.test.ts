// 配音：文字清洗 / 切段、wav 头修正、SpeechService（缓存、顺序、失败不卡桌面、idle 等声音播完）、
// DashscopeTts 对着一个本地假服务器走真实的 HTTP 路径。
import { afterEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createLogs } from '../src/log.js';
import { EventBus, type TableEvent } from '../src/table/events.js';
import { scrub } from '../src/util.js';
import { DashscopeTts, type TtsClient, type TtsResult } from '../src/tts/dashscope.js';
import { SpeechService, cleanForSpeech, splitForSpeech, type SpeakerKey } from '../src/tts/speech.js';
import { fixWavHeader, parseWav } from '../src/tts/wav.js';

/** 24kHz 单声道 16 位静音 wav；bogusSize = 模拟 DashScope 流式占位的长度 */
function makeWav(ms: number, bogusSize = false): Buffer {
  const dataBytes = Math.round((24000 * 2 * ms) / 1000);
  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(bogusSize ? 0x7fffff9b : 36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(24000, 24);
  buf.writeUInt32LE(48000, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(bogusSize ? 0x7fffff9b : dataBytes, 40);
  return buf;
}

describe('cleanForSpeech', () => {
  it('去掉 markdown 记号、引号书名号、表情，保留标点', () => {
    expect(cleanForSpeech('**弓弦声**停了，「林子」重新安静下来。')).toBe('弓弦声停了，林子重新安静下来。');
    expect(cleanForSpeech('# 标题\n> 引用一句\n[链接文字](http://x.y) 结束')).toBe('标题。引用一句。链接文字 结束');
    expect(cleanForSpeech('他笑了😀，说“走吧”。')).toBe('他笑了，说走吧。');
  });

  it('换行变句号（前面已经有标点就不再加）；没有字的返回空串', () => {
    expect(cleanForSpeech('第一句\n第二句。\n第三句')).toBe('第一句。第二句。第三句');
    expect(cleanForSpeech('   ')).toBe('');
    expect(cleanForSpeech('……！？')).toBe('');
    expect(cleanForSpeech('***')).toBe('');
  });
});

describe('splitForSpeech', () => {
  it('短的不切；按句子打包到不超过上限', () => {
    expect(splitForSpeech('你好。', 110)).toEqual(['你好。']);
    const text = '甲甲甲甲甲。乙乙乙乙乙。丙丙丙丙丙。丁丁丁丁丁。';
    expect(splitForSpeech(text, 12)).toEqual(['甲甲甲甲甲。乙乙乙乙乙。', '丙丙丙丙丙。丁丁丁丁丁。']);
  });

  it('一句太长先按逗号切，再不行硬切；每段都不超过上限，拼回去不丢字', () => {
    const long = '一二三四五，六七八九十，甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥';
    const parts = splitForSpeech(long, 10);
    expect(parts.every((p) => p.length <= 10)).toBe(true);
    expect(parts.join('')).toBe(long);
    const noPunct = '字'.repeat(25);
    const hard = splitForSpeech(noPunct, 10);
    expect(hard.map((p) => p.length)).toEqual([10, 10, 5]);
  });
});

describe('wav', () => {
  it('流式占位的长度被改成真实长度，时长算对', () => {
    const raw = makeWav(1500, true);
    expect(parseWav(raw)?.durationMs).toBe(1500);
    const fixed = fixWavHeader(raw);
    expect(fixed.readUInt32LE(4)).toBe(fixed.length - 8);
    expect(fixed.readUInt32LE(40)).toBe(fixed.length - 44);
    expect(parseWav(fixed)).toMatchObject({ sampleRate: 24000, channels: 1, bits: 16, durationMs: 1500 });
  });

  it('不是 wav 就原样返回 / 解析失败', () => {
    const junk = Buffer.from('not a wav at all, definitely not a wav at all');
    expect(parseWav(junk)).toBeNull();
    expect(fixWavHeader(junk)).toBe(junk);
  });
});

describe('scrub', () => {
  it('带点的新格式密钥也能盖住', () => {
    expect(scrub('key sk-ws-H.ABCDEFGH.xyzXYZ123.tail_part-9 end')).toBe('key sk-*** end');
  });
});

class FakeTts implements TtsClient {
  calls: { text: string; voice: string }[] = [];
  failOn: ((text: string) => boolean) | null = null;
  delayMs = 0;
  /** 按文字决定合成要多久（优先于 delayMs） */
  delayFor: ((text: string) => number) | null = null;
  clipMs = 300;
  async synth(text: string, voice: string): Promise<TtsResult> {
    this.calls.push({ text, voice });
    const wait = this.delayFor ? this.delayFor(text) : this.delayMs;
    if (wait) await new Promise((r) => setTimeout(r, wait));
    if (this.failOn?.(text)) throw new Error('合成失败了 sk-ws-H.secretsecret.tail');
    return { wav: makeWav(this.clipMs), characters: text.length * 2 };
  }
}

function setupSpeech(client: FakeTts, extra: { maxChars?: number; waitCapMs?: number } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trpg-tts-'));
  const bus = new EventBus();
  const events: TableEvent[] = [];
  bus.subscribe((e) => events.push(e));
  const logs = createLogs(dir);
  const svc = new SpeechService({
    client,
    bus,
    logs,
    cacheDir: join(dir, 'tts'),
    voices: {
      narrator: { voice: 'Eldric Sage', rate: 1, volume: 1 },
      player_a: { voice: 'Kai', rate: 1, volume: 0.9 },
      player_b: { voice: 'Marcus', rate: 2, volume: 1 },
    },
    model: 'qwen3-tts-flash',
    waitCapMs: extra.waitCapMs ?? 5000,
    maxChars: extra.maxChars,
  });
  return { svc, events, dir, bus, logs };
}

const tts = (events: TableEvent[]) => events.filter((e) => e.kind === 'tts');

describe('SpeechService', () => {
  it('每个说话人用自己的音色；事件里有地址、倍速、估计时长、座位', async () => {
    const client = new FakeTts();
    const { svc, events } = setupSpeech(client);
    for (const [who, text] of [
      ['narrator', '林子安静下来。'],
      ['player_a', '尊贵的客人，请当心。'],
      ['player_b', '滚出来！'],
    ] as [SpeakerKey, string][]) {
      svc.say(who, text);
    }
    await svc.idle(3000);
    expect(client.calls.map((c) => c.voice).sort()).toEqual(['Eldric Sage', 'Kai', 'Marcus']);
    const out = tts(events);
    expect(out).toHaveLength(3);
    expect(out.map((e) => e.data?.who)).toEqual(['narrator', 'player_a', 'player_b']);
    const d = out[2].data as Record<string, unknown>;
    expect(d).toMatchObject({ seat: 'player_b', kind: 'speech', rate: 2, volume: 1 });
    expect(d.durationMs).toBe(150); // 300ms 的片段 2 倍速
    expect(String(d.url)).toMatch(/^\/overlay\/tts\/[a-f0-9]{20}\.wav$/);
    expect((out[0].data as Record<string, unknown>).seat).toBeNull();
    expect((out[0].data as Record<string, unknown>).kind).toBe('narration');
  });

  it('prepare 只合成不播：release 之前没有 tts 事件，release 之后才有；多次 release 只放一次', async () => {
    const client = new FakeTts();
    const { svc, events } = setupSpeech(client);
    const p = svc.prepare('player_a', '稍等，我看看。');
    expect(p).not.toBeNull();
    await new Promise((r) => setTimeout(r, 80));
    expect(client.calls).toHaveLength(1);
    expect(tts(events)).toHaveLength(0);
    await Promise.all([p!.release(), p!.release()]);
    expect(tts(events)).toHaveLength(1);
  });

  it('长文本切成几段，事件按原来的顺序；同一句话第二次不再调接口（缓存）', async () => {
    const client = new FakeTts();
    const { svc, events, dir } = setupSpeech(client, { maxChars: 12 });
    const text = '第一句话在这里。第二句话在这里。第三句话在这里。';
    svc.say('narrator', text);
    await svc.idle(5000);
    expect(tts(events).length).toBe(client.calls.length);
    expect(client.calls.length).toBeGreaterThanOrEqual(2);
    expect(client.calls.map((c) => c.text).join('')).toBe(text);
    const first = client.calls.length;
    svc.say('narrator', text);
    await svc.idle(5000);
    expect(client.calls.length).toBe(first); // 缓存
    expect(tts(events).length).toBe(first * 2); // 但还是放了
    expect(readdirSync(join(dir, 'tts')).filter((f) => f.endsWith('.wav')).length).toBe(first);
  });

  it('先后两句话：后合成好的不会插队（先放出去的先播）', async () => {
    const client = new FakeTts();
    client.delayFor = (t) => (t.includes('合成得慢') ? 400 : 0);
    const { svc, events } = setupSpeech(client);
    const slow = svc.prepare('narrator', '这一句先说但是合成得慢。')!;
    const fast = svc.prepare('player_a', '这一句后说。')!;
    void slow.release();
    void fast.release();
    // 第二句其实早就合成好了，但事件要等第一句放出去之后才出
    await new Promise((r) => setTimeout(r, 150));
    expect(tts(events)).toHaveLength(0);
    await svc.idle(4000);
    expect(tts(events).map((e) => e.data?.who)).toEqual(['narrator', 'player_a']);
  });

  it('合成失败只丢这一段，不抛、不卡 idle；失败原因进 usage 日志且密钥被遮住', async () => {
    const client = new FakeTts();
    client.failOn = (t) => t.includes('坏');
    const { svc, events, dir, logs } = setupSpeech(client);
    svc.say('narrator', '这一句是坏的。');
    svc.say('narrator', '这一句是好的。');
    const t0 = Date.now();
    await svc.idle(3000);
    expect(Date.now() - t0).toBeLessThan(2500);
    expect(tts(events)).toHaveLength(1);
    await logs.usage.flush();
    const rows = readFileSync(join(dir, 'logs', 'usage.jsonl'), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l) as Record<string, unknown>);
    expect(rows.map((r) => r.ok).sort()).toEqual([false, true]);
    const failed = rows.find((r) => r.ok === false)!;
    expect(failed).toMatchObject({ provider: 'dashscope', purpose: 'tts', seat: 'tts:narrator', voice: 'Eldric Sage' });
    expect(JSON.stringify(rows)).not.toContain('secretsecret'); // 错误信息里的密钥被遮住
    const good = rows.find((r) => r.ok === true)!;
    expect(good.characters).toBe('这一句是好的。'.length * 2);
  });

  it('idle：等已放出去的声音估计播完（300ms 的片段至少要等差不多这么久），没声音就立刻返回', async () => {
    const client = new FakeTts();
    client.clipMs = 600;
    const { svc } = setupSpeech(client);
    const t0 = Date.now();
    await svc.idle(2000);
    expect(Date.now() - t0).toBeLessThan(100);
    svc.say('narrator', '要念一阵的一句话。');
    const t1 = Date.now();
    await svc.idle(3000);
    expect(Date.now() - t1).toBeGreaterThanOrEqual(500);
  });

  it('busy：合成中、排队中、估计还在播都算在说话；全放完才变回 false（Helixus 页面据此不抢话）', async () => {
    const client = new FakeTts();
    client.clipMs = 400;
    client.delayMs = 60;
    const { svc } = setupSpeech(client);
    expect(svc.busy).toBe(false);
    svc.say('narrator', '要念一阵的一句话。');
    expect(svc.busy).toBe(true); // 还在合成
    await new Promise((r) => setTimeout(r, 150));
    expect(svc.busy).toBe(true); // 已经放出去，估计还在播
    await svc.idle(3000);
    expect(svc.busy).toBe(false);
  });

  it('idle 有上限：合成一直不返回时到点就放行', async () => {
    const client = new FakeTts();
    client.delayMs = 5000;
    const { svc } = setupSpeech(client);
    svc.say('narrator', '这句永远合成不出来。');
    const t0 = Date.now();
    await svc.idle(400);
    const waited = Date.now() - t0;
    expect(waited).toBeGreaterThanOrEqual(380);
    expect(waited).toBeLessThan(1500);
  });

  it('清洗后没有字的文字：prepare 返回 null', () => {
    const { svc } = setupSpeech(new FakeTts());
    expect(svc.prepare('narrator', '……')).toBeNull();
    expect(svc.prepare('player_a', '')).toBeNull();
  });
});

describe('DashscopeTts（本地假服务器）', () => {
  let server: Server | null = null;
  afterEach(async () => {
    await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
    server = null;
  });

  async function start(handler: (body: Record<string, unknown>, auth: string) => { status?: number; json?: unknown } | 'audio') {
    const wav = makeWav(800, true);
    server = createServer((req, res) => {
      if (req.url === '/audio.wav') {
        res.writeHead(200, { 'content-type': 'audio/wav' }).end(wav);
        return;
      }
      let raw = '';
      req.on('data', (c) => (raw += c));
      req.on('end', () => {
        const out = handler(JSON.parse(raw), String(req.headers.authorization ?? ''));
        if (out === 'audio') return;
        res.writeHead(out.status ?? 200, { 'content-type': 'application/json' }).end(JSON.stringify(out.json ?? {}));
      });
    });
    await new Promise<void>((resolve) => server!.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as AddressInfo).port;
    return new DashscopeTts({
      apiKey: 'sk-ws-test.key.value',
      model: 'qwen3-tts-flash',
      endpoint: `http://127.0.0.1:${port}/api`,
      languageType: 'Chinese',
      timeoutMs: 3000,
      maxRetries: 0,
    });
  }

  it('请求体 / 鉴权头对；拿到地址再下载，wav 头被修正，字符数取接口返回的', async () => {
    let seen: { body: Record<string, unknown>; auth: string } | null = null;
    const port = () => (server!.address() as AddressInfo).port;
    const client = await start((body, auth) => {
      seen = { body, auth };
      return { json: { status_code: 200, output: { audio: { url: `http://127.0.0.1:${port()}/audio.wav` } }, usage: { characters: 58 } } };
    });
    const res = await client.synth('箭从北边来。', 'Kai');
    expect(seen!.auth).toBe('Bearer sk-ws-test.key.value');
    expect(seen!.body).toEqual({ model: 'qwen3-tts-flash', input: { text: '箭从北边来。', voice: 'Kai', language_type: 'Chinese' } });
    expect(res.characters).toBe(58);
    expect(parseWav(res.wav)?.durationMs).toBe(800);
    expect(res.wav.readUInt32LE(40)).toBe(res.wav.length - 44);
  });

  it('接口报错（code）、没有音频地址、鉴权失败都抛错，且错误信息里没有密钥', async () => {
    const bad = await start(() => ({ json: { code: 'InvalidParameter', message: 'voice not supported sk-ws-H.leaked.secret.abc' } }));
    await expect(bad.synth('你好', 'Nope')).rejects.toThrow(/InvalidParameter/);
    await bad.synth('你好', 'Nope').catch((e: Error) => expect(e.message).not.toContain('leaked'));
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const empty = await start(() => ({ json: { status_code: 200, output: { audio: {} } } }));
    await expect(empty.synth('你好', 'Kai')).rejects.toThrow(/没有音频/);
    await new Promise<void>((resolve) => server!.close(() => resolve()));
    const auth = await start(() => ({ status: 401, json: { code: 'InvalidApiKey', message: 'bad key' } }));
    await expect(auth.synth('你好', 'Kai')).rejects.toThrow(/401/);
  });
});

describe('心里话配音', () => {
  it('prepare(…, { thought: true })：同一个音色，kind 是 thought，音量乘 thoughtVolume；没传就是原来的说话', async () => {
    const client = new FakeTts();
    const { svc, events } = setupSpeech(client);
    const speech = svc.prepare('player_a', '这狼是饿的，不是疯的。')!;
    const thought = svc.prepare('player_a', '它咬绳是饿。', { thought: true })!;
    void thought.release();
    void speech.release();
    await svc.idle(3000);
    expect(client.calls.map((c) => c.voice)).toEqual(['Kai', 'Kai']);
    const out = tts(events);
    expect(out.map((e) => e.data?.kind)).toEqual(['thought', 'speech']);
    expect(out[0].data).toMatchObject({ seat: 'player_a', volume: 0.9 * 0.7 });
    expect(out[1].data).toMatchObject({ seat: 'player_a', volume: 0.9 });
  });
});
