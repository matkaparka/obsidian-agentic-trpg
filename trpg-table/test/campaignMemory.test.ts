// 战役记忆：每幕的前情 + GM 登记的世界事实，进存档，进 GM 的提示；玩家只看得到公开的那部分。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import type { CompleteRequest } from '../src/llm/types.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { loadParty } from '../src/table/characters.js';
import { loadAdventure } from '../src/table/content.js';
import { TableLoop } from '../src/table/loop.js';
import { CampaignMemory } from '../src/table/memory.js';
import { projectRoot } from '../src/util.js';

describe('CampaignMemory', () => {
  it('前情：同一幕再记就覆盖；超过 12 幕淘汰最旧；GM 看全文，玩家只看公开版', () => {
    const m = new CampaignMemory();
    m.addRecap({ sceneId: 's1', title: '第一幕', summary: '路上遇袭，其实首领是内鬼 X', publicRecap: '路上遇袭，打退了哥布林', facts: ['击败：哥布林'], rounds: 6 });
    m.addRecap({ sceneId: 's1', title: '第一幕', summary: '改写', publicRecap: '', facts: [], rounds: 7 });
    expect(m.recaps).toHaveLength(1);
    expect(m.recaps[0].summary).toBe('改写');
    for (let i = 2; i <= 15; i++) m.addRecap({ sceneId: `s${i}`, title: `第${i}幕`, summary: `s${i}`, publicRecap: `p${i}`, facts: [], rounds: 1 });
    expect(m.recaps).toHaveLength(12);
    expect(m.recaps[0].sceneId).toBe('s4');

    const gm = new CampaignMemory();
    gm.addRecap({ sceneId: 'a', title: '甲幕', summary: '秘密：矮人其实是公爵', publicRecap: '救下了一个矮人', facts: ['击败：饿狼'], rounds: 9 });
    expect(gm.gmBlock()).toContain('秘密：矮人其实是公爵');
    expect(gm.gmBlock()).toContain('击败：饿狼');
    expect(gm.playerBlock()).toContain('救下了一个矮人');
    expect(gm.playerBlock()).not.toContain('公爵');
  });

  it('没写公开版时，玩家只看到桌面客观记下的几条', () => {
    const m = new CampaignMemory();
    m.addRecap({ sceneId: 'a', title: '甲幕', summary: '含秘密的结局', publicRecap: '', facts: ['击败：饿狼', '维斯坡伊 升到 4 级'], rounds: 3 });
    expect(m.playerBlock()).toContain('击败：饿狼；维斯坡伊 升到 4 级');
    expect(m.playerBlock()).not.toContain('含秘密');
    m.addRecap({ sceneId: 'b', title: '乙幕', summary: '只有 GM 知道', publicRecap: '', facts: [], rounds: 3 });
    expect(m.playerBlock()).not.toContain('乙幕'); // 公开版和客观记录都没有就不占地方
  });

  it('事实：同 key 更新、满 30 条淘汰最旧、可删；非公开的不进玩家视角', () => {
    const m = new CampaignMemory();
    const a = m.setFact({ text: '矮人欠维斯坡伊一条命', key: 'dwarf_debt', public: true, scene: 2 });
    expect(a.replaced).toBe(false);
    expect(m.setFact({ text: '矮人已经还清了人情', key: 'dwarf_debt', public: true, scene: 3 }).replaced).toBe(true);
    m.setFact({ text: '黑斗篷是骨哨帮的幕后', key: 'cloak', public: false, scene: 2 });
    expect(m.facts).toHaveLength(2);
    expect(m.gmBlock()).toContain('[cloak] 黑斗篷是骨哨帮的幕后（只有你知道）');
    expect(m.playerBlock()).toContain('矮人已经还清了人情');
    expect(m.playerBlock()).not.toContain('黑斗篷');
    expect(m.dropFact('dwarf_debt')?.key).toBe('dwarf_debt');
    expect(m.dropFact('没有这条')).toBeNull();

    for (let i = 0; i < 40; i++) m.setFact({ text: `事实${i}`, scene: 1 });
    expect(m.facts).toHaveLength(30);
    expect(m.facts.some((f) => f.text === '事实0')).toBe(false);
    expect(m.facts.some((f) => f.text === '事实39')).toBe(true);
  });

  it('存档读回来一样，没写 key 的事实编号接着往下排，不会撞', () => {
    const m = new CampaignMemory();
    m.addRecap({ sceneId: 'a', title: '甲幕', summary: 's', publicRecap: 'p', facts: ['f'], rounds: 2 });
    m.setFact({ text: 't', key: 'k', public: true, scene: 1 });
    expect(m.setFact({ text: '无 key 一', scene: 1 }).fact.key).toBe('f1');
    expect(m.setFact({ text: '无 key 二', scene: 1 }).fact.key).toBe('f2');
    const copy = new CampaignMemory();
    copy.load(JSON.parse(JSON.stringify(m.snapshot())));
    expect(copy.gmBlock()).toBe(m.gmBlock());
    expect(copy.playerBlock()).toBe(m.playerBlock());
    expect(copy.setFact({ text: '无 key 三', scene: 1 }).fact.key).toBe('f3');
  });
});

// ---------------------------------------------------------------- 整桌

function makeLoop(dir = mkdtempSync(join(tmpdir(), 'trpg-mem-')), resume = false) {
  const config = loadConfig(projectRoot());
  config.paths.state = join(dir, 'state');
  config.paths.logs = join(dir, 'logs');
  config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
  config.table.characterSet = 'lv3';
  const logs = createLogs(dir);
  const llm = new FakeLLM(config, logs);
  (llm as unknown as { startedCombat: boolean }).startedCombat = true; // 不让假 GM 自己开战
  const party = loadParty(config.paths.campaignVault, 'lv3');
  const base = loadAdventure(config.paths.campaignVault, 'phandalin-road');
  const adventure = { ...base, scenes: base.scenes.filter((s) => ['forest-camp', 'cave-mouth'].includes(s.id)) };
  const loop = new TableLoop({
    config,
    llm,
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource: new LocalRollSource(mulberry32(5)),
    dryRun: true,
    resume,
  });
  return { loop, llm, dir, config, adventure, logs, step: () => (loop as unknown as { step(): Promise<void> }).step() };
}

type Tool = (name: string, args: Record<string, unknown>) => Promise<{ ok: boolean; text: string }>;

describe('TableLoop：战役记忆', () => {
  it('end_scene 存成前情：GM 的提示里有全文，玩家视角里只有公开版；换场景不丢', async () => {
    const { loop, llm, step } = makeLoop();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool: Tool }).execTool.bind(loop.gm);
    const wolf = [...loop.engine.actors.values()].find((a) => a.kind === 'monster')!;
    wolf.hp = 0; // 这一幕里倒下了
    expect((await exec('note_fact', { text: '饿狼后来跟着队伍', key: 'wolf_ally', public: true })).ok).toBe(true);
    expect((await exec('note_fact', { text: '拖痕尽头的洞里关着 Gundren，巡逻队今晚换班', key: 'patrol', public: false })).ok).toBe(true);
    const end = await exec('end_scene', { summary: '救下了狼，GM 暗中确定洞里有一队守卫', public_recap: '给饿狼包了伤，找到了通往溪边的小径' });
    expect(end.ok).toBe(true);

    await step(); // applySceneEnd
    expect(loop.sceneIndex).toBe(1);
    expect(loop.memory.recaps).toHaveLength(1);
    const recap = loop.memory.recaps[0];
    expect(recap.sceneId).toBe('forest-camp');
    expect(recap.publicRecap).toContain('给饿狼包了伤');
    expect(recap.facts.join('；')).toContain('击败：饿狼');

    const system = (loop.gm as unknown as { systemPrompt(): string }).systemPrompt();
    expect(system).toContain('【前情（已经过去的幕）】');
    expect(system).toContain('GM 暗中确定洞里有一队守卫');
    expect(system).toContain('[patrol] 拖痕尽头的洞里关着 Gundren，巡逻队今晚换班（只有你知道）');
    expect(system).toContain('[wolf_ally] 饿狼后来跟着队伍');

    // 玩家的输入里：公开的前情和公开事实在，GM 的秘密不在
    const seen: string[] = [];
    const orig = llm.complete.bind(llm);
    (llm as unknown as { complete: unknown }).complete = async (seat: string, req: CompleteRequest, purpose: string) => {
      if (seat === 'player_a' || seat === 'player_b') seen.push(JSON.stringify(req.messages));
      return orig(seat as never, req, purpose);
    };
    for (let i = 0; i < 12 && !seen.length; i++) await step();
    expect(seen.length).toBeGreaterThan(0);
    const view = seen[0];
    expect(view).toContain('【前情（你们都记得的）】');
    expect(view).toContain('给饿狼包了伤');
    expect(view).toContain('饿狼后来跟着队伍');
    expect(view).not.toContain('GM 暗中确定');
    expect(view).not.toContain('巡逻队今晚换班');
  }, 60000);

  it('存档重启后前情和事实还在；老存档（没有 memory）从记录里补出前几幕', async () => {
    const a = makeLoop();
    await a.loop.init();
    const exec = (a.loop.gm as unknown as { execTool: Tool }).execTool.bind(a.loop.gm);
    await exec('note_fact', { text: '矮人欠维斯坡伊一条命', key: 'debt', public: true });
    await exec('end_scene', { summary: '第二幕结束了', public_recap: '第二幕的公开版' });
    await a.step();
    a.loop.save();
    await a.loop.flushSave();

    const b = makeLoop(a.dir, true);
    await b.loop.init();
    expect(b.loop.sceneIndex).toBe(1);
    expect(b.loop.memory.recaps.map((r) => r.publicRecap)).toEqual(['第二幕的公开版']);
    expect(b.loop.memory.facts.map((f) => f.key)).toEqual(['debt']);

    // 老存档：去掉 memory 字段，只剩 transcript 里的「场景结束：…」
    const snap = a.loop.snapshot() as unknown as Record<string, unknown>;
    delete snap.memory;
    writeFileSync(join(a.dir, 'state', 'table.json'), JSON.stringify(snap));
    const c = makeLoop(a.dir, true);
    await c.loop.init();
    expect(c.loop.memory.recaps).toHaveLength(1);
    expect(c.loop.memory.recaps[0].summary).toBe('第二幕结束了');
    expect(c.loop.memory.recaps[0].title).toContain('林间血迹');
    expect(c.loop.memory.playerBlock()).toBe(''); // 补出来的没有公开版，玩家不会看到 GM 的那句话
  }, 60000);

  it('note_fact / drop_fact 的参数检查', async () => {
    const { loop } = makeLoop();
    await loop.init();
    const exec = (loop.gm as unknown as { execTool: Tool }).execTool.bind(loop.gm);
    expect((await exec('note_fact', { text: '   ' })).ok).toBe(false);
    const ok = await exec('note_fact', { text: '桥断了', key: 'bridge', public: true });
    expect(ok.text).toContain('已记下「bridge」');
    expect((await exec('note_fact', { text: '桥修好了', key: 'bridge', public: true })).text).toContain('已更新');
    expect(loop.memory.facts).toHaveLength(1);
    expect((await exec('drop_fact', { key: 'bridge' })).ok).toBe(true);
    expect((await exec('drop_fact', { key: 'bridge' })).ok).toBe(false);
  }, 60000);
});
