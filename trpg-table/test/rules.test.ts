import { describe, expect, it } from 'vitest';
import { LocalRollSource, doubleDiceFormula, formulaAverage, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { actorFromCharacter, makeDefaultParty } from '../src/rules/sheet.js';
import type { Actor, MapInfo } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

function setup() {
  const rolls = new ScriptedRollSource();
  const engine = new RulesEngine({ rollSource: rolls });
  const { a, b } = makeDefaultParty();
  engine.addActor(a);
  engine.addActor(b);
  return { engine, rolls, a, b };
}

function addWizard(engine: RulesEngine): Actor {
  const w = actorFromCharacter(
    {
      name: '测试法师',
      level: 3,
      abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
      saves: ['int', 'wis'],
      skills: ['arcana', 'investigation'],
      ac: 12,
      maxHp: 20,
      attacks: [{ weaponId: 'dagger' }],
      spells: {
        ability: 'int',
        known: ['magic_missile', 'shield', 'fire_bolt', 'hold_person', 'bless'],
        slots: { '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } },
      },
      hitDice: { die: 6, total: 3 },
    },
    'wizard',
    'player_a'
  );
  engine.addActor(w);
  return w;
}

describe('骰子', () => {
  it('d20 分布接近均匀，均值约 10.5', async () => {
    const src = new LocalRollSource(mulberry32(12345));
    const counts = new Array(21).fill(0) as number[];
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const r = await src.roll({ formula: '1d20', label: 'test' });
      counts[r.total] += 1;
      sum += r.total;
    }
    expect(sum / 20000).toBeGreaterThan(10.1);
    expect(sum / 20000).toBeLessThan(10.9);
    for (let face = 1; face <= 20; face++) {
      expect(counts[face]).toBeGreaterThan(800);
      expect(counts[face]).toBeLessThan(1200);
    }
  });

  it('优势均值约 13.8，劣势约 7.2', async () => {
    const adv = new LocalRollSource(mulberry32(7));
    const dis = new LocalRollSource(mulberry32(7));
    let a = 0;
    let d = 0;
    for (let i = 0; i < 12000; i++) {
      a += (await adv.roll({ formula: '2d20kh1', label: 'adv' })).total;
      d += (await dis.roll({ formula: '2d20kl1', label: 'dis' })).total;
    }
    expect(a / 12000).toBeGreaterThan(13.2);
    expect(a / 12000).toBeLessThan(14.4);
    expect(d / 12000).toBeGreaterThan(6.6);
    expect(d / 12000).toBeLessThan(7.8);
  });

  it('暴击翻倍伤害骰、不翻倍加值', () => {
    expect(doubleDiceFormula('2d6+3')).toBe('4d6+3');
    expect(doubleDiceFormula('1d8+2d6+3')).toBe('2d8+4d6+3');
    expect(formulaAverage('1d8+3')).toBe(7.5);
  });
});

describe('检定与豁免', () => {
  it('检定按 d20 + 调整值 对 DC 比较；自然 20 不自动成功', async () => {
    const { engine, rolls } = setup();
    rolls.d20.push(12);
    const ok = await engine.check('player_a', 'acrobatics', 15);
    // 敏捷 +3，熟练 +2 => +5，12+5=17
    expect(ok.total).toBe(17);
    expect(ok.success).toBe(true);

    rolls.d20.push(20);
    const impossible = await engine.check('player_a', 'athletics', 25);
    // 力量 +0，未熟练 => +0，20+0=20 < 25
    expect(impossible.natural).toBe(20);
    expect(impossible.success).toBe(false);
  });

  it('专精（expertise）加双倍熟练', async () => {
    const { engine, rolls } = setup();
    rolls.d20.push(10);
    const r = await engine.check('player_a', 'stealth', 20);
    // 敏捷 +3，专精 +4 => +7，10+7=17
    expect(r.total).toBe(17);
    expect(r.success).toBe(false);
  });

  it('豁免加熟练；麻痹时力量/敏捷豁免自动失败', async () => {
    const { engine, rolls, b } = setup();
    rolls.d20.push(10);
    const save = await engine.save('player_b', 'wis', 13);
    // 感知 +3，熟练 +2 => +5，10+5=15
    expect(save.total).toBe(15);
    expect(save.success).toBe(true);

    engine.applyCondition('player_b', 'paralyzed');
    const auto = await engine.save('player_b', 'dex', 10);
    expect(auto.success).toBe(false);
    expect(auto.dice).toEqual([]);
    expect(auto.label).toContain('自动失败');
    expect(b.conditions.map((c) => c.name)).toContain('paralyzed');
  });

  it('中毒：属性检定劣势，豁免不受影响（SRD：中毒只管攻击检定和属性检定）', async () => {
    const { engine, rolls } = setup();
    engine.applyCondition('player_a', 'poisoned');
    rolls.d20.push(18);
    const save = await engine.save('player_a', 'con', 12);
    expect(save.advantage).toBe('none');
    expect(save.total).toBe(18 + 2);

    rolls.d20.push(18, 3);
    const check = await engine.check('player_a', 'perception', 12);
    expect(check.advantage).toBe('dis');
    expect(check.natural).toBe(3);
  });
});

describe('攻击', () => {
  it('命中、伤害、目标倒地', async () => {
    const { engine, rolls } = setup();
    engine.addActor(spawnMonster('goblin', '地精1'));
    rolls.d20.push(15);
    const r = await engine.attack('player_a', 'goblin:地精1', 'rapier', { sneakAttack: false });
    // 15 + 5 = 20 >= AC 15；伤害 1d8+3 取最大 = 11
    expect(r.hit).toBe(true);
    expect(r.crit).toBe(false);
    expect(r.damage?.formula).toContain('1d8');
    expect(r.damage?.total).toBe(11);
    expect(engine.require('goblin:地精1').hp).toBe(0);
    expect(r.targetDown).toBe(true);
  });

  it('未命中、自然 1 必定失手、自然 20 暴击', async () => {
    const { engine, rolls } = setup();
    engine.addActor(spawnMonster('goblin', '地精2'));
    rolls.d20.push(2);
    const miss = await engine.attack('player_a', 'goblin:地精2', 'rapier');
    expect(miss.hit).toBe(false);

    engine.beginTurn('player_a');
    rolls.d20.push(1);
    const fumble = await engine.attack('player_a', 'goblin:地精2', 'rapier');
    expect(fumble.hit).toBe(false);
    expect(fumble.fumble).toBe(true);

    engine.beginTurn('player_a');
    rolls.d20.push(20);
    const crit = await engine.attack('player_a', 'goblin:地精2', 'rapier');
    expect(crit.crit).toBe(true);
    expect(crit.damage?.formula).toContain('2d8');
    expect(crit.damage?.total).toBe(19); // 2d8 取最大 16 + 3
  });

  it('优势时偷袭附加 2d6，且每回合只能用一次', async () => {
    const { engine, rolls, a } = setup();
    engine.addActor(spawnMonster('bandit', '强盗1'));
    rolls.d20.push(18, 4);
    const r = await engine.attack('player_a', 'bandit:强盗1', 'rapier', { advantage: 'adv' });
    expect(r.hit).toBe(true);
    expect(r.sneakAttack).toBe(true);
    expect(r.damage?.formula).toContain('2d6');
    expect(a.turn.sneakUsed).toBe(true);
  });

  it('抗性减半、临时生命先扣', async () => {
    const { engine, rolls } = setup();
    engine.addActor(spawnMonster('swarm_of_rats', '鼠群'));
    rolls.d20.push(15);
    const r = await engine.attack('player_a', 'swarm_of_rats:鼠群', 'rapier', { sneakAttack: false });
    // 11 点穿刺，抗性减半 => 5
    expect(r.appliedDamage).toBe(5);

    const goblin = spawnMonster('goblin', '地精3');
    goblin.tempHp = 5;
    engine.addActor(goblin);
    const applied = await engine.damage('goblin:地精3', 8, 'slashing');
    expect(applied).toBe(8);
    expect(goblin.tempHp).toBe(0);
    expect(goblin.hp).toBe(4);
  });

  it('护盾术的 AC 加值能让攻击落空', async () => {
    const { engine, rolls, b } = setup();
    engine.addActor(spawnMonster('goblin', '地精4'));
    b.effects.push({
      id: 'shield-1',
      spellId: 'shield',
      name: '护盾术',
      concentration: false,
      acBonus: 5,
      rounds: 1,
    });
    expect(engine.acOf(b)).toBe(23);
    rolls.d20.push(18);
    const r = await engine.attack('goblin:地精4', 'player_b', { attackBonus: 4, damage: '1d6+2', damageType: 'slashing' });
    // 18+4=22 < 23
    expect(r.hit).toBe(false);
  });
});

describe('法术位、专注与法术结算', () => {
  it('魔法飞弹消耗法术位，升环多一枚飞弹', async () => {
    const { engine, rolls } = setup();
    const w = addWizard(engine);
    engine.addActor(spawnMonster('goblin', '地精5'));
    const r1 = await engine.castSpell('wizard', 'magic_missile', 1, ['goblin:地精5']);
    expect(r1.ok).toBe(true);
    expect(r1.slotUsed).toBe(true);
    expect(w.spells?.slots[1].used).toBe(1);
    const dmg1 = r1.rolls.find((r) => r.kind === 'damage');
    expect(dmg1?.formula).toBe('3d4+3');
    expect(dmg1?.total).toBe(15);

    engine.beginTurn('wizard');
    const r2 = await engine.castSpell('wizard', 'magic_missile', 2, ['goblin:地精5']);
    expect(r2.ok).toBe(true);
    expect(w.spells?.slots[2].used).toBe(1);
    expect(r2.rolls.find((r) => r.kind === 'damage')?.formula).toBe('4d4+4');
  });

  it('没有法术位时拒绝施法', async () => {
    const { engine, rolls } = setup();
    const w = addWizard(engine);
    w.spells!.slots[1].used = 4;
    const r = await engine.castSpell('wizard', 'magic_missile', 1, []);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('法术位');
    expect(rolls.calls).toHaveLength(0);
  });

  it('定身人类：豁免失败麻痹，成功则不麻痹', async () => {
    const { engine, rolls } = setup();
    const w = addWizard(engine);
    engine.addActor(spawnMonster('bandit', '强盗2'));
    // 先攻不需要
    rolls.d20.push(3); // 强盗 WIS -0 => 3 < DC 13
    const fail = await engine.castSpell('wizard', 'hold_person', 2, ['bandit:强盗2']);
    expect(fail.ok).toBe(true);
    expect(engine.require('bandit:强盗2').conditions.map((c) => c.name)).toContain('paralyzed');
    expect(w.concentration?.spellId).toBe('hold_person');

    engine.beginTurn('wizard');
    engine.addActor(spawnMonster('bandit', '强盗3'));
    rolls.d20.push(19);
    const ok = await engine.castSpell('wizard', 'hold_person', 2, ['bandit:强盗3']);
    expect(ok.ok).toBe(true);
    expect(engine.require('bandit:强盗3').conditions.map((c) => c.name)).not.toContain('paralyzed');
  });

  it('新的专注法术会结束旧的专注并移除其效果', async () => {
    const { engine, rolls } = setup();
    const w = addWizard(engine);
    engine.beginTurn('wizard');
    const bless = await engine.castSpell('wizard', 'bless', 1, ['wizard']);
    expect(bless.ok).toBe(true);
    expect(w.effects.some((e) => e.spellId === 'bless')).toBe(true);

    engine.beginTurn('wizard');
    engine.addActor(spawnMonster('bandit', '强盗4'));
    rolls.d20.push(2);
    const hold = await engine.castSpell('wizard', 'hold_person', 2, ['bandit:强盗4']);
    expect(hold.ok).toBe(true);
    expect(w.effects.some((e) => e.spellId === 'bless')).toBe(false);
    expect(w.concentration?.spellId).toBe('hold_person');
  });

  it('受到伤害时要掷专注豁免，失败则专注结束', async () => {
    const { engine, rolls, b } = setup();
    engine.beginTurn('player_b');
    const bless = await engine.castSpell('player_b', 'bless', 1, ['player_a', 'player_b']);
    expect(bless.ok).toBe(true);
    expect(b.concentration).not.toBeNull();

    rolls.d20.push(2); // 体质 +2，DC 10 => 失败
    await engine.damage('player_b', 9, 'slashing');
    expect(b.concentration).toBeNull();
    expect(b.effects.some((e) => e.spellId === 'bless')).toBe(false);
  });

  it('治疗伤害：1d8 + 感知 + 生命领域加成', async () => {
    const { engine } = setup();
    const a = engine.require('player_a');
    a.hp = 5;
    engine.beginTurn('player_b');
    const r = await engine.castSpell('player_b', 'cure_wounds', 1, ['player_a']);
    // 1d8 取最大 8 + 感知 3 + 生命领域 (2+1)=3 => 14
    expect(r.ok).toBe(true);
    expect(r.heal).toBe(14);
    expect(a.hp).toBe(19);
  });
});

describe('战斗', () => {
  it('先攻按总值排序，同值比敏捷', async () => {
    const { engine, rolls } = setup();
    engine.addActor(spawnMonster('goblin', '地精6'));
    rolls.d20.push(15, 10, 10, 5);
    const order = await engine.startCombat(['player_a', 'player_b', 'goblin:地精6']);
    expect(order[0].actorId).toBe('player_a'); // 15+3
    expect(order[1].actorId).toBe('goblin:地精6'); // 10+2
    expect(order[2].actorId).toBe('player_b'); // 10-1
    expect(engine.combat.active).toBe(true);
  });

  it('nextTurn 轮转，绕一圈回合数 +1', async () => {
    const { engine, rolls } = setup();
    rolls.d20.push(10, 10);
    await engine.startCombat(['player_a', 'player_b']);
    expect(engine.combat.round).toBe(1);
    expect(engine.nextTurn()).toBe('player_b');
    expect(engine.combat.round).toBe(1);
    expect(engine.nextTurn()).toBe('player_a');
    expect(engine.combat.round).toBe(2);
  });

  it('legalActions 反映动作与法术位', async () => {
    const { engine } = setup();
    const w = addWizard(engine);
    const all = engine.legalActions('wizard');
    expect(all.some((a) => a.kind === 'attack')).toBe(true);
    expect(all.some((a) => a.kind === 'cast' && a.spellId === 'magic_missile' && a.available)).toBe(true);
    w.spells!.slots[1].used = 4;
    const after = engine.legalActions('wizard');
    expect(after.find((a) => a.spellId === 'magic_missile')?.available).toBe(false);
    w.turn.actionUsed = true;
    expect(engine.legalActions('wizard').find((a) => a.kind === 'attack')?.available).toBe(false);
  });

  it('短休消耗生命骰、治疗、并恢复短休资源', async () => {
    const { engine, rolls, b } = setup();
    engine.addActor(spawnMonster('goblin', '地精7'));
    const a = engine.require('player_a');
    a.hp = 5;
    b.resources.channel_divinity.used = 1;
    rolls.d20.push(10); // 不需要，但保险
    const r = await engine.shortRest(['player_a', 'player_b'], 1);
    expect(a.hitDice.used).toBe(1);
    expect(a.hp).toBe(15); // 5 + (1d8 最大 8 + 体质 2)
    expect(b.resources.channel_divinity.used).toBe(0);
    expect(r.find((x) => x.actorId === 'player_a')?.healed).toBe(10);
  });
});

describe('位置与近战距离', () => {
  function positioned() {
    const h = setup();
    h.a.position = { col: 3, row: 3 };
    h.b.position = { col: 5, row: 3 };
    h.engine.ensurePositions();
    const goblin = spawnMonster('goblin', '地精8');
    goblin.position = { col: 10, row: 10 };
    h.engine.addActor(goblin);
    return { ...h, goblin };
  }

  it('距离超过 5 尺的近战直接拒绝（不掷骰）', async () => {
    const { engine, rolls, goblin } = positioned();
    rolls.d20.push(15);
    await expect(engine.attack('player_a', goblin.id, 'rapier')).rejects.toThrow(/近战需要先贴近/);
    expect(rolls.calls).toHaveLength(0);
  });

  it('速度范围内自动贴近到相邻格，然后才允许近战', async () => {
    const { engine, rolls, a, goblin } = positioned();
    const ap = engine.approachTarget('player_a', goblin.id);
    expect(ap.ok).toBe(true);
    expect(ap.movedCells).toBe(6);
    expect(a.position).toEqual({ col: 9, row: 9 });
    expect(engine.distanceCells(a.position!, goblin.position!)).toBe(1);
    expect(a.turn.movementUsed).toBe(30);
    rolls.d20.push(15);
    const hit = await engine.attack('player_a', goblin.id, 'rapier');
    expect(hit.attack.kind).toBe('attack');
  });

  it('速度不够时整次行动非法，位置不动', async () => {
    const { engine, a, goblin } = positioned();
    goblin.position = { col: 20, row: 20 };
    const before = { ...a.position! };
    const ap = engine.approachTarget('player_a', goblin.id);
    expect(ap.ok).toBe(false);
    expect(ap.reason).toMatch(/够不到/);
    expect(a.position).toEqual(before);
    expect(a.turn.movementUsed).toBe(0);
  });

  it('legalActions 给出可达格子和近战射程说明', () => {
    const { engine } = positioned();
    engine.beginTurn('player_a');
    const acts = engine.legalActions('player_a');
    expect(acts.find((x) => x.kind === 'move')?.detail).toMatch(/可到 .*尺/);
    expect(acts.find((x) => x.kind === 'move')?.detail).not.toMatch(/可到 \(\d+,\d+\)/);
    expect(acts.find((x) => x.kind === 'attack')?.detail).toMatch(/近战（需要相邻，5 尺）/);
  });

  it('活人不能叠在同一格：moveTo / setPosition 拒绝，approachTarget 停在空着的相邻格', () => {
    const { engine, a, b, goblin } = positioned();
    // 自己人的格子不能停
    const stack = engine.moveTo('player_a', { ...b.position! }, { maxCells: Infinity });
    expect(stack.ok).toBe(false);
    expect(stack.reason).toMatch(/已经站着/);
    expect(a.position).toEqual({ col: 3, row: 3 });
    expect(() => engine.setPosition('player_a', { ...goblin.position! })).toThrow(/已经站着/);

    // 贴近目标时，相邻格被占就换一个空的
    goblin.position = { col: 6, row: 3 }; // 布拉姆在 (5,3)，和地精紧挨着
    const ap = engine.approachTarget('player_a', goblin.id);
    expect(ap.ok).toBe(true);
    expect(engine.occupiedBy(a.position!, 'player_a')).toBeNull();
    expect(engine.distanceCells(a.position!, goblin.position!)).toBe(1);
    expect(a.position).not.toEqual(b.position);
  });

  it('倒下的怪不占格；已经叠在一起的残局，approachTarget 会让它走到相邻格', () => {
    const { engine, a, goblin } = positioned();
    goblin.position = { col: 3, row: 3 }; // 叠在薇克丝身上（老存档里出现过）
    expect(engine.distanceCells(a.position!, goblin.position!)).toBe(0);
    const ap = engine.approachTarget('player_a', goblin.id);
    expect(ap.ok).toBe(true);
    expect(engine.distanceCells(a.position!, goblin.position!)).toBe(1);

    goblin.hp = 0;
    expect(engine.occupiedBy(goblin.position!, 'player_b')).toBeNull();
  });

  it('位置写进存档并能恢复', () => {
    const { engine, a } = positioned();
    const snap = engine.snapshot() as Parameters<RulesEngine['load']>[0];
    const other = new RulesEngine({ rollSource: new ScriptedRollSource() });
    other.load(snap);
    expect(other.positionOf('player_a')).toEqual(a.position);
  });
});

describe('地图信息：可站立区域、水面、障碍与地标', () => {
  function deckMap(): MapInfo {
    return {
      standable: [
        { name: '甲板', kind: 'deck', polygon: [[2.71, 2.14], [18.64, 3.5], [16.86, 12.29], [1.64, 11.0]] },
      ],
      water: [{ name: '海面', polygon: [[0, 0], [20, 0], [20, 14.3], [0, 14.3]] }],
      blocked: [
        { name: '货箱 A', cells: { col: [4, 5], row: [4, 5] } },
        { name: '桅杆底座', cells: { col: [10, 12], row: [5, 6] } },
      ],
      landmarks: [{ name: '货舱口', cells: { col: [5, 8], row: [7, 9] }, note: '半开的货舱口' }],
    };
  }

  function mapped(map = deckMap()) {
    const h = setup();
    h.a.position = { col: 4, row: 3 };
    h.b.position = { col: 6, row: 3 };
    h.engine.setMapInfo(map);
    return h;
  }

  it('甲板能站；海面只有游泳速度 > 0 能站；障碍不能站', () => {
    const { engine, a } = mapped();
    const sahuagin = spawnMonster('sahuagin', '鱼人');
    expect(sahuagin.swimSpeed).toBe(40);
    expect(engine.canStandAt(a, { col: 4, row: 3 })).toBe(true);
    expect(engine.canStandAt(a, { col: 0, row: 0 })).toBe(false); // 海面
    expect(engine.canStandAt(sahuagin, { col: 0, row: 0 })).toBe(true); // 会游泳
    expect(engine.canStandAt(a, { col: 4, row: 4 })).toBe(false); // 货箱
    expect(engine.canStandAt(a, { col: 10, row: 5 })).toBe(false); // 桅杆底座
  });

  it('setPosition 拒绝水面/障碍/越界，不悄悄夹格子', () => {
    const { engine, a } = mapped();
    expect(() => engine.setPosition('player_a', { col: 0, row: 0 })).toThrow(/不能站在/);
    expect(() => engine.setPosition('player_a', { col: 4, row: 4 })).toThrow(/不能站在/);
    expect(() => engine.setPosition('player_a', { col: 99, row: 99 })).toThrow(/边界外/);
    expect(a.position).toEqual({ col: 4, row: 3 });
  });

  it('货舱 / 洞穴里被水洼盖住的地面，只有会游泳的能站', () => {
    const { engine, a } = mapped({
      standable: [{ name: '货舱地板', polygon: [[0, 0], [20, 0], [20, 14.3], [0, 14.3]] }],
      water: [{ name: '水洼', polygon: [[9, 1], [16, 1], [16, 3], [9, 3]] }],
      blocked: [],
      landmarks: [],
    });
    const sahuagin = spawnMonster('sahuagin', '鱼人2');
    expect(engine.canStandAt(a, { col: 10, row: 2 })).toBe(false);
    expect(engine.canStandAt(sahuagin, { col: 10, row: 2 })).toBe(true);
    expect(engine.canStandAt(a, { col: 3, row: 3 })).toBe(true);
  });

  it('moveTo 用 BFS 绕过障碍、按 maxCells 拒绝且不移动', () => {
    const { engine, a } = mapped({
      standable: [{ name: '地面', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
      water: [{ name: '背景水', polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      blocked: [{ name: '墙', cells: { col: [5, 5], row: [0, 6] } }],
      landmarks: [],
    });
    a.position = { col: 2, row: 2 };
    const rejected = engine.moveTo('player_a', { col: 8, row: 2 }, { maxCells: 6 });
    expect(rejected.ok).toBe(false);
    expect(rejected.reason).toMatch(/最多还能走/);
    expect(a.position).toEqual({ col: 2, row: 2 });
    expect(a.turn.movementUsed).toBe(0);

    const ok = engine.moveTo('player_a', { col: 8, row: 2 }, { maxCells: Infinity });
    expect(ok.ok).toBe(true);
    expect(ok.cells).toBeGreaterThan(6);
    expect(a.position).toEqual({ col: 8, row: 2 });
    expect(a.turn.movementUsed).toBe(ok.cells * 5);
    expect(ok.path.every((c) => engine.canStandAt(a, c))).toBe(true);
    expect(ok.path).not.toContainEqual({ col: 5, row: 2 });
  });

  it('reachableCells 过滤掉水和障碍', () => {
    const { engine, a } = mapped();
    a.position = { col: 4, row: 3 };
    const cells = engine.reachableCells(a, 50);
    expect(cells.length).toBeGreaterThan(0);
    expect(cells.every((c) => engine.canStandAt(a, c))).toBe(true);
    expect(cells).not.toContainEqual({ col: 0, row: 0 });
    expect(cells).not.toContainEqual({ col: 4, row: 4 });
  });

  it('approachTarget 只走合法格；被墙隔开时整次失败、位置不动', () => {
    const { engine, a } = mapped({
      standable: [{ name: '地面', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]] }],
      water: [{ name: '背景水', polygon: [[0, 0], [20, 0], [20, 20], [0, 20]] }],
      blocked: [{ name: '墙', cells: { col: [5, 5], row: [0, 9] } }],
      landmarks: [],
    });
    a.position = { col: 2, row: 2 };
    const goblin = spawnMonster('goblin', '墙后的地精');
    goblin.position = { col: 8, row: 2 };
    engine.addActor(goblin);
    const ap = engine.approachTarget('player_a', goblin.id);
    expect(ap.ok).toBe(false);
    expect(ap.reason).toMatch(/找不到|够不到/);
    expect(a.position).toEqual({ col: 2, row: 2 });
  });

  it('describeCell 用地标 + 方位 + 原始格 + 尺数', () => {
    const { engine } = mapped();
    expect(engine.describeCell({ col: 5, row: 5 }, { col: 5, row: 2 })).toBe('货舱口北沿 (5,5)，15 尺');
    expect(engine.describeCell({ col: 6, row: 8 })).toBe('货舱口内 (6,8)');
    expect(engine.describeCell({ col: 1, row: 1 })).toMatch(/货舱口|海面|空地/);
  });
});
