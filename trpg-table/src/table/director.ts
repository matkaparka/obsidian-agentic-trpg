import type { AppConfig } from '../config.js';
import type { LLM } from '../llm/index.js';
import { clip } from '../util.js';
import { extractJsonObject } from './player.js';

/**
 * 进度导演：一次小模型调用（models.yaml 里的 director 座位，现在是 Haiku 5.5），每隔几个探索轮对照剧本判断一次进度。
 * 它不叙述、不裁定，只回一个 JSON：出口满足了没有、哪些节拍做完了、GM 有没有编出和剧本对不上的东西、有没有原地打转、
 * 下一步该推什么。**桌面强制执行**（见 TableLoop.applyDirector）：出口满足就让 GM 收尾，GM 不收桌面替它收；
 * 对不上的世界事实删掉；推进指令塞进 GM 的下一步提示。它的输出不可信，每一项都在这里和桌面里校验过再用。
 */

export interface DirectorInput {
  /** 这一幕的全文（读给玩家的、公开信息、GM 秘密、遭遇、战利品清单、出口文字…），和 GM 看到的一样 */
  scene: string;
  /** 节拍打勾情况 + 自动出口规则 + 这一幕走到第几轮 */
  progress: string;
  /** 前情 + 已记下的世界事实（带 key） */
  memory: string;
  /** 最近的桌面记录 */
  recent: string;
  /** PC 和场上生物现在在哪 */
  where: string;
  /** 允许删的世界事实的 key / 允许打勾的节拍 id */
  factKeys: string[];
  beatIds: string[];
  /** 这是最后一幕（出口 = 一场结束） */
  isEnding: boolean;
  /** 场上藏着的生物（玩家看不见、地图上还没有标记），每行 `- id：名字（位置）` */
  hidden?: string;
  /** 导演允许让现身的生物 id（就是 hidden 里列的） */
  hiddenIds?: string[];
}

export interface DirectorDrift {
  what: string;
  /** 这条对不上的东西已经被登记成世界事实时，那条事实的 key（只认 factKeys 里有的） */
  factKey?: string;
}

export interface DirectorOutput {
  exitMet: boolean;
  exitReason: string;
  beatsDone: string[];
  drift: DirectorDrift[];
  stalled: boolean;
  push: string;
  /** 这一步 push 里要现身的、目前藏着的生物 id（桌面把它们放上地图） */
  reveal: string[];
  summary: string;
  publicRecap: string;
}

export interface DirectorResult {
  ok: boolean;
  output?: DirectorOutput;
  error?: string;
  latencyMs: number;
  model: string;
  usage: { inputTokens: number; outputTokens: number };
}

const SYSTEM = `你是一场 D&D 直播跑团的「进度导演」。你不是 GM：不叙述、不裁定、不扮演任何人。你只做一件事——对照剧本，判断这一幕进行到哪了、该不该收尾、GM 有没有编出和剧本对不上的东西、下一步该推什么。只输出一个 JSON 对象，不要任何别的字。

判断标准：
- exit_met：剧本的「出口/推进条件」或「自动出口」在**已经发生的事**里满足了（看最近记录和 PC 位置，不是看 GM 打算怎么办）。拿不准就 false。
- exit_reason：一句话，凭什么说满足了（exit_met 为 false 就写空串）。
- beats_done：节拍清单里，从记录看**已经做完**的 id，只列还没打勾的；没把握的别列。
- drift：GM 编出的、和剧本对不上的东西。典型：提前演了下一幕的内容（下一幕的怪、地点）、编出剧本里没有的重要 NPC / 怪物、和「GM 秘密」矛盾的设定。小的即兴（气氛、细节、不影响后面的设定）不算。每条写 what（一句话）；如果它已经被登记成世界事实，给 fact_key（只能是「已记下的世界事实」里 [] 里的 key）。
- stalled：最近几轮同一件事在原地打转、没有新信息或新进展。
- push：下一步该推的**一件具体的事**，一句话，写成「发生了什么」（有人出现、有动静、倒计时到点、线索被发现…），贴合剧本，不剧透 GM 秘密，不替玩家做决定。出口已满足时 push 写成收尾的提示。没必要推就写空串。
- reveal：push 里写到「某个生物出现 / 探出头 / 冲出来」，而它现在在【藏着的生物】清单里，就把它的 id 列在这里（只能写清单里的 id，一般 0–2 个），桌面会把它的标记放上地图，旁白和地图才对得上。没有就空数组。
- summary / public_recap：只有 exit_met 为 true 才写。summary 两句内，给 GM 自己看（可含秘密）；public_recap 一两句，只写玩家已经知道的事。

输出格式（字段一个都不能少）：
{"exit_met":false,"exit_reason":"","beats_done":[],"drift":[{"what":"","fact_key":""}],"stalled":false,"push":"","reveal":[],"summary":"","public_recap":""}`;

export function buildDirectorPrompt(input: DirectorInput): { system: string; user: string } {
  const parts: string[] = [];
  parts.push(`【剧本（这一幕）】\n${input.scene}`);
  if (input.progress) parts.push(`【进度】\n${input.progress}`);
  if (input.memory) parts.push(`【前情和世界事实】\n${input.memory}`);
  parts.push(`【现在在哪】\n${input.where || '（没有位置信息）'}`);
  if (input.hidden) parts.push(`【藏着的生物（玩家看不见，地图上还没有它们的标记）】\n${input.hidden}`);
  parts.push(`【最近的桌面记录】\n${input.recent || '（没有）'}`);
  parts.push(
    input.isEnding
      ? '这是最后一幕：exit_met 为 true 就意味着这一场结束。现在请输出 JSON。'
      : '现在请输出 JSON。'
  );
  return { system: SYSTEM, user: parts.join('\n\n') };
}

const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

/** 把模型的输出收拾成能用的结构；JSON 不合法返回 null。节拍 id / 事实 key 只留允许的。 */
export function parseDirectorOutput(text: string, input: Pick<DirectorInput, 'factKeys' | 'beatIds' | 'hiddenIds'>): DirectorOutput | null {
  const raw = extractJsonObject(text);
  if (!raw || typeof raw !== 'object') return null;
  const o = raw as Record<string, unknown>;
  if (!('exit_met' in o) && !('push' in o) && !('drift' in o)) return null;
  const beatIds = new Set(input.beatIds);
  const factKeys = new Set(input.factKeys);
  const hiddenIds = new Set(input.hiddenIds ?? []);
  const exitMet = o.exit_met === true;
  const drift: DirectorDrift[] = [];
  for (const d of arr(o.drift)) {
    if (!d || typeof d !== 'object') continue;
    const what = clip(str((d as Record<string, unknown>).what), 120);
    if (!what) continue;
    const key = str((d as Record<string, unknown>).fact_key);
    drift.push({ what, ...(key && factKeys.has(key) ? { factKey: key } : {}) });
  }
  return {
    exitMet,
    exitReason: exitMet ? clip(str(o.exit_reason), 160) : '',
    beatsDone: arr(o.beats_done)
      .map(str)
      .filter((id) => beatIds.has(id)),
    drift: drift.slice(0, 4),
    stalled: o.stalled === true,
    push: clip(str(o.push), 200),
    reveal: arr(o.reveal)
      .map(str)
      .filter((id) => hiddenIds.has(id))
      .slice(0, 3),
    summary: exitMet ? clip(str(o.summary), 300) : '',
    publicRecap: exitMet ? clip(str(o.public_recap), 200) : '',
  };
}

/** 调一次导演。出错 / 超时 / JSON 不合法都返回 ok:false，调用方跳过这一次，不影响桌面。 */
export async function runDirector(llm: LLM, config: AppConfig, input: DirectorInput): Promise<DirectorResult> {
  const seat = config.models.seats.director;
  const started = Date.now();
  const { system, user } = buildDirectorPrompt(input);
  try {
    const res = await llm.complete(
      'director',
      {
        system,
        messages: [{ role: 'user', content: user }],
        maxTokens: seat.maxTokens,
        temperature: seat.temperature,
        stream: false,
        timeoutMs: config.table.director?.timeoutMs ?? 30000,
      },
      'director'
    );
    const output = parseDirectorOutput(res.text, input);
    return {
      ok: !!output,
      ...(output ? { output } : { error: 'JSON 不合法或字段不对' }),
      latencyMs: Date.now() - started,
      model: res.model,
      usage: { inputTokens: res.usage.inputTokens, outputTokens: res.usage.outputTokens },
    };
  } catch (e) {
    return { ok: false, error: (e as Error).message.slice(0, 160), latencyMs: Date.now() - started, model: seat.model, usage: { inputTokens: 0, outputTokens: 0 } };
  }
}
