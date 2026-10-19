// 物品 / 金币 / 战利品：背包进存档，GM 用工具给和收，玩家能用，场景有战利品清单，面板显示金币。
import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import {
  addCoins,
  addItem,
  coinChip,
  coinsFrom,
  describeInventory,
  findItem,
  formatCoins,
  healFormulaIn,
  removeItem,
  spendCoins,
} from '../src/rules/inventory.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { lootLine, parseLoot } from '../src/table/loot.js';
import { TableLoop } from '../src/table/loop.js';
import { buildPlayerView } from '../src/table/view.js';
import type { PlayerDecision } from '../src/table/types.js';
import { ScriptedRollSource } from './helpers.js';
import { projectRoot } from '../src/util.js';

describe('inventory：物品堆和金币', () => {
  it('同名同类合并、上限 99、按名字模糊找', () => {
    const { a } = makeDefaultParty();
    addItem(a, { name: '治疗药水', kind: 'consumable', qty: 2, use: { heal: '2d4+2' } });
    addItem(a, { name: '治疗药水', kind: 'consumable', qty: 1 });
    expect(a.inventory).toHaveLength(1);
    expect(a.inventory![0].qty).toBe(3);
    expect(a.inventory![0].use?.heal).toBe('2d4+2');
    addItem(a, { name: '火把', kind: 'gear', qty: 500 });
    expect(findItem(a.inventory!, '火把')!.qty).toBe(99);
    expect(findItem(a.inventory!, '喝治疗药水')?.name).toBe('治疗药水'); // 玩家写的话里带了别的字
    expect(findItem(a.inventory!, '药水')?.name).toBe('治疗药水');
    expect(findItem(a.inventory!, '剑')).toBeNull();
    expect(findItem(a.inventory!, '')).toBeNull();
  });

  it('拿走：数量不够不动背包；拿光了就从背包里消失', () => {
    const { a } = makeDefaultParty();
    addItem(a, { name: '绳索', kind: 'gear', qty: 2 });
    expect(removeItem(a, '绳索', 3)).toBeNull();
    expect(a.inventory![0].qty).toBe(2);
    expect(removeItem(a, '绳索', 1)?.left).toBe(1);
    expect(removeItem(a, '绳索', 1)?.left).toBe(0);
    expect(a.inventory).toHaveLength(0);
  });

  it('钱：铜币总数，1 gp = 100 cp，付不起不扣', () => {
    const { a } = makeDefaultParty();
    expect(formatCoins(0)).toBe('没有钱');
    expect(coinsFrom({ gp: 9, sp: 3, cp: 5 })).toBe(935);
    expect(coinsFrom({ gp: 0.5 })).toBe(50);
    addCoins(a, 935);
    expect(formatCoins(a.coinsCp!)).toBe('9 gp 3 sp 5 cp');
    expect(coinChip(a)).toBe('9 gp 3 sp 5 cp');
    expect(spendCoins(a, 1000)).toBe(false);
    expect(a.coinsCp).toBe(935);
    expect(spendCoins(a, 35)).toBe(true);
    expect(formatCoins(a.coinsCp!)).toBe('9 gp');
    expect(describeInventory(a)).toBe('金币：9 gp；物品：（空）');
  });

  it('从一段话里读出治疗公式', () => {
    expect(healFormulaIn('喝下恢复 2d4+2 HP')).toBe('2d4+2');
    expect(healFormulaIn('回复 1d8 - 1 点生命')).toBe('1d8-1');
    expect(healFormulaIn('只是一瓶水')).toBeNull();
  });
});

describe('parseLoot：剧本里的 ## 战利品', () => {
  it('钱、数量、类别、治疗公式、位置', () => {
    const loot = parseLoot(
      [
        '- 碎银 9 gp｜红帐里的战利品箱',
        '- 治疗药水 ×2｜消耗品｜喝下恢复 2d4+2｜北侧帐篷的铺盖下面（察觉 DC 13）',
        '- 矮人银衣扣｜任务物品｜刻着一圈符文，是 Gundren 的｜红帐里的箱子',
        '- 铜币 6 cp｜死哥布林身上',
        '- 一张纸',
        '不是列表的行',
      ].join('\n')
    );
    expect(loot.map((l) => l.id)).toEqual(['loot:1', 'loot:2', 'loot:3', 'loot:4', 'loot:5']);
    expect(loot[0]).toMatchObject({ coinsCp: 900, where: '红帐里的战利品箱' });
    expect(loot[1]).toMatchObject({ name: '治疗药水', qty: 2, kind: 'consumable', heal: '2d4+2', where: '北侧帐篷的铺盖下面（察觉 DC 13）' });
    expect(loot[2]).toMatchObject({ name: '矮人银衣扣', kind: 'quest', desc: '刻着一圈符文，是 Gundren 的', where: '红帐里的箱子' });
    expect(loot[3].coinsCp).toBe(6);
    expect(loot[4]).toMatchObject({ name: '一张纸', kind: 'gear', where: '' });
    expect(lootLine(loot[0], true)).toContain('【已发】');
    expect(lootLine(loot[1], false)).toContain('×2');
  });

  it('正式剧本里每一幕的清单都读得出来', () => {
    const adv = loadAdventure(loadConfig(projectRoot()).paths.campaignVault, 'phandalin-road');
    const camp = adv.scenes.find((s) => s.id === 'forest-camp')!;
    expect(camp.loot!.map((l) => l.name)).toEqual(['碎银 9 gp', '矮人银衣扣', '潦草的炭笔地图', '被撕坏的矮人外套']);
    expect(camp.loot![0].coinsCp).toBe(900);
    const hall = adv.scenes.find((s) => s.id === 'water-hall')!;
    expect(hall.loot![0].coinsCp).toBe(5000);
    for (const s of adv.scenes) expect(s.loot!.length, `${s.id} 没有战利品清单`).toBeGreaterThan(0);
  });
});

describe('引擎：使用物品', () => {
  function setup() {
    const rolls = new ScriptedRollSource();
    const engine = new RulesEngine({ rollSource: rolls });
    const { a, b } = makeDefaultParty();
    engine.addActor(a);
    engine.addActor(b);
    addItem(a, { name: '治疗药水', kind: 'consumable', qty: 2, use: { heal: '2d4+2' } });
    return { engine, a, b };
  }

  it('自己喝：花一个动作、用掉一瓶、掷骰回血（不超过上限）', async () => {
    const { engine, a } = setup();
    a.hp = 3;
    engine.beginExplorationTurn(a.id);
    const out = await engine.useItem(a.id, '治疗药水');
    expect(out.ok).toBe(true);
    expect(out.consumed).toBe(true);
    expect(out.note).toContain('喝下治疗药水');
    expect(a.hp).toBeGreaterThan(3);
    expect(a.hp).toBeLessThanOrEqual(engine.maxHpOf(a));
    expect(a.inventory![0].qty).toBe(1);
    expect(a.turn.actionUsed).toBe(true);
    await expect(engine.useItem(a.id, '治疗药水')).rejects.toThrow(/已经用过动作/); // 一回合只有一个动作
  });

  it('喂给倒下的队友：他醒过来；战斗里要相邻', async () => {
    const { engine, a, b } = setup();
    b.hp = 0;
    b.deathSaves = { successes: 0, failures: 1, stable: false, dead: false };
    engine.beginExplorationTurn(a.id);
    const out = await engine.useItem(a.id, '治疗药水', b.id);
    expect(out.ok).toBe(true);
    expect(out.note).toContain(`让 ${b.name} 喝下`);
    expect(b.hp).toBeGreaterThan(0);

    a.position = { col: 3, row: 3 };
    b.position = { col: 12, row: 3 };
    engine.combat = { active: true, round: 1, order: [{ actorId: a.id, initiative: 10, dex: 10 }], index: 0 };
    engine.beginTurn(a.id);
    const far = await engine.useItem(a.id, '治疗药水', b.id);
    expect(far.ok).toBe(false);
    expect(far.note).toContain('离得太远');
    expect(a.inventory![0].qty).toBe(1); // 没喂成就没用掉
    expect(a.turn.actionUsed).toBe(false);
  });

  it('没有的东西不生效；没有规则效果的东西拿出来看看，不花动作也不用掉', async () => {
    const { engine, a } = setup();
    const none = await engine.useItem(a.id, '复活卷轴');
    expect(none.ok).toBe(false);
    expect(none.note).toContain('背包里没有');
    addItem(a, { name: '矮人银衣扣', kind: 'quest' });
    const clasp = await engine.useItem(a.id, '银衣扣');
    expect(clasp).toMatchObject({ ok: true, consumed: false });
    expect(a.inventory!.some((i) => i.name === '矮人银衣扣')).toBe(true);
    expect(a.turn.actionUsed).toBe(false);
  });

  it('玩家的「能做的事」里列出有效果的物品，没有效果的不列', () => {
    const { engine, a } = setup();
    addItem(a, { name: '矮人银衣扣', kind: 'quest' });
    const acts = engine.legalActions(a.id).filter((x) => x.kind === 'item');
    expect(acts.map((x) => x.name)).toContain('使用：治疗药水 ×2');
    expect(acts.some((x) => x.name.includes('银衣扣'))).toBe(false);
  });
});

// ---------------------------------------------------------------- 整桌

function makeLoop(dir = mkdtempSync(join(tmpdir(), 'trpg-inv-')), resume = false) {
  const config = loadConfig(projectRoot());
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  const logs = createLogs(dir);
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const adventure = { ...base, scenes: base.scenes.filter((s) => ['forest-camp', 'cave-mouth'].includes(s.id)) };
  const loop = new TableLoop({
    config,
    llm: new FakeLLM(config, logs),
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(9)),
    dryRun: true,
    resume,
  });
  return { loop, dir, party, adventure };
}

type Tool = (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;
type Exec = (seat: 'player_a' | 'player_b', d: PlayerDecision) => Promise<{ ok: boolean; summary: string; errors: string[] }>;

describe('TableLoop：背包和战利品', () => {
  it('角色卡里的 kit 给起始金币和药水；overlay 面板有金币；玩家视角里写明背包', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const a = loop.engine.require('player_a');
    expect(a.coinsCp).toBe(1500);
    expect(a.inventory!.map((i) => i.name)).toEqual(['治疗药水']);
    expect(a.inventory![0].use?.heal).toBe('2d4+2');
    const players = (loop.overlayState().players as { seat: string; gold: string }[]);
    expect(players.find((p) => p.seat === 'player_a')!.gold).toBe('15 gp');

    const view = buildPlayerView({
      engine: loop.engine,
      selfId: 'player_a',
      visibleActorIds: loop.visibleActorIds,
      sceneTitle: 't',
      phase: 'explore',
      round: 1,
      gmNarration: '',
      publicEvents: [],
      otherPlayerSays: [],
      legalActions: loop.engine.legalActions('player_a'),
      inCombat: false,
    });
    expect(view.text).toContain('【你的背包】金币：15 gp；物品：治疗药水');
    expect(view.text).toContain('背包里没有的东西，你就是没有');
    expect(view.text).toContain('使用：治疗药水');
  });

  it('GM 工具：战利品清单、发过不能再发、平分钱、付钱不够不扣、拿走东西', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool: Tool }).execTool.bind(loop.gm);
    const a = loop.engine.require('player_a');
    const b = loop.engine.require('player_b');
    a.coinsCp = 0;
    b.coinsCp = 0;

    // GM 提示里看得到清单
    const sys = (loop.gm as unknown as { systemPrompt(): string }).systemPrompt();
    expect(sys).toContain('【可发现的战利品');
    expect(sys).toContain('[loot:1] 碎银 9 gp');
    expect(sys).toContain('背包与金币：');

    const clasp = await exec('give_item', { to: 'player_b', loot_id: 'loot:2' });
    expect(clasp.ok).toBe(true);
    expect(b.inventory!.map((i) => i.name)).toEqual(['治疗药水', '矮人银衣扣']);
    expect(b.inventory![1].kind).toBe('quest');
    expect((await exec('give_item', { to: 'player_a', loot_id: 'loot:2' })).text).toContain('已经发过了');
    expect((await exec('give_item', { to: 'player_a', loot_id: 'loot:1' })).text).toContain('用 give_gold'); // 钱不能当物品发
    expect((await exec('give_item', { to: 'player_a', loot_id: 'loot:99' })).ok).toBe(false);
    expect((await exec('give_item', { to: 'player_a' })).ok).toBe(false);
    expect((await exec('give_item', { to: 'player_a', name: '药膏', heal: 'lots' })).text).toContain('骰子公式');
    expect((await exec('give_item', { to: 'player_a', name: '药膏', qty: 3, heal: '1d4' })).ok).toBe(true);
    expect(a.inventory!.find((i) => i.name === '药膏')!.use?.heal).toBe('1d4');

    const gold = await exec('give_gold', { to: 'party', loot_id: 'loot:1' }); // 9 gp 平分
    expect(gold.ok).toBe(true);
    expect(a.coinsCp! + b.coinsCp!).toBe(900);
    expect([a.coinsCp, b.coinsCp].sort()).toEqual([450, 450]);
    expect((await exec('give_gold', { to: 'party', loot_id: 'loot:1' })).text).toContain('已经发过了');
    await exec('give_gold', { to: 'party', cp: 3 }); // 除不尽：多的一枚给第一个人
    expect(a.coinsCp! + b.coinsCp!).toBe(903);
    expect((await exec('give_gold', { to: 'player_a', gp: -5 })).ok).toBe(false);
    expect((await exec('give_gold', { to: 'player_a', gp: 999999 })).ok).toBe(false);

    const before = b.coinsCp!;
    expect((await exec('take_gold', { from: 'player_b', gp: 100 })).text).toContain('不够');
    expect(b.coinsCp).toBe(before);
    expect((await exec('take_gold', { from: 'player_b', sp: 5, reason: '买了一壶酒' })).ok).toBe(true);
    expect(b.coinsCp).toBe(before - 50);

    expect((await exec('take_item', { from: 'player_a', name: '药膏', qty: 5 })).ok).toBe(false);
    expect((await exec('take_item', { from: 'player_a', name: '药膏', qty: 2, reason: '被抢走' })).ok).toBe(true);
    expect(a.inventory!.find((i) => i.name === '药膏')!.qty).toBe(1);

    // 清单里标了已发；记录里有这些事；前情的客观记录也会带上
    const sys2 = (loop.gm as unknown as { systemPrompt(): string }).systemPrompt();
    expect(sys2).toContain('[loot:1] 碎银 9 gp —— 红帐里的战利品箱（翻箱子就能拿到） 【已发】');
    expect(loop.transcript.some((t) => t.kind === 'event' && t.text.includes('萨珀特菲 得到 矮人银衣扣'))).toBe(true);
    const sceneLog = (loop as unknown as { sceneLog: string[] }).sceneLog;
    expect(sceneLog.some((t) => t.includes('矮人银衣扣'))).toBe(true);
  }, 60000);

  it('玩家用物品：喂药水给队友，桌面结算并记下来', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const a = loop.engine.require('player_a');
    const b = loop.engine.require('player_b');
    a.hp = 4;
    const exec = (loop as unknown as { executePlayerAction: Exec }).executePlayerAction.bind(loop);
    loop.engine.beginExplorationTurn('player_b');
    const out = await exec('player_b', {
      say: '喝了它。',
      action: { type: 'item', target: a.name, detail: '把治疗药水喂给维斯坡伊' },
      expression: 'neutral',
    });
    expect(out.ok).toBe(true);
    expect(out.summary).toContain(`让 ${a.name} 喝下治疗药水`);
    expect(a.hp).toBeGreaterThan(4);
    expect(b.inventory ?? []).toHaveLength(0);
    expect(loop.transcript.some((t) => t.text.includes('用掉了 治疗药水'))).toBe(true);

    // 没有了就是没有了：同一句话第二次不会凭空再喝一瓶
    loop.engine.beginExplorationTurn('player_b');
    const again = await exec('player_b', { say: '再来一瓶。', action: { type: 'item', target: a.name, detail: '再喂一瓶治疗药水' }, expression: 'neutral' });
    expect(again.summary).not.toContain('喝下治疗药水');
  });

  it('存档重启后背包、钱、已发的战利品都在；kit 不会盖掉存档里的背包', async () => {
    const first = makeLoop();
    await first.loop.init();
    const exec = (first.loop.gm as unknown as { execTool: Tool }).execTool.bind(first.loop.gm);
    await exec('give_item', { to: 'player_a', loot_id: 'loot:2' });
    await exec('give_gold', { to: 'player_a', loot_id: 'loot:1' });
    await exec('take_item', { from: 'player_b', name: '治疗药水' }); // b 的药水没了
    first.loop.save();
    await first.loop.flushSave();

    const second = makeLoop(first.dir, true);
    await second.loop.init();
    const a = second.loop.engine.require('player_a');
    const b = second.loop.engine.require('player_b');
    expect(a.inventory!.map((i) => i.name)).toEqual(['治疗药水', '矮人银衣扣']);
    expect(a.coinsCp).toBe(1500 + 900);
    expect(b.inventory ?? []).toHaveLength(0); // 存档说没了就是没了，kit 不会又塞一瓶
    expect([...second.loop.lootTaken].sort()).toEqual(['forest-camp:loot:1', 'forest-camp:loot:2']);
  }, 60000);
});
