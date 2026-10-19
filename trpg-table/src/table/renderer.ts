import { z } from 'zod';
import type { AppConfig } from '../config.js';
import { LLM, LLMError } from '../llm/index.js';
import type { Message } from '../llm/types.js';
import { clip, countChars } from '../util.js';
import { isMetaReasoning, quoteInReasoning, screenText } from './safety.js';
import type { PlayerDecision, RendererMeta, RendererOutput, ThoughtBeat } from './types.js';

const TAGS = ['算计', '犹豫', '恐惧', '贪心', '背刺念头', '自我吐槽', '误判', '计划'] as const;

const BeatSchema = z.object({
  text: z.string(),
  tag: z.enum(TAGS),
  score: z.coerce.number(),
  quote: z.string(),
});

// 模型偶尔会把某条 beat 的 tag 写成表外的词、把 score 写成字符串，或者把 bubble 写成对象。
// 以前这些会让整份输出 bad_schema（连 bubble 一起丢）；现在只丢出错的那一项。
const optText = z.string().nullable().optional().catch(null);
const RendererSchema = z.object({
  beats: z.array(z.unknown()).catch([]),
  contrast: optText,
  headline: optText,
  bubble: optText,
  bubbleQuote: optText,
});

export interface RendererInput {
  seatName: string;
  /** 这个角色可能出现的名字/英文名，用于第一人称校验。 */
  aliases?: string[];
  reasoning: string;
  reasoningKind: 'raw' | 'summary' | null;
  decision: PlayerDecision;
  situation: string;
  budgetMs?: number;
}

export interface RendererResult {
  output: RendererOutput;
  meta: RendererMeta;
}

const EMPTY: RendererOutput = { beats: [], contrast: null, headline: null, bubble: null, bubbleQuote: null };

export interface BubbleValidation {
  ok: boolean;
  text: string | null;
  quote: string | null;
  reason?: string;
}

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * 上屏的「一句心里话」必须满足：
 * - ≤22 个汉字（码点）；
 * - 第一人称，不能出现自己的名字/英文名；
 * - 不能用「他/她」指代自己；
 * - 不能是「X 先做 Y」这种第三人称标签；
 * - 必须能在思维链原文里逐字找到 quote。
 */
export function validateBubbleText(
  text: string | null | undefined,
  quote: string | null | undefined,
  reasoning: string,
  name: string,
  aliases: string[] = []
): BubbleValidation {
  const t = String(text ?? '').trim();
  const q = String(quote ?? '').trim();
  if (!t) return { ok: false, text: null, quote: null, reason: 'empty' };
  if ([...t].length > 22) return { ok: false, text: null, quote: null, reason: 'too_long' };
  if (!q || !quoteInReasoning(q, reasoning)) return { ok: false, text: null, quote: null, reason: 'not_grounded' };
  const screened = screenText(t);
  if (!screened.ok) return { ok: false, text: null, quote: null, reason: `blocked:${screened.reasons.join(',')}` };
  if (isMetaReasoning(t)) return { ok: false, text: null, quote: null, reason: 'meta' };

  const names = [...new Set([name, ...aliases].map((s) => s.trim()).filter(Boolean))];
  for (const n of names) {
    if (n.length >= 2 && new RegExp(escapeRe(n), 'i').test(t)) {
      return { ok: false, text: null, quote: null, reason: `own_name:${n}` };
    }
  }
  // 用他/她指代自己：句首，或「他/她自己/本人」，或「他/她+先/又/总/…」
  if (/^(他|她)/.test(t) || /(他|她)(自己|本人)/.test(t) || /(他|她)(又|总|还是|先|要|想|会|得|是|在|把|给)/.test(t)) {
    return { ok: false, text: null, quote: null, reason: 'third_person_self' };
  }
  // 标签式短语：「X 先做 Y」，且没有任何第一人称标记
  const firstPerson = /(我|俺|咱|老子|老夫|人家)/.test(t);
  if (!firstPerson && /^.{0,12}(先|又|总|还是|就)[\u4e00-\u9fa5]/.test(t)) {
    return { ok: false, text: null, quote: null, reason: 'label_phrase' };
  }
  return { ok: true, text: t, quote: q };
}

function systemPrompt(): string {
  return `你是直播跑团的「看点编辑」。观众屏幕上只会看到角色头上的两样东西：一句第一人称心里话（云朵气泡）和角色说出口的话（说话气泡）。你没有在写小说。
你不是编剧：不能编造原文里没有的想法。每一条 beat 和 bubble 都必须附一段原文里逐字出现的 quote 作为依据；对不上就会被系统丢掉。
挑有戏剧性的：怀疑队友、想背刺、怕死、贪宝、对规则或局面的误判、想的和做的不一样、吐槽 GM。
不要流水账（「我需要计算距离」），不要复述动作，不要解释规则。
【不是想法，一律丢掉】原文里如果有模型在考虑输出格式的段落——JSON、expression、表情名（neutral/happy/smug/angry/scared/surprised/thinking/hurt）、「我需要以 XX 的身份」「选 angry」「哪个表情更合适」——那不是角色在想事情，不要引用，也不要写成看点。
【翻译】原文可能是英文（Gemini 的思考摘要经常是英文）。所有上屏文字必须是中文：先翻成中文再加工，bubble/headline/contrast 也一样；玩家名字统一用中文名，不要写拼音或英文名（「名字对照」里列的那些）。
每条 beat：第一人称、口语、≤30 字，可以原样引用原文，但要用观众听得懂的话。最多 3 条（优先 2 条，挑最值的）。
tag 只能是：算计、犹豫、恐惧、贪心、背刺念头、自我吐槽、误判、计划。
score 0-10，表示观众会不会觉得有意思。
bubble：只写一句第一人称心里话，≤22 个汉字，口语，像角色在心里嘀咕；必须能在原文里找到依据，并在 bubbleQuote 给出原文逐字片段。
bubble 不能出现角色自己的名字或英文名（名字和别名会给你），不能用「他/她」指代自己，不能是「X 先做 Y」这种第三人称标签，不能复述动作或念规则。不合格会把原因给你，让你重写一次；仍不合格就不出云朵（填 null）。
headline ≤16 字，是这一回合的看点标题（只给 Helixus 看，不上屏）。
contrast：想的和做的哪里反差最大，一句话；没有就 null（只给 Helixus 看）。
不要输出网址、联系方式、长串数字、现实政治话题。只输出一个 JSON 对象，不要 markdown：
{"bubble":"...或 null","bubbleQuote":"原文逐字片段或 null","beats":[{"text":"...","tag":"算计","score":8,"quote":"原文逐字片段"}],"contrast":"...或 null","headline":"...或 null"}`;
}

function userPrompt(input: RendererInput): string {
  // Gemini 的思考摘要经常 1200–1900 字；摘要太长只取前 600 字（校验仍拿完整原文，quote 不会被误判）。
  const reasoningText = clip(input.reasoning, input.reasoningKind === 'summary' ? 600 : 900);
  const aliases = [...new Set([input.seatName, ...(input.aliases ?? [])].filter(Boolean))];
  return `【玩家】${input.seatName}
【名字对照】这个角色在原文里可能被叫作：${aliases.join(' / ')}。上屏文字一律用中文名「${input.seatName}」，bubble 里不要出现自己的名字。
【这一回合的${input.reasoningKind === 'summary' ? '思考摘要（Gemini，摘要不是原文，只截前半段）' : '思维链原文'}】
${reasoningText}

【他最终做的决定】
说：「${clip(input.decision.say, 120)}」
做：${input.decision.action.type}${input.decision.action.target ? ` / ${clip(input.decision.action.target, 40)}` : ''}${input.decision.action.detail ? ` / ${clip(input.decision.action.detail, 120)}` : ''}

【局面】
${clip(input.situation, 450)}

只输出 JSON。bubble 一句话，最多 22 个汉字，第一人称；不合格会重写一次。`;
}

export function parseRendererJson(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

export interface RendererValidationOptions {
  name?: string;
  aliases?: string[];
}

export function validateRendererOutput(
  raw: unknown,
  reasoning: string,
  opts: RendererValidationOptions = {}
): { output: RendererOutput; dropped: number; bubbleReason?: string } {
  const parsed = RendererSchema.safeParse(raw);
  if (!parsed.success) return { output: EMPTY, dropped: 0, bubbleReason: 'bad_schema' };
  const reasoningNorm = reasoning.replace(/\s+/g, '');
  const seen = new Set<string>();
  const beats: ThoughtBeat[] = [];
  let dropped = 0;

  for (const rawBeat of parsed.data.beats.slice(0, 12)) {
    const parsedBeat = BeatSchema.safeParse(rawBeat);
    if (!parsedBeat.success) {
      dropped += 1;
      continue;
    }
    const b = parsedBeat.data;
    const text = b.text.trim();
    const quote = b.quote.trim();
    if (!text || !quote) {
      dropped += 1;
      continue;
    }
    if (!quoteInReasoning(quote, reasoningNorm)) {
      dropped += 1;
      continue;
    }
    // 模型在考虑 JSON/表情字段的段落不是角色的想法：quote 或 beat 命中一律丢掉
    if (isMetaReasoning(quote) || isMetaReasoning(text)) {
      dropped += 1;
      continue;
    }
    // 关键词必须真的在原文里（quote 本身已校验；text 里若出现 URL/政治等也挡）
    const screenedText = screenText(text);
    const screenedQuote = screenText(quote);
    if (!screenedText.ok || !screenedQuote.ok) {
      dropped += 1;
      continue;
    }
    const normalized = clip(screenedText.text, 30);
    if (seen.has(normalized)) {
      dropped += 1;
      continue;
    }
    seen.add(normalized);
    beats.push({
      text: normalized,
      tag: b.tag,
      score: Math.max(0, Math.min(10, Math.round(b.score))),
      quote: clip(screenedQuote.text, 40),
    });
  }
  beats.sort((a, b) => b.score - a.score);
  if (beats.length > 3) {
    dropped += beats.length - 3;
    beats.length = 3;
  }

  const contrastRaw = parsed.data.contrast ?? null;
  const contrastScreen = contrastRaw && !isMetaReasoning(contrastRaw) ? screenText(contrastRaw) : null;
  const contrast = contrastScreen?.ok && contrastScreen.text ? clip(contrastScreen.text, 60) : null;

  const headlineRaw = parsed.data.headline ?? null;
  const headlineScreen = headlineRaw && !isMetaReasoning(headlineRaw) ? screenText(headlineRaw) : null;
  const headline = headlineScreen?.ok && headlineScreen.text ? clip(headlineScreen.text, 16) : null;

  const name = opts.name ?? '';
  const aliases = opts.aliases ?? [];
  let bubble: string | null = null;
  let bubbleQuote: string | null = null;
  let bubbleReason: string | undefined;
  if (parsed.data.bubble) {
    const checked = validateBubbleText(parsed.data.bubble, parsed.data.bubbleQuote, reasoning, name, aliases);
    if (checked.ok) {
      bubble = checked.text;
      bubbleQuote = checked.quote;
    } else {
      bubbleReason = checked.reason;
    }
  }

  return { output: { beats, contrast, headline, bubble, bubbleQuote }, dropped, bubbleReason };
}

/**
 * 默认 7 秒预算（直播实测 Gemini 的思考摘要常在 3 秒外）。超时就只显示一行说明，不显示看点；
 * 原始思维链绝不进返回值以外的地方。
 */
export async function runRenderer(
  llm: LLM,
  config: AppConfig,
  input: RendererInput
): Promise<RendererResult> {
  const started = Date.now();
  const budget = input.budgetMs ?? 7000;
  const name = input.seatName;
  const aliases = input.aliases ?? [];
  const fail = (reason: string): RendererResult => ({
    output: EMPTY,
    meta: { ok: false, latencyMs: Date.now() - started, reason, droppedBeats: 0, keywords: [] },
  });

  if (!input.reasoning || countChars(input.reasoning) < 12) return fail('no_reasoning');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('timeout', 'TimeoutError')), budget);
  let timedOut = false;
  timer.unref?.();
  const call = async (messages: Message[], timeoutMs: number) => {
    const remaining = Math.max(400, budget - (Date.now() - started) - 100);
    const result = await Promise.race([
      llm.complete(
        'renderer',
        {
          system: systemPrompt(),
          messages,
          maxTokens: 400,
          temperature: config.models.seats.renderer.temperature,
          stream: false,
          timeoutMs: Math.min(timeoutMs, remaining),
          signal: controller.signal,
        },
        'renderer'
      ),
      new Promise<null>((resolve) => {
        setTimeout(() => {
          timedOut = true;
          controller.abort(new DOMException('timeout', 'TimeoutError'));
          resolve(null);
        }, Math.min(timeoutMs, remaining) + 50);
      }),
    ]);
    return result;
  };

  const fallbackBubble = (beats: ThoughtBeat[]) => {
    for (const b of beats) {
      const checked = validateBubbleText(b.text, b.quote, input.reasoning, name, aliases);
      if (checked.ok) return { bubble: checked.text, bubbleQuote: checked.quote };
    }
    return { bubble: null as string | null, bubbleQuote: null as string | null };
  };

  try {
    const first = await call([{ role: 'user', content: userPrompt(input) }], budget);
    if (!first || timedOut) return fail('timeout');
    const raw = parseRendererJson(first.text);
    if (!raw) return fail('bad_json');
    const checkedFirst = validateRendererOutput(raw, input.reasoning, { name, aliases });
    let output = checkedFirst.output;
    let dropped = checkedFirst.dropped;
    let bubbleReason = checkedFirst.bubbleReason;
    let retried = false;

    // bubble 不合格就重写一次；只重写 bubble，不重跑 beat 校验
    if (!output.bubble && output.beats.length > 0 && Date.now() - started < budget - 1200) {
      retried = true;
      bubbleReason = bubbleReason ?? 'missing';
      const correction = `你上一版 bubble 不合格（${bubbleReason}）。只重写 bubble 和 bubbleQuote，其他字段可以原样返回。
要求：一句第一人称中文心里话，≤22 个汉字；不能出现角色自己的名字（${[name, ...aliases].join('/')}），不能用他/她指代自己，不能是「X 先做 Y」这种标签，必须在原文里有逐字依据。仍然不合格就填 null。`;
      const second = await call(
        [
          { role: 'user', content: userPrompt(input) },
          { role: 'assistant', content: first.text },
          { role: 'user', content: correction },
        ],
        budget
      );
      if (second && !timedOut) {
        const raw2 = parseRendererJson(second.text);
        if (raw2) {
          const checkedSecond = validateRendererOutput(raw2, input.reasoning, { name, aliases });
          if (checkedSecond.output.bubble) {
            output = { ...output, bubble: checkedSecond.output.bubble, bubbleQuote: checkedSecond.output.bubbleQuote };
            bubbleReason = undefined;
          } else {
            bubbleReason = checkedSecond.bubbleReason ?? bubbleReason;
          }
          dropped += checkedSecond.dropped;
        }
      }
    }

    if (!output.bubble && output.beats.length > 0) {
      const picked = fallbackBubble(output.beats);
      if (picked.bubble) {
        output = { ...output, bubble: picked.bubble, bubbleQuote: picked.bubbleQuote };
        bubbleReason = undefined;
      }
    }

    return {
      output,
      meta: {
        ok: output.beats.length > 0 || !!output.contrast || !!output.bubble,
        latencyMs: Date.now() - started,
        reason: output.beats.length || output.bubble ? undefined : 'no_grounded_beats',
        droppedBeats: dropped,
        keywords: [...output.beats.map((b) => b.quote), ...(output.bubbleQuote ? [output.bubbleQuote] : [])],
        bubbleReason,
        bubbleRetried: retried,
      },
    };
  } catch (e) {
    if (e instanceof LLMError && (e.kind === 'timeout' || e.kind === 'cancelled')) return fail('timeout');
    const detail = e instanceof LLMError ? `${e.kind}: ${e.message}` : `unknown: ${(e as Error).message}`;
    return fail(`error:${detail.slice(0, 160)}`);
  } finally {
    clearTimeout(timer);
  }
}
