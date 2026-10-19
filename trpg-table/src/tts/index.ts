import { join } from 'node:path';
import type { AppConfig } from '../config.js';
import type { Logs } from '../log.js';
import type { EventBus } from '../table/events.js';
import { DashscopeTts } from './dashscope.js';
import { SpeechService } from './speech.js';

export { SpeechService, cleanForSpeech, splitForSpeech, type Prepared, type SpeakerKey } from './speech.js';
export { DashscopeTts, type TtsClient } from './dashscope.js';

/** 合成好的 wav 放哪里（overlay 服务也从这里取）。 */
export function ttsCacheDir(config: AppConfig): string {
  return join(config.paths.state, 'tts');
}

/**
 * 按配置建配音服务。没开 / 没密钥 / 假模型（--fake）就返回 null，桌面照常跑，只是没有声音。
 * 不打印密钥，只说是哪个环境变量。
 */
export function createSpeech(config: AppConfig, logs: Logs, bus: EventBus, opts: { fake?: boolean } = {}): SpeechService | null {
  const t = config.table.tts;
  if (!t?.enabled) return null;
  if (opts.fake) {
    logs.trace('配音：--fake 模式不配音');
    return null;
  }
  const apiKey = process.env[t.keyEnv]?.trim();
  if (!apiKey) {
    logs.trace(`配音：没有环境变量 ${t.keyEnv}（写在 .env 里），配音关闭`);
    return null;
  }
  const client = new DashscopeTts({
    apiKey,
    model: t.model,
    endpoint: t.endpoint,
    languageType: t.languageType,
    timeoutMs: t.timeoutMs,
    maxRetries: t.maxRetries,
  });
  logs.trace(
    `配音：已开（${t.model}；旁白 ${t.voices.narrator.voice}、${config.table.tts ? t.voices.player_a.voice : ''}、${t.voices.player_b.voice}）`
  );
  return new SpeechService({
    client,
    bus,
    logs,
    cacheDir: ttsCacheDir(config),
    voices: t.voices,
    model: t.model,
    waitCapMs: t.waitCapMs,
    maxChars: t.maxChars,
    thoughtVolume: t.thoughtVolume,
  });
}
