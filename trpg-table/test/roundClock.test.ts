// 回合计：探索和战斗共用一条“第 N 轮”，每一轮里每个能动的角色 / 环境各行动一次。
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure, type Adventure } from '../src/table/content.js';
import { TableLoop } from '../src/table/loop.js';
import type { TableEvent } from '../src/table/events.js';
import { RoundClock, cadenceText, envFires, nextFireRound, parseEnvironment } from '../src/table/roundClock.js';
import { projectRoot } from '../src/util.js';

describe('剧本 ## 环境 的解析', () => {
  it('认得每轮 / 每 N 轮 / 第 N 轮 / 第 N 轮起每 M 轮，带 [秘密] 的标出来，读不懂的行忽略', () => {
    const env = parseEnvironment(
      [
        '- 暮色｜每 5 轮｜天色又暗了一档',
        '- 水位 | 第 3 轮起每轮 | 水涨了一指，货舱里的东西开始漂',
        '- 巡逻｜第 8 轮｜一队哥布林回营地 [秘密]',
        '- 毒发｜第 2 轮起每 2 轮｜中毒的人再受一次伤',
        '- 心跳｜每轮｜鼓声更近了',
        '- 乱写｜过一会儿｜这行读不懂',
        '- 缺一段｜每轮',
        '不是列表的行',
      ].join('\n')
    );
    expect(env.map((e) => [e.name, e.first, e.every, e.secret])).toEqual([
      ['暮色', 5, 5, false],
      ['水位', 3, 1, false],
      ['巡逻', 8, null, true],
      ['毒发', 2, 2, false],
      ['心跳', 1, 1, false],
    ]);
    expect(env[0].effect).toBe('天色又暗了一档');
    expect(env[2].effect).toBe('一队哥布林回营地'); // [秘密] 标记不留在文字里
  });

  it('到点判断和下次到点', () => {
    const everyFive = { first: 5, every: 5 };
    expect([1, 4, 5, 6, 9, 10, 15].map((r) => envFires(everyFive, r))).toEqual([false, false, true, false, false, true, true]);
    const once = { first: 3, every: null };
    expect([2, 3, 4].map((r) => envFires(once, r))).toEqual([false, true, false]);
    expect(nextFireRound(everyFive, 1)).toBe(5);
    expect(nextFireRound(everyFive, 6)).toBe(10);
    expect(nextFireRound(everyFive, 5, 5)).toBe(10); // 这一轮已经登记过了
    expect(nextFireRound(once, 4)).toBeNull();
    expect(cadenceText({ first: 1, every: 1 })).toBe('每轮');
    expect(cadenceText({ first: 5, every: 5 })).toBe('每 5 轮');
    expect(cadenceText({ first: 3, every: 1 })).toBe('第 3 轮起每轮');
    expect(cadenceText({ first: 8, every: null })).toBe('第 8 轮');
  });
});

describe('RoundClock', () => {
  it('PC 按固定顺序各一次，动过的和不能动的跳过', () => {
    const c = new RoundClock();
    expect(c.nextSeat()).toBe('player_a');
    c.markActed('player_a');
    expect(c.nextSeat()).toBe('player_b');
    c.markActed('player_b');
    expect(c.nextSeat()).toBeNull();
    c.closeRound();
    expect(c.round).toBe(2);
    expect(c.nextSeat()).toBe('player_a');
    expect(c.nextSeat((s) => s !== 'player_a')).toBe('player_b'); // A 倒下了
  });

  it('环境条目：到点才出现，登记过同一轮不再出现，只触发一次的用完就摘掉', () => {
    const c = new RoundClock();
    c.loadScene(parseEnvironment('- 暮色｜每 2 轮｜天暗\n- 巡逻｜第 3 轮｜来人'));
    expect(c.dueEnv().map((e) => e.name)).toEqual([]); // 第 1 轮没有
    c.closeRound(); // → 第 2 轮
    expect(c.dueEnv().map((e) => e.name)).toEqual(['暮色']);
    expect(c.register('env:1', { did: '天暗了', secret: false, auto: false })).toBe(true);
    expect(c.register('env:1', { did: '再来一次', secret: false, auto: false })).toBe(false);
    expect(c.dueEnv()).toEqual([]);
    expect(c.envThisRound().map((e) => e.name)).toEqual(['暮色']); // 回合条上仍然显示
    c.closeRound(); // → 第 3 轮
    expect(c.dueEnv().map((e) => e.name)).toEqual(['巡逻']);
    c.register('env:2', { did: '来了', secret: true, auto: false });
    c.closeRound(); // → 第 4 轮：巡逻只触发一次，已经摘掉
    expect(c.env.map((e) => e.name)).toEqual(['暮色']);
    expect(c.dueEnv().map((e) => e.name)).toEqual(['暮色']);
  });

  it('GM 登记的倒计时按“现在的轮数 + in_rounds”到点，可以取消；存档读回来一样', () => {
    const c = new RoundClock();
    c.closeRound();
    c.closeRound(); // 第 3 轮
    const t = c.addTimer({ name: '涨水', inRounds: 2, every: 1, effect: '水漫过脚踝', secret: false });
    expect(t.first).toBe(5);
    expect(c.addTimer({ name: '援军', inRounds: 4, effect: '号角', secret: true }).every).toBeNull();
    c.markActed('player_a');
    const copy = new RoundClock();
    copy.load(JSON.parse(JSON.stringify(c.snapshot())));
    expect(copy.round).toBe(3);
    expect([...copy.acted]).toEqual(['player_a']);
    expect(copy.env.map((e) => [e.name, e.first, e.every, e.secret])).toEqual([
      ['涨水', 5, 1, false],
      ['援军', 7, null, true],
    ]);
    expect(copy.addTimer({ name: '再一个', inRounds: 1, effect: 'x' }).id).not.toBe(t.id); // id 不重复
    expect(c.cancel('涨水')?.id).toBe(t.id);
    expect(c.cancel('不存在')).toBeNull();
    expect(c.env).toHaveLength(1);
  });

  it('换场景从第 1 轮重新数', () => {
    const c = new RoundClock();
    c.closeRound();
    c.markActed('player_b');
    c.loadScene(parseEnvironment('- 心跳｜每轮｜鼓声'));
    expect(c.round).toBe(1);
    expect(c.acted.size).toBe(0);
    expect(c.dueEnv().map((e) => e.name)).toEqual(['心跳']);
  });
});

describe('引擎：战斗外的回合', () => {
  function engineWithParty() {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
    const party = makeDefaultParty();
    engine.addActor(party.a);
    engine.addActor(party.b);
    return { engine, a: party.a };
  }

  it('战斗外用过一次动作，不重置就一直是“动作已用”；回合开始重置之后恢复', async () => {
    const { engine, a } = engineWithParty();
    await engine.takeAction(a.id, 'dodge');
    await expect(engine.takeAction(a.id, 'dodge')).rejects.toThrow(/已经用过动作/);
    expect(engine.legalActions(a.id).find((x) => x.kind === 'dodge')?.available).toBe(false);
    engine.beginExplorationTurn(a.id);
    await engine.takeAction(a.id, 'dodge');
    expect(a.turn.actionUsed).toBe(true);
  });

  it('战斗里不动（先攻自己管）', async () => {
    const { engine, a } = engineWithParty();
    await engine.takeAction(a.id, 'dodge');
    engine.combat = { active: true, round: 1, order: [{ actorId: a.id, initiative: 10, dex: 10 }], index: 0 };
    engine.beginExplorationTurn(a.id);
    expect(a.turn.actionUsed).toBe(true);
  });

  it('战斗外一轮 = 10 个战斗轮：有回合数的状态到期', () => {
    const { engine, a } = engineWithParty();
    a.conditions.push({ name: 'frightened', source: 'test', rounds: 25 });
    engine.advanceExplorationRound();
    expect(a.conditions.find((c) => c.name === 'frightened')?.rounds).toBe(15);
    engine.advanceExplorationRound();
    engine.advanceExplorationRound();
    expect(a.conditions.some((c) => c.name === 'frightened')).toBe(false);
  });
});

// ---------------------------------------------------------------- TableLoop 整体

type Step = { step(): Promise<void> };

function makeLoop(env: string, opts: { startCombat?: boolean } = {}) {
  const root = projectRoot();
  const dir = mkdtempSync(join(tmpdir(), 'trpg-rounds-'));
  const config = loadConfig(root);
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  config.table.startPaused = true;
  const logs = createLogs(dir);
  const llm = new FakeLLM(config, logs);
  // 假 GM 第 3 步会自己 start_combat（两只鲨人）；探索用例要把它关掉
  (llm as unknown as { startedCombat: boolean }).startedCombat = !opts.startCombat;
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const camp = base.scenes.find((s) => s.id === 'forest-camp')!;
  const adventure: Adventure = { ...base, scenes: [{ ...camp, environment: parseEnvironment(env) }] };
  const loop = new TableLoop({
    config,
    llm,
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(7)),
    dryRun: true,
    resume: false,
  });
  // eventsAfter 一次最多 50 条、环形缓冲 500 条，整场跑下来会截断：自己订阅，收全
  const events: TableEvent[] = [];
  loop.bus.subscribe((e) => events.push(e));
  return { loop, dir, config, logs, llm, adventure, events, stepper: loop as unknown as Step };
}

async function run(stepper: Step, steps: number, until?: () => boolean) {
  for (let i = 0; i < steps; i++) {
    await stepper.step();
    if (until?.()) return;
  }
}

describe('TableLoop：探索按回合计走', () => {
  it('每一轮每个 PC 只行动一次，A、B 严格轮流，GM 点错人会被改回来', async () => {
    const { loop, stepper } = makeLoop('- 暮色｜每 2 轮｜天色又暗了一档');
    await loop.init();
    await run(stepper, 80, () => loop.clock.round >= 5);
    expect(loop.clock.round).toBeGreaterThanOrEqual(5);

    const seats = loop.history.map((h) => h.seat);
    // 假 GM 在偶数步点的是 B，奇数步点的是 A：不按回合计的话会出现 AA / BB
    expect(seats.slice(0, 8)).toEqual(['player_a', 'player_b', 'player_a', 'player_b', 'player_a', 'player_b', 'player_a', 'player_b']);
    // 每条记录的轮数：1,1,2,2,3,3,4,4
    expect(loop.history.slice(0, 8).map((h) => h.round)).toEqual([1, 1, 2, 2, 3, 3, 4, 4]);
    expect(loop.history[0].phase).toBe('explore');
  }, 60000);

  it('世界回合：场上的狼每一轮都动一次，到点的环境才动；秘密的环境事件不带名字', async () => {
    const { loop, stepper, events } = makeLoop('- 暮色｜每 2 轮｜天色又暗了一档\n- 暗哨｜第 3 轮｜山上有人打了个手势 [秘密]');
    await loop.init();
    await run(stepper, 120, () => loop.clock.round >= 6);
    const world = events.filter((e) => e.kind === 'world');
    const wolf = [...loop.engine.actors.values()].find((a) => a.kind === 'monster')!.id;

    const byRound = (id: string) => world.filter((e) => e.data?.id === id).map((e) => e.data?.round);
    expect(byRound(wolf)).toEqual([1, 2, 3, 4, 5]); // 第 1–5 轮各一次（第 6 轮还没结束）
    expect(byRound('env:1')).toEqual([2, 4]); // 每 2 轮
    expect(byRound('env:2')).toEqual([3]); // 只在第 3 轮

    const secret = world.find((e) => e.data?.id === 'env:2')!;
    expect(secret.data?.secret).toBe(true);
    expect(JSON.stringify(secret)).not.toContain('暗哨');
    expect(JSON.stringify(secret)).not.toContain('打了个手势');
    // 暮色不是秘密：名字和内容都在
    expect(world.find((e) => e.data?.id === 'env:1')?.text).toContain('暮色');

    // 每个关掉的轮都有一条 round 事件，连续编号
    const rounds = events.filter((e) => e.kind === 'round').map((e) => [e.data?.closed, e.data?.round]);
    expect(rounds.slice(0, 5)).toEqual([[1, 2], [2, 3], [3, 4], [4, 5], [5, 6]]);
  }, 60000);

  it('GM 漏登记的位子，桌面替它记成没动静，轮照样往下走', async () => {
    const { loop, stepper, llm, events } = makeLoop('- 心跳｜每轮｜鼓声更近了');
    // 一个不登记世界回合的 GM：只 narrate + ask_player
    const orig = llm.complete.bind(llm);
    (llm as unknown as { complete: unknown }).complete = async (...args: Parameters<typeof orig>) => {
      const out = await orig(...args);
      if (args[0] === 'gm') out.toolCalls = out.toolCalls.filter((c) => c.name !== 'world_act');
      return out;
    };
    await loop.init();
    await run(stepper, 80, () => loop.clock.round >= 4);
    expect(loop.clock.round).toBeGreaterThanOrEqual(4);
    // 没有 GM 登记的 world 事件（桌面替记的不上总线），但每一轮都关了
    expect(events.filter((e) => e.kind === 'world')).toHaveLength(0);
    expect(events.filter((e) => e.kind === 'round').length).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('探索里每个 PC 的行动在自己的回合开始时恢复（原来战斗外一直是“动作已用”）', async () => {
    const { loop, stepper } = makeLoop('');
    await loop.init();
    const a = loop.engine.require('player_a');
    a.turn.actionUsed = true; // 上一场留下的“动作已用”
    a.turn.dashed = true;
    await run(stepper, 20, () => loop.history.some((h) => h.seat === 'player_a'));
    expect(loop.history.some((h) => h.seat === 'player_a')).toBe(true);
    expect(a.turn.actionUsed).toBe(false); // 轮到 A 时重置过，假玩家这一轮只是说话，没再花动作
    expect(a.turn.dashed).toBe(false);
  }, 60000);

  it('存档里带回合计：重启后轮数、本轮行动记录、GM 登记的倒计时都在', async () => {
    const first = makeLoop('- 暮色｜每 2 轮｜天暗');
    await first.loop.init();
    await run(first.stepper, 40, () => first.loop.clock.round >= 3 && first.loop.clock.acted.size === 1);
    first.loop.clock.addTimer({ name: '涨水', inRounds: 3, effect: '水漫过脚踝' });
    first.loop.save();
    await first.loop.flushSave();
    const round = first.loop.clock.round;
    const acted = [...first.loop.clock.acted];

    // 同一个 state 目录再起一个桌面
    const root = projectRoot();
    const config = loadConfig(root);
    config.paths.state = first.config.paths.state;
    config.paths.logs = first.config.paths.logs;
    config.table.characterSet = 'lv3';
    config.table.pacing = first.config.table.pacing;
    const party = loadParty(config.paths.campaignVault, 'lv3');
    const second = new TableLoop({
      config,
      llm: new FakeLLM(config, first.logs),
      logs: first.logs,
      adventure: first.adventure,
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(7)),
      dryRun: true,
      resume: true,
    });
    await second.init();
    expect(second.clock.round).toBe(round);
    expect([...second.clock.acted]).toEqual(acted);
    expect(second.clock.env.map((e) => e.name).sort()).toEqual(['暮色', '涨水']);
  }, 60000);
});

describe('TableLoop：战斗里环境也在轮里动', () => {
  it('每个战斗轮结束，到点的环境各动一次，桌面轮数跟着涨；战斗结束回到探索', async () => {
    const { loop, stepper, events } = makeLoop('- 心跳｜每轮｜鼓声更近了', { startCombat: true });
    await loop.init();
    let sawCombat = false;
    await run(stepper, 400, () => {
      sawCombat ||= loop.engine.combat.active;
      return sawCombat && !loop.engine.combat.active && loop.clock.round >= 3;
    });
    expect(sawCombat).toBe(true);

    const combatRounds = events.filter((e) => e.kind === 'round' && e.data?.kind === '战斗');
    expect(combatRounds.length).toBeGreaterThanOrEqual(1);
    // 每个在战斗里关掉的轮，“心跳”都登记过一次
    const heart = events.filter((e) => e.kind === 'world' && e.data?.id === 'env:1').map((e) => e.data?.round);
    for (const ev of combatRounds) expect(heart).toContain(ev.data?.closed);
    // 桌面轮号一路连续，没有跳也没有重复
    const closed = events.filter((e) => e.kind === 'round').map((e) => e.data?.closed as number);
    closed.forEach((c, i) => expect(c).toBe(i + 1));
  }, 120000);
});

describe('GM 工具：回合计的约束', () => {
  type Tool = (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string; askedSeat?: string; finishesStep?: boolean }>;
  const tool = (loop: TableLoop): Tool => (loop.gm as unknown as { execTool: Tool }).execTool.bind(loop.gm);

  it('ask_player 点了不是下一位的人，改成回合计认的那位，并在返回里告诉 GM', async () => {
    const { loop } = makeLoop('');
    await loop.init();
    const exec = tool(loop);
    const first = await exec('ask_player', { seat: 'player_b', prompt: '你来' });
    expect(first.askedSeat).toBe('player_a'); // 这一轮还没人动，下一位是 A
    expect(first.text).toContain('已替你改了');

    loop.clock.markActed('player_a');
    expect((await exec('ask_player', { seat: 'player_a', prompt: '再来' })).askedSeat).toBe('player_b');
    const ok = await exec('ask_player', { seat: 'player_b', prompt: '到你' });
    expect(ok.askedSeat).toBe('player_b');
    expect(ok.text).not.toContain('已替你改了');

    // 两人都动过：下一位是下一轮的第一位
    loop.clock.markActed('player_b');
    expect((await exec('ask_player', { seat: 'player_b', prompt: '？' })).askedSeat).toBe('player_a');
  });

  it('世界回合没登记完，ask_player 被拒；登记完才放行', async () => {
    const { loop } = makeLoop('- 心跳｜每轮｜鼓声更近了');
    await loop.init();
    const exec = tool(loop);
    loop.clock.markActed('player_a');
    loop.clock.markActed('player_b');
    const priv = loop as unknown as { worldPending: unknown; worldSlots(): { id: string }[] };
    const slots = priv.worldSlots();
    expect(slots.map((s) => s.id)).toContain('env:1');
    expect(slots.length).toBe(2); // 狼 + 心跳
    priv.worldPending = slots;

    const refused = await exec('ask_player', { seat: 'player_a', prompt: '新一轮' });
    expect(refused.ok).toBe(false);
    expect(refused.text).toContain('世界回合还没完');
    expect(refused.text).toContain('心跳');

    // 真 GM（Haiku）会把清单里的写法整串抄进来：这些写法都认
    expect((await exec('world_act', { entry: '[world:env:1]', did: '鼓声更近了' })).ok).toBe(true);
    expect((await exec('world_act', { entry: 'id=env:1', did: '再一次' })).text).toContain('已经登记过');
    expect((await exec('world_act', { entry: '没有这个', did: 'x' })).ok).toBe(false);
    expect((await exec('ask_player', { seat: 'player_a', prompt: '新一轮' })).ok).toBe(false); // 狼还没登记
    const last = await exec('world_act', { entry: `world:${slots.find((s) => s.id !== 'env:1')!.id}`, did: '保持原样' });
    expect(last.ok).toBe(true);
    expect(last.text).toContain('全部登记完');
    expect((await exec('ask_player', { seat: 'player_a', prompt: '新一轮' })).ok).toBe(true);
  });

  it('战斗里的世界回合登记完就结束这一步；不是世界回合时 world_act 不接受', async () => {
    const { loop } = makeLoop('- 心跳｜每轮｜鼓声更近了');
    await loop.init();
    const exec = tool(loop);
    expect((await exec('world_act', { entry: '心跳', did: 'x' })).ok).toBe(false);
    loop.engine.combat = { active: true, round: 1, order: [{ actorId: 'player_a', initiative: 10, dex: 10 }], index: 0 };
    const priv = loop as unknown as { worldPending: unknown; worldSlots(o: { combat: boolean }): { id: string }[] };
    priv.worldPending = priv.worldSlots({ combat: true });
    expect((priv.worldPending as unknown[]).length).toBe(1); // 战斗里生物在先攻里，只有环境
    const out = await exec('world_act', { entry: 'env:1', did: '鼓声' });
    expect(out.ok).toBe(true);
    expect(out.finishesStep).toBe(true);
  });

  it('set_timer / cancel_timer：参数校验、登记、取消', async () => {
    const { loop } = makeLoop('');
    await loop.init();
    const exec = tool(loop);
    expect((await exec('set_timer', { name: '涨水', in_rounds: 0, effect: '水漫过脚踝' })).ok).toBe(false);
    expect((await exec('set_timer', { name: '涨水', in_rounds: 2, effect: '' })).ok).toBe(false);
    const made = await exec('set_timer', { name: '涨水', in_rounds: 2, every: 1, effect: '水漫过脚踝' });
    expect(made.ok).toBe(true);
    expect(made.text).toContain('第 3 轮'); // 现在第 1 轮 + 2
    expect(loop.clock.env.map((e) => [e.name, e.first, e.every, e.source])).toEqual([['涨水', 3, 1, 'gm']]);
    expect((await exec('cancel_timer', { entry: '涨水' })).ok).toBe(true);
    expect((await exec('cancel_timer', { entry: '涨水' })).ok).toBe(false);
    expect(loop.clock.env).toHaveLength(0);
  });
});

describe('正式剧本里的环境条目', () => {
  it('第二幕「林间血迹」有暮色和篝火余烬两条，节奏读对了', () => {
    const adv = loadAdventure(loadConfig(projectRoot()).paths.campaignVault, 'phandalin-road');
    const camp = adv.scenes.find((s) => s.id === 'forest-camp')!;
    expect((camp.environment ?? []).map((e) => [e.name, e.first, e.every, e.secret])).toEqual([
      ['暮色', 4, 4, false],
      ['篝火余烬', 5, 5, false],
    ]);
    // 没写 ## 环境 的场景就是空，不会凭空多出条目
    expect((adv.scenes.find((s) => s.id === 'road-ambush')!.environment ?? []).length).toBe(0);
  });
});
