import type { AppConfig, SeatId } from '../config.js';
import type { Logs } from '../log.js';
import { LLM } from './index.js';
import type { CompleteRequest, CompleteResult, ToolCall } from './types.js';
import { uuid } from '../util.js';

/**
 * 只用于本机演示/测试：不调真模型，按固定剧本产出 GM 工具调用、玩家 JSON、看点 JSON。
 * 真直播不能用它；用 `--fake` 启动时会在日志和状态里明确标出来。
 */
export class FakeLLM extends LLM {
  private gmTurns = 0;
  private startedCombat = false;
  private monsterTurns = 0;
  private readonly log: Logs;
  private readonly fakeConfig: AppConfig;

  constructor(config: AppConfig, logs: Logs) {
    super(config, logs);
    this.log = logs;
    this.fakeConfig = config;
  }

  override async complete(seat: SeatId, req: CompleteRequest, purpose: string): Promise<CompleteResult> {
    const started = Date.now();
    await new Promise((r) => setTimeout(r, 30));
    const last = req.messages[req.messages.length - 1];
    const lastText =
      typeof last?.content === 'string'
        ? last.content
        : (last?.content ?? [])
            .map((p) => (p.type === 'text' ? p.text : p.type === 'tool_result' ? p.content : ''))
            .join('\n');
    const sawToolResult = Array.isArray(last?.content) && last.content.some((p) => p.type === 'tool_result');
    const system = req.system ?? '';

    if (seat === 'gm') return this.gmTurn(system, lastText, sawToolResult, purpose, started);
    if (seat === 'renderer') return this.rendererTurn(lastText, started);
    if (seat === 'director') return this.directorTurn(lastText, started);
    return this.playerTurn(seat, lastText, started);
  }

  private result(partial: Partial<CompleteResult> & { text?: string; toolCalls?: ToolCall[] }): CompleteResult {
    return {
      text: partial.text ?? '',
      reasoning: partial.reasoning ?? null,
      reasoningKind: partial.reasoningKind ?? null,
      toolCalls: partial.toolCalls ?? [],
      usage: partial.usage ?? { inputTokens: 0, outputTokens: 0 },
      latencyMs: partial.latencyMs ?? 30,
      model: 'fake',
      provider: 'fake',
      stopReason: partial.stopReason ?? (partial.toolCalls?.length ? 'tool_use' : 'end_turn'),
      attempts: 1,
    };
  }

  private gmTurn(system: string, lastText: string, sawToolResult: boolean, purpose: string, started: number): CompleteResult {
    this.log.usage.record({ seat: 'gm', purpose, provider: 'fake', model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: 30, attempts: 1, ok: true });
    const call = (name: string, input: Record<string, unknown>): ToolCall => ({ id: `fake_${uuid().slice(0, 8)}`, name, input });

    if (sawToolResult) {
      return this.result({ text: '', latencyMs: Date.now() - started });
    }
    if (/出口已达成/.test(lastText)) {
      // 假 GM：被要求收尾就收尾（带公开版前情）
      return this.result({
        toolCalls: [
          call('narrate', { text: '你们站在岩缝口，溪水声从下面涌上来。该走了。' }),
          call('end_scene', { summary: '（假 GM）按出口条件收尾', public_recap: '（假 GM）你们走到了岩缝口，决定进去。' }),
        ],
        latencyMs: Date.now() - started,
      });
    }
    if (/世界回合/.test(lastText)) {
      // 回合计：清单里的每一项都 world_act 登记；探索里的世界回合最后还要 ask_player（桌面会改成该动的那位）
      const ids = [...lastText.matchAll(/（id=([^，）]+)，/g)].map((m) => m[1]);
      const combatWorld = /战斗轮结束/.test(lastText);
      return this.result({
        toolCalls: [
          call('narrate', { text: '林子里的动静变了，远处有什么东西挪了一下。' }),
          ...ids.map((id) => call('world_act', { entry: id, did: '保持原样，盯着这边' })),
          ...(combatWorld ? [] : [call('ask_player', { seat: 'player_a', prompt: '新的一轮。你要做什么？' })]),
        ],
        latencyMs: Date.now() - started,
      });
    }
    if (/现在轮到怪物/.test(lastText)) {
      // 演示 / 测试用：怪物真的去打人（走规则层的多攻、借机攻击、倒地、死亡豁免）
      const name = /现在轮到怪物「([^」]+)」/.exec(lastText)?.[1] ?? '';
      this.monsterTurns += 1;
      const target = this.monsterTurns % 2 === 0 ? 'player_b' : 'player_a';
      return this.result({
        toolCalls: [
          call('narrate', { text: '怪物低吼一声，扑了上来，鱼骨矛在灯下闪了一下。' }),
          call('monster_attack', { monster: name, target }),
          call('next_turn', {}),
        ],
        latencyMs: Date.now() - started,
      });
    }
    if (/开场/.test(lastText)) {
      this.gmTurns = 1;
      return this.result({
        toolCalls: [
          call('narrate', {
            text: '午夜的风裹着咸味。你们抓住船板爬上“银鸥号”倾斜的甲板，货舱口在脚下张着黑嘴，船尾的提灯忽明忽暗。海面上，一道白色的水痕正绕着船慢慢转圈。',
          }),
          call('ask_player', { seat: 'player_a', prompt: '甲板上只有你们两个人。先做什么？' }),
        ],
        latencyMs: Date.now() - started,
      });
    }

    this.gmTurns += 1;
    if (!this.startedCombat && this.gmTurns >= 3) {
      this.startedCombat = true;
      return this.result({
        toolCalls: [
          call('narrate', { text: '脚下的积水忽然一晃。两只湿漉漉的影子从船舷翻了上来，手里攥着磨得发白的鱼骨矛。' }),
          call('start_combat', { monsters: [{ monster_id: 'sahuagin', count: 2 }] }),
          call('ask_player', { seat: 'player_a', prompt: '它们上船了。你要做什么？' }),
        ],
        latencyMs: Date.now() - started,
      });
    }
    const seat = this.gmTurns % 2 === 0 ? 'player_b' : 'player_a';
    return this.result({
      toolCalls: [
        call('narrate', { text: this.gmTurns % 2 === 0 ? '货舱深处传来一声轻响，像有人把铁器碰在了木板上。' : '提灯的火焰缩了一下。船身又一次倾向海面。' }),
        call('ask_player', { seat, prompt: '轮到你。你要做什么？' }),
      ],
      latencyMs: Date.now() - started,
    });
  }

  /** 假导演：默认什么都不判；提示里带 [[FAKE_EXIT]] 就判出口满足，[[FAKE_DRIFT:key]] 就指出那条事实对不上，[[FAKE_BEAT:id]] 就给节拍打勾。 */
  private directorTurn(prompt: string, started: number): CompleteResult {
    this.log.usage.record({ seat: 'director', purpose: 'director', provider: 'fake', model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: 30, attempts: 1, ok: true });
    const exit = /\[\[FAKE_EXIT\]\]/.test(prompt);
    const drift = /\[\[FAKE_DRIFT:([^\]]+)\]\]/.exec(prompt)?.[1];
    const beat = /\[\[FAKE_BEAT:([^\]]+)\]\]/.exec(prompt)?.[1];
    const reveal = /\[\[FAKE_REVEAL:([^\]]+)\]\]/.exec(prompt)?.[1];
    const out = {
      exit_met: exit,
      exit_reason: exit ? '（假导演）出口条件满足' : '',
      beats_done: beat ? [beat] : [],
      drift: drift ? [{ what: '（假导演）这条和剧本对不上', fact_key: drift }] : [],
      stalled: false,
      push: '（假导演）让远处传来一声动静，局面往前走一步',
      reveal: reveal ? [reveal] : [],
      summary: exit ? '（假导演）这一幕按出口条件结束' : '',
      public_recap: exit ? '（假导演）你们找到了路，往前走了' : '',
    };
    return this.result({ text: JSON.stringify(out), latencyMs: Date.now() - started });
  }

  private playerTurn(seat: SeatId, view: string, started: number): CompleteResult {
    const inCombat = /【局面】战斗中/.test(view);
    const a = seat === 'player_a';
    const reasoning = a
      ? '我盯着那只箱子，先别让她看见。要是她问起来，就说我去探路。她要是先动手，我就把话说圆一点。'
      : '愿神保佑，但我得先数清楚退路。真打起来，我可不站最前面。先看看她往哪边走，再决定要不要跟。';
    const decision = inCombat
      ? {
          say: a ? '别挡路，这只归我。' : '我压住它，你找机会！',
          action: { type: 'attack', detail: a ? '刺剑' : '钉头锤' },
          expression: a ? 'angry' : 'neutral',
        }
      : {
          say: a ? '我去前面探路。' : '先别散开，这船不对劲。',
          action: { type: a ? 'talk' : 'check', target: a ? undefined : '甲板', detail: a ? '嘴上说探路，脚下往船尾提灯走' : '观察甲板和货舱口' },
          expression: a ? 'smug' : 'thinking',
        };
    const text = JSON.stringify(decision);
    this.log.usage.record({ seat, purpose: `player:${seat}`, provider: 'fake', model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: 30, attempts: 1, ok: true });
    return this.result({
      text,
      reasoning,
      reasoningKind: a ? 'raw' : 'summary',
      latencyMs: Date.now() - started,
    });
  }

  private rendererTurn(prompt: string, started: number): CompleteResult {
    const a = prompt.includes('【玩家】薇克丝');
    const reasoning = a
      ? '我盯着那只箱子，先别让她看见。要是她问起来，就说我去探路。'
      : '愿神保佑，但我得先数清楚退路。真打起来，我可不站最前面。';
    if (!prompt.includes(reasoning.slice(0, 8))) {
      return this.result({ text: '{"beats":[],"contrast":null,"headline":null}', latencyMs: Date.now() - started });
    }
    const payload = a
      ? {
          beats: [
            { text: '这箱子得先到手，别让她看见', tag: '贪心', score: 8, quote: '先别让她看见' },
            { text: '她要是问，就说我去探路', tag: '算计', score: 7, quote: '就说我去探路' },
          ],
          contrast: '嘴上说探路，心里想的是独吞',
          headline: '她想独吞',
        }
      : {
          beats: [
            { text: '先数清楚退路，别站最前面', tag: '恐惧', score: 8, quote: '先数清楚退路' },
            { text: '愿神保佑，可我更信自己的脚', tag: '自我吐槽', score: 6, quote: '愿神保佑' },
          ],
          contrast: '嘴上说别散开，心里已经在找退路',
          headline: '牧师先找退路',
        };
    this.log.usage.record({ seat: 'renderer', purpose: 'renderer', provider: 'fake', model: 'fake', inputTokens: 0, outputTokens: 0, latencyMs: 30, attempts: 1, ok: true });
    return this.result({ text: JSON.stringify(payload), latencyMs: Date.now() - started });
  }

  /** 让 /status 能看出这不是真模型 */
  override seat(id: SeatId) {
    const s = super.seat(id);
    return { ...s, model: `fake:${s.model}` };
  }

  get configSummary(): string {
    return `fake（${this.fakeConfig.models.seats.gm.model}）`;
  }
}
