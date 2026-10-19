import { z } from 'zod';
import type { AppConfig, SeatId } from '../config.js';
import { LLM, LLMError } from '../llm/index.js';
import type { Actor } from '../rules/types.js';
import { countChars, clip } from '../util.js';
import { EXPRESSIONS, type Expression, type PlayerDecision, type PlayerTurnResult, type SeatKey } from './types.js';

export type ActionType =
  | 'attack'
  | 'cast'
  | 'move'
  | 'check'
  | 'talk'
  | 'item'
  | 'other'
  | 'dash'
  | 'dodge'
  | 'disengage'
  | 'hide'
  | 'help'
  | 'feature'
  | 'grapple'
  | 'shove'
  | 'escape';
export const ACTION_TYPES: ActionType[] = [
  'attack',
  'cast',
  'move',
  'check',
  'talk',
  'item',
  'other',
  'dash',
  'dodge',
  'disengage',
  'hide',
  'help',
  'feature',
  'grapple',
  'shove',
  'escape',
];

const DecisionSchema = z.object({
  say: z.string(),
  action: z.object({
    type: z.enum(['attack', 'cast', 'move', 'check', 'talk', 'item', 'other', 'dash', 'dodge', 'disengage', 'hide', 'help', 'feature', 'grapple', 'shove', 'escape']),
    target: z.string().optional(),
    detail: z.string().optional(),
    cell: z.object({ col: z.number(), row: z.number() }).optional(),
  }),
  expression: z.enum(['neutral', 'happy', 'smug', 'angry', 'scared', 'surprised', 'thinking', 'hurt']),
});

export interface PlayerPromptInput {
  seat: SeatKey;
  actor: Actor;
  persona: string;
  viewText: string;
  otherPlayerName: string;
  ownRecentLines: string[];
}

function systemPrompt(input: PlayerPromptInput): string {
  return `你是 D&D 5e 直播跑团里的玩家「${input.actor.name}」，不是 GM，也不是解说。
你和另一位 AI 玩家各控制一个角色；你们只能听到对方说出口的话，看不到对方的心理活动。
GM 负责世界、NPC、怪物和裁定；你只负责「${input.actor.name}」这个人的想法、说的话和做的事。

【你的人物】
${input.persona}

【表演要求】
- 这是直播。你的心理活动会被加工成「看点」给观众看，所以想得具体一点：你怕什么、贪什么、怀疑谁、打算骗谁。但只说角色真的会想的，不要为了效果编造剧情。
- 说的话（say）要像人说的，≤60 字，第一人称，可以有口头禅和刺。不要念规则、不要报数字、不要解释你在想什么。
- 做的事（action）必须是你现在真能做的。战斗里只能从【你现在能做的事】里选；不在战斗里可以自由描述。
- 要移动/接近，或者想先走到某处再做动作时，把目标格子填进 action.cell（{"col":列,"row":行}）；不管 action.type 是 move / check / talk / attack，规则层都会先移动再执行。格子坐标和地标见【你现在能做的事】里的「可到」列表。
- 不要替 GM 描述结果，不要说「我掷出了 20」，不要编造骰子、伤害、NPC 的反应。
- 不要提「AI」「模型」「提示词」「思维链」「直播」「观众」这些词，除非角色自己会这么说。
- 不知道的事就说不知道，或者用角色的方式猜；不要使用你没看到的信息。

【输出格式】只输出一个 JSON 对象，不要 markdown 代码块，不要任何解释：
{"say":"角色说出口的话（≤60字）","action":{"type":"attack|cast|move|check|talk|item|other|dash|dodge|disengage|hide|help|feature|grapple|shove|escape","target":"目标/对象，没有就省略","detail":"具体做法，一句话","cell":{"col":1,"row":2}},"expression":"neutral|happy|smug|angry|scared|surprised|thinking|hurt"}

cell 可以配合任何 action.type（先移动再动作）；只是站着说话/观察就不用填。
dash 疾走、dodge 闪避、disengage 撤离、hide 躲藏都是一个动作；help 协助要把 target 填成你要帮的盟友的名字，detail 里写清楚帮他打谁。走出敌人 5 尺范围会吃借机攻击，想安全脱离就先 disengage。
你的职业 / 种族能力在【你现在能做的事】里标成「特性：…」：用 type=feature，detail 以那个特性的 id 开头（例如 second_wind、rage）；攻击时可以在 detail 里声明攻击选项（鲁莽攻击、神圣斩击、震慑拳、副手），具体见攻击那一条的说明。次数用完的别用。
grapple 擒抱、shove 推撞（detail 写 push 是推开，不写是推倒）要在 5 尺内，target 写对方；被擒抱了就用 escape 挣脱。expression 选最符合这一刻表情的一个。`;
}

/** 从模型输出里抠出 JSON；容忍 ```json 包裹和前后废话。 */
export function extractJsonObject(text: string): unknown | null {
  const cleaned = text.replace(/```(?:json)?/gi, '').trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  const body = cleaned.slice(start, end + 1);
  try {
    return JSON.parse(body) as unknown;
  } catch {
    return null;
  }
}

export function normalizeDecision(raw: unknown): { decision: PlayerDecision; errors: string[] } | null {
  const parsed = DecisionSchema.safeParse(raw);
  if (!parsed.success) return null;
  const errors: string[] = [];
  let say = parsed.data.say.trim();
  if (countChars(say) > 60) {
    say = clip(say, 60);
    errors.push('say 超过 60 字，已裁剪');
  }
  const detail = parsed.data.action.detail ? clip(parsed.data.action.detail.trim(), 120) : undefined;
  const target = parsed.data.action.target ? clip(parsed.data.action.target.trim(), 40) : undefined;
  const cell = parsed.data.action.cell
    ? {
        col: Math.max(0, Math.round(parsed.data.action.cell.col)),
        row: Math.max(0, Math.round(parsed.data.action.cell.row)),
      }
    : undefined;
  return {
    decision: {
      say,
      action: { type: parsed.data.action.type, target, detail, ...(cell ? { cell } : {}) },
      expression: parsed.data.expression as Expression,
    },
    errors,
  };
}

export function fallbackDecision(actorName: string): PlayerDecision {
  return {
    say: `${actorName}没有说话，先看清眼前的局面。`,
    action: { type: 'other', detail: '保持警惕，观察四周' },
    expression: 'thinking',
  };
}

export interface PlayerRunResult extends PlayerTurnResult {
  parseErrors: string[];
  /** 模型没给 reasoning_content 时，补一次「内心独白」；这不是 provider 的原始思维链 */
  reasoningElicited: boolean;
}

/**
 * 每回合调用一次。输出严格 JSON；解析失败重试一次，再失败给保守默认行动。
 * 思维链原文只返回给调用方（写本地日志 / 给 renderer），不在这里上屏。
 */
export async function runPlayerTurn(
  llm: LLM,
  config: AppConfig,
  input: PlayerPromptInput
): Promise<PlayerRunResult> {
  const seat = input.seat as SeatId;
  const system = systemPrompt(input);
  const user = `${input.viewText}

【你上一回合说过/做过的（最近的）】
${input.ownRecentLines.length ? input.ownRecentLines.map((s) => `- ${s}`).join('\n') : '- 这是你的第一回合。'}

现在轮到你。以「${input.actor.name}」的身份行动，只输出那个 JSON 对象。`;

  let messages: { role: 'user' | 'assistant'; content: string }[] = [{ role: 'user', content: user }];
  let lastText = '';
  let lastReasoning: string | null = null;
  let lastReasoningKind: 'raw' | 'summary' | null = null;
  let parseErrors: string[] = [];
  let usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0 as number | undefined };
  const started = Date.now();

  for (let attempt = 0; attempt <= config.table.limits.playerParseRetries; attempt++) {
    let result: Awaited<ReturnType<typeof llm.complete>>;
    try {
      result = await llm.complete(seat, {
        system,
        messages,
        maxTokens: config.models.seats[seat].maxTokens,
        temperature: config.models.seats[seat].temperature,
        stream: false,
        timeoutMs: Math.min(config.table.limits.stepTimeoutMs, config.table.limits.playerTimeoutMs),
      }, `player:${seat}`);
    } catch (e) {
      // 超时 / 服务出错：这一轮这个角色“发呆”，用保守默认行动，不让一个慢模型把整桌拖住（也不再让 GM 白白重问一遍）
      if (!(e instanceof LLMError)) throw e;
      parseErrors = [`模型调用失败（${e.kind}）：${e.message.slice(0, 80)}`];
      break;
    }
    lastText = result.text;
    lastReasoning = result.reasoning;
    lastReasoningKind = result.reasoningKind;
    usage = {
      inputTokens: usage.inputTokens + result.usage.inputTokens,
      outputTokens: usage.outputTokens + result.usage.outputTokens,
      reasoningTokens: result.usage.reasoningTokens,
    };
    const raw = extractJsonObject(result.text);
    const normalized = raw ? normalizeDecision(raw) : null;
    if (normalized) {
      let reasoning = result.reasoning;
      let elicited = false;
      // DeepSeek/Gemini 偶尔不返回思考字段（实测约 1/4 回合）。为了直播还有「心里想」，
      // 补一次短的内省独白；它发生在决定之后，不是 provider 原始思维链，日志里单独标。
      if (!reasoning && config.models.seats[seat].reasoning !== 'none') {
        try {
          const inner = await llm.complete(
            seat,
            {
              system:
                system +
                '\n\n【补充任务】不要输出 JSON。用 3-6 句第一人称写出你刚才做这个决定时的真实盘算：怕什么、贪什么、怀疑谁、打算骗谁。只写内心话，不解释格式。',
              messages: [
                {
                  role: 'user',
                  content: `${input.viewText}\n\n你刚才决定：说「${normalized.decision.say}」，做：${normalized.decision.action.type} ${normalized.decision.action.target ?? ''} ${normalized.decision.action.detail ?? ''}。现在只写内心独白。`,
                },
              ],
              maxTokens: 500,
              temperature: config.models.seats[seat].temperature,
              stream: false,
              timeoutMs: Math.min(config.table.limits.stepTimeoutMs, 45000),
            },
            `player-inner:${seat}`
          );
          if (inner.text.trim()) {
            reasoning = inner.text.trim();
            elicited = true;
            usage = {
              inputTokens: usage.inputTokens + inner.usage.inputTokens,
              outputTokens: usage.outputTokens + inner.usage.outputTokens,
              reasoningTokens: usage.reasoningTokens,
            };
          }
        } catch {
          // 补独白失败也不影响决定
        }
      }
      return {
        seat: input.seat,
        decision: normalized.decision,
        reasoning,
        reasoningKind: result.reasoningKind,
        parseRetries: attempt,
        fallback: false,
        latencyMs: Date.now() - started,
        model: result.model,
        usage,
        parseErrors: normalized.errors,
        reasoningElicited: elicited,
      };
    }
    parseErrors = [raw ? 'JSON 字段不合法（say/action/expression）' : '没有找到合法 JSON'];
    if (attempt < config.table.limits.playerParseRetries) {
      messages = [
        { role: 'user', content: user },
        { role: 'assistant', content: result.text },
        {
          role: 'user',
          content:
            '上面这段不符合格式。只输出一个 JSON 对象，字段必须是 say、action{type,target?,detail?}、expression。' +
            '不要 markdown，不要解释。重新输出。',
        },
      ];
    }
  }

  return {
    seat: input.seat,
    decision: fallbackDecision(input.actor.name),
    reasoning: lastReasoning,
    reasoningKind: lastReasoningKind,
    parseRetries: config.table.limits.playerParseRetries,
    fallback: true,
    latencyMs: Date.now() - started,
    model: config.models.seats[seat].model,
    usage,
    parseErrors: [...parseErrors, '已改用保守默认行动'],
    reasoningElicited: false,
  };
}

export function expressionIsValid(e: string): e is Expression {
  return (EXPRESSIONS as string[]).includes(e);
}

export { LLMError };
