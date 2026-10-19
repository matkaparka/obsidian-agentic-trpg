// 2026-10-19 复核后的几处护栏：走向障碍格不再整次作废、一幕拖太久提醒 GM、玩家模型超时用保守行动、GM 的记录窗口不被回合记录挤占。
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LLM } from '../src/llm/index.js';
import { LLMError, type CompleteRequest } from '../src/llm/types.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { GameMaster, type GmWorld } from '../src/table/gm.js';
import { TableLoop } from '../src/table/loop.js';
import { runPlayerTurn } from '../src/table/player.js';
import { RoundClock } from '../src/table/roundClock.js';
import { SceneProgress } from '../src/table/sceneProgress.js';
import type { PlayerDecision } from '../src/table/types.js';
import { projectRoot } from '../src/util.js';

function makeCampLoop() {
  const root = projectRoot();
  const dir = mkdtempSync(join(tmpdir(), 'trpg-flow-'));
  const config = loadConfig(root);
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  const logs = createLogs(dir);
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const adventure = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const camp = adventure.scenes.find((s) => s.id === 'forest-camp')!;
  const loop = new TableLoop({
    config,
    llm: new FakeLLM(config, logs),
    logs,
    adventure: { ...adventure, scenes: [camp] },
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(11)),
    dryRun: true,
    resume: false,
  });
  return { loop };
}

type Exec = (seat: 'player_a' | 'player_b', d: PlayerDecision) => Promise<{ ok: boolean; summary: string; errors: string[] }>;

describe('走向障碍格：走到最近的合法格，不再整次行动作废', () => {
  it('check 带着篝火坑（障碍格）的 cell：停在它西边这一侧，检定照做，结算里写明原因', async () => {
    const { loop } = makeCampLoop();
    await loop.init();
    const b = loop.engine.require('player_b');
    const pit = { col: 8, row: 6 };
    expect(loop.engine.canStandAt(b, pit)).toBe(false); // 火坑本身站不了
    const exec = (loop as unknown as { executePlayerAction: Exec }).executePlayerAction.bind(loop);
    const out = await exec('player_b', {
      say: '我去看看余烬。',
      action: { type: 'check', detail: '蹲在火坑边摸余烬', cell: pit },
      expression: 'neutral',
    });
    expect(out.ok).toBe(true); // 原来是 false：行动未执行（不能站在篝火坑内）
    expect(out.summary).toContain('站不进去');
    expect(out.summary).toContain('篝火坑');
    const pos = loop.engine.positionOf('player_b')!;
    expect(loop.engine.canStandAt(b, pos)).toBe(true);
    expect(Math.max(Math.abs(pos.col - pit.col), Math.abs(pos.row - pit.row))).toBeLessThanOrEqual(1);
    // 一样近的格子里取离出发点（来路，西边）近的一侧，而不是绕到火坑东边
    expect(pos.col).toBeLessThan(pit.col);
  });

  it('合法的 cell 照旧，什么都不提', async () => {
    const { loop } = makeCampLoop();
    await loop.init();
    const exec = (loop as unknown as { executePlayerAction: Exec }).executePlayerAction.bind(loop);
    const out = await exec('player_b', { say: '往前。', action: { type: 'move', cell: { col: 6, row: 7 } }, expression: 'neutral' });
    expect(out.ok).toBe(true);
    expect(out.summary).not.toContain('站不进去');
  });

  it('红帐和两顶小帐篷里面能进去（剧本里红帐有战利品箱、北侧帐篷有外套），火坑和树还是障碍', async () => {
    for (const sceneId of ['forest-camp', 'night-camp']) {
      const config = loadConfig(projectRoot());
      const adv = loadAdventure(config.paths.campaignVault, 'phandalin-road');
      const scene = adv.scenes.find((s) => s.id === sceneId)!;
      const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
      engine.setMapInfo(scene.mapInfo);
      const { a } = makeDefaultParty();
      engine.addActor(a);
      for (const [name, cells] of [
        ['红顶大帐', [[9, 7], [10, 8], [11, 9]]],
        ['南侧帐篷', [[5, 8], [6, 9], [7, 9]]],
        ['北侧帐篷', [[6, 4], [7, 4], [6, 5], [7, 5]]],
      ] as const) {
        for (const [col, row] of cells) expect(engine.canStandAt(a, { col, row }), `${sceneId}：${name} (${col},${row})`).toBe(true);
      }
      expect(engine.canStandAt(a, { col: 8, row: 6 }), `${sceneId}：篝火坑`).toBe(false);
      expect(engine.canStandAt(a, { col: 2, row: 1 }), `${sceneId}：树丛`).toBe(false);
    }
  });
});

describe('一幕拖太久：GM 的提示里加提醒', () => {
  function gm(round: number, over: Partial<{ ending: boolean; combat: boolean }> = {}) {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
    const { a, b } = makeDefaultParty();
    engine.addActor(a);
    engine.addActor(b);
    if (over.combat) engine.combat = { active: true, round: 1, order: [{ actorId: a.id, initiative: 10, dex: 10 }], index: 0 };
    const clock = new RoundClock();
    clock.round = round;
    const world = {
      engine,
      clock,
      progress: new SceneProgress(),
      exitOrder: () => '',
      directorBrief: () => '',
      scene: { id: 's', title: '第二幕', readAloud: '', publicNotes: '', gmSecrets: '', encounter: [], exits: '找到东北小径', ending: !!over.ending },
      characters: { player_a: a, player_b: b },
    } as unknown as GmWorld;
    const config = { table: { limits: { sceneNudgeRounds: 12, sceneNudgeEvery: 4 } } } as unknown as AppConfig;
    const g = new GameMaster(null as unknown as LLM, config, world);
    return (g as unknown as { userPrompt(i: { mode: 'normal' }): string }).userPrompt({ mode: 'normal' });
  }

  it('没到第 12 轮不提醒；到了提醒，带出口条件；每 4 轮加重一次', () => {
    expect(gm(11)).not.toContain('场景节奏');
    const first = gm(12);
    expect(first).toContain('第 1 次提醒');
    expect(first).toContain('找到东北小径');
    expect(gm(15)).toContain('第 1 次提醒');
    const second = gm(16);
    expect(second).toContain('第 2 次提醒');
    expect(second).toContain('就要把出口摆到玩家面前');
  });

  it('战斗里、收尾幕不提醒', () => {
    expect(gm(20, { combat: true })).not.toContain('场景节奏');
    expect(gm(20, { ending: true })).not.toContain('场景节奏');
  });
});

describe('玩家模型调用有上限', () => {
  const baseInput = (cfg: AppConfig) => {
    const party = makeDefaultParty();
    return { seat: 'player_a' as const, actor: party.a, persona: '', viewText: '【场景】测试', otherPlayerName: party.b.name, ownRecentLines: [] as string[], cfg };
  };

  function cfgWith(llmThrows: boolean) {
    const config = loadConfig(projectRoot());
    config.table.limits.playerTimeoutMs = 5000;
    config.table.limits.stepTimeoutMs = 180000;
    const seen: number[] = [];
    const llm = {
      async complete(_seat: string, req: CompleteRequest) {
        seen.push(req.timeoutMs ?? -1);
        if (llmThrows) throw new LLMError({ kind: 'timeout', provider: 'test', message: '超过 5000ms 没有响应', attempts: 1 });
        throw new Error('不该走到这里');
      },
    } as unknown as LLM;
    return { config, llm, seen };
  }

  it('调用超时：不抛错，换成保守默认行动，并且用的是玩家上限而不是 180 秒', async () => {
    const { config, llm, seen } = cfgWith(true);
    const input = baseInput(config);
    const res = await runPlayerTurn(llm, config, input);
    expect(res.fallback).toBe(true);
    expect(res.decision.action.type).toBeTruthy();
    expect(res.parseErrors.join(' ')).toContain('模型调用失败');
    expect(seen).toEqual([5000]); // 不再白白重试解析，超时直接用默认行动
  });

  it('不是 LLMError 的异常照旧往上抛（别把程序错误吞成“发呆”）', async () => {
    const { config, llm } = cfgWith(false);
    await expect(runPlayerTurn(llm, config, baseInput(config))).rejects.toThrow('不该走到这里');
  });
});

describe('GM 的记录窗口', () => {
  it('回合切换不再往记录里塞「第 N 轮结束」分隔行', async () => {
    const { loop } = makeCampLoop();
    await loop.init();
    (loop as unknown as { advanceClock(k: '探索'): void }).advanceClock('探索');
    expect(loop.transcript.some((t) => /第 \d+ 轮结束/.test(t.text))).toBe(false);
    expect(loop.clock.round).toBe(2);
  });

  it('GM 提示里带最近 20 条记录', () => {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(1)) });
    const { a, b } = makeDefaultParty();
    engine.addActor(a);
    engine.addActor(b);
    const transcript = Array.from({ length: 30 }, (_, i) => ({ at: i, kind: 'gm' as const, text: `第${i}句旁白` }));
    const world = { engine, transcript, clock: new RoundClock(), characters: { player_a: a, player_b: b } } as unknown as GmWorld;
    const g = new GameMaster(null as unknown as LLM, {} as AppConfig, world);
    const text = (g as unknown as { transcriptContext(): string }).transcriptContext();
    expect(text).toContain('第29句旁白');
    expect(text).toContain('第10句旁白');
    expect(text).not.toContain('第9句旁白');
  });
});
