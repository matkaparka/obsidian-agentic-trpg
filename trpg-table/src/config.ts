import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';
import { loadEnvFile } from './util.js';

export const SEAT_IDS = ['gm', 'player_a', 'player_b', 'renderer', 'director'] as const;
export type SeatId = (typeof SEAT_IDS)[number];

export type ProviderKind = 'anthropic' | 'gemini' | 'openai_compatible';
export type ReasoningMode = 'none' | 'raw' | 'summary';

export interface ProviderConfig {
  kind: ProviderKind;
  keyEnv: string;
  baseUrl: string;
  apiVersion?: string;
  proxy: string | null;
  timeoutMs: number;
  maxRetries: number;
}

export interface SeatConfig {
  id: SeatId;
  provider: string;
  model: string;
  maxTokens: number;
  /** null = 不发送 temperature（新版 Claude 5.5 已弃用这个参数） */
  temperature: number | null;
  reasoning: ReasoningMode;
  thinkingBudget?: number;
  timeoutMs?: number;
}

export interface ModelsConfig {
  providers: Record<string, ProviderConfig>;
  seats: Record<SeatId, SeatConfig>;
}

export interface PacingConfig {
  tThought: number;
  tDecision: number;
  tBetween: number;
  tReact: number;
  tScene: number;
  tResolve: number;
}

export interface TableConfig {
  campaignVault: string;
  adventure: string;
  pacing: PacingConfig;
  limits: {
    gmMaxToolCalls: number;
    playerRecentEvents: number;
    playerRecentTurns: number;
    playerParseRetries: number;
    historyTurns: number;
    stepTimeoutMs: number;
    /** 玩家决定那一次模型调用的上限（毫秒）；超时就用保守默认行动，不让一个慢模型拖住整桌 */
    playerTimeoutMs: number;
    /** 一幕进行到第几轮还没结束，就在 GM 的提示里提醒“该推进了”；0 = 不提醒 */
    sceneNudgeRounds: number;
    /** 提醒之后每隔几轮加重一次 */
    sceneNudgeEvery: number;
  };
  /** 进度导演（专门对照剧本管进度的一次小模型调用）：每隔几个探索轮判断一次，桌面强制执行 */
  director?: { enabled: boolean; everyRounds: number; timeoutMs: number };
  helixusSuggestions: boolean;
  helixusMaxSuggestions: number;
  helixusSuggestionTtlSec: number;
  helixusKnowsSecrets: boolean;
  startPaused: boolean;
  fallbackToDryRun: boolean;
  /** 用哪一套角色卡：不写 = characters/<seat>.json；写 lv3 = characters/lv3/<seat>.json（见 table/characters.ts） */
  characterSet?: string;
  /** 配音（旁白 + 两个角色的 TTS）；没写 = 关 */
  tts?: TtsConfig;
}

export interface TtsVoiceConfig {
  /** 服务端音色名（Kai / Marcus / Eldric Sage …），原样传给 TTS */
  voice: string;
  /** 播放倍速（保持音高）；1 = 原速 */
  rate: number;
  volume: number;
}

export interface TtsConfig {
  enabled: boolean;
  model: string;
  endpoint: string;
  /** 密钥放在哪个环境变量里（.env） */
  keyEnv: string;
  languageType: string;
  timeoutMs: number;
  maxRetries: number;
  /** 桌面最多等多久让声音播完（毫秒） */
  waitCapMs: number;
  /** 一段文字最多多少字就切开单独合成 */
  maxChars: number;
  /** 心里话相对说话的音量倍数 */
  thoughtVolume: number;
  voices: { narrator: TtsVoiceConfig; player_a: TtsVoiceConfig; player_b: TtsVoiceConfig };
}

export interface OverlayInsets {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

export interface OverlayBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OverlayBubbleConfig {
  maxThoughtChars: number;
  maxSayChars: number;
  thoughtTtlMs: number;
  speechMinMs: number;
  speechPerCharMs: number;
  speechMaxMs: number;
  gapPx: number;
}

export interface OverlayConfig {
  canvas: { width: number; height: number };
  colors: Record<string, string>;
  fonts: {
    family: string;
    /** 滚动剧情用的字体（默认同 family）。 */
    narrationFamily: string;
    /** HP / 数字用的字体（默认同 family）。 */
    numericFamily: string;
    subtitlePx: number;
    bubblePx: number;
    initiativePx: number;
    dicePx: number;
    namePx: number;
    hpPx: number;
  };
  /** 地图 / 滚动剧情 / 主播（Helixus）区 / 两个主角的面板（1920×1080 设计坐标）。 */
  layout: { map: OverlayBox; streamer: OverlayBox; subtitle: OverlayBox; characters: OverlayBox };
  bubbles: OverlayBubbleConfig;
  dice: { ttlMs: number };
  /** 角色换表情时是否真的去改 Atlas token 头像。 */
  tokenExpressions: boolean;
  /** 地图区域 = 画布减去这些 inset；同时传给 atlas_player_frame 去缩 Atlas 的 canvas。 */
  frame: { insets: OverlayInsets; gap: number };
}

export interface AppConfig {
  root: string;
  models: ModelsConfig;
  table: TableConfig;
  overlay: OverlayConfig;
  paths: {
    config: string;
    logs: string;
    state: string;
    campaignVault: string;
  };
  /** .env 是否存在、读到了哪些变量名（值不保存、不打印） */
  env: { present: boolean; loaded: string[]; missingKeys: string[] };
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const providerSchema = z.object({
  kind: z.enum(['anthropic', 'gemini', 'openai_compatible']),
  key_env: z.string().min(1),
  base_url: z.string().url(),
  api_version: z.string().optional(),
  proxy: z.string().url().nullable().optional(),
  timeout_ms: z.number().int().positive().optional(),
  max_retries: z.number().int().min(0).max(6).optional(),
});

const seatSchema = z.object({
  provider: z.string().min(1),
  model: z.string().min(1),
  max_tokens: z.number().int().positive().optional(),
  temperature: z.number().min(0).max(2).nullable().optional(),
  reasoning: z.enum(['none', 'raw', 'summary']).optional(),
  thinking_budget: z.number().int().positive().optional(),
  timeout_ms: z.number().int().positive().optional(),
});

const modelsSchema = z.object({
  providers: z.record(z.string(), providerSchema),
  seats: z.object({
    gm: seatSchema,
    player_a: seatSchema,
    player_b: seatSchema,
    renderer: seatSchema,
    /** 进度导演；models.yaml 里没写就沿用 gm 的模型（max_tokens 1500） */
    director: seatSchema.optional(),
  }),
});

const ttsVoiceSchema = z.object({
  voice: z.string().min(1),
  rate: z.number().min(0.5).max(2).default(1),
  volume: z.number().min(0).max(1).default(1),
});

const tableSchema = z.object({
  campaign_vault: z.string().min(1),
  adventure: z.string().min(1),
  pacing: z.object({
    t_thought: z.number().min(0).default(6),
    t_decision: z.number().min(0).default(4),
    t_between: z.number().min(0).default(2),
    t_react: z.number().min(0).default(8),
    t_scene: z.number().min(0).default(3),
    t_resolve: z.number().min(0).default(2),
  }),
  limits: z.object({
    gm_max_tool_calls: z.number().int().min(1).max(30).default(8),
    player_recent_events: z.number().int().min(0).default(12),
    player_recent_turns: z.number().int().min(0).default(6),
    player_parse_retries: z.number().int().min(0).max(3).default(1),
    history_turns: z.number().int().min(5).default(40),
    step_timeout_ms: z.number().int().positive().default(180000),
    player_timeout_ms: z.number().int().positive().default(75000),
    scene_nudge_rounds: z.number().int().min(0).default(12),
    scene_nudge_every: z.number().int().min(1).default(4),
  }),
  director: z
    .object({
      enabled: z.boolean().default(true),
      every_rounds: z.number().int().min(1).default(2),
      timeout_ms: z.number().int().positive().default(30000),
    })
    .default({ enabled: true, every_rounds: 2, timeout_ms: 30000 }),
  helixus_suggestions: z.enum(['on', 'off']).default('on'),
  helixus_max_suggestions: z.number().int().min(1).max(10).default(2),
  helixus_suggestion_ttl_sec: z.number().int().min(1).default(60),
  helixus_knows_secrets: z.boolean().default(true),
  start_paused: z.boolean().default(true),
  fallback_to_dry_run: z.boolean().default(true),
  character_set: z.string().default(''),
  tts: z
    .object({
      enabled: z.boolean().default(false),
      model: z.string().min(1).default('qwen3-tts-flash'),
      endpoint: z.string().url().default('https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'),
      key_env: z.string().min(1).default('DASHSCOPE_API_KEY'),
      language_type: z.string().min(1).default('Chinese'),
      timeout_ms: z.number().int().positive().default(30000),
      max_retries: z.number().int().min(0).max(5).default(2),
      wait_cap_ms: z.number().int().min(0).default(60000),
      max_chars: z.number().int().min(20).max(250).default(110),
      thought_volume: z.number().min(0).max(1).default(0.7),
      voices: z.object({
        narrator: ttsVoiceSchema,
        player_a: ttsVoiceSchema,
        player_b: ttsVoiceSchema,
      }),
    })
    .optional(),
});

const boxSchema = z.object({ x: z.number(), y: z.number(), w: z.number().positive(), h: z.number().positive() });

const overlaySchema = z.object({
  canvas: z.object({ width: z.number().positive(), height: z.number().positive() }),
  frame: z.object({ gap: z.number().min(0).default(0) }).default({ gap: 0 }),
  colors: z.record(z.string(), z.string()),
  fonts: z.object({
    family: z.string(),
    narration_family: z.string().optional(),
    numeric_family: z.string().optional(),
    subtitle_px: z.number().positive().default(30),
    bubble_px: z.number().positive().default(31),
    initiative_px: z.number().positive().default(22),
    dice_px: z.number().positive().default(38),
    name_px: z.number().positive().default(30),
    hp_px: z.number().positive().default(24),
  }),
  layout: z.object({
    map: boxSchema,
    streamer: boxSchema,
    subtitle: boxSchema,
    characters: boxSchema,
  }),
  bubbles: z
    .object({
      max_thought_chars: z.number().int().positive().default(22),
      max_say_chars: z.number().int().positive().default(40),
      thought_ttl_ms: z.number().int().positive().default(6000),
      speech_min_ms: z.number().int().positive().default(4000),
      speech_per_char_ms: z.number().int().min(0).default(250),
      speech_max_ms: z.number().int().positive().default(10000),
      gap_px: z.number().min(0).default(10),
    })
    .default({
      max_thought_chars: 22,
      max_say_chars: 40,
      thought_ttl_ms: 6000,
      speech_min_ms: 4000,
      speech_per_char_ms: 250,
      speech_max_ms: 10000,
      gap_px: 10,
    }),
  dice: z.object({ ttl_ms: z.number().int().positive().default(1500) }).default({ ttl_ms: 1500 }),
  token_expressions: z.boolean().default(true),
});

function readYaml(path: string): unknown {
  if (!existsSync(path)) throw new ConfigError(`缺少配置文件：${path}`);
  try {
    return parseYaml(readFileSync(path, 'utf8'));
  } catch (e) {
    throw new ConfigError(`配置文件不是合法 YAML：${path}（${(e as Error).message}）`);
  }
}

function seatFrom(raw: z.infer<typeof seatSchema>, id: SeatId): SeatConfig {
  return {
    id,
    provider: raw.provider,
    model: raw.model,
    maxTokens: raw.max_tokens ?? 2000,
    temperature: raw.temperature === null ? null : raw.temperature ?? 1,
    reasoning: raw.reasoning ?? 'none',
    thinkingBudget: raw.thinking_budget,
    timeoutMs: raw.timeout_ms,
  };
}

export function loadConfig(root: string, envPath = join(root, '.env')): AppConfig {
  const env = loadEnvFile(envPath);

  const modelsRaw = modelsSchema.safeParse(readYaml(join(root, 'config', 'models.yaml')));
  if (!modelsRaw.success) {
    throw new ConfigError(`config/models.yaml 不合法：${modelsRaw.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  const providers: Record<string, ProviderConfig> = {};
  for (const [name, p] of Object.entries(modelsRaw.data.providers)) {
    providers[name] = {
      kind: p.kind,
      keyEnv: p.key_env,
      baseUrl: p.base_url.replace(/\/+$/, ''),
      apiVersion: p.api_version,
      proxy: p.proxy ?? null,
      timeoutMs: p.timeout_ms ?? 120000,
      maxRetries: p.max_retries ?? 3,
    };
  }

  const seatEnv: Record<SeatId, string | undefined> = {
    gm: process.env.TRPG_GM_MODEL,
    player_a: process.env.TRPG_PLAYER_A_MODEL,
    player_b: process.env.TRPG_PLAYER_B_MODEL,
    renderer: process.env.TRPG_RENDERER_MODEL,
    director: process.env.TRPG_DIRECTOR_MODEL,
  };
  const seats = {} as Record<SeatId, SeatConfig>;
  for (const id of SEAT_IDS) {
    const rawSeat = id === 'director' ? (modelsRaw.data.seats.director ?? { ...modelsRaw.data.seats.gm, max_tokens: 1500 }) : modelsRaw.data.seats[id];
    const seat = seatFrom(rawSeat, id);
    if (seatEnv[id]) seat.model = seatEnv[id]!;
    if (!providers[seat.provider]) {
      throw new ConfigError(`座位 ${id} 用的 provider「${seat.provider}」没有在 providers 里定义`);
    }
    seats[id] = seat;
  }

  const tableRaw = tableSchema.safeParse(readYaml(join(root, 'config', 'table.yaml')));
  if (!tableRaw.success) {
    throw new ConfigError(`config/table.yaml 不合法：${tableRaw.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  const t = tableRaw.data;

  const overlayRaw = overlaySchema.safeParse(readYaml(join(root, 'config', 'overlay.yaml')));
  if (!overlayRaw.success) {
    throw new ConfigError(`config/overlay.yaml 不合法：${overlayRaw.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('；')}`);
  }
  const o = overlayRaw.data;
  // 地图区域 = layout.map。滚动剧情、主播区、角色面板都不能压到地图上（跑团直播里地图是主画面）。
  const gap = o.frame.gap;
  const map = o.layout.map;
  const streamer = o.layout.streamer;
  const subtitle = o.layout.subtitle;
  const characters = o.layout.characters;
  const insideCanvas = (box: OverlayBox) =>
    box.x >= 0 && box.y >= 0 && box.x + box.w <= o.canvas.width && box.y + box.h <= o.canvas.height;
  const overlaps = (a: OverlayBox, b: OverlayBox) =>
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  const boxes: [string, OverlayBox][] = [
    ['map', map],
    ['streamer', streamer],
    ['subtitle', subtitle],
    ['characters', characters],
  ];
  for (const [name, box] of boxes) {
    if (!insideCanvas(box)) throw new ConfigError(`config/overlay.yaml：layout.${name} 超出画布`);
  }
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (overlaps(boxes[i][1], boxes[j][1])) {
        throw new ConfigError(`config/overlay.yaml：layout.${boxes[i][0]} 和 layout.${boxes[j][0]} 不能重叠`);
      }
    }
  }
  if (o.bubbles.max_thought_chars > 22) throw new ConfigError('config/overlay.yaml：bubbles.max_thought_chars 不能超过 22');
  if (o.bubbles.max_say_chars > 40) throw new ConfigError('config/overlay.yaml：bubbles.max_say_chars 不能超过 40');
  if (o.bubbles.speech_min_ms < 4000) throw new ConfigError('config/overlay.yaml：说话气泡至少停 4 秒');
  const insets: OverlayInsets = {
    left: Math.max(0, Math.round(map.x)),
    right: Math.max(0, Math.round(o.canvas.width - (map.x + map.w))),
    top: Math.max(0, Math.round(map.y)),
    bottom: Math.max(0, Math.round(o.canvas.height - (map.y + map.h))),
  };

  const campaignVault = (process.env.TRPG_CAMPAIGN_VAULT || t.campaign_vault).trim();

  const missingKeys = Object.values(providers)
    .map((p) => p.keyEnv)
    .filter((name, i, all) => all.indexOf(name) === i && !process.env[name]?.trim());

  return {
    root,
    models: { providers, seats },
    table: {
      campaignVault,
      adventure: t.adventure,
      pacing: {
        tThought: t.pacing.t_thought,
        tDecision: t.pacing.t_decision,
        tBetween: t.pacing.t_between,
        tReact: t.pacing.t_react,
        tScene: t.pacing.t_scene,
        tResolve: t.pacing.t_resolve,
      },
      limits: {
        gmMaxToolCalls: t.limits.gm_max_tool_calls,
        playerRecentEvents: t.limits.player_recent_events,
        playerRecentTurns: t.limits.player_recent_turns,
        playerParseRetries: t.limits.player_parse_retries,
        historyTurns: t.limits.history_turns,
        stepTimeoutMs: t.limits.step_timeout_ms,
        playerTimeoutMs: t.limits.player_timeout_ms,
        sceneNudgeRounds: t.limits.scene_nudge_rounds,
        sceneNudgeEvery: t.limits.scene_nudge_every,
      },
      director: { enabled: t.director.enabled, everyRounds: t.director.every_rounds, timeoutMs: t.director.timeout_ms },
      helixusSuggestions: t.helixus_suggestions === 'on',
      helixusMaxSuggestions: t.helixus_max_suggestions,
      helixusSuggestionTtlSec: t.helixus_suggestion_ttl_sec,
      helixusKnowsSecrets: t.helixus_knows_secrets,
      startPaused: t.start_paused,
      fallbackToDryRun: t.fallback_to_dry_run,
      characterSet: t.character_set.trim(),
      ...(t.tts
        ? {
            tts: {
              enabled: t.tts.enabled,
              model: t.tts.model,
              endpoint: t.tts.endpoint,
              keyEnv: t.tts.key_env,
              languageType: t.tts.language_type,
              timeoutMs: t.tts.timeout_ms,
              maxRetries: t.tts.max_retries,
              waitCapMs: t.tts.wait_cap_ms,
              maxChars: t.tts.max_chars,
              thoughtVolume: t.tts.thought_volume,
              voices: t.tts.voices,
            },
          }
        : {}),
    },
    overlay: {
      canvas: o.canvas,
      colors: o.colors,
      fonts: {
        family: o.fonts.family,
        narrationFamily: o.fonts.narration_family ?? o.fonts.family,
        numericFamily: o.fonts.numeric_family ?? o.fonts.family,
        subtitlePx: o.fonts.subtitle_px,
        bubblePx: o.fonts.bubble_px,
        initiativePx: o.fonts.initiative_px,
        dicePx: o.fonts.dice_px,
        namePx: o.fonts.name_px,
        hpPx: o.fonts.hp_px,
      },
      layout: {
        map: { x: map.x, y: map.y, w: map.w, h: map.h },
        streamer: { x: streamer.x, y: streamer.y, w: streamer.w, h: streamer.h },
        subtitle: { x: subtitle.x, y: subtitle.y, w: subtitle.w, h: subtitle.h },
        characters: { x: characters.x, y: characters.y, w: characters.w, h: characters.h },
      },
      bubbles: {
        maxThoughtChars: o.bubbles.max_thought_chars,
        maxSayChars: o.bubbles.max_say_chars,
        thoughtTtlMs: o.bubbles.thought_ttl_ms,
        speechMinMs: o.bubbles.speech_min_ms,
        speechPerCharMs: o.bubbles.speech_per_char_ms,
        speechMaxMs: o.bubbles.speech_max_ms,
        gapPx: o.bubbles.gap_px,
      },
      dice: { ttlMs: o.dice.ttl_ms },
      tokenExpressions: o.token_expressions,
      frame: { insets, gap },
    },
    paths: {
      config: join(root, 'config'),
      logs: join(root, 'logs'),
      state: join(root, 'state'),
      campaignVault,
    },
    env: { present: !env.missingFile, loaded: env.loaded, missingKeys },
  };
}

export const APIKEY_HINT =
  '密钥只放 trpg-table/.env（已 gitignore）；本程序不会打印密钥，也不会读别的项目的 .env。';

/** 取 provider 的密钥。只在真正发请求时调用；错误信息里只有变量名。 */
export function apiKeyFor(providerName: string, provider: ProviderConfig): string {
  const key = process.env[provider.keyEnv]?.trim();
  if (!key) {
    throw new ConfigError(
      `provider「${providerName}」的密钥没设置：请在 trpg-table/.env 里填 ${provider.keyEnv}=...（不要填进 config/models.yaml）`
    );
  }
  return key;
}
