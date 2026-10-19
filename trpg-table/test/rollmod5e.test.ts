// 掷骰修正类法术（优势 / 劣势 / 固定加值）：恶言相加、克敌先击、电爪、加速术、希望信标、无痕步、防护毒素、
// 防护善恶、增强属性、降咒术、缓慢术、圣洁光环、预知术、难以抗拒之舞，以及按生物类型区别对待的豁免（枯萎术、日爆术…）。
import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { SPELLS } from '../src/rules/data/spells.js';
import { buildCharacter, type CharacterBuild } from '../src/rules/build/index.js';
import { actorFromCharacter, makeDefaultParty, type CharacterFile } from '../src/rules/sheet.js';
import type { Actor, RollResult } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

const allSlots = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), { max: 4, used: 0 }]));

/** 7 级智力施法者：法术 DC 14，法术攻击 +6，匕首。 */
const caster = (extra: Partial<CharacterFile> = {}): CharacterFile => ({
  name: '施法者',
  level: 7,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 },
  ac: 12,
  maxHp: 50,
  attacks: [{ weaponId: 'dagger' }],
  spells: { ability: 'int', known: [], slots: allSlots },
  ...extra,
});

function setup(...extras: Partial<CharacterFile>[]) {
  const rolls = new ScriptedRollSource();
  const log: RollResult[] = [];
  const engine = new RulesEngine({ rollSource: rolls, onRoll: (r) => log.push(r) });
  const actors: Actor[] = [];
  (extras.length ? extras : [{}]).forEach((extra, i) => {
    const a = actorFromCharacter({ ...caster(), name: `角色${i}`, ...extra }, `c${i}`, i === 0 ? 'player_a' : 'player_b');
    a.position = { col: 5 + i, row: 5 };
    engine.addActor(a);
    actors.push(a);
  });
  return { engine, rolls, log, actors, c: actors[0] };
}

function foe(engine: RulesEngine, id: string, col: number, row: number, hp = 300): Actor {
  const m = spawnMonster(id, `${id}@${col},${row}`);
  m.hp = hp;
  m.maxHp = hp;
  m.position = { col, row };
  engine.addActor(m);
  return m;
}

const cast = (engine: RulesEngine, who: string, spell: string, level: number, targets: string[], option?: string) =>
  engine.castSpell(who, spell, level, targets, { ignoreKnown: true, ...(option ? { option } : {}) });

describe('恶言相加（豁免失败 → 下一次攻击检定劣势）', () => {
  it('失败：目标下一次攻击两颗骰取低，用掉就没；成功：什么都不挂', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20 = [2]; // 地精感知 -1：总值 1 < DC 14
    const r = await cast(engine, c.id, 'vicious_mockery', 0, [g.id]);
    expect(r.ok).toBe(true);
    expect(g.effects).toHaveLength(1);
    expect(g.effects[0]).toMatchObject({ attackRoll: { state: 'dis', once: true }, untilEndOfTurnOf: g.id });

    rolls.d20 = [18, 3];
    const first = await engine.attack(g.id, c.id, 0);
    expect(first.attack.advantage).toBe('dis');
    expect(first.attack.natural).toBe(3);
    expect(g.effects).toHaveLength(0);

    engine.beginTurn(g.id);
    rolls.d20 = [18];
    const second = await engine.attack(g.id, c.id, 0);
    expect(second.attack.advantage).toBe('none');
    expect(second.attack.natural).toBe(18);

    const { engine: e2, rolls: r2, c: c2 } = setup();
    const g2 = foe(e2, 'goblin', 6, 5);
    r2.d20 = [20];
    await cast(e2, c2.id, 'vicious_mockery', 0, [g2.id]);
    expect(g2.effects).toHaveLength(0);
  });

  it('没打就等到目标自己的回合结束：劣势随之消失', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20 = [20, 1];
    await engine.startCombat([c.id, g.id]); // c 先攻
    rolls.d20 = [2];
    await cast(engine, c.id, 'vicious_mockery', 0, [g.id]);
    expect(g.effects).toHaveLength(1);
    engine.nextTurn(); // c 的回合结束，轮到地精
    expect(engine.currentActor()?.id).toBe(g.id);
    expect(g.effects).toHaveLength(1);
    engine.nextTurn(); // 地精的回合结束
    expect(g.effects).toHaveLength(0);
  });
});

describe('克敌先击（下一回合第一次攻击有优势）', () => {
  it('施法回合还没生效；下一回合对那个目标的第一次攻击有优势，别的目标没有；用掉就没', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    const h = foe(engine, 'goblin', 4, 5);
    rolls.d20 = [20, 1, 1];
    await engine.startCombat([c.id, g.id, h.id]);
    const r = await cast(engine, c.id, 'true_strike', 0, [g.id]);
    expect(r.ok).toBe(true);
    const eff = c.effects.find((e) => e.attackRoll)!;
    expect(eff).toMatchObject({ armedAtTurnOf: c.id, untilEndOfTurnOf: c.id, attackRoll: { state: 'adv', once: true, against: g.id } });

    rolls.d20 = [10];
    const same = await engine.attack(c.id, g.id, 0, { noSlot: true }); // 本回合还没生效
    expect(same.attack.advantage).toBe('none');

    engine.nextTurn();
    engine.nextTurn();
    engine.nextTurn(); // 回到 c 的回合
    expect(engine.currentActor()?.id).toBe(c.id);
    expect(eff.armedAtTurnOf).toBeUndefined();

    rolls.d20 = [10];
    const other = await engine.attack(c.id, h.id, 0, { noSlot: true }); // 别的目标：没有优势，也不会用掉
    expect(other.attack.advantage).toBe('none');
    expect(c.effects).toContain(eff);

    rolls.d20 = [4, 17];
    const real = await engine.attack(c.id, g.id, 0);
    expect(real.attack.advantage).toBe('adv');
    expect(real.attack.natural).toBe(17);
    expect(c.effects.some((e) => e.attackRoll)).toBe(false);
  });

  it('下一回合没用上就在那个回合结束时没了，专注也一起结束；专注断了也没了', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20 = [20, 1];
    await engine.startCombat([c.id, g.id]);
    await cast(engine, c.id, 'true_strike', 0, [g.id]);
    expect(c.concentration?.spellId).toBe('true_strike');
    engine.nextTurn(); // g
    engine.nextTurn(); // 回到 c：生效
    expect(c.effects.some((e) => e.attackRoll)).toBe(true);
    engine.nextTurn(); // c 的回合结束
    expect(c.effects.some((e) => e.attackRoll)).toBe(false);
    expect(c.concentration).toBeNull();

    // 专注被打断
    const w = setup();
    const g2 = foe(w.engine, 'goblin', 6, 5);
    await cast(w.engine, w.c.id, 'true_strike', 0, [g2.id]);
    w.engine.applyCondition(w.c.id, 'incapacitated');
    expect(w.c.effects.some((e) => e.attackRoll)).toBe(false);
  });
});

describe('电爪（对金属护甲有优势；命中后目标不能反应）', () => {
  it('目标穿金属护甲：优势；不穿：普通。命中后目标到它下回合开始前不能用反应', async () => {
    const { engine, rolls, c } = setup();
    const metal = foe(engine, 'goblin', 6, 5);
    metal.metalArmor = true;
    const plain = foe(engine, 'goblin', 4, 5);
    rolls.d20 = [5, 15];
    const r = await cast(engine, c.id, 'shocking_grasp', 0, [metal.id]);
    expect(r.rolls[0].advantage).toBe('adv');
    expect(r.rolls[0].natural).toBe(15);
    expect(r.rolls[0].success).toBe(true);
    expect(r.notes.some((n) => n.includes('金属护甲'))).toBe(true);
    expect(metal.effects.some((e) => e.noReactions)).toBe(true);
    await expect(engine.attack(metal.id, c.id, 0, { reaction: true })).rejects.toThrow(/不能用反应/);
    engine.beginTurn(metal.id);
    expect(metal.effects.some((e) => e.noReactions)).toBe(false);

    engine.beginTurn(c.id);
    rolls.d20 = [15];
    const r2 = await cast(engine, c.id, 'shocking_grasp', 0, [plain.id]);
    expect(r2.rolls[0].advantage).toBe('none');
  });

  it('构建器按护甲写 metalArmor；怪物数据里活化盔甲是金属的；默认牧师穿链甲', () => {
    const base: CharacterBuild = {
      name: '测试',
      race: 'human',
      background: 'soldier',
      classes: [{ id: 'fighter', level: 1 }],
      abilityScores: { str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 },
      skills: ['perception', 'survival'],
      fightingStyles: ['dueling'],
      equipment: { armor: 'chain_mail', shield: true, weapons: ['longsword'] },
    };
    const mail = buildCharacter(base);
    expect(mail.errors).toEqual([]);
    expect(mail.file.metalArmor).toBe(true);
    const leather = buildCharacter({ ...base, equipment: { armor: 'leather', shield: true, weapons: ['longsword'] } });
    expect(leather.errors).toEqual([]);
    expect(leather.file.metalArmor).toBeUndefined();
    expect(actorFromCharacter(mail.file, 'x').metalArmor).toBe(true);
    expect(spawnMonster('animated_armor').metalArmor).toBe(true);
    expect(spawnMonster('goblin').metalArmor).toBeUndefined();
    expect(makeDefaultParty().b.metalArmor).toBe(true);
  });
});

describe('加速术（敏捷豁免优势；结束时倦怠一回合）', () => {
  it('敏捷豁免优势，别的豁免不受影响', async () => {
    const { engine, rolls, actors } = setup({}, {});
    await cast(engine, 'c0', 'haste', 3, ['c1']);
    rolls.d20 = [3, 18];
    const dex = await engine.save('c1', 'dex', 10);
    expect(dex.advantage).toBe('adv');
    expect(dex.natural).toBe(18);
    rolls.d20 = [3];
    const wis = await engine.save('c1', 'wis', 10);
    expect(wis.advantage).toBe('none');
    expect(actors[1].effects.some((e) => e.lethargyOnEnd)).toBe(true);
  });

  it('专注断了：被加速的人这一轮还没行动 → 倦怠撑到这一轮结束，失能且速度 0', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const g = foe(engine, 'goblin', 8, 5);
    rolls.d20 = [20, 15, 1];
    await engine.startCombat([actors[0].id, actors[1].id, g.id]); // c0 > c1 > 地精
    await cast(engine, 'c0', 'haste', 3, ['c1']);
    engine.applyCondition('c0', 'incapacitated'); // 专注断
    const c1 = actors[1];
    expect(c1.effects.some((e) => e.acBonus === 2)).toBe(false);
    const tired = c1.conditions.find((c) => c.source === 'haste_lethargy');
    expect(tired).toMatchObject({ name: 'incapacitated', rounds: 1 });
    expect(engine.isIncapacitated(c1)).toBe(true);
    expect(engine.speedOf(c1)).toBe(0);
    engine.nextTurn(); // c1
    engine.nextTurn(); // g
    engine.nextTurn(); // 新的一轮：倦怠结束
    expect(c1.conditions.some((c) => c.source === 'haste_lethargy')).toBe(false);
    expect(engine.speedOf(c1)).toBe(30);
  });

  it('专注断了：被加速的人这一轮已经行动过 → 倦怠撑到下一轮 ta 的回合之后', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const g = foe(engine, 'goblin', 8, 5);
    rolls.d20 = [10, 20, 1];
    await engine.startCombat([actors[0].id, actors[1].id, g.id]); // c1 > c0 > 地精
    engine.nextTurn(); // 轮到 c0
    expect(engine.currentActor()?.id).toBe('c0');
    await cast(engine, 'c0', 'haste', 3, ['c1']);
    engine.applyCondition('c0', 'incapacitated');
    const c1 = actors[1];
    expect(c1.conditions.find((c) => c.source === 'haste_lethargy')?.rounds).toBe(2);
    engine.nextTurn(); // g
    engine.nextTurn(); // 下一轮 c1：还在倦怠
    expect(engine.currentActor()?.id).toBe('c1');
    expect(engine.isIncapacitated(c1)).toBe(true);
    engine.nextTurn();
    engine.nextTurn();
    engine.nextTurn(); // 再下一轮
    expect(engine.isIncapacitated(c1)).toBe(false);
  });

  it('时间到（10 轮）也一样倦怠；战斗结束把倦怠清掉', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const g = foe(engine, 'goblin', 8, 5);
    rolls.d20 = [20, 15, 1];
    await engine.startCombat([actors[0].id, actors[1].id, g.id]);
    await cast(engine, 'c0', 'haste', 3, ['c1']);
    const c1 = actors[1];
    for (let i = 0; i < 90 && !c1.conditions.some((c) => c.source === 'haste_lethargy'); i++) engine.nextTurn();
    expect(c1.conditions.some((c) => c.source === 'haste_lethargy')).toBe(true);
    expect(c1.effects.some((e) => e.acBonus === 2)).toBe(false);
    expect(actors[0].concentration).toBeNull();
    engine.endCombat();
    expect(c1.conditions).toHaveLength(0);
    expect(c1.effects).toHaveLength(0);
  });

  it('专注的法术挂在别人身上，过了一轮专注也还在（以前一轮就丢了）', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const g = foe(engine, 'goblin', 8, 5);
    rolls.d20 = [20, 15, 1];
    await engine.startCombat([actors[0].id, actors[1].id, g.id]);
    await cast(engine, 'c0', 'haste', 3, ['c1']);
    engine.nextTurn();
    engine.nextTurn();
    engine.nextTurn(); // 过了一轮
    expect(actors[0].concentration?.spellId).toBe('haste');
  });
});

describe('希望信标 / 无痕步（不给目标 = 射程内所有存活的盟友）', () => {
  it('希望信标：感知豁免和死亡豁免优势；法术治疗取最大值；30 尺外的盟友不算', async () => {
    const { engine, rolls, actors } = setup({}, {}, {});
    actors[2].position = { col: 20, row: 5 };
    // 对照：没有信标时 cure_wounds 1d8 掷到 1
    rolls.maxOtherDice = false;
    actors[1].hp = 1;
    const control = await cast(engine, 'c0', 'cure_wounds', 1, ['c1']);
    const plain = control.heal;

    engine.beginTurn('c0');
    await cast(engine, 'c0', 'beacon_of_hope', 3, []);
    expect(actors.map((a) => a.effects.some((e) => e.maxHealing))).toEqual([true, true, false]);
    rolls.d20 = [3, 18];
    const wis = await engine.save('c1', 'wis', 10);
    expect(wis.advantage).toBe('adv');
    expect(wis.natural).toBe(18);
    rolls.d20 = [3];
    expect((await engine.save('c2', 'wis', 10)).advantage).toBe('none');
    rolls.d20 = [3, 12];
    expect((await engine.save('c1', 'con', 10)).advantage).toBe('none');

    // 死亡豁免
    actors[1].hp = 0;
    rolls.d20 = [2, 15];
    const death = await engine.rollDeathSave('c1');
    expect(death.roll.advantage).toBe('adv');
    expect(death.roll.natural).toBe(15);

    // 治疗取最大值：骰子 8 而不是 1
    actors[1].hp = 1;
    actors[1].deathSaves = { successes: 0, failures: 0, stable: false, dead: false };
    engine.beginTurn('c0');
    const boosted = await cast(engine, 'c0', 'cure_wounds', 1, ['c1']);
    expect(boosted.heal).toBe(plain + 7);
    expect(boosted.rolls[0].label).toContain('希望信标');
  });

  it('无痕步：隐匿检定 +10，只算 30 尺内的盟友', async () => {
    const { engine, rolls, actors } = setup({}, {}, {});
    actors[2].position = { col: 20, row: 5 };
    await cast(engine, 'c0', 'pass_without_trace', 2, []);
    rolls.d20 = [10, 10, 10, 10];
    const near = await engine.check('c1', 'stealth', 15);
    const far = await engine.check('c2', 'stealth', 15);
    expect(near.modifier - far.modifier).toBe(10);
    // 只管隐匿
    const other = await engine.check('c1', 'acrobatics', 15);
    expect(other.modifier).toBe(far.modifier);
    // 其他座位的盟友都吃到
    expect(actors[0].effects[0].skillBonuses).toEqual({ stealth: 10 });
    expect(actors[1].effects[0].skillBonuses).toEqual({ stealth: 10 });
    expect(actors[2].effects).toHaveLength(0);
  });
});

describe('防护毒素 / 防护善恶 / 驱散善恶', () => {
  it('防护毒素：解除中毒；对抗中毒和毒素伤害的豁免优势，别的来源不受影响；矮人韧性对毒素伤害法术也生效', async () => {
    const { engine, rolls, actors } = setup({}, { features: ['dwarven_resilience'] }, {}, {});
    actors[1].position = { col: 7, row: 5 };
    actors[2].position = { col: 4, row: 5 };
    actors[3].position = { col: 5, row: 6 };
    engine.applyCondition('c2', 'poisoned');
    await cast(engine, 'c0', 'protection_from_poison', 2, ['c2']);
    expect(engine.hasCondition(actors[2], 'poisoned')).toBe(false);
    expect(actors[2].effects.some((e) => e.resistances?.includes('poison'))).toBe(true);
    rolls.d20 = [3, 18];
    expect((await engine.save('c2', 'con', 10, { against: 'poisoned' })).advantage).toBe('adv');
    rolls.d20 = [3, 18];
    expect((await engine.save('c2', 'con', 10, { against: 'poison' })).advantage).toBe('adv');
    rolls.d20 = [3];
    expect((await engine.save('c2', 'con', 10, { against: 'charmed' })).advantage).toBe('none');
    rolls.d20 = [3];
    expect((await engine.save('c2', 'con', 10)).advantage).toBe('none');

    // 毒素伤害的法术：被保护的、矮人优势；普通人没有
    engine.beginTurn('c0');
    for (const [id, want] of [['c2', 'adv'], ['c1', 'adv'], ['c3', 'none']] as const) {
      rolls.d20 = [3, 18];
      const r = await engine.castSpell('c0', 'poison_spray', 0, [id], { ignoreKnown: true });
      expect(r.ok, id).toBe(true);
      engine.beginTurn('c0');
      expect(r.rolls[0].advantage, id).toBe(want);
    }
  });

  it('防护善恶：异怪 / 天界 / 元素 / 妖精 / 邪魔 / 亡灵打被保护的人劣势，凡人和野兽不受影响', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const sk = foe(engine, 'skeleton', 7, 5);
    const gob = foe(engine, 'goblin', 6, 6);
    const aber = foe(engine, 'goblin', 7, 6);
    aber.creatureType = 'aberration';
    const und = foe(engine, 'goblin', 4, 5);
    und.creatureType = 'undead';
    await cast(engine, 'c0', 'protection_from_evil_and_good', 1, ['c1']);
    rolls.d20 = [18, 3];
    const a = await engine.attack(sk.id, 'c1', 0);
    expect(a.attack.advantage).toBe('dis');
    expect(a.attack.natural).toBe(3);
    rolls.d20 = [12];
    expect((await engine.attack(gob.id, 'c1', 0)).attack.advantage).toBe('none');
    rolls.d20 = [18, 3];
    expect((await engine.attack(aber.id, 'c1', 0)).attack.advantage).toBe('dis');
    // 没被保护的人照常
    rolls.d20 = [12];
    expect((await engine.attack(und.id, 'c0', 0)).attack.advantage).toBe('none');
    expect(actors[1].effects[0].attackersDisadvantageFrom).toContain('undead');
  });

  it('驱散善恶：保护自己，但不包括异怪', async () => {
    const { engine, rolls, c } = setup();
    const sk = foe(engine, 'skeleton', 6, 5);
    const aber = foe(engine, 'goblin', 4, 5);
    aber.creatureType = 'aberration';
    await cast(engine, c.id, 'dispel_evil_and_good', 5, []);
    rolls.d20 = [18, 3];
    expect((await engine.attack(sk.id, c.id, 0)).attack.advantage).toBe('dis');
    rolls.d20 = [12];
    expect((await engine.attack(aber.id, c.id, 0)).attack.advantage).toBe('none');
  });
});

describe('增强属性（要选一种）', () => {
  it('没写选项：拒绝施法，不扣法术位', async () => {
    const { engine, c } = setup({}, {});
    const r = await cast(engine, c.id, 'enhance_ability', 2, ['c1']);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('要先选一种');
    expect(r.error).toContain('熊之耐力');
    expect(c.spells!.slots[2].used).toBe(0);
    expect(c.concentration).toBeNull();
    // 选项文本认不出来也一样
    const r2 = await cast(engine, c.id, 'enhance_ability', 2, ['c1'], '随便');
    expect(r2.ok).toBe(false);
  });

  it('熊之耐力：体质检定优势 + 2d6 临时 HP；别的检定没有', async () => {
    const { engine, rolls, actors } = setup({}, {});
    const r = await cast(engine, 'c0', 'enhance_ability', 2, ['c1'], '熊之耐力');
    expect(r.ok).toBe(true);
    expect(actors[1].tempHp).toBe(12);
    rolls.d20 = [3, 18];
    const con = await engine.check('c1', 'con', 10);
    expect(con.advantage).toBe('adv');
    expect(con.natural).toBe(18);
    rolls.d20 = [3];
    expect((await engine.check('c1', 'dex', 10)).advantage).toBe('none');
    rolls.d20 = [3];
    expect((await engine.check('c1', 'athletics', 10)).advantage).toBe('none');
  });

  it('猫之敏捷：敏捷检定和敏捷技能、先攻都有优势；猫头鹰认成枭之智慧不是猫', async () => {
    const { engine, rolls, log, actors } = setup({}, {});
    await cast(engine, 'c0', 'enhance_ability', 2, ['c1'], 'cat 猫之敏捷');
    rolls.d20 = [3, 18];
    expect((await engine.check('c1', 'acrobatics', 10)).advantage).toBe('adv');
    rolls.d20 = [3, 18];
    expect((await engine.check('c1', 'dex', 10)).advantage).toBe('adv');
    rolls.d20 = [3];
    expect((await engine.check('c1', 'perception', 10)).advantage).toBe('none');
    log.length = 0;
    rolls.d20 = [3, 17];
    await engine.startCombat(['c1']);
    expect(log.find((r) => r.kind === 'initiative')?.advantage).toBe('adv');
    engine.endCombat();

    actors[1].effects = [];
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'enhance_ability', 2, ['c1'], '猫头鹰之智慧');
    rolls.d20 = [3, 18];
    expect((await engine.check('c1', 'perception', 10)).advantage).toBe('adv');
    rolls.d20 = [3];
    expect((await engine.check('c1', 'dex', 10)).advantage).toBe('none');
  });

  it('升环：2 环一个目标，3 环两个', async () => {
    const { engine, actors } = setup({}, {}, {});
    actors[2].position = { col: 5, row: 6 };
    await cast(engine, 'c0', 'enhance_ability', 2, ['c1', 'c2'], '公牛之力');
    expect(actors.map((a) => a.effects.length)).toEqual([0, 1, 0]);
    actors[1].effects = [];
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'enhance_ability', 3, ['c1', 'c2'], '公牛之力');
    expect(actors.map((a) => a.effects.length)).toEqual([0, 1, 1]);
  });
});

describe('降咒术（四种诅咒）', () => {
  function curseSetup() {
    const s = setup({}, {});
    const g = foe(s.engine, 'goblin', 5, 6);
    return { ...s, g };
  }

  it('没选 / 选不出来：拒绝施法，不扣法术位', async () => {
    const { engine, c, g } = curseSetup();
    const r = await cast(engine, c.id, 'bestow_curse', 3, [g.id]);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('要先选一种');
    expect(c.spells!.slots[3].used).toBe(0);
  });

  it('豁免成功：什么都不挂', async () => {
    const { engine, rolls, c, g } = curseSetup();
    rolls.d20 = [20];
    const r = await cast(engine, c.id, 'bestow_curse', 3, [g.id], '力量');
    expect(r.ok).toBe(true);
    expect(g.effects).toHaveLength(0);
    expect(c.effects).toHaveLength(0);
    expect(c.spells!.slots[3].used).toBe(1);
  });

  it('属性诅咒：该属性的检定和豁免劣势，别的属性不受影响', async () => {
    const { engine, rolls, c, g } = curseSetup();
    rolls.d20 = [2];
    await cast(engine, c.id, 'bestow_curse', 3, [g.id], '力量检定与豁免劣势');
    expect(g.effects[0].name).toContain('力量');
    rolls.d20 = [15, 4];
    const save = await engine.save(g.id, 'str', 10);
    expect(save.advantage).toBe('dis');
    expect(save.natural).toBe(4);
    rolls.d20 = [15, 4];
    expect((await engine.check(g.id, 'athletics', 10)).advantage).toBe('dis');
    rolls.d20 = [15];
    expect((await engine.check(g.id, 'stealth', 10)).advantage).toBe('none');
    rolls.d20 = [15];
    expect((await engine.save(g.id, 'dex', 10)).advantage).toBe('none');
  });

  it('攻击诅咒：它打你劣势，打别人不受影响', async () => {
    const { engine, rolls, c, g } = curseSetup();
    rolls.d20 = [2];
    await cast(engine, c.id, 'bestow_curse', 3, [g.id], '对你的攻击检定劣势');
    rolls.d20 = [18, 3];
    const at = await engine.attack(g.id, c.id, 0);
    expect(at.attack.advantage).toBe('dis');
    engine.beginTurn(g.id);
    rolls.d20 = [18];
    expect((await engine.attack(g.id, 'c1', 0)).attack.advantage).toBe('none');
  });

  it('额外伤害诅咒：你的武器攻击和法术攻击命中它都额外 1d8 黯蚀，打别人没有；专注断了就没', async () => {
    const { engine, rolls, c, g } = curseSetup();
    const other = foe(engine, 'goblin', 4, 5);
    rolls.d20 = [2];
    await cast(engine, c.id, 'bestow_curse', 3, [g.id], '额外伤害');
    expect(c.effects[0].bonusDamage).toMatchObject({ dice: '1d8', damageType: 'necrotic', against: g.id, spellAttacks: true });

    rolls.d20 = [19];
    const weapon = await engine.attack(c.id, g.id, 0, { noSlot: true });
    expect(weapon.hit).toBe(true);
    expect(weapon.extraRolls?.some((r) => r.damageType === 'necrotic')).toBe(true);

    engine.beginTurn(c.id);
    rolls.d20 = [19];
    const spell = await cast(engine, c.id, 'fire_bolt', 0, [g.id]);
    expect(spell.rolls.some((r) => r.damageType === 'necrotic' && r.label.includes('额外伤害'))).toBe(true);

    engine.beginTurn(c.id);
    rolls.d20 = [19];
    const elsewhere = await cast(engine, c.id, 'fire_bolt', 0, [other.id]);
    expect(elsewhere.rolls.some((r) => r.damageType === 'necrotic')).toBe(false);

    engine.applyCondition(c.id, 'incapacitated');
    expect(g.effects).toHaveLength(0);
    expect(c.effects.some((e) => e.bonusDamage)).toBe(false);
  });
});

describe('缓慢术', () => {
  it('失败的目标：AC -2、敏捷豁免 -2、速度减半、不能反应；成功的不受影响', async () => {
    const { engine, rolls, c } = setup();
    const a = foe(engine, 'goblin', 5, 6);
    const b = foe(engine, 'goblin', 4, 5);
    const d = foe(engine, 'goblin', 4, 6);
    rolls.d20 = [1, 20, 1];
    const r = await cast(engine, c.id, 'slow', 3, [a.id, b.id, d.id]);
    expect(r.ok).toBe(true);
    expect(engine.acOf(a)).toBe(13);
    expect(engine.acOf(b)).toBe(15);
    expect(engine.speedOf(a)).toBe(15);
    expect(engine.speedOf(b)).toBe(30);
    rolls.d20 = [10, 10];
    expect((await engine.save(a.id, 'dex', 10)).modifier).toBe(0); // 敏捷 +2 再 -2
    expect((await engine.save(b.id, 'dex', 10)).modifier).toBe(2);
    await expect(engine.attack(a.id, c.id, 0, { reaction: true })).rejects.toThrow(/不能用反应/);
    expect(a.effects[0].endSave).toEqual({ ability: 'wis', dc: 14 });
  });

  it('每个 Attack 动作只剩一次攻击（斥候本来两次）', async () => {
    const { engine, rolls, c } = setup();
    const slowed = foe(engine, 'scout', 6, 5);
    const free = foe(engine, 'scout', 4, 5);
    expect((await engine.attackAction(free.id, c.id, '短剑')).length).toBe(2);
    rolls.d20 = [1];
    await cast(engine, c.id, 'slow', 3, [slowed.id]);
    engine.beginTurn(slowed.id);
    expect((await engine.attackAction(slowed.id, c.id, '短剑')).length).toBe(1);
  });

  it('每个回合结束再豁免：成功就摆脱，失败继续', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 5, 6);
    rolls.d20 = [20, 1];
    await engine.startCombat([c.id, g.id]);
    rolls.d20 = [1];
    await cast(engine, c.id, 'slow', 3, [g.id]);
    await engine.advanceTurn(); // c 结束，轮到地精
    expect(engine.currentActor()?.id).toBe(g.id);
    rolls.d20 = [2];
    const stay = await engine.advanceTurn();
    expect(stay.rolls.some((r) => r.label.includes('回合结束再豁免'))).toBe(true);
    expect(g.effects.some((e) => e.endSave)).toBe(true);
    await engine.advanceTurn();
    expect(engine.currentActor()?.id).toBe(g.id);
    rolls.d20 = [20];
    const out = await engine.advanceTurn();
    expect(out.notes.some((n) => n.includes('摆脱了'))).toBe(true);
    expect(g.effects.some((e) => e.endSave)).toBe(false);
    expect(engine.acOf(g)).toBe(15);
  });
});

describe('圣洁光环 / 预知术 / 难以抗拒之舞', () => {
  it('圣洁光环：30 尺内的盟友所有豁免（含死亡豁免）有优势，打它们劣势；30 尺外没有', async () => {
    const { engine, rolls, actors } = setup({}, {}, {});
    actors[2].position = { col: 20, row: 5 };
    const g = foe(engine, 'goblin', 6, 6);
    await cast(engine, 'c0', 'holy_aura', 8, []);
    rolls.d20 = [3, 18];
    expect((await engine.save('c1', 'str', 10)).advantage).toBe('adv');
    rolls.d20 = [3];
    expect((await engine.save('c2', 'str', 10)).advantage).toBe('none');
    rolls.d20 = [18, 3];
    expect((await engine.attack(g.id, 'c1', 0)).attack.advantage).toBe('dis');
    actors[1].hp = 0;
    rolls.d20 = [2, 15];
    expect((await engine.rollDeathSave('c1')).roll.advantage).toBe('adv');
  });

  it('预知术：攻击、检定（含先攻）、豁免都有优势；打它劣势', async () => {
    const { engine, rolls, log, actors } = setup({}, {});
    const g = foe(engine, 'goblin', 6, 6);
    await cast(engine, 'c0', 'foresight', 9, ['c1']);
    rolls.d20 = [3, 17];
    const hit = await engine.attack('c1', g.id, 0);
    expect(hit.attack.advantage).toBe('adv');
    expect(hit.attack.natural).toBe(17);
    rolls.d20 = [3, 17];
    expect((await engine.check('c1', 'stealth', 10)).advantage).toBe('adv');
    rolls.d20 = [3, 17];
    expect((await engine.save('c1', 'wis', 10)).advantage).toBe('adv');
    rolls.d20 = [18, 3];
    expect((await engine.attack(g.id, 'c1', 0)).attack.advantage).toBe('dis');
    log.length = 0;
    rolls.d20 = [3, 17, 10];
    await engine.startCombat(['c1', g.id]);
    expect(log.find((r) => r.kind === 'initiative' && r.actorId === 'c1')?.advantage).toBe('adv');
    expect(actors[0].effects).toHaveLength(0);
  });

  it('难以抗拒之舞：速度 0、敏捷豁免和攻击劣势、别人打它优势；免疫魅惑的不受影响', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    const armor = foe(engine, 'animated_armor', 6, 6);
    const r = await cast(engine, c.id, 'irresistible_dance', 6, [g.id]);
    expect(r.ok).toBe(true);
    expect(engine.speedOf(g)).toBe(0);
    rolls.d20 = [15, 4];
    expect((await engine.save(g.id, 'dex', 10)).advantage).toBe('dis');
    rolls.d20 = [18, 3];
    expect((await engine.attack(g.id, c.id, 0)).attack.advantage).toBe('dis');
    rolls.d20 = [3, 17];
    expect((await engine.attack(c.id, g.id, 0, { noSlot: true })).attack.advantage).toBe('adv');

    engine.beginTurn(c.id);
    const r2 = await cast(engine, c.id, 'irresistible_dance', 6, [armor.id]);
    expect(r2.notes.some((n) => n.includes('免疫魅惑'))).toBe(true);
    expect(armor.effects).toHaveLength(0);
  });
});

describe('按生物类型区别对待的豁免', () => {
  it('枯萎术：亡灵、构装体不受影响；植物豁免劣势且受最大伤害', async () => {
    const { engine, rolls, c } = setup();
    const sk = foe(engine, 'skeleton', 6, 5);
    const r = await cast(engine, c.id, 'blight', 4, [sk.id]);
    expect(r.ok).toBe(true);
    expect(r.rolls).toHaveLength(0);
    expect(sk.hp).toBe(300);
    expect(r.notes.some((n) => n.includes('无效'))).toBe(true);
    expect(c.spells!.slots[4].used).toBe(1);

    const plant = foe(engine, 'goblin', 4, 5);
    plant.creatureType = 'plant';
    engine.beginTurn(c.id);
    rolls.maxOtherDice = false; // 骰子都是 1：8d8 = 8，取最大值才是 64
    rolls.d20 = [18, 2];
    const r2 = await cast(engine, c.id, 'blight', 4, [plant.id]);
    expect(r2.rolls[0].advantage).toBe('dis');
    expect(r2.rolls[0].natural).toBe(2);
    expect(r2.damage).toBe(64);
    expect(plant.hp).toBe(236);
  });

  it('日爆术：亡灵和软泥怪豁免劣势，其他人不受影响', async () => {
    const { engine, rolls, c } = setup();
    const sk = foe(engine, 'skeleton', 6, 5);
    const gob = foe(engine, 'goblin', 4, 5);
    rolls.d20 = [18, 3, 10];
    const r = await cast(engine, c.id, 'sunburst', 8, [sk.id, gob.id]);
    expect(r.rolls[0].advantage).toBe('dis');
    expect(r.rolls[0].natural).toBe(3);
    const gobSave = r.rolls.find((x) => x.kind === 'save' && x.actorId === gob.id)!;
    expect(gobSave.advantage).toBe('none');
  });

  it('粉碎音波：构装体豁免劣势', async () => {
    const { engine, rolls, c } = setup();
    const armor = foe(engine, 'animated_armor', 6, 5);
    rolls.d20 = [18, 3];
    const r = await cast(engine, c.id, 'shatter', 2, [armor.id]);
    expect(r.rolls[0].advantage).toBe('dis');
  });
});

describe('存档和数据', () => {
  it('存档来回一趟，克敌先击的待生效状态还在，到时候照样生效', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20 = [20, 1];
    await engine.startCombat([c.id, g.id]);
    await cast(engine, c.id, 'true_strike', 0, [g.id]);
    const saved = JSON.parse(JSON.stringify(engine.snapshot())) as Parameters<RulesEngine['load']>[0];
    const rolls2 = new ScriptedRollSource();
    const e2 = new RulesEngine({ rollSource: rolls2 });
    e2.load(saved);
    const c2 = e2.require(c.id);
    expect(c2.effects[0]).toMatchObject({ armedAtTurnOf: c.id, untilEndOfTurnOf: c.id });
    e2.nextTurn();
    e2.nextTurn();
    rolls2.d20 = [4, 17];
    const hit = await e2.attack(c.id, g.id, 0);
    expect(hit.attack.advantage).toBe('adv');
  });

  it('挂到角色身上的修正是拷贝，改它不会改到法术数据', async () => {
    const { engine, rolls, c } = setup({}, {});
    rolls.d20 = [3];
    await cast(engine, c.id, 'holy_aura', 8, []);
    const eff = c.effects[0];
    eff.saveEdges![0].state = 'dis';
    expect((SPELLS.holy_aura.effect as { saveEdges?: { state: string }[] }).saveEdges![0].state).toBe('adv');
  });
});

describe('数据：needs 标签和机制对得上', () => {
  it('已自动结算的 roll_modifier 法术不再带这个标签，剩下的还带', () => {
    const done = [
      'shocking_grasp', 'true_strike', 'vicious_mockery', 'protection_from_evil_and_good', 'enhance_ability', 'enthrall',
      'pass_without_trace', 'protection_from_poison', 'shatter', 'beacon_of_hope', 'bestow_curse', 'haste', 'slow',
      'blight', 'dispel_evil_and_good', 'irresistible_dance', 'sunbeam', 'holy_aura', 'sunburst', 'foresight',
    ];
    for (const id of done) expect(SPELLS[id].needs ?? [], id).not.toContain('roll_modifier');
    const left = Object.values(SPELLS).filter((s) => s.needs?.includes('roll_modifier')).map((s) => s.id).sort();
    expect(left).toEqual(['contagion', 'heat_metal', 'magic_circle', 'ray_of_enfeeblement']);
  });

  it('每个选项都能被自己的关键词认出来，而且不被排在前面的选项抢走', () => {
    for (const def of Object.values(SPELLS)) {
      if (!def.choices) continue;
      for (const [i, choice] of def.choices.entries()) {
        for (const key of choice.match) {
          const hit = def.choices.findIndex((c) => c.match.some((k) => key.toLowerCase().includes(k.toLowerCase())));
          // 关键词整串去匹配时，第一个命中的选项必须是它自己（或排在它前面的同义选项不存在）
          expect(hit, `${def.id}:${choice.key}:${key}`).toBe(i);
        }
      }
    }
  });
});
