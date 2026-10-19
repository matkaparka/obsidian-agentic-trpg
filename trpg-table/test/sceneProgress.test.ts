// 进度管理：确定性的自动出口 + 节拍，和每隔几轮对照剧本判断一次的进度导演（Haiku）。
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LLMError, type CompleteRequest } from '../src/llm/types.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { buildDirectorPrompt, parseDirectorOutput } from '../src/table/director.js';
import { TableLoop } from '../src/table/loop.js';
import { SceneProgress, parseBeats, parseExitRules } from '../src/table/sceneProgress.js';
import { projectRoot } from '../src/util.js';

describe('剧本里的 ## 节拍 / ## 自动出口', () => {
  it('节拍：id｜描述；重复 id、缺描述的忽略', () => {
    const beats = parseBeats('- camp｜进营地\n- wolf | 处理狼\n- camp｜重复的 id\n- 只有名字\n不是列表');
    expect(beats).toEqual([
      { id: 'camp', text: '进营地' },
      { id: 'wolf', text: '处理狼' },
    ]);
  });

  it('自动出口：「且」连接条件，多行是「或」，读不懂的整条忽略（不会半条生效）', () => {
    const rules = parseExitRules(
      [
        '- 任一到达 trail 且 第 4 轮起｜找到了小径',
        '- 全员到达 outflow｜都出洞了',
        '- 第 14 轮起｜强制收尾',
        '- 节拍 gundren 完成 且 第 3 轮起｜救出了人',
        '- 任一到达 trail 且 天亮了｜这条有读不懂的条件，整条不要',
        '- 随便写点什么｜读不懂',
      ].join('\n')
    );
    expect(rules.map((r) => r.raw)).toEqual(['任一到达 trail 且 第 4 轮起', '全员到达 outflow', '第 14 轮起', '节拍 gundren 完成 且 第 3 轮起']);
    expect(rules[0].conds).toEqual([{ kind: 'any_at', ref: 'trail' }, { kind: 'round_from', n: 4 }]);
    expect(rules[0].note).toBe('找到了小径');
    expect(rules[3].conds).toEqual([{ kind: 'beat', id: 'gundren' }, { kind: 'round_from', n: 3 }]);
  });

  it('求值：条件全满足才算，多条规则取第一条满足的；打勾和存档', () => {
    const p = new SceneProgress();
    p.loadScene(parseBeats('- a｜甲\n- b｜乙'), parseExitRules('- 任一到达 trail 且 第 4 轮起｜到了\n- 节拍 b 完成｜b 做完了\n- 第 10 轮起｜上限'));
    let at = { any: false, all: false };
    const ctx = (round: number) => ({ round, at: () => at });
    expect(p.evaluate(ctx(3))).toBeNull();
    at = { any: true, all: false };
    expect(p.evaluate(ctx(3))).toBeNull(); // 到了但没到第 4 轮
    expect(p.evaluate(ctx(4))?.raw).toBe('任一到达 trail 且 第 4 轮起');
    at = { any: false, all: false };
    expect(p.evaluate(ctx(9))).toBeNull();
    expect(p.markBeat('乙')?.id).toBe('b'); // 按描述也认
    expect(p.markBeat('b')).toBeNull(); // 已经勾过
    expect(p.markBeat('没有')).toBeNull();
    expect(p.evaluate(ctx(5))?.raw).toBe('节拍 b 完成');
    expect(p.evaluate(ctx(10))?.raw).toBe('节拍 b 完成'); // 第一条满足的
    expect(p.gmBlock(5)).toContain('节拍（1/2）');
    expect(p.gmBlock(5)).toContain('[✓] b：乙');

    p.exit = { rule: 'x', note: 'y', sinceRound: 5, gmSteps: 1 };
    const copy = new SceneProgress();
    copy.loadScene(parseBeats('- a｜甲\n- b｜乙'), []);
    copy.load(JSON.parse(JSON.stringify(p.snapshot())));
    expect([...copy.done]).toEqual(['b']);
    expect(copy.exit?.gmSteps).toBe(1);
    // 存档里有已经不存在的节拍 id（剧本改了）：忽略
    copy.loadScene(parseBeats('- z｜新的'), []);
    copy.load({ done: ['b', 'z'], exit: null });
    expect([...copy.done]).toEqual(['z']);
  });

  it('正式剧本：五幕都有节拍和自动出口；规则里引用的地标和节拍都真的存在', () => {
    const adv = loadAdventure(loadConfig(projectRoot()).paths.campaignVault, 'phandalin-road');
    for (const s of adv.scenes) {
      expect(s.beats!.length, `${s.id} 没有节拍`).toBeGreaterThan(0);
      expect(s.autoExit!.length, `${s.id} 没有自动出口`).toBeGreaterThan(0);
      const ids = new Set(s.beats!.map((b) => b.id));
      const marks = s.mapInfo!.landmarks;
      for (const rule of s.autoExit!) {
        for (const c of rule.conds) {
          if (c.kind === 'beat') expect(ids.has(c.id), `${s.id}：规则「${rule.raw}」引用了不存在的节拍 ${c.id}`).toBe(true);
          if (c.kind === 'any_at' || c.kind === 'all_at') {
            expect(marks.some((l) => l.id === c.ref || l.name === c.ref), `${s.id}：规则「${rule.raw}」引用了不存在的地标 ${c.ref}`).toBe(true);
          }
        }
      }
      // 每一幕都有一条只看轮数的上限，不会无限拖
      expect(s.autoExit!.some((r) => r.conds.length === 1 && r.conds[0].kind === 'round_from'), `${s.id} 没有强制收尾的上限`).toBe(true);
    }
  });
});

describe('导演的输出校验', () => {
  const input = { factKeys: ['stream_brute', 'wolf_ally'], beatIds: ['camp', 'wolf', 'trail'] };

  it('只认允许的节拍 id 和事实 key；没出口时 exit_reason / summary 清空', () => {
    const out = parseDirectorOutput(
      '```json\n{"exit_met":false,"exit_reason":"不该留","beats_done":["wolf","瞎写的","trail"],"drift":[{"what":"提前演了洞口的哨兵","fact_key":"stream_brute"},{"what":"编了个公爵","fact_key":"不存在"},{"what":""}],"stalled":true,"push":"让远处传来号角声","summary":"不该留","public_recap":"不该留"}\n```',
      input
    )!;
    expect(out.exitMet).toBe(false);
    expect(out.exitReason).toBe('');
    expect(out.summary).toBe('');
    expect(out.beatsDone).toEqual(['wolf', 'trail']);
    expect(out.drift).toEqual([{ what: '提前演了洞口的哨兵', factKey: 'stream_brute' }, { what: '编了个公爵' }]);
    expect(out.stalled).toBe(true);
    expect(out.push).toBe('让远处传来号角声');
  });

  it('出口满足时保留收尾文字；不是 JSON 返回 null', () => {
    const out = parseDirectorOutput('{"exit_met":true,"exit_reason":"到了小径","summary":"两句话","public_recap":"玩家知道的"}', input)!;
    expect(out).toMatchObject({ exitMet: true, exitReason: '到了小径', summary: '两句话', publicRecap: '玩家知道的' });
    expect(parseDirectorOutput('我觉得这一幕可以结束了', input)).toBeNull();
    expect(parseDirectorOutput('{"hello":1}', input)).toBeNull();
  });

  it('提示里有剧本、进度、前情、最近记录和位置', () => {
    const { system, user } = buildDirectorPrompt({
      scene: '标题：第二幕', progress: '节拍（1/4）', memory: '前情…', recent: '- [GM] 你们到了溪边', where: '维斯坡伊：东北小径', factKeys: [], beatIds: [], isEnding: false,
    });
    expect(system).toContain('进度导演');
    expect(system).toContain('只输出一个 JSON');
    for (const part of ['【剧本（这一幕）】', '【进度】', '【前情和世界事实】', '【现在在哪】', '【最近的桌面记录】']) expect(user).toContain(part);
  });
});

// ---------------------------------------------------------------- 整桌

type Step = { step(): Promise<void> };

function makeLoop(over: { director?: boolean } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'trpg-prog-'));
  const config = loadConfig(projectRoot());
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  config.table.director = { enabled: over.director ?? false, everyRounds: 1, timeoutMs: 5000 };
  const logs = createLogs(dir);
  const llm = new FakeLLM(config, logs);
  (llm as unknown as { startedCombat: boolean }).startedCombat = true;
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const adventure = { ...base, scenes: base.scenes.filter((s) => ['forest-camp', 'cave-mouth'].includes(s.id)) };
  const loop = new TableLoop({
    config,
    llm,
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(31)),
    dryRun: true,
    resume: false,
  });
  const priv = loop as unknown as { step(): Promise<void>; sceneIntroPending: boolean; sceneEndRequest: unknown; maybeRunDirector(): Promise<void>; lastDirectorRound: number };
  return { loop, llm, config, logs, adventure, priv, stepper: loop as unknown as Step };
}

const onTrail = (loop: TableLoop) => {
  loop.engine.require('player_a').position = { col: 13, row: 3 }; // 东北小径的地标格
  loop.engine.require('player_b').position = { col: 13, row: 4 };
};

describe('自动出口：整桌', () => {
  it('到了地标但还没到第 4 轮不算；到了第 4 轮，GM 的提示里出现收尾指令，GM 收尾后换幕，前情带公开版', async () => {
    const { loop, priv } = makeLoop();
    await loop.init();
    priv.sceneIntroPending = false;
    onTrail(loop);
    loop.clock.round = 3;
    await priv.step();
    expect(loop.progress.exit).toBeNull(); // 到了小径，但这一幕才第 3 轮
    expect(loop.exitOrder()).toBe('');

    loop.clock.round = 4;
    // 清掉上一步留下的 currentSeat，走到下一次 GM 调用
    (loop as unknown as { currentSeat: null }).currentSeat = null;
    // checkSceneExit 在每一步开头判；GM 这一步的提示里就有指令
    (loop as unknown as { checkSceneExit(): void }).checkSceneExit();
    expect(loop.progress.exit?.rule).toBe('任一到达 trail 且 第 4 轮起');
    const order = loop.exitOrder();
    expect(order).toContain('【出口已达成 · 这一步必须收尾】');
    expect(order).toContain('end_scene');

    await priv.step(); // 假 GM 看到指令就 end_scene（带 public_recap）
    expect(priv.sceneEndRequest).toBeTruthy();
    await priv.step(); // 换幕
    expect(loop.sceneIndex).toBe(1);
    expect(loop.scene.id).toBe('cave-mouth');
    expect(loop.progress.exit).toBeNull(); // 新的一幕，进度清零
    expect(loop.progress.beats.map((b) => b.id)).toContain('stair');
    const recap = loop.memory.recaps[0];
    expect(recap.sceneId).toBe('forest-camp');
    expect(recap.publicRecap).toContain('（假 GM）你们走到了岩缝口');
  }, 60000);

  it('GM 不收尾：两步之后桌面替它收，用出口规则的说明当公开版前情', async () => {
    const { loop, llm, priv } = makeLoop();
    await loop.init();
    priv.sceneIntroPending = false;
    // 一个对收尾指令装聋的 GM：把 end_scene 滤掉
    const orig = llm.complete.bind(llm);
    (llm as unknown as { complete: unknown }).complete = async (...args: Parameters<typeof orig>) => {
      const out = await orig(...args);
      if (args[0] === 'gm') out.toolCalls = out.toolCalls.filter((c) => c.name !== 'end_scene');
      return out;
    };
    onTrail(loop);
    loop.clock.round = 5;
    (loop as unknown as { checkSceneExit(): void }).checkSceneExit();
    expect(loop.progress.exit).toBeTruthy();
    for (let i = 0; i < 8 && !priv.sceneEndRequest && loop.sceneIndex === 0; i++) await priv.step();
    expect(loop.sceneIndex === 1 || !!priv.sceneEndRequest).toBe(true);
    if (loop.sceneIndex === 0) await priv.step();
    expect(loop.sceneIndex).toBe(1);
    const recap = loop.memory.recaps[0];
    expect(recap.summary).toContain('桌面按出口条件收尾');
    expect(recap.publicRecap).toBe('找到了东北小径，往溪水声的方向去了');
  }, 60000);

  it('战斗里不判出口；最后一幕的指令写的是 end_game', async () => {
    const { loop, priv } = makeLoop();
    await loop.init();
    priv.sceneIntroPending = false;
    onTrail(loop);
    loop.clock.round = 6;
    loop.engine.combat = { active: true, round: 1, order: [{ actorId: 'player_a', initiative: 10, dex: 10 }], index: 0 };
    (loop as unknown as { checkSceneExit(): void }).checkSceneExit();
    expect(loop.progress.exit).toBeNull();
    loop.engine.combat = { active: false, round: 0, order: [], index: 0 };
    (loop as unknown as { checkSceneExit(): void }).checkSceneExit();
    expect(loop.progress.exit).toBeTruthy();
    loop.scene.ending = true;
    expect(loop.exitOrder()).toContain('end_game');
  });

  it('GM 工具 mark_beat：打勾、重复、没有节拍的幕', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool(n: string, a: Record<string, unknown>): Promise<{ ok: boolean; text: string }> }).execTool.bind(loop.gm);
    const ok = await exec('mark_beat', { beat: 'camp' });
    expect(ok.text).toContain('已打勾「camp」（1/4）');
    expect((await exec('mark_beat', { beat: 'camp' })).text).toContain('还没勾的：wolf、tents、trail');
    expect((await exec('mark_beat', { beat: '瞎写' })).ok).toBe(false);
    loop.progress.loadScene([], []);
    expect((await exec('mark_beat', { beat: 'camp' })).text).toContain('没有节拍清单');
  }, 60000);

  it('进度进存档：打勾的节拍和正在等收尾的出口，重启后还在；状态事件带「进度 n/m」', async () => {
    const a = makeLoop();
    await a.loop.init();
    a.loop.progress.markBeat('wolf');
    onTrail(a.loop);
    a.loop.clock.round = 5;
    (a.loop as unknown as { checkSceneExit(): void }).checkSceneExit();
    a.loop.save();
    await a.loop.flushSave();
    expect((a.loop.overlayState().beats as { done: number; total: number })).toEqual({ done: 1, total: 4 });

    // 同一个 state 目录再起一个桌面
    const dirState = a.config.paths.state;
    const config = loadConfig(projectRoot());
    config.paths.state = dirState;
    config.paths.logs = a.config.paths.logs;
    config.table.characterSet = 'lv3';
    config.table.pacing = a.config.table.pacing;
    const party = loadParty(config.paths.campaignVault, 'lv3');
    const b = new TableLoop({
      config,
      llm: new FakeLLM(config, a.logs),
      logs: a.logs,
      adventure: a.adventure,
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(31)),
      dryRun: true,
      resume: true,
    });
    await b.init();
    expect([...b.progress.done]).toEqual(['wolf']);
    expect(b.progress.exit?.rule).toBe('任一到达 trail 且 第 4 轮起');
  }, 60000);
});

describe('进度导演：整桌', () => {
  it('导演判出口满足：桌面记下出口，GM 收到指令，收尾文字用导演写的', async () => {
    const { loop, priv } = makeLoop({ director: true });
    await loop.init();
    priv.sceneIntroPending = false;
    loop.transcript.push({ at: Date.now(), kind: 'gm', text: '你们站在溪边。[[FAKE_EXIT]]' });
    await priv.maybeRunDirector();
    expect(loop.progress.exit).toMatchObject({ rule: '导演判断', summary: '（假导演）这一幕按出口条件结束', publicRecap: '（假导演）你们找到了路，往前走了' });
    expect(loop.exitOrder()).toContain('出口已达成');
    expect(loop.directorBrief()).toContain('下一步该推的：（假导演）让远处传来一声动静');
  }, 60000);

  it('导演指出对不上的事实：桌面把那条事实删掉，GM 的指令里写明；导演打勾的节拍生效', async () => {
    const { loop, priv } = makeLoop({ director: true });
    await loop.init();
    loop.memory.setFact({ text: '溪石下的伤兽被 Gundren 用斧柄打伤', key: 'stream_brute', public: true, scene: 2 });
    loop.memory.setFact({ text: '饿狼后来跟着队伍', key: 'wolf_ally', public: true, scene: 2 });
    loop.transcript.push({ at: Date.now(), kind: 'gm', text: '伤兽缩回石缝。[[FAKE_DRIFT:stream_brute]] [[FAKE_BEAT:wolf]]' });
    await priv.maybeRunDirector();
    expect(loop.memory.facts.map((f) => f.key)).toEqual(['wolf_ally']);
    expect(loop.progress.done.has('wolf')).toBe(true);
    expect(loop.directorBrief()).toContain('和剧本对不上');
    expect(loop.directorBrief()).toContain('这条和剧本对不上');
    expect(loop.progress.exit).toBeNull();
  }, 60000);

  it('隔几轮才请一次；关掉就不请；出错 / 超时跳过，不影响桌面；指令两轮后过期', async () => {
    const { loop, llm, config, priv } = makeLoop({ director: true });
    await loop.init();
    let calls = 0;
    const orig = llm.complete.bind(llm);
    (llm as unknown as { complete: unknown }).complete = async (...args: Parameters<typeof orig>) => {
      if (args[0] === 'director') {
        calls += 1;
        if (calls === 2) throw new LLMError({ kind: 'timeout', provider: 'test', message: '超时', attempts: 1 });
      }
      return orig(...args);
    };
    config.table.director = { enabled: true, everyRounds: 2, timeoutMs: 5000 };
    loop.clock.round = 1;
    await priv.maybeRunDirector();
    expect(calls).toBe(0); // 第 1 轮离上次（第 0 轮）不到 2 轮
    loop.clock.round = 2;
    await priv.maybeRunDirector();
    expect(calls).toBe(1);
    expect(loop.directorBrief()).toContain('下一步该推的');
    loop.clock.round = 3;
    await priv.maybeRunDirector();
    expect(calls).toBe(1); // 才过了 1 轮
    loop.clock.round = 4;
    await priv.maybeRunDirector(); // 第 2 次调用：假装超时
    expect(calls).toBe(2);
    expect(loop.directorBrief()).toContain('下一步该推的'); // 上一次的指令还在有效期（round 2 → 4）
    loop.clock.round = 5;
    expect(loop.directorBrief()).toBe(''); // 超过两轮，过期
    config.table.director = { enabled: false, everyRounds: 1, timeoutMs: 5000 };
    loop.clock.round = 9;
    await priv.maybeRunDirector();
    expect(calls).toBe(2);
  }, 60000);

  it('导演的调用走 director 座位（模型来自 models.yaml）', () => {
    const config = loadConfig(projectRoot());
    expect(config.models.seats.director.provider).toBe('anthropic');
    expect(config.models.seats.director.model).toBe('claude-haiku-5-5');
    expect(config.table.director).toMatchObject({ enabled: true, everyRounds: 2 });
  });
});

describe('request 形状', () => {
  it('导演请求不带工具、不流式', async () => {
    const { loop, llm, priv } = makeLoop({ director: true });
    await loop.init();
    const seen: CompleteRequest[] = [];
    const orig = llm.complete.bind(llm);
    (llm as unknown as { complete: unknown }).complete = async (seat: string, req: CompleteRequest, purpose: string) => {
      if (seat === 'director') seen.push(req);
      return orig(seat as never, req, purpose);
    };
    await priv.maybeRunDirector();
    expect(seen).toHaveLength(1);
    expect(seen[0].tools).toBeUndefined();
    expect(seen[0].stream).toBe(false);
    expect(seen[0].timeoutMs).toBe(5000);
  }, 60000);
});

describe('换幕：next_scene_id 写错不再把整场结束掉', () => {
  type Tool = (n: string, a: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;

  it('GM 工具：不认识的 id 报错并列出可用的；_ / 标题里的词也认', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool: Tool }).execTool.bind(loop.gm);
    const bad = await exec('end_scene', { summary: 'x', next_scene_id: 'third-act' });
    expect(bad.ok).toBe(false);
    expect(bad.text).toContain('cave-mouth');
    expect((loop as unknown as { sceneEndRequest: unknown }).sceneEndRequest).toBeNull(); // 没登记收尾

    expect((await exec('end_scene', { summary: 'x', next_scene_id: 'cave_mouth' })).ok).toBe(true);
    expect((loop as unknown as { sceneEndRequest: { nextSceneId?: string } }).sceneEndRequest.nextSceneId).toBe('cave-mouth');
  }, 60000);

  it('桌面：就算有人直接给了不存在的 id，也退回按顺序进下一幕（以前整场结束）', async () => {
    const { loop, priv } = makeLoop();
    await loop.init();
    loop.requestSceneEnd('x', 'no-such-scene', '公开版');
    await priv.step();
    expect(loop.phase).not.toBe('ended');
    expect(loop.sceneIndex).toBe(1);
    expect(loop.scene.id).toBe('cave-mouth');
  }, 60000);
});

// ---------------------------------------------------------------- 藏着的生物：进场就在场上，现身时才有 pin

describe('伏兵 / 哨兵：进场就生成（藏着），现身才出现 pin', () => {
  function makeCave(director = false) {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-hide-'));
    const config = loadConfig(projectRoot());
    config.paths.state = join(dir, 'state');
    config.paths.logs = join(dir, 'logs');
    config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
    config.table.characterSet = 'lv3';
    config.table.director = { enabled: director, everyRounds: 1, timeoutMs: 5000 };
    const logs = createLogs(dir);
    const llm = new FakeLLM(config, logs);
    const party = loadParty(config.paths.campaignVault, 'lv3');
    const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
    const loop = new TableLoop({
      config,
      llm,
      logs,
      adventure: { ...base, scenes: base.scenes.filter((s) => s.id === 'cave-mouth') },
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(41)),
      dryRun: true,
      resume: false,
    });
    return { loop, priv: loop as unknown as { maybeRunDirector(): Promise<void>; worldSlots(): { id: string; secret: boolean; kind: string }[] } };
  }

  it('第三幕：两个哨兵和栏里的狼一进场就在场上、在剧本写的出场格、玩家看不见', async () => {
    const { loop } = makeCave();
    await loop.init();
    const monsters = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster');
    expect(monsters.map((m) => m.id.split(':')[0]).sort()).toEqual(['goblin', 'goblin', 'wolf']);
    const goblins = monsters.filter((m) => m.id.startsWith('goblin'));
    expect(goblins.map((g) => g.position)).toEqual([{ col: 8, row: 3 }, { col: 6, row: 5 }]); // 剧本地图信息里的出场格
    expect(monsters.find((m) => m.id.startsWith('wolf'))!.position).toEqual({ col: 1, row: 6 });
    for (const m of monsters) expect(loop.visibleActorIds.has(m.id)).toBe(false);
    // 玩家视角里没有它们
    expect(JSON.stringify([...loop.visibleActorIds])).not.toContain('goblin');
  });

  it('藏着的生物也在世界回合清单里（标「玩家看不到」），GM 要处理它们的动静', async () => {
    const { loop, priv } = makeCave();
    await loop.init();
    const slots = priv.worldSlots();
    const hidden = slots.filter((s) => s.kind === 'creature');
    expect(hidden).toHaveLength(3);
    expect(hidden.every((s) => s.secret)).toBe(true);
  });

  it('GM 用 reveal_area 让一个哨兵现身：变成玩家看得见的；开打时 start_combat 用场上已有的，不会多出一份', async () => {
    const { loop } = makeCave();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool(n: string, a: Record<string, unknown>): Promise<{ ok: boolean; text: string }> }).execTool.bind(loop.gm);
    const sentry = [...loop.engine.actors.values()].find((a) => a.id.startsWith('goblin'))!;
    expect((await exec('reveal_area', { description: '哨兵探出头', actors: [sentry.name] })).ok).toBe(true);
    expect(loop.visibleActorIds.has(sentry.id)).toBe(true);
    const before = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster').length;
    expect((await exec('start_combat', { monsters: [{ monster_id: 'goblin', count: 2 }] })).ok).toBe(true);
    expect([...loop.engine.actors.values()].filter((a) => a.kind === 'monster')).toHaveLength(before); // 没有多出来
    expect(loop.engine.combat.order.filter((o) => o.actorId.startsWith('goblin'))).toHaveLength(2);
    expect(loop.engine.combat.order.some((o) => o.actorId.startsWith('wolf'))).toBe(false); // 栏里的狼没参战
  });

  it('战斗胜负只数参战的：打倒两个哨兵就赢，藏着没参战的狼不挡', async () => {
    const { loop } = makeCave();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool(n: string, a: Record<string, unknown>): Promise<{ ok: boolean; text: string }> }).execTool.bind(loop.gm);
    await exec('start_combat', { monsters: [{ monster_id: 'goblin', count: 2 }] });
    const goblins = [...loop.engine.actors.values()].filter((a) => a.id.startsWith('goblin'));
    expect(loop.engine.combatStatus()).toBe('ongoing');
    goblins[0].hp = 0;
    expect(loop.engine.combatStatus()).toBe('ongoing');
    goblins[1].hp = 0;
    expect([...loop.engine.actors.values()].some((a) => a.id.startsWith('wolf') && a.hp > 0)).toBe(true);
    expect(loop.engine.combatStatus()).toBe('victory');
  });

  it('导演让藏着的生物现身：桌面揭示并写进给 GM 的指令；只认真的藏着的 id', async () => {
    const { loop, priv } = makeCave(true);
    await loop.init();
    const sentry = [...loop.engine.actors.values()].find((a) => a.id.startsWith('goblin'))!;
    loop.transcript.push({ at: Date.now(), kind: 'gm', text: `哨兵探出身来。[[FAKE_REVEAL:${sentry.id}]]` });
    await priv.maybeRunDirector();
    expect(loop.visibleActorIds.has(sentry.id)).toBe(true);
    expect(loop.directorBrief()).toContain('桌面已经把这些生物放上地图了');
    expect(loop.directorBrief()).toContain(sentry.name);
    // 另一个哨兵没被揭示
    const other = [...loop.engine.actors.values()].find((a) => a.id.startsWith('goblin') && a.id !== sentry.id)!;
    expect(loop.visibleActorIds.has(other.id)).toBe(false);
  });

  it('导演输出里的 reveal 只留清单里有的 id、最多 3 个', () => {
    const out = parseDirectorOutput('{"exit_met":false,"push":"x","reveal":["goblin:甲","瞎写","wolf:乙","goblin:丙","goblin:丁"]}', {
      factKeys: [],
      beatIds: [],
      hiddenIds: ['goblin:甲', 'wolf:乙', 'goblin:丙', 'goblin:丁'],
    })!;
    expect(out.reveal).toEqual(['goblin:甲', 'wolf:乙', 'goblin:丙']);
    const none = parseDirectorOutput('{"exit_met":false,"push":"x","reveal":["goblin:甲"]}', { factKeys: [], beatIds: [] })!;
    expect(none.reveal).toEqual([]);
  });
});

describe('伏兵进场生成：按「种类 + 数量」去重', () => {
  it('场上已经有 GM 开战时自己起名生成的哨兵和狼：不会再补一份重复的', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-dedupe-'));
    const config = loadConfig(projectRoot());
    config.paths.state = join(dir, 'state');
    config.paths.logs = join(dir, 'logs');
    config.table.characterSet = 'lv3';
    config.table.director = { enabled: false, everyRounds: 2, timeoutMs: 5000 };
    const logs = createLogs(dir);
    const party = loadParty(config.paths.campaignVault, 'lv3');
    const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
    const loop = new TableLoop({
      config,
      llm: new FakeLLM(config, logs),
      logs,
      adventure: { ...base, scenes: base.scenes.filter((s) => s.id === 'cave-mouth') },
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(51)),
      dryRun: true,
      resume: false,
    });
    // 模拟旧版：GM 开战时用自己的名字生成了两个哨兵和一只狼（一个已经被打倒）
    const { spawnMonster } = await import('../src/rules/engine.js');
    for (const [id, name] of [['goblin', '哨兵甲'], ['goblin', '哨兵乙'], ['wolf', '栏中的狼']] as const) {
      const m = spawnMonster(id, name);
      m.position = { col: 5, row: 5 };
      loop.engine.addActor(m);
    }
    [...loop.engine.actors.values()].find((a) => a.name === '哨兵甲')!.hp = 0;
    (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    const monsters = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster');
    expect(monsters.map((m) => m.name).sort()).toEqual(['哨兵乙', '哨兵甲', '栏中的狼'].sort()); // 没有多出骨哨帮哨兵 / 栏里的狼
    // 再调一次也一样
    (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    expect([...loop.engine.actors.values()].filter((a) => a.kind === 'monster')).toHaveLength(3);
  });

  it('只有一只哨兵在场（另一只还没生成）：只补一只', async () => {
    const { loop } = makeLoop();
    await loop.init(); // 第二幕：先清掉，换成只有一个 goblin 的场景状态
    const cave = (await import('../src/table/content.js')).loadAdventure(loadConfig(projectRoot()).paths.campaignVault, 'phandalin-road').scenes.find((s) => s.id === 'cave-mouth')!;
    (loop as unknown as { scene: unknown }).scene = cave;
    loop.engine.setMapInfo(cave.mapInfo);
    for (const a of [...loop.engine.actors.values()]) if (a.kind === 'monster') loop.engine.removeActor(a.id);
    const { spawnMonster } = await import('../src/rules/engine.js');
    const one = spawnMonster('goblin', '哨兵甲');
    one.position = { col: 5, row: 5 };
    loop.engine.addActor(one);
    (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    const monsters = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster');
    expect(monsters.filter((m) => m.id.startsWith('goblin'))).toHaveLength(2); // 甲 + 补的一只
    expect(monsters.filter((m) => m.id.startsWith('wolf'))).toHaveLength(1);
  }, 60000);
});
