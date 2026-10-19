// 剧本里标了 [可见] 的遭遇生物（拴着的狼）一进场就在地图上（规则层 actor + Atlas pin），开战时直接拉进战斗、不再多生成一份。
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import type { AppConfig } from '../src/config.js';
import type { LLM } from '../src/llm/index.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { EventBus } from '../src/table/events.js';
import { GameMaster, type GmWorld } from '../src/table/gm.js';
import { TableLoop } from '../src/table/loop.js';
import { projectRoot } from '../src/util.js';

const vault = () => loadConfig(projectRoot()).paths.campaignVault;

describe('遭遇条目的 [可见] 标记', () => {
  it('第二幕的狼标了 [可见]，其它幕的伏兵没标', () => {
    const adv = loadAdventure(vault(), 'phandalin-road');
    const camp = adv.scenes.find((s) => s.id === 'forest-camp')!;
    expect(camp.encounter).toEqual([{ monsterId: 'wolf', count: 1, name: '饿狼', visible: true }]);
    const road = adv.scenes.find((s) => s.id === 'road-ambush')!;
    expect(road.encounter.every((e) => !e.visible)).toBe(true);
    expect(road.encounter.length).toBeGreaterThan(0);
  });
});

function makeLoop() {
  const root = projectRoot();
  const dir = mkdtempSync(join(tmpdir(), 'trpg-creature-'));
  const config = loadConfig(root);
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  const logs = createLogs(dir);
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const adventure = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const loop = new TableLoop({
    config,
    llm: new FakeLLM(config, logs),
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(3)),
    dryRun: true,
    resume: false,
  });
  return { loop, adventure };
}

describe('TableLoop.ensureSceneCreatures', () => {
  it('进第二幕就有一只饿狼：在地图上、玩家看得见、没进先攻；没标 [可见] 的伏兵也在场上但藏着；重复调用或打死了也不会再生成', () => {
    const { loop, adventure } = makeLoop();
    // 第一幕没有 [可见] 的生物：两个伏击的哥布林一进场就在场上，但藏着（玩家看不见，Atlas 里是隐藏 token）
    (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    const ambushers = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster');
    expect(ambushers).toHaveLength(2);
    for (const g of ambushers) {
      expect(loop.visibleActorIds.has(g.id)).toBe(false);
      expect(g.position).toBeTruthy(); // 有位置，Atlas 才放得出（隐藏的）pin
    }

    const camp = adventure.scenes.find((s) => s.id === 'forest-camp')!;
    (loop as unknown as { scene: unknown }).scene = camp;
    loop.engine.setMapInfo(camp.mapInfo); // 真实流程里换场景时先设地图再摆生物
    const ensure = () => (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    ensure();
    const wolves = [...loop.engine.actors.values()].filter((a) => a.kind === 'monster' && a.id.startsWith('wolf'));
    expect(wolves).toHaveLength(1);
    const wolf = wolves[0];
    expect(wolf.name).toBe('饿狼');
    expect(wolf.id.split(':')[0]).toBe('wolf');
    expect(wolf.position).toEqual({ col: 12, row: 8 }); // 第二幕地图信息里写的狼的出场格
    expect(wolf.hp).toBeGreaterThan(0);
    expect(loop.visibleActorIds.has(wolf.id)).toBe(true);
    expect(loop.engine.combat.active).toBe(false);

    ensure();
    expect([...loop.engine.actors.values()].filter((a) => a.id.startsWith('wolf'))).toHaveLength(1);
    wolf.hp = 0; // 打倒了、还没清场：不能又冒出一只
    ensure();
    expect([...loop.engine.actors.values()].filter((a) => a.id.startsWith('wolf'))).toHaveLength(1);
  });
});

describe('start_combat 拉进场上已有的生物', () => {
  function gmWithWolf(extraWolves = 0) {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(5)) });
    const party = loadParty(vault(), 'lv3');
    engine.addActor(party.a);
    engine.addActor(party.b);
    engine.ensurePositions();
    const wolf = spawnMonster('wolf', '饿狼');
    wolf.position = { col: 12, row: 8 };
    engine.addActor(wolf);
    for (let i = 0; i < extraWolves; i++) engine.addActor(spawnMonster('wolf', `野狼${i + 1}`));
    const visible = new Set<string>(['player_a', 'player_b']);
    const world = {
      engine,
      bus: new EventBus(),
      visibleActorIds: visible,
      transcript: [],
      setPhase: () => undefined,
    } as unknown as GmWorld;
    const gm = new GameMaster(null as unknown as LLM, {} as AppConfig, world);
    const run = (args: Record<string, unknown>) =>
      (gm as unknown as { execTool: (n: string, a: Record<string, unknown>) => Promise<{ ok: boolean; text: string }> }).execTool('start_combat', args);
    return { engine, wolf, visible, run };
  }

  it('同一个 monster_id 的活物直接进先攻，不多生成一只；位置和名字保留', async () => {
    const { engine, wolf, visible, run } = gmWithWolf();
    const before = engine.actors.size;
    const r = await run({ monsters: [{ monster_id: 'wolf' }] });
    expect(r.ok).toBe(true);
    expect(engine.actors.size).toBe(before);
    expect(engine.combat.order.map((o) => o.actorId)).toContain(wolf.id);
    expect(wolf.name).toBe('饿狼');
    expect(wolf.position).toEqual({ col: 12, row: 8 });
    expect(visible.has(wolf.id)).toBe(true);
  });

  it('要的比场上多：先用场上的，缺的才新生成；打死的不算', async () => {
    const { engine, wolf, run } = gmWithWolf();
    const before = engine.actors.size;
    const r = await run({ monsters: [{ monster_id: 'wolf', count: 3 }] });
    expect(r.ok).toBe(true);
    expect(engine.actors.size).toBe(before + 2); // 场上那只 + 新生成 2 只
    expect(engine.combat.order.filter((o) => engine.get(o.actorId)?.kind === 'monster')).toHaveLength(3);
    expect(engine.combat.order.map((o) => o.actorId)).toContain(wolf.id);

    const g2 = gmWithWolf();
    g2.wolf.hp = 0;
    const before2 = g2.engine.actors.size;
    await g2.run({ monsters: [{ monster_id: 'wolf' }] });
    expect(g2.engine.actors.size).toBe(before2 + 1); // 打倒的不拉进来，生成新的
  });

  it('不同种类的怪照常生成', async () => {
    const { engine, run } = gmWithWolf();
    const before = engine.actors.size;
    await run({ monsters: [{ monster_id: 'goblin', count: 2 }] });
    expect(engine.actors.size).toBe(before + 2);
  });
});

describe('和生物互动要走到它旁边', () => {
  async function setup() {
    const { loop, adventure } = makeLoop();
    await loop.init();
    const camp = adventure.scenes.find((s) => s.id === 'forest-camp')!;
    (loop as unknown as { scene: unknown }).scene = camp;
    loop.engine.setMapInfo(camp.mapInfo);
    (loop as unknown as { ensureSceneCreatures(): void }).ensureSceneCreatures();
    const wolf = [...loop.engine.actors.values()].find((a) => a.kind === 'monster' && a.id.startsWith('wolf'))!;
    const cleric = loop.engine.require('player_a');
    cleric.position = { col: 7, row: 7 }; // 篝火坑西南角，离狼 5 格
    const run = (decision: { type: string; target?: string; detail?: string; cell?: { col: number; row: number } }) =>
      (loop as unknown as { executePlayerAction(seat: string, d: unknown): Promise<{ ok: boolean; summary: string }> }).executePlayerAction('player_a', {
        say: '',
        expression: 'neutral',
        action: decision,
      });
    return { loop, wolf, cleric, run };
  }
  const cheb = (a: { col: number; row: number }, b: { col: number; row: number }) => Math.max(Math.abs(a.col - b.col), Math.abs(a.row - b.row));

  it('检定的目标是狼（玩家叫它「拴着的狼」）：不管玩家写的 cell，棋子走到狼的旁边', async () => {
    const { wolf, cleric, run } = await setup();
    expect(cheb(cleric.position!, wolf.position!)).toBe(5);
    const r = await run({ type: 'check', target: '拴着的狼', detail: 'medicine', cell: { col: 7, row: 7 } });
    expect(r.ok).toBe(true);
    expect(cheb(cleric.position!, wolf.position!)).toBe(1);
    expect(r.summary).toContain('走到');
  });

  it('已经相邻就不动；目标不是生物（营地、篝火）也不动', async () => {
    const { wolf, cleric, run } = await setup();
    cleric.position = { col: wolf.position!.col - 1, row: wolf.position!.row };
    const before = { ...cleric.position };
    await run({ type: 'check', target: '饿狼', detail: 'medicine' });
    expect(cleric.position).toEqual(before);

    cleric.position = { col: 7, row: 7 };
    await run({ type: 'check', target: '篝火坑', detail: 'survival' });
    expect(cleric.position).toEqual({ col: 7, row: 7 });
  });

  it('move 照旧：给了 cell 就走到那一格', async () => {
    const { cleric, run } = await setup();
    await run({ type: 'move', cell: { col: 5, row: 7 } });
    expect(cleric.position).toEqual({ col: 5, row: 7 });
  });
});
