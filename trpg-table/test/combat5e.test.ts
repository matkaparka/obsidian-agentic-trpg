import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { applyDeathSaveRoll, freshDeathTrack, isMassiveDamage, onDamageAtZero } from '../src/rules/logic/death.js';
import { attackContext, mergeAdvantage, exhaustionSpeed } from '../src/rules/logic/conditions.js';
import { damageAdjust } from '../src/rules/logic/damage.js';
import { leavesReachAt, isFlanking, squaresBetween } from '../src/rules/logic/reach.js';
import { plannedSwings } from '../src/rules/logic/routines.js';
import { makeDefaultParty, actorFromCharacter } from '../src/rules/sheet.js';
import type { Actor, MapInfo } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

/** 两名 PC 站在 (5,5) 和 (4,5)；其它角色自己放。 */
function world(opts: { opportunityAttacks?: boolean; flanking?: boolean } = {}) {
  const rolls = new ScriptedRollSource();
  const engine = new RulesEngine({ rollSource: rolls, ...opts });
  const { a, b } = makeDefaultParty();
  a.position = { col: 5, row: 5 };
  b.position = { col: 4, row: 5 };
  engine.addActor(a);
  engine.addActor(b);
  return { engine, rolls, a, b };
}

/** 默认把怪的 HP 调到 200，免得一次命中就死、后面的断言打在尸体上。 */
function place(engine: RulesEngine, monsterId: string, label: string, col: number, row: number, hp = 200): Actor {
  const m = spawnMonster(monsterId, label);
  m.hp = hp;
  m.maxHp = hp;
  m.position = { col, row };
  engine.addActor(m);
  return m;
}

function startFight(engine: RulesEngine, order: string[]) {
  engine.combat = {
    active: true,
    round: 1,
    order: order.map((actorId) => ({ actorId, initiative: 10, dex: 10 })),
    index: 0,
  };
  for (const id of order) engine.beginTurn(id);
}

const wholeMap = (blocked: MapInfo['blocked'] = []): MapInfo => ({
  standable: [
    {
      name: '场地',
      polygon: [
        [0, 0],
        [32, 0],
        [32, 24],
        [0, 24],
      ],
    },
  ],
  water: [],
  blocked,
  landmarks: [],
});

describe('logic/death 纯函数', () => {
  it('重伤即死：溢出 ≥ 最大 HP', () => {
    expect(isMassiveDamage(24, 24)).toBe(true);
    expect(isMassiveDamage(23, 24)).toBe(false);
  });

  it('0 HP 再受伤：失败 +1，暴击 +2，稳定被打破，3 次死亡', () => {
    expect(onDamageAtZero(freshDeathTrack(), false).failures).toBe(1);
    expect(onDamageAtZero(freshDeathTrack(), true).failures).toBe(2);
    const stable = { successes: 0, failures: 0, stable: true, dead: false };
    expect(onDamageAtZero(stable, false)).toMatchObject({ stable: false, failures: 1 });
    expect(onDamageAtZero({ successes: 0, failures: 2, stable: false, dead: false }, false).dead).toBe(true);
  });

  it('死亡豁免：20 醒来，1 两次失败，10 成功，三次成功稳定且计数清零', () => {
    const t = freshDeathTrack();
    expect(applyDeathSaveRoll(t, 20).outcome).toBe('revive');
    expect(applyDeathSaveRoll(t, 1).track.failures).toBe(2);
    expect(applyDeathSaveRoll(t, 9, 9).outcome).toBe('failure');
    expect(applyDeathSaveRoll(t, 10, 10).outcome).toBe('success');
    // 祝福术让总值 ≥10：看总值，不看自然点数
    expect(applyDeathSaveRoll(t, 8, 12).outcome).toBe('success');
    const two = { successes: 2, failures: 1, stable: false, dead: false };
    const third = applyDeathSaveRoll(two, 15);
    expect(third.outcome).toBe('stable');
    expect(third.track).toEqual({ successes: 0, failures: 0, stable: true, dead: false });
  });
});

describe('logic/conditions 纯函数', () => {
  it('优势劣势只要各有一个就抵消，不管几个', () => {
    expect(mergeAdvantage(['adv', 'dis', 'adv'])).toBe('none');
    expect(mergeAdvantage(['dis', 'adv', 'adv', 'adv'])).toBe('none');
    expect(mergeAdvantage(['adv', 'none'])).toBe('adv');
  });

  it('attackContext：倒地近处优势远处劣势；麻痹贴身自动暴击；攻击者倒地所有攻击劣势', () => {
    const base = { attackerConditions: [], targetConditions: ['prone'], adjacent: true };
    expect(attackContext(base).advantage).toBe('adv');
    expect(attackContext({ ...base, adjacent: false }).advantage).toBe('dis');
    const para = attackContext({ attackerConditions: [], targetConditions: ['paralyzed'], adjacent: true });
    expect(para.autoCrit).toBe(true);
    expect(attackContext({ attackerConditions: [], targetConditions: ['paralyzed'], adjacent: false }).autoCrit).toBe(false);
    expect(attackContext({ attackerConditions: ['prone'], targetConditions: [], adjacent: true }).advantage).toBe('dis');
  });

  it('力竭：2 级速度减半，5 级速度 0', () => {
    expect(exhaustionSpeed(1, 30)).toBe(30);
    expect(exhaustionSpeed(2, 30)).toBe(15);
    expect(exhaustionSpeed(5, 30)).toBe(0);
  });
});

describe('logic/damage 与 reach 与 routines', () => {
  it('抗性减半向下取整，易伤翻倍，两者同在先减半再翻倍，免疫优先', () => {
    const none = { resistances: [], vulnerabilities: [], immunities: [] };
    expect(damageAdjust(25, 'fire', { ...none, resistances: ['fire'], vulnerabilities: ['fire'] }).amount).toBe(24);
    expect(damageAdjust(7, 'fire', { ...none, resistances: ['fire'] }).amount).toBe(3);
    expect(damageAdjust(7, 'fire', { ...none, resistances: ['fire'], immunities: ['fire'] }).amount).toBe(0);
  });

  it('非魔法抗性：魔法武器不吃', () => {
    const d = { resistances: [], vulnerabilities: [], immunities: [], resistancesNonmagical: ['slashing' as const] };
    expect(damageAdjust(10, 'slashing', d).amount).toBe(5);
    expect(damageAdjust(10, 'slashing', d, { magical: true }).amount).toBe(10);
  });

  it('leavesReachAt / isFlanking / squaresBetween', () => {
    const steps = [
      { col: 5, row: 5 },
      { col: 6, row: 5 },
      { col: 7, row: 5 },
      { col: 8, row: 5 },
    ];
    expect(leavesReachAt(steps, { col: 4, row: 5 }, 1)).toEqual({ col: 5, row: 5 });
    expect(leavesReachAt(steps, { col: 6, row: 6 }, 1)).toEqual({ col: 7, row: 5 });
    expect(leavesReachAt(steps, { col: 7, row: 6 }, 1)).toBeNull(); // 始终在触及内
    expect(leavesReachAt(steps, { col: 20, row: 5 }, 1)).toBeNull();
    expect(isFlanking({ col: 4, row: 4 }, { col: 5, row: 5 }, [{ col: 6, row: 6 }])).toBe(true);
    expect(isFlanking({ col: 4, row: 4 }, { col: 5, row: 5 }, [{ col: 6, row: 5 }])).toBe(false);
    expect(squaresBetween({ col: 0, row: 0 }, { col: 3, row: 0 })).toEqual([
      { col: 1, row: 0 },
      { col: 2, row: 0 },
    ]);
  });

  it('plannedSwings：套路里的攻击、换套路、单击', () => {
    const attacks = [{ name: '弯刀' }, { name: '匕首' }, { name: '匕首（投掷）' }];
    const routines = [
      [
        { attack: '弯刀', count: 2 },
        { attack: '匕首', count: 1 },
      ],
      [{ attack: '匕首（投掷）', count: 2 }],
    ];
    expect(plannedSwings(attacks, routines, undefined).map((s) => s.name)).toEqual(['弯刀', '弯刀', '匕首']);
    expect(plannedSwings(attacks, routines, '匕首（投掷）').map((s) => s.name)).toEqual(['匕首（投掷）', '匕首（投掷）']);
    expect(plannedSwings(attacks, undefined, '弯刀', 3).length).toBe(3);
  });
});

describe('倒地、死亡与死亡豁免', () => {
  it('打到 0 HP：昏迷 + 倒地 + 开始濒死；溢出不够大就不会即死', async () => {
    const { engine, a } = world();
    a.hp = 10;
    await engine.damage('player_a', 12, 'slashing');
    expect(a.hp).toBe(0);
    expect(a.deathSaves).toEqual({ successes: 0, failures: 0, stable: false, dead: false });
    expect(a.conditions.map((c) => c.name)).toEqual(expect.arrayContaining(['unconscious', 'prone']));
  });

  it('溢出伤害 ≥ 最大 HP 即死（HP 10 的人受 40 点，溢出 30 ≥ 24）', async () => {
    const { engine, a } = world();
    a.hp = 10;
    await engine.damage('player_a', 40, 'slashing');
    expect(a.deathSaves.dead).toBe(true);
    expect(a.hp).toBe(0);
  });

  it('已经在 0 HP：再受伤记失败（暴击两次），不是重置', async () => {
    const { engine, a } = world();
    a.hp = 1;
    await engine.damage('player_a', 2, 'slashing');
    await engine.damage('player_a', 3, 'slashing');
    expect(a.deathSaves.failures).toBe(1);
    await engine.damage('player_a', 3, 'slashing', '暴击', { crit: true });
    expect(a.deathSaves.failures).toBe(3);
    expect(a.deathSaves.dead).toBe(true);
  });

  it('已经在 0 HP：伤害 ≥ 最大 HP 直接死', async () => {
    const { engine, a } = world();
    a.hp = 0;
    a.deathSaves = freshDeathTrack();
    await engine.damage('player_a', 24, 'slashing');
    expect(a.deathSaves.dead).toBe(true);
  });

  it('怪物到 0 HP 直接死，不掷死亡豁免', async () => {
    const { engine } = world();
    const g = place(engine, 'goblin', '地精', 8, 5, 7);
    await engine.damage(g.id, 99, 'slashing');
    expect(g.deathSaves.dead).toBe(true);
    expect(engine.livingMonsters()).toHaveLength(0);
  });

  it('rollDeathSave：20 醒来 1 HP；1 两次失败；三次成功稳定；只有濒死的人能掷', async () => {
    const { engine, rolls, a } = world();
    await expect(engine.rollDeathSave('player_a')).rejects.toThrow('不需要');
    a.hp = 0;
    a.deathSaves = freshDeathTrack();
    a.conditions.push({ name: 'unconscious', source: 'dying' }, { name: 'prone', source: 'dying' });

    rolls.d20.push(1);
    const nat1 = await engine.rollDeathSave('player_a');
    expect(nat1.outcome).toBe('failure');
    expect(a.deathSaves.failures).toBe(2);

    rolls.d20.push(20);
    const revive = await engine.rollDeathSave('player_a');
    expect(revive.outcome).toBe('revive');
    expect(a.hp).toBe(1);
    expect(a.conditions.some((c) => c.name === 'unconscious')).toBe(false);
    expect(a.conditions.some((c) => c.name === 'prone')).toBe(true);

    a.hp = 0;
    a.deathSaves = freshDeathTrack();
    a.conditions.push({ name: 'unconscious', source: 'dying' });
    rolls.d20.push(12, 12, 12);
    await engine.rollDeathSave('player_a');
    await engine.rollDeathSave('player_a');
    const third = await engine.rollDeathSave('player_a');
    expect(third.outcome).toBe('stable');
    expect(a.deathSaves.stable).toBe(true);
  });

  it('治疗唤醒濒死的人（HP 回来，死亡豁免清零），但睡眠术的昏迷不归治疗管', async () => {
    const { engine, a, b } = world();
    a.hp = 0;
    a.deathSaves = { successes: 1, failures: 2, stable: false, dead: false };
    a.conditions.push({ name: 'unconscious', source: 'dying' });
    await engine.heal('player_a', 4);
    expect(a.hp).toBe(4);
    expect(a.deathSaves).toEqual(freshDeathTrack());
    expect(a.conditions.some((c) => c.name === 'unconscious')).toBe(false);

    b.conditions.push({ name: 'unconscious', source: 'sleep' });
    b.hp = 5;
    await engine.heal('player_b', 3);
    expect(b.conditions.some((c) => c.name === 'unconscious')).toBe(true);
  });

  it('advanceTurn：轮到濒死的 PC 自动掷死亡豁免并跳过，轮到下一个能动的人', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 8, 5);
    a.hp = 0;
    a.deathSaves = freshDeathTrack();
    a.conditions.push({ name: 'unconscious', source: 'dying' });
    startFight(engine, [g.id, 'player_a', 'player_b']);
    rolls.d20.push(11);
    const adv = await engine.advanceTurn();
    expect(adv.deathSaves).toHaveLength(1);
    expect(adv.deathSaves[0].actorId).toBe('player_a');
    expect(adv.actorId).toBe('player_b');
    expect(a.deathSaves.successes).toBe(1);
    expect(adv.notes[0]).toContain('死亡豁免');
  });

  it('advanceTurn：死了的、稳定的、倒下的怪都跳过；自然 20 醒来的当场行动', async () => {
    const { engine, rolls, a, b } = world();
    const g1 = place(engine, 'goblin', '地精1', 8, 5);
    const g2 = place(engine, 'goblin', '地精2', 9, 5);
    await engine.damage(g1.id, 999, 'slashing');
    a.hp = 0;
    a.deathSaves = { successes: 0, failures: 0, stable: true, dead: false };
    startFight(engine, [g2.id, g1.id, 'player_a', 'player_b']);
    const adv = await engine.advanceTurn();
    expect(adv.actorId).toBe('player_b');
    expect(adv.deathSaves).toHaveLength(0);

    b.hp = 0;
    b.deathSaves = freshDeathTrack();
    startFight(engine, [g2.id, 'player_b']);
    rolls.d20.push(20);
    const revived = await engine.advanceTurn();
    expect(revived.actorId).toBe('player_b');
    expect(b.hp).toBe(1);
  });

  it('combatStatus：怪全死 = 胜利；PC 全倒 = 失败', async () => {
    const { engine, a, b } = world();
    const g = place(engine, 'goblin', '地精', 8, 5);
    expect(engine.combatStatus()).toBe('ongoing');
    a.hp = 0;
    b.hp = 0;
    expect(engine.combatStatus()).toBe('defeat');
    await engine.damage(g.id, 999, 'slashing');
    expect(engine.combatStatus()).toBe('victory');
  });

  it('stabilize：医药检定 DC 10 成功才稳定', async () => {
    const { engine, rolls, a } = world();
    a.hp = 0;
    a.deathSaves = freshDeathTrack();
    rolls.d20.push(3);
    const fail = await engine.stabilize('player_a', 'check', 'player_b');
    expect(a.deathSaves.stable).toBe(false);
    expect(fail.note).toContain('没能稳住');
    rolls.d20.push(15);
    await engine.stabilize('player_a', 'check', 'player_b');
    expect(a.deathSaves.stable).toBe(true);
    const kit = await engine.stabilize('player_a', 'kit');
    expect(kit.ok).toBe(false);
  });
});

describe('状态对攻击检定的实际影响', () => {
  it('攻击麻痹的目标：5 尺内命中即暴击（用 2d8 而不是 1d8）；远处不暴击', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    engine.applyCondition(g.id, 'paralyzed');
    rolls.d20.push(10, 10); // 麻痹给优势，掷两颗
    const r = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r.hit).toBe(true);
    expect(r.crit).toBe(true);
    expect(r.damage?.formula).toContain('2d8');

    engine.beginTurn('player_a');
    g.position = { col: 15, row: 5 };
    rolls.d20.push(10, 10);
    const far = await engine.attack('player_a', g.id, 'shortbow', { sneakAttack: false });
    expect(far.crit).toBe(false);
  });

  it('倒地的目标：近战优势，远程劣势；攻击者自己倒地所有攻击劣势', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    engine.applyCondition(g.id, 'prone');
    rolls.d20.push(5, 5);
    const melee = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(melee.attack.advantage).toBe('adv');

    engine.beginTurn('player_a');
    g.position = { col: 12, row: 5 };
    rolls.d20.push(5, 5);
    const ranged = await engine.attack('player_a', g.id, 'shortbow', { sneakAttack: false });
    expect(ranged.attack.advantage).toBe('dis');

    engine.removeCondition(g, 'prone');
    g.position = { col: 6, row: 5 };
    engine.beginTurn('player_a');
    engine.applyCondition('player_a', 'prone');
    rolls.d20.push(5, 5);
    const proneAttacker = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(proneAttacker.attack.advantage).toBe('dis');
    void a;
  });

  it('中毒、恐惧：攻击劣势；和目标的优势来源互相抵消', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    engine.applyCondition('player_a', 'poisoned');
    rolls.d20.push(5, 5);
    const r = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r.attack.advantage).toBe('dis');

    engine.beginTurn('player_a');
    engine.applyCondition(g.id, 'blinded'); // 目标目盲：优势；自己中毒：劣势 → 抵消
    rolls.d20.push(5);
    const r2 = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r2.attack.advantage).toBe('none');
  });

  it('闪避：对闪避者的攻击劣势，敏捷豁免优势；失能的闪避者没用', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    startFight(engine, ['player_a', g.id]);
    await engine.takeAction('player_a', 'dodge');
    expect(a.turn.dodging).toBe(true);
    rolls.d20.push(5, 5);
    const r = await engine.attack(g.id, 'player_a', 0);
    expect(r.attack.advantage).toBe('dis');
    rolls.d20.push(5, 5);
    const save = await engine.save('player_a', 'dex', 10);
    expect(save.advantage).toBe('adv');
    // 下回合开始，闪避结束
    engine.beginTurn('player_a');
    expect(a.turn.dodging).toBe(false);
  });

  it('躲藏：隐匿对被动感知，成功后攻击有优势，攻击后现形', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 8, 5);
    startFight(engine, ['player_a', g.id]);
    rolls.d20.push(20);
    const hide = await engine.takeAction('player_a', 'hide');
    expect(hide.note).toContain('躲了起来');
    expect(a.conditions.some((c) => c.name === 'hidden')).toBe(true);
    engine.beginTurn('player_a');
    g.position = { col: 6, row: 5 };
    rolls.d20.push(5, 5);
    const r = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r.attack.advantage).toBe('adv');
    expect(a.conditions.some((c) => c.name === 'hidden')).toBe(false);
  });

  it('力竭：2 级速度减半、3 级攻击和豁免劣势、4 级 HP 上限减半、5 级动不了、6 级死', async () => {
    const { engine, rolls, a } = world();
    startFight(engine, ['player_a', 'player_b']);
    engine.applyCondition('player_a', 'exhaustion', { level: 2 });
    expect(engine.movementCellsLeft(a)).toBe(3);
    engine.applyCondition('player_a', 'exhaustion', { level: 1 });
    rolls.d20.push(5, 5);
    const save = await engine.save('player_a', 'con', 10);
    expect(save.advantage).toBe('dis');
    engine.applyCondition('player_a', 'exhaustion', { level: 1 });
    expect(engine.maxHpOf(a)).toBe(12);
    expect(a.hp).toBe(12);
    engine.applyCondition('player_a', 'exhaustion', { level: 1 });
    expect(engine.moveTo('player_a', { col: 6, row: 6 }, { maxCells: 6 }).ok).toBe(false);
    engine.applyCondition('player_a', 'exhaustion', { level: 1 });
    expect(a.deathSaves.dead).toBe(true);
  });

  it('免疫的状态加不上；失能打断专注', async () => {
    const { engine, b } = world();
    const sk = place(engine, 'skeleton', '骷髅', 8, 5);
    expect(engine.applyCondition(sk.id, 'poisoned')).toBe(false);
    expect(sk.conditions).toHaveLength(0);
    await engine.castSpell('player_b', 'bless', 1, ['player_a', 'player_b']);
    expect(b.concentration).not.toBeNull();
    engine.applyCondition('player_b', 'stunned');
    expect(b.concentration).toBeNull();
  });
});

describe('距离、射程、掩蔽与夹击', () => {
  it('5 尺内有敌人时远程攻击劣势；超过正常射程劣势；超过长射程直接拒绝', async () => {
    const { engine, rolls } = world();
    const near = place(engine, 'goblin', '近的', 6, 5);
    const far = place(engine, 'goblin', '远的', 15, 5);
    rolls.d20.push(5, 5);
    const r = await engine.attack('player_a', far.id, 'shortbow', { sneakAttack: false });
    expect(r.attack.advantage).toBe('dis'); // 近的那只在 5 尺内
    expect(r.notes?.join('')).toContain('5 尺内有敌对生物');

    await engine.damage(near.id, 999, 'slashing');
    engine.beginTurn('player_a');
    far.position = { col: 5 + 17, row: 5 }; // 85 尺 > 正常射程 80，< 长射程 320
    rolls.d20.push(5, 5);
    const beyond = await engine.attack('player_a', far.id, 'shortbow', { sneakAttack: false });
    expect(beyond.attack.advantage).toBe('dis');
    expect(beyond.notes?.join('')).toContain('超出正常射程');

    engine.beginTurn('player_a');
    far.position = { col: 5 + 15, row: 5 }; // 75 尺，在正常射程内
    rolls.d20.push(5);
    const inside = await engine.attack('player_a', far.id, 'shortbow', { sneakAttack: false });
    expect(inside.attack.advantage).toBe('none');
  });

  it('可投掷的近战武器（匕首）在投掷射程内按远程打，射程外拒绝', async () => {
    const { engine, rolls, a } = world();
    a.attacks.push({ weaponId: 'dagger', name: '匕首' });
    const g = place(engine, 'goblin', '地精', 9, 5); // 20 尺
    rolls.d20.push(12);
    const r = await engine.attack('player_a', g.id, '匕首', { sneakAttack: false });
    expect(r.attack.label).toContain('匕首');
    engine.beginTurn('player_a');
    g.position = { col: 25, row: 5 }; // 100 尺 > 投掷长射程 60
    await expect(engine.attack('player_a', g.id, '匕首')).rejects.toThrow('投掷射程');
    await expect(engine.attack('player_a', g.id, 'rapier')).rejects.toThrow('近战需要先贴近');
  });

  it('近战够不到：不掷骰、不消耗动作', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 9, 5);
    await expect(engine.attack('player_a', g.id, 'rapier')).rejects.toThrow('近战需要先贴近');
    expect(rolls.calls).toHaveLength(0);
    expect(a.turn.actionUsed).toBe(false);
  });

  it('掩蔽：目标挡着一格障碍 = AC +2，拐角两格 = +5；另一个生物挡在中间 = 半掩蔽', async () => {
    const { engine, rolls } = world();
    const a = engine.require('player_a');
    engine.setMapInfo(wholeMap([{ name: '墙', cells: { col: [9, 9], row: [5, 5] } }]));
    const g = place(engine, 'goblin', '地精', 10, 5);
    const r = await engine.attack('player_a', g.id, 'shortbow', { sneakAttack: false });
    expect(r.coverBonus).toBe(2);
    expect(r.targetAc).toBe(17); // 地精 AC 15 + 2
    void rolls;

    // 拐角：目标在攻击者这一侧有两面墙 = 四分之三掩蔽
    a.position = { col: 5, row: 2 };
    engine.setMapInfo(
      wholeMap([
        { name: '墙1', cells: { col: [9, 9], row: [5, 5] } },
        { name: '墙2', cells: { col: [10, 10], row: [4, 4] } },
      ])
    );
    expect(engine.coverBonus(a, g)).toBe(5);

    // 生物挡路：半掩蔽；贴身没有掩蔽
    a.position = { col: 5, row: 5 };
    engine.setMapInfo(wholeMap());
    place(engine, 'goblin', '挡路的', 7, 5);
    expect(engine.coverBonus(a, g)).toBe(2);
    g.position = { col: 6, row: 5 };
    expect(engine.coverBonus(a, g)).toBe(0);
  });

  it('夹击（可选规则，默认关）：盟友在正对面时有优势', async () => {
    const off = world();
    const g = place(off.engine, 'goblin', '地精', 6, 5);
    off.b.position = { col: 7, row: 5 };
    off.rolls.d20.push(5);
    const r0 = await off.engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r0.attack.advantage).toBe('none');

    const on = world({ flanking: true });
    const g2 = place(on.engine, 'goblin', '地精', 6, 5);
    on.b.position = { col: 7, row: 5 };
    on.rolls.d20.push(5, 5);
    const r1 = await on.engine.attack('player_a', g2.id, 'rapier', { sneakAttack: false });
    expect(r1.attack.advantage).toBe('adv');
  });

  it('群体战术：盟友在目标 5 尺内时狼有优势', async () => {
    const { engine, rolls } = world();
    const w1 = place(engine, 'wolf', '狼1', 6, 4);
    place(engine, 'wolf', '狼2', 5, 4);
    rolls.d20.push(5, 5);
    const r = await engine.attack(w1.id, 'player_a', 0);
    expect(r.attack.advantage).toBe('adv');
    expect(r.notes?.join('')).toContain('群体战术');
  });

  it('偷袭：没有优势但目标 5 尺内有盟友也行；有劣势不行', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 6);
    // b 在 (4,5)，离地精 (6,6) 2 格：不算
    rolls.d20.push(15);
    const none = await engine.attack('player_a', g.id, 'rapier');
    expect(none.sneakAttack).toBe(false);

    engine.beginTurn('player_a');
    engine.require('player_b').position = { col: 7, row: 6 };
    rolls.d20.push(15);
    const ally = await engine.attack('player_a', g.id, 'rapier');
    expect(ally.sneakAttack).toBe(true);
    expect(ally.damage?.formula).toContain('2d6');

    engine.beginTurn('player_a');
    a.turn.sneakUsed = false;
    engine.applyCondition('player_a', 'poisoned'); // 劣势
    rolls.d20.push(15, 15);
    const dis = await engine.attack('player_a', g.id, 'rapier');
    expect(dis.sneakAttack).toBe(false);
  });
});

describe('动作经济：额外攻击、多攻、疾走、撤离、借机攻击', () => {
  it('额外攻击：一个 Attack 动作两次，第三次拒绝，下回合重置', async () => {
    const { engine, rolls, a } = world();
    a.attacksPerAction = 2;
    engine.beginTurn('player_a');
    const g = place(engine, 'goblin', '地精', 6, 5);
    g.hp = 99;
    g.maxHp = 99;
    rolls.d20.push(2, 2);
    const results = await engine.attackAction('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(results).toHaveLength(2);
    await expect(engine.attack('player_a', g.id, 'rapier')).rejects.toThrow('已经用过动作');
    engine.beginTurn('player_a');
    rolls.d20.push(2);
    await expect(engine.attack('player_a', g.id, 'rapier', { sneakAttack: false })).resolves.toBeDefined();
  });

  it('没有额外攻击的角色只能打一次', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    rolls.d20.push(2);
    const r = await engine.attackAction('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(r).toHaveLength(1);
    await expect(engine.attackAction('player_a', g.id, 'rapier')).rejects.toThrow('已经用过动作');
  });

  it('怪物多攻：强盗首领一次打三下（弯刀 ×2 + 匕首），目标倒下就停', async () => {
    const { engine, rolls } = world();
    const cap = place(engine, 'bandit_captain', '首领', 6, 5);
    engine.beginTurn(cap.id);
    rolls.d20.push(2, 2, 2);
    const swings = await engine.attackAction(cap.id, 'player_a', '弯刀');
    expect(swings).toHaveLength(3);
    expect(swings.map((s) => s.attack.label.split('：')[1])).toEqual(['弯刀', '弯刀', '匕首']);

    engine.beginTurn(cap.id);
    engine.require('player_a').hp = 1;
    rolls.d20.push(20, 20, 20);
    const stopped = await engine.attackAction(cap.id, 'player_a', '弯刀');
    expect(stopped).toHaveLength(1);
    expect(engine.require('player_a').hp).toBe(0);
  });

  it('沙华鱼人：啮咬 + 爪击，或啮咬 + 矛', async () => {
    const { engine, rolls } = world();
    const s = place(engine, 'sahuagin', '鱼人', 6, 5);
    rolls.d20.push(2, 2);
    const claws = await engine.attackAction(s.id, 'player_a', '啮咬');
    expect(claws.map((r) => r.attack.label.split('：')[1])).toEqual(['啮咬', '爪击']);
    engine.beginTurn(s.id);
    rolls.d20.push(2, 2);
    const spear = await engine.attackAction(s.id, 'player_a', '矛');
    expect(spear.map((r) => r.attack.label.split('：')[1])).toEqual(['啮咬', '矛']);
  });

  it('怪物的远程攻击不需要贴身，也有射程限制', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 15, 5);
    expect(engine.isMeleeAttack(g.id, '短弓')).toBe(false);
    rolls.d20.push(2);
    const r = await engine.attack(g.id, 'player_a', '短弓');
    expect(r.attack.label).toContain('短弓');
    g.position = { col: 31, row: 5 };
    engine.beginTurn(g.id);
    engine.require('player_a').position = { col: 0, row: 5 };
    await expect(engine.attack(g.id, 'player_a', '短弓')).resolves.toBeDefined(); // 155 尺 < 320
  });

  it('疾走：移动力翻倍', async () => {
    const { engine, a } = world();
    startFight(engine, ['player_a', 'player_b']);
    expect(engine.movementCellsLeft(a)).toBe(6);
    await engine.takeAction('player_a', 'dash');
    expect(engine.movementCellsLeft(a)).toBe(12);
    await expect(engine.takeAction('player_a', 'dodge')).rejects.toThrow('已经用过动作');
  });

  it('走出敌人触及范围引发借机攻击；撤离不引发；原地周旋（始终在触及内）不引发', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    startFight(engine, ['player_a', g.id]);
    rolls.d20.push(2);
    const moved = await engine.moveWithReactions('player_a', { col: 10, row: 8 }, { maxCells: 6 });
    expect(moved.ok).toBe(true);
    expect(moved.opportunity).toHaveLength(1);
    expect(moved.opportunity![0].reactorId).toBe(g.id);
    expect(g.turn.reactionUsed).toBe(true);
    expect(a.position).toEqual({ col: 10, row: 8 });

    // 撤离
    const w = world();
    const g2 = place(w.engine, 'goblin', '地精', 6, 5);
    startFight(w.engine, ['player_a', g2.id]);
    await w.engine.takeAction('player_a', 'disengage');
    const safe = await w.engine.moveWithReactions('player_a', { col: 10, row: 8 }, { maxCells: 6 });
    expect(safe.opportunity).toBeUndefined();
    expect(g2.turn.reactionUsed).toBe(false);

    // 绕着敌人转，始终在 5 尺内
    const w3 = world();
    const g3 = place(w3.engine, 'goblin', '地精', 6, 5);
    startFight(w3.engine, ['player_a', g3.id]);
    const circle = await w3.engine.moveWithReactions('player_a', { col: 6, row: 6 }, { maxCells: 6 });
    expect(circle.opportunity).toBeUndefined();
  });

  it('借机攻击每个反应只有一次；开关可以关', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    startFight(engine, ['player_a', g.id]);
    rolls.d20.push(2);
    await engine.moveWithReactions('player_a', { col: 10, row: 8 }, { maxCells: 6 });
    expect(g.turn.reactionUsed).toBe(true);
    // 再走回来再走开：反应已经用掉
    engine.beginTurn('player_a');
    await engine.moveWithReactions('player_a', { col: 6, row: 6 }, { maxCells: 6 });
    const again = await engine.moveWithReactions('player_a', { col: 12, row: 9 }, { maxCells: 6 });
    expect(again.opportunity).toBeUndefined();

    const off = world({ opportunityAttacks: false });
    const g2 = place(off.engine, 'goblin', '地精', 6, 5);
    startFight(off.engine, ['player_a', g2.id]);
    const free = await off.engine.moveWithReactions('player_a', { col: 10, row: 8 }, { maxCells: 6 });
    expect(free.opportunity).toBeUndefined();
  });

  it('借机攻击把走位的人打倒：停在半路，后面的借机攻击不再发生', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    a.hp = 1;
    startFight(engine, ['player_a', g.id]);
    rolls.d20.push(20); // 暴击命中
    const r = await engine.moveWithReactions('player_a', { col: 11, row: 9 }, { maxCells: 6 });
    expect(r.downedAt).toBeDefined();
    expect(a.hp).toBe(0);
    expect(a.position).toEqual(r.downedAt);
    expect(r.cells).toBeLessThan(6);
  });

  it('倒地的人在战斗里要先站起来：花一半速度；探索中不花', async () => {
    const { engine, a } = world();
    startFight(engine, ['player_a', 'player_b']);
    engine.applyCondition('player_a', 'prone');
    const r = engine.moveTo('player_a', { col: 7, row: 5 }, { maxCells: engine.movementCellsLeft(a) });
    expect(r.ok).toBe(true);
    expect(a.turn.movementUsed).toBe((2 + 3) * 5);
    expect(a.conditions.some((c) => c.name === 'prone')).toBe(false);

    const free = world();
    free.engine.applyCondition('player_a', 'prone');
    free.engine.moveTo('player_a', { col: 7, row: 5 });
    expect(free.a.turn.movementUsed).toBe(10);
  });

  it('协助：盟友对目标的下一次攻击有优势，用掉就没了，施助者下回合开始前也会过期', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    startFight(engine, ['player_b', 'player_a', g.id]);
    await engine.takeAction('player_b', 'help', { allyId: 'player_a', targetId: g.id });
    engine.beginTurn('player_a');
    expect(a.effects.some((e) => e.advantageOnNextAttack)).toBe(true);
    rolls.d20.push(5, 5);
    const first = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(first.attack.advantage).toBe('adv');
    engine.beginTurn('player_a');
    rolls.d20.push(5);
    const second = await engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(second.attack.advantage).toBe('none');

    engine.beginTurn('player_b');
    await engine.takeAction('player_b', 'help', { allyId: 'player_a', targetId: g.id });
    expect(a.effects.some((e) => e.advantageOnNextAttack)).toBe(true);
    engine.beginTurn('player_b');
    expect(a.effects.some((e) => e.advantageOnNextAttack)).toBe(false);
  });
});

describe('命中后的效果：撞倒、麻痹、毒伤豁免', () => {
  it('食尸鬼爪击：体质豁免失败才麻痹', async () => {
    const { engine, rolls, a } = world();
    const gh = place(engine, 'ghoul', '食尸鬼', 6, 5);
    rolls.d20.push(15, 3); // 命中，豁免 3+0 < 10
    const r = await engine.attack(gh.id, 'player_a', '爪击');
    expect(r.hit).toBe(true);
    expect(r.conditionApplied).toBe('paralyzed');
    expect(a.conditions.some((c) => c.name === 'paralyzed')).toBe(true);
    expect(r.extraRolls).toHaveLength(1);

    engine.removeCondition(a, 'paralyzed');
    engine.beginTurn(gh.id);
    rolls.d20.push(15, 18);
    const saved = await engine.attack(gh.id, 'player_a', '爪击');
    expect(saved.conditionApplied).toBeUndefined();
  });

  it('巨蜘蛛毒伤：体质豁免成功减半，且按毒素算（不是穿刺）', async () => {
    const { engine, rolls, a } = world();
    const sp = place(engine, 'giant_spider', '蜘蛛', 6, 5);
    a.maxHp = 100;
    a.hp = 100;
    rolls.d20.push(18, 3); // 命中；豁免失败（3+2<11）
    const fail = await engine.attack(sp.id, 'player_a', '啮咬');
    expect(100 - a.hp).toBe(8 + 3 + 16); // 1d8+3 取最大 + 2d8 全额
    engine.beginTurn(sp.id);
    a.hp = 100;
    rolls.d20.push(18, 18);
    await engine.attack(sp.id, 'player_a', '啮咬');
    expect(100 - a.hp).toBe(8 + 3 + 8); // 毒伤减半
    void fail;
  });

  it('毒素免疫的目标吃不到毒伤，却照样吃穿刺伤（分开结算）', async () => {
    const { engine, rolls } = world();
    const sp = place(engine, 'giant_spider', '蜘蛛', 6, 5);
    const sk = place(engine, 'skeleton', '骷髅', 5, 6);
    sk.hp = 100;
    rolls.d20.push(18, 1);
    await engine.attack(sp.id, sk.id, '啮咬');
    expect(100 - sk.hp).toBe(11); // 8+3 穿刺，毒伤免疫
  });

  it('狼的啮咬：力量豁免失败被撞倒', async () => {
    const { engine, rolls, a } = world();
    const w = place(engine, 'wolf', '狼', 6, 5);
    rolls.d20.push(15, 2);
    const r = await engine.attack(w.id, 'player_a', 0);
    expect(r.conditionApplied).toBe('prone');
    expect(a.conditions.some((c) => c.name === 'prone')).toBe(true);
  });
});

describe('法术：范围、效果、专注、射程', () => {
  function caster() {
    const w = world();
    w.b.spells!.known.push('faerie_fire', 'web', 'burning_hands', 'fire_bolt', 'guiding_bolt');
    w.b.abilities.wis = 16;
    return w;
  }

  it('燃烧之手（范围）：给出的每个目标都要豁免，半伤', async () => {
    const w = world();
    const wiz = actorFromCharacter(
      {
        name: '法师',
        level: 3,
        abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
        ac: 12,
        maxHp: 20,
        spells: { ability: 'int', known: ['burning_hands'], slots: { '1': { max: 4, used: 0 } } },
      },
      'wiz'
    );
    wiz.position = { col: 5, row: 6 };
    w.engine.addActor(wiz);
    const g1 = place(w.engine, 'goblin', '地精1', 7, 6, 7);
    const g2 = place(w.engine, 'goblin', '地精2', 7, 7, 7);
    w.rolls.d20.push(2, 18); // g1 豁免失败，g2 成功
    const r = await w.engine.castSpell('wiz', 'burning_hands', 1, [g1.id, g2.id]);
    expect(r.ok).toBe(true);
    expect(r.rolls.filter((x) => x.kind === 'save')).toHaveLength(2);
    expect(g1.hp).toBe(0); // 3d6 取最大 18 ≥ 7
    expect(g2.hp).toBe(0); // 半伤 9 ≥ 7
  });

  it('妖火：敏捷豁免失败的目标被勾勒（对它的攻击有优势），专注结束时消失', async () => {
    const w = caster();
    const g = place(w.engine, 'goblin', '地精', 6, 5);
    w.rolls.d20.push(2);
    const r = await w.engine.castSpell('player_b', 'faerie_fire', 1, [g.id]);
    expect(r.ok).toBe(true);
    expect(g.effects.some((e) => e.grantsAttackersAdvantage)).toBe(true);
    w.rolls.d20.push(5, 5);
    const hit = await w.engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(hit.attack.advantage).toBe('adv');
    // 施法者专注被打断：勾勒消失
    w.b.hp = 24;
    w.rolls.d20.push(1);
    await w.engine.damage('player_b', 5, 'slashing');
    expect(g.effects.some((e) => e.grantsAttackersAdvantage)).toBe(false);
  });

  it('光导箭：命中后目标的下一次被攻击有优势，用一次就没', async () => {
    const w = caster();
    const g = place(w.engine, 'goblin', '地精', 6, 5);
    w.b.position = { col: 5, row: 4 };
    w.rolls.d20.push(15);
    const cast = await w.engine.castSpell('player_b', 'guiding_bolt', 1, [g.id]);
    expect(cast.ok).toBe(true);
    expect(g.effects.some((e) => e.grantsAdvantageOnce)).toBe(true);
    w.rolls.d20.push(5, 5);
    const first = await w.engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(first.attack.advantage).toBe('adv');
    w.engine.beginTurn('player_a');
    w.rolls.d20.push(5);
    const second = await w.engine.attack('player_a', g.id, 'rapier', { sneakAttack: false });
    expect(second.attack.advantage).toBe('none');
  });

  it('护盾术：AC +5 到施法者下回合开始', async () => {
    const w = world();
    const wiz = actorFromCharacter(
      {
        name: '法师',
        level: 3,
        abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
        ac: 12,
        maxHp: 20,
        spells: { ability: 'int', known: ['shield'], slots: { '1': { max: 4, used: 0 } } },
      },
      'wiz'
    );
    w.engine.addActor(wiz);
    await w.engine.castSpell('wiz', 'shield', 1, []);
    expect(w.engine.acOf(wiz)).toBe(17);
    w.engine.beginTurn('wiz');
    expect(w.engine.acOf(wiz)).toBe(12);
  });

  it('射程不够 / 没有目标：拒绝，而且不扣法术位、不占动作', async () => {
    const w = caster();
    const far = place(w.engine, 'goblin', '远的', 30, 5); // 125 尺 > 60
    const before = w.b.spells!.slots[1].used;
    const r = await w.engine.castSpell('player_b', 'guiding_bolt', 1, [far.id]); // 120 尺
    expect(r.ok).toBe(false);
    expect(r.error).toContain('射程');
    const none = await w.engine.castSpell('player_b', 'sacred_flame', 0, []);
    expect(none.ok).toBe(false);
    const tooFar = await w.engine.castSpell('player_b', 'hold_person', 2, [far.id]);
    expect(tooFar.ok).toBe(false);
    expect(w.b.spells!.slots[1].used).toBe(before);
    expect(w.b.spells!.slots[2].used).toBe(0);
    expect(w.b.turn.actionUsed).toBe(false);
  });

  it('远程法术攻击：5 尺内有敌人劣势；触碰法术是近战', async () => {
    const w = world();
    const wiz = actorFromCharacter(
      {
        name: '法师',
        level: 3,
        abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
        ac: 12,
        maxHp: 20,
        spells: { ability: 'int', known: ['fire_bolt'], slots: {} },
      },
      'wiz'
    );
    wiz.position = { col: 5, row: 6 };
    w.engine.addActor(wiz);
    place(w.engine, 'goblin', '贴脸的', 5, 7);
    const far = place(w.engine, 'goblin', '远的', 12, 6);
    w.rolls.d20.push(5, 5);
    const r = await w.engine.castSpell('wiz', 'fire_bolt', 0, [far.id]);
    expect(r.rolls[0].advantage).toBe('dis');
  });

  it('法术攻击打麻痹的目标：5 尺内暴击', async () => {
    const w = caster();
    const g = place(w.engine, 'goblin', '地精', 6, 5);
    w.b.position = { col: 5, row: 4 };
    w.engine.applyCondition(g.id, 'paralyzed');
    w.rolls.d20.push(10, 10);
    const r = await w.engine.castSpell('player_b', 'fire_bolt', 0, [g.id]);
    expect(r.rolls[0].crit).toBe(true);
    expect(r.rolls[1].label).toContain('暴击');
  });

  it('定身人类：专注断了，目标的麻痹跟着没（状态挂在目标身上）', async () => {
    const w = caster();
    const bandit = place(w.engine, 'bandit', '强盗', 6, 5);
    w.rolls.d20.push(2);
    await w.engine.castSpell('player_b', 'hold_person', 2, [bandit.id]);
    expect(bandit.conditions.some((c) => c.name === 'paralyzed')).toBe(true);
    w.rolls.d20.push(1); // 专注豁免失败
    await w.engine.damage('player_b', 5, 'slashing');
    expect(w.b.concentration).toBeNull();
    expect(bandit.conditions.some((c) => c.name === 'paralyzed')).toBe(false);
  });

  it('圣火无视掩蔽；燃烧之手吃掩蔽的敏捷豁免加值', async () => {
    const w = caster();
    w.engine.setMapInfo(wholeMap([{ name: '墙', cells: { col: [9, 9], row: [5, 5] } }]));
    w.b.position = { col: 6, row: 5 };
    const g = place(w.engine, 'goblin', '地精', 10, 5);
    w.rolls.d20.push(10);
    const flame = await w.engine.castSpell('player_b', 'sacred_flame', 0, [g.id]);
    expect(flame.rolls[0].modifier).toBe(2); // 地精敏捷 +2，没有掩蔽加值
    w.engine.beginTurn('player_b');
    w.rolls.d20.push(10);
    const web = await w.engine.castSpell('player_b', 'web', 2, [g.id]);
    expect(web.rolls[0].modifier).toBe(4); // 敏捷 +2，半掩蔽 +2
  });
});

describe('存档兼容', () => {
  it('老存档的回合记录缺新字段：load 时补默认值', () => {
    const { engine } = world();
    const snap = JSON.parse(JSON.stringify(engine.snapshot())) as { actors: Actor[] };
    for (const a of snap.actors) {
      a.turn = { actionUsed: true, bonusUsed: false, reactionUsed: false, movementUsed: 5, sneakUsed: false } as Actor['turn'];
    }
    const fresh = new RulesEngine({ rollSource: new ScriptedRollSource() });
    fresh.load(snap as Parameters<RulesEngine['load']>[0]);
    const a = fresh.require('player_a');
    expect(a.turn.actionUsed).toBe(true);
    expect(a.turn.attacksAllowed).toBe(1);
    expect(a.turn.oncePerTurn).toEqual([]);
    expect(a.turn.dodging).toBe(false);
  });
});

describe('擒抱、推撞、挣脱、突袭、怪物特性', () => {
  it('擒抱：运动对抗运动 / 杂技，成功则速度变 0；占 Attack 动作里的一击', async () => {
    const { engine, rolls, a } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    startFight(engine, ['player_a', g.id]);
    rolls.d20.push(18, 2); // 盗贼运动 +0：18；地精运动 -1 / 杂技 +2：2 → 赢
    const out = await engine.grapple('player_a', g.id);
    expect(out.note).toContain('擒住');
    expect(g.conditions.some((c) => c.name === 'grappled')).toBe(true);
    expect(engine.speedOf(g)).toBe(0);
    expect(a.turn.actionUsed).toBe(true);
    // 擒抱者倒下，擒抱就松了
    a.hp = 0;
    expect(engine.speedOf(g)).toBe(30);
  });

  it('擒抱：目标比自己大两级以上抓不住；够不到不行；平手算防守方赢', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    g.size = 'huge';
    await expect(engine.grapple('player_a', g.id)).rejects.toThrow('体型太大');
    g.size = 'small';
    g.position = { col: 12, row: 5 };
    await expect(engine.grapple('player_a', g.id)).rejects.toThrow('够不到');
    g.position = { col: 6, row: 5 };
    rolls.d20.push(10, 12); // 10+0 对 12+2：输
    const out = await engine.grapple('player_a', g.id);
    expect(out.note).toContain('没能擒住');
  });

  it('推撞：成功则倒地，或者推开 5 尺', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 6, 5);
    rolls.d20.push(18, 2);
    await engine.shove('player_a', g.id, 'prone');
    expect(g.conditions.some((c) => c.name === 'prone')).toBe(true);
    engine.beginTurn('player_a');
    g.conditions = [];
    rolls.d20.push(18, 2);
    await engine.shove('player_a', g.id, 'push');
    expect(g.position).toEqual({ col: 7, row: 5 });
  });

  it('挣脱：怪物的擒抱有固定脱逃 DC（巨蟹 11）；玩家擒抱则对抗擒抱者', async () => {
    const { engine, rolls, a } = world();
    const crab = place(engine, 'giant_crab', '蟹', 6, 5);
    rolls.d20.push(15);
    await engine.attack(crab.id, 'player_a', 0);
    const grip = a.conditions.find((c) => c.name === 'grappled');
    expect(grip?.escapeDc).toBe(11);
    engine.beginTurn('player_a');
    rolls.d20.push(5); // 盗贼运动 +0 / 杂技 +3(敏捷 3 + 无熟练? 杂技熟练 +2 → +5)：5+5=10 < 11
    const fail = await engine.escapeGrapple('player_a');
    expect(fail.note).toContain('没能挣脱');
    engine.beginTurn('player_a');
    rolls.d20.push(12);
    const ok = await engine.escapeGrapple('player_a');
    expect(ok.note).toContain('挣脱了擒抱');
    expect(a.conditions.some((c) => c.name === 'grappled')).toBe(false);
  });

  it('突袭：被突袭的第一回合直接跳过，之后正常', async () => {
    const { engine, rolls } = world();
    const g = place(engine, 'goblin', '地精', 8, 5);
    rolls.d20.push(15, 5, 5); // 先攻：地精 15，两个 PC 各 5
    await engine.startCombat([g.id, 'player_a', 'player_b'], { surprised: ['player_a'] });
    expect(engine.currentActor()?.id).toBe(g.id);
    // 被突袭者在自己的回合过去之前不能用反应
    expect(engine.require('player_a').turn.reactionUsed).toBe(true);
    const adv = await engine.advanceTurn();
    expect(adv.actorId).toBe('player_b'); // player_a（先攻同值时按敏捷排在前面）被跳过
    expect(adv.notes.join('')).toContain('被突袭');
    expect(engine.combat.surprised ?? []).toHaveLength(0);
    // 被跳过的那个回合一过去，反应就恢复了
    expect(engine.require('player_a').turn.reactionUsed).toBe(false);
  });

  it('不死坚韧：丧尸被打到 0 HP 时体质豁免成功留 1 HP；暴击和光耀不行', async () => {
    const { engine, rolls } = world();
    const z = place(engine, 'zombie', '丧尸', 6, 5, 10);
    rolls.d20.push(20); // 体质豁免 DC 5+10=15
    await engine.damage(z.id, 10, 'slashing');
    expect(z.hp).toBe(1);
    expect(z.deathSaves.dead).toBe(false);
    await engine.damage(z.id, 1, 'radiant');
    expect(z.deathSaves.dead).toBe(true);
    const z2 = place(engine, 'zombie', '丧尸2', 7, 5, 10);
    rolls.d20.push(20);
    await engine.damage(z2.id, 10, 'slashing', '暴击', { crit: true });
    expect(z2.deathSaves.dead).toBe(true);
  });

  it('嗜血狂热：鲨人打已经受伤的目标有优势', async () => {
    const { engine, rolls, a } = world();
    const s = place(engine, 'sahuagin', '鲨人', 6, 5);
    rolls.d20.push(5);
    const healthy = await engine.attack(s.id, 'player_a', '啮咬');
    expect(healthy.attack.advantage).toBe('none');
    a.hp = 10;
    engine.beginTurn(s.id);
    rolls.d20.push(5, 5);
    const hurt = await engine.attack(s.id, 'player_a', '啮咬');
    expect(hurt.attack.advantage).toBe('adv');
  });
});

describe('回合结束的豁免、失能跳过、蛛网术', () => {
  function casterWorld() {
    const w = world();
    w.b.spells!.known.push('web');
    w.b.abilities.wis = 16;
    return w;
  }

  it('定身人类：被麻痹的人回合直接跳过，回合结束再豁免，成功就摆脱', async () => {
    const w = casterWorld();
    const bandit = place(w.engine, 'bandit', '强盗', 6, 5);
    w.rolls.d20.push(2); // 强盗豁免失败
    await w.engine.castSpell('player_b', 'hold_person', 2, [bandit.id]);
    expect(bandit.conditions.find((c) => c.name === 'paralyzed')?.save).toEqual({ ability: 'wis', dc: 13 });
    startFight(w.engine, ['player_a', bandit.id, 'player_b']);
    w.rolls.d20.push(2); // 强盗回合结束的再豁免：失败
    const first = await w.engine.advanceTurn(); // player_a 的回合结束 → 强盗被跳过
    expect(first.actorId).toBe('player_b');
    expect(first.notes.join('')).toContain('动不了');
    expect(bandit.conditions.some((c) => c.name === 'paralyzed')).toBe(true);
    // 下一圈：再豁免成功
    await w.engine.advanceTurn(); // player_b → player_a
    w.rolls.d20.push(20);
    const second = await w.engine.advanceTurn(); // player_a → 强盗（被跳过，豁免成功）
    expect(second.notes.join('')).toContain('摆脱了麻痹');
    expect(bandit.conditions.some((c) => c.name === 'paralyzed')).toBe(false);
  });

  it('蛛网术：失败被束缚，可以用动作做力量检定（对施法 DC）摆脱；范围内的都吃', async () => {
    const w = casterWorld();
    const g1 = place(w.engine, 'goblin', '地精1', 7, 5);
    const g2 = place(w.engine, 'goblin', '地精2', 7, 6);
    w.rolls.d20.push(2, 2);
    await w.engine.castSpell('player_b', 'web', 2, [g1.id, g2.id]);
    expect(g1.conditions.some((c) => c.name === 'restrained')).toBe(true);
    expect(g2.conditions.some((c) => c.name === 'restrained')).toBe(true);
    const grip = g1.conditions.find((c) => c.name === 'restrained');
    expect(grip?.escapeDc).toBe(13);
    expect(grip?.escapeAbility).toBe('str');
    w.rolls.d20.push(20);
    const out = await w.engine.escapeGrapple(g1.id);
    expect(out.note).toContain('挣脱');
    expect(g1.conditions.some((c) => c.name === 'restrained')).toBe(false);
    expect(w.engine.speedOf(g2)).toBe(0);
  });
});
