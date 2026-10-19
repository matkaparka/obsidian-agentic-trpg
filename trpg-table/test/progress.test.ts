// 经验值与升级：怪物按 CR 发经验、平分、不重复；到线自动重算角色卡并保留正在发生的状态；3 级版角色卡能用。
import { describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { FakeLLM } from '../src/llm/fake.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { LEVEL_XP, levelForXp, nextLevelXp, xpForCr, xpForLevel } from '../src/rules/xp.js';
import { loadAdventure } from '../src/table/content.js';
import { loadParty, readBuildSpec } from '../src/table/characters.js';
import { TableLoop } from '../src/table/loop.js';
import { levelUpActor } from '../src/table/progress.js';
import { projectRoot } from '../src/util.js';
import { ScriptedRollSource } from './helpers.js';

const vault = () => loadConfig(projectRoot()).paths.campaignVault;

describe('xp 表', () => {
  it('CR → XP：和 SRD 的表一致', () => {
    expect([0, 0.125, 0.25, 0.5, 1, 2, 3, 5, 10, 20, 30].map(xpForCr)).toEqual([10, 25, 50, 100, 200, 450, 700, 1800, 5900, 25000, 155000]);
    expect(xpForCr(0.75)).toBe(100); // 不在表里取不超过它的最近一档
  });

  it('等级门槛：和 PHB 一致，来回换算', () => {
    expect(LEVEL_XP).toHaveLength(20);
    expect([1, 2, 3, 4, 5, 20].map(xpForLevel)).toEqual([0, 300, 900, 2700, 6500, 355000]);
    expect([0, 299, 300, 899, 900, 2699, 2700, 355000, 999999].map(levelForXp)).toEqual([1, 1, 2, 2, 3, 3, 4, 20, 20]);
    expect(nextLevelXp(3)).toBe(2700);
    expect(nextLevelXp(20)).toBeNull();
  });
});

function setup() {
  const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
  const { a, b } = makeDefaultParty();
  a.xp = 0; // 默认队伍是 3 级（900）；这组测试从 0 开始数，免得和门槛搅在一起
  b.xp = 0;
  engine.addActor(a);
  engine.addActor(b);
  const foe = (id: string, hp: number) => {
    const m = spawnMonster(id, `${id}@${engine.actors.size}`);
    m.hp = hp;
    engine.addActor(m);
    return m;
  };
  return { engine, a, b, foe };
}

describe('RulesEngine.awardCombatXp', () => {
  it('倒下的怪物按 CR 发经验，总数平分给两个 PC', () => {
    const { engine, a, b, foe } = setup();
    foe('goblin', 0); // CR 1/4 = 50
    foe('goblin', 0);
    foe('wolf', 0); // CR 1/4 = 50
    const award = engine.awardCombatXp();
    expect(award).not.toBeNull();
    expect(award!.total).toBe(150);
    expect(award!.share).toBe(75);
    expect(award!.defeated).toHaveLength(3);
    expect(a.xp).toBe(75);
    expect(b.xp).toBe(75);
  });

  it('没倒下的（逃跑 / 还活着）不算；发过的不重复发', () => {
    const { engine, a, foe } = setup();
    foe('goblin', 7); // 活着
    expect(engine.awardCombatXp()).toBeNull();
    const dead = foe('bugbear', 0); // CR 1 = 200
    const first = engine.awardCombatXp();
    expect(first?.total).toBe(200);
    expect(dead.xpAwarded).toBe(true);
    expect(engine.awardCombatXp()).toBeNull();
    expect(a.xp).toBe(100);
  });

  it('已经死亡的 PC 不分；零头不发；全员死亡时不打标记、留着以后再发', () => {
    const { engine, a, b, foe } = setup();
    const m = foe('goblin', 0); // 50
    foe('skeleton', 0); // CR 1/4 = 50
    foe('zombie', 0); // CR 1/4 = 50 → 一共 150
    b.deathSaves.dead = true;
    expect(engine.awardCombatXp()?.share).toBe(150);
    expect(a.xp).toBe(150);
    expect(b.xp ?? 0).toBe(0);

    const { engine: e2, a: a2, b: b2, foe: foe2 } = setup();
    const g = foe2('goblin', 0);
    a2.deathSaves.dead = true;
    b2.deathSaves.dead = true;
    expect(e2.awardCombatXp()).toBeNull();
    expect(g.xpAwarded).toBeUndefined();
    b2.deathSaves.dead = false;
    expect(e2.awardCombatXp()?.share).toBe(50);
    expect(m.xpAwarded).toBe(true);

    const { engine: e3, a: a3 } = setup(); // 零头：3 个 25 分 2 人 = 37，各 37
    for (let i = 0; i < 3; i++) {
      const rat = spawnMonster('swarm_of_rats', `r${i}`); // CR 1/4 = 50
      rat.hp = 0;
      rat.cr = 0.125; // 25
      e3.addActor(rat);
    }
    expect(e3.awardCombatXp()?.share).toBe(37);
    expect(a3.xp).toBe(37);
  });

  it('awardXp：剧情经验平分；数量不对返回 null', () => {
    const { engine, a, b } = setup();
    expect(engine.awardXp(0, '没有')).toBeNull();
    expect(engine.awardXp(Number.NaN, '没有')).toBeNull();
    const award = engine.awardXp(301, '识破阴谋');
    expect(award).toMatchObject({ total: 301, share: 150, reason: '识破阴谋' });
    expect(a.xp).toBe(150);
    expect(b.xp).toBe(150);
    expect(award!.gains.map((g) => g.reachedLevel)).toEqual([1, 1]);
  });
});

describe('3 级版角色卡（characters/lv3/）', () => {
  it('能读出来：没有错误，3 级，经验 900', () => {
    const party = loadParty(vault(), 'lv3');
    expect(party.source).toBe('vault');
    expect(party.warnings.filter((w) => /错误|失败/.test(w))).toEqual([]);
    for (const actor of [party.a, party.b]) {
      expect(actor.level).toBe(3);
      expect(actor.xp).toBe(900);
      expect(actor.proficiencyBonus).toBe(2);
    }
    expect(party.a.charClass).toContain('3');
    // 牧师：3 级 = 4 个 1 环 + 2 个 2 环；生命领域；准备了援助术和定身术
    expect(party.a.spells?.slots[1].max).toBe(4);
    expect(party.a.spells?.slots[2].max).toBe(2);
    expect(party.a.spells?.known).toEqual(expect.arrayContaining(['aid', 'hold_person', 'healing_word', 'guiding_bolt']));
    expect(party.a.maxHp).toBe(27); // 8+3 + 2×(5+3)
    // 野蛮人：3 级 = 狂暴 3 次，狂战士
    expect(party.b.maxHp).toBe(38); // 12+4 + 2×(7+4)
    expect(party.b.resources.rage?.max).toBe(3);
    expect(party.b.features).toEqual(expect.arrayContaining(['frenzy', 'reckless_attack']));
  });

  it('没指定套 / 指定的套里没有这个座位：读原来的 1 级卡', () => {
    expect(loadParty(vault()).a.level).toBe(1);
    expect(loadParty(vault(), 'no-such-set').a.level).toBe(1);
  });

  it('原来的 1 级 json 没被动', () => {
    const base = readBuildSpec(vault(), 'player_a');
    expect(base?.classes[0].level).toBe(1);
    expect(readBuildSpec(vault(), 'player_a', 'lv3')?.classes[0].level).toBe(3);
  });
});

describe('levelUpActor', () => {
  it('3 → 4 级：属性提升、HP、法术位按新等级，当前 HP / 已用法术位 / 状态 / 位置 / 人设都保留', () => {
    const party = loadParty(vault(), 'lv3');
    const a = party.a;
    a.persona = '测试人设';
    a.position = { col: 7, row: 9 };
    a.hp = 20;
    a.xp = 2700;
    a.spells!.slots[1].used = 3;
    a.spells!.slots[2].used = 1;
    a.conditions.push({ name: 'poisoned' });
    const wisBefore = a.abilities.wis;
    const maxBefore = a.maxHp;

    const res = levelUpActor(a, readBuildSpec(vault(), 'player_a', 'lv3')!);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.outcome).toMatchObject({ fromLevel: 3, toLevel: 4 });
    expect(a.level).toBe(4);
    expect(a.maxHp).toBe(maxBefore + 8); // d8 平均 5 + 体质调整值 3
    expect(res.outcome.hpGain).toBe(8);
    expect(a.hp).toBe(28); // 20 + 8
    expect(a.abilities.wis).toBe(wisBefore + 2); // 4 级属性提升：主属性 +2
    expect(a.spells?.slots[1]).toEqual({ max: 4, used: 3 });
    expect(a.spells?.slots[2]).toEqual({ max: 3, used: 1 });
    expect(a.conditions).toEqual([{ name: 'poisoned' }]);
    expect(a.position).toEqual({ col: 7, row: 9 });
    expect(a.persona).toBe('测试人设');
    expect(a.xp).toBe(2700);
    expect(a.name).toBe('维斯坡伊');
    expect(a.id).toBe('player_a');
    expect(a.hitDice.total).toBe(4);
  });

  it('倒下（HP 0）时升级：最大 HP 涨，当前 HP 不动', () => {
    const party = loadParty(vault(), 'lv3');
    const b = party.b;
    b.hp = 0;
    b.deathSaves.successes = 1;
    const res = levelUpActor(b, readBuildSpec(vault(), 'player_b', 'lv3')!);
    expect(res.ok).toBe(true);
    expect(b.level).toBe(4);
    expect(b.hp).toBe(0);
    expect(b.deathSaves.successes).toBe(1);
    expect(b.maxHp).toBe(38 + 11);
  });

  it('已经用掉的资源保留（狂暴 3 次用掉 2 次，升到 5 级狂暴 3 次、用掉的还是 2 次）', () => {
    const party = loadParty(vault(), 'lv3');
    const b = party.b;
    b.resources.rage.used = 2;
    const spec = readBuildSpec(vault(), 'player_b', 'lv3')!;
    expect(levelUpActor(b, spec).ok).toBe(true); // 4 级：还是 3 次
    expect(b.resources.rage).toMatchObject({ max: 3, used: 2 });
    expect(levelUpActor(b, spec).ok).toBe(true); // 5 级：额外攻击、速度，狂暴 3 次
    expect(b.level).toBe(5);
    expect(b.resources.rage.used).toBe(2);
    expect(b.attacksPerAction).toBe(2);
  });

  it('20 级不再升；没职业的 build 不动 Actor', () => {
    const party = loadParty(vault(), 'lv3');
    const spec = readBuildSpec(vault(), 'player_a', 'lv3')!;
    party.a.level = 20;
    expect(levelUpActor(party.a, spec)).toMatchObject({ ok: false });
    expect(levelUpActor(party.b, { ...readBuildSpec(vault(), 'player_b', 'lv3')!, classes: [] })).toMatchObject({ ok: false });
    expect(party.b.level).toBe(3);
  });
});

describe('读档时的人设', () => {
  it('以角色卡文件现在写的为准，存档里的旧人设不会盖过它；HP 等状态仍来自存档', async () => {
    const root = projectRoot();
    const dir = mkdtempSync(join(tmpdir(), 'trpg-persona-'));
    const config = loadConfig(root);
    config.paths.state = join(dir, 'state');
    config.paths.logs = join(dir, 'logs');
    config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
    config.table.characterSet = 'lv3';
    const logs = createLogs(dir);
    const make = (persona?: string) => {
      const party = loadParty(config.paths.campaignVault, 'lv3');
      if (persona) party.a.persona = persona;
      return {
        party,
        loop: new TableLoop({
          config,
          llm: new FakeLLM(config, logs),
          logs,
          adventure: loadAdventure(config.paths.campaignVault, 'phandalin-road'),
          characters: { player_a: party.a, player_b: party.b },
          rollSource: new LocalRollSource(mulberry32(7)),
          dryRun: true,
          resume: true,
        }),
      };
    };
    // 先用「旧人设」开一局、打掉点血、存档
    const first = make('旧人设：对谁都叫尊贵的客人');
    await first.loop.init();
    // init 自己也会存一次档（异步写）：先等它写完，再改 HP 存第二次——两次写同一个临时文件会互相踩，全套并行跑时偶尔丢掉第二次
    const statePath = join(config.paths.state, 'table.json');
    const readHp = (): number | null => {
      try {
        const snap = JSON.parse(readFileSync(statePath, 'utf8')) as { rules?: { actors?: { id: string; hp: number }[] } };
        return snap.rules?.actors?.find((x) => x.id === 'player_a')?.hp ?? null;
      } catch {
        return null; // 还没写好
      }
    };
    const deadline = Date.now() + 8000;
    while (readHp() === null) {
      if (Date.now() > deadline) throw new Error('开局的存档一直没写出来');
      await new Promise((r) => setTimeout(r, 50));
    }
    first.party.a.hp = 9;
    // 写进了 HP 9 才算数；没写进就再存一次（save 是幂等的）
    for (let tries = 0; readHp() !== 9; tries++) {
      if (Date.now() > deadline) throw new Error('存档一直没写进 HP 9');
      if (tries % 10 === 0) first.loop.save();
      await new Promise((r) => setTimeout(r, 50));
    }
    // 再读档：角色卡文件里的人设是新的
    const second = make();
    await second.loop.init();
    const a = second.loop.engine.get('player_a')!;
    expect(a.hp).toBe(9); // 状态来自存档
    expect(a.persona).toContain('不认识的人、NPC 和敌人');
    expect(a.persona).not.toContain('旧人设');
    expect(second.loop.characters.player_a.persona).toBe(a.persona);
  });
});

describe('TableLoop.grantCombatRewards', () => {
  function makeLoop() {
    const root = projectRoot();
    const dir = mkdtempSync(join(tmpdir(), 'trpg-xp-'));
    const config = loadConfig(root);
    config.paths.state = join(dir, 'state');
    config.paths.logs = join(dir, 'logs');
    config.table.pacing = { tThought: 0, tDecision: 0, tBetween: 0, tReact: 0, tScene: 0, tResolve: 0 };
    config.table.startPaused = true;
    config.table.characterSet = 'lv3';
    const logs = createLogs(dir);
    const party = loadParty(config.paths.campaignVault, 'lv3');
    const loop = new TableLoop({
      config,
      llm: new FakeLLM(config, logs),
      logs,
      adventure: loadAdventure(config.paths.campaignVault, 'phandalin-road'),
      characters: { player_a: party.a, player_b: party.b },
      rollSource: new LocalRollSource(mulberry32(7)),
      dryRun: true,
      resume: false,
    });
    return { loop, party };
  }

  it('击败怪物 → 发经验、到线的自动升级、发 xp / level_up 事件，结果文字给 GM', async () => {
    const { loop, party } = makeLoop();
    await loop.init();
    party.a.xp = 2690; // 差 10 点到 4 级
    for (const n of ['g1', 'g2']) {
      const m = spawnMonster('goblin', n);
      m.hp = 0;
      loop.engine.addActor(m);
    }
    const text = await loop.grantCombatRewards();
    expect(text).toContain('共 100 经验，每人 50');
    expect(text).toContain('维斯坡伊 经验 2740；升到 4 级');
    expect(text).toContain('萨珀特菲 经验 950（下一级 2700）');
    expect(party.a.level).toBe(4);
    expect(party.b.level).toBe(3);
    const events = loop.eventsAfter(0).events;
    expect(events.map((e) => e.kind)).toEqual(expect.arrayContaining(['xp', 'level_up']));
    const up = events.find((e) => e.kind === 'level_up');
    expect(up?.data).toMatchObject({ seat: 'player_a', level: 4 });
    // 再调一次：什么都不发
    expect(await loop.grantCombatRewards()).toBe('');
    expect(party.a.xp).toBe(2740);
  });

  it('GM 的剧情经验：award_xp 同一条路径；一次发够可以连升两级', async () => {
    const { loop, party } = makeLoop();
    await loop.init();
    const text = await loop.grantStoryXp(2 * (6500 - 900), '解决了矿坑的事'); // 每人 +5600 → 6500 = 5 级
    expect(text).toContain('升到 4 级');
    expect(text).toContain('升到 5 级');
    expect(party.a.level).toBe(5);
    expect(party.b.level).toBe(5);
    expect(await loop.grantStoryXp(-5, '不对')).toContain('没有发经验');
  });
});
