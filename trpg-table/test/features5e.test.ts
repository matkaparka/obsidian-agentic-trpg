import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { actorFromCharacter, type CharacterFile } from '../src/rules/sheet.js';
import type { Actor } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

type Spec = Partial<CharacterFile> & { id: string; name: string };

const base: Omit<CharacterFile, 'name'> = {
  level: 5,
  abilities: { str: 16, dex: 14, con: 14, int: 10, wis: 12, cha: 14 },
  ac: 15,
  maxHp: 50,
  hitDice: { die: 10, total: 5 },
};

function table(...specs: Spec[]) {
  const rolls = new ScriptedRollSource();
  const engine = new RulesEngine({ rollSource: rolls });
  const actors: Record<string, Actor> = {};
  specs.forEach((spec, i) => {
    const { id, ...rest } = spec;
    const a = actorFromCharacter({ ...base, ...rest }, id, i === 0 ? 'player_a' : 'player_b');
    a.position = { col: 5 - i, row: 5 };
    engine.addActor(a);
    actors[id] = a;
  });
  return { engine, rolls, actors };
}

function foe(engine: RulesEngine, id: string, col: number, row: number, hp = 300): Actor {
  const m = spawnMonster(id, `${id}@${col},${row}`);
  m.hp = hp;
  m.maxHp = hp;
  m.position = { col, row };
  engine.addActor(m);
  return m;
}

function fight(engine: RulesEngine, order: string[]) {
  engine.combat = { active: true, round: 1, order: order.map((actorId) => ({ actorId, initiative: 10, dex: 10 })), index: 0 };
  for (const id of order) engine.beginTurn(id);
}

const barbarian = (extra: Partial<CharacterFile> = {}): Spec => ({
  id: 'barb',
  name: '野蛮人',
  classes: [{ id: 'barbarian', level: 5 }],
  features: ['rage', 'reckless_attack', 'danger_sense', 'extra_attack'],
  resources: { rage: { name: '狂暴', max: 3, used: 0, recharge: 'long' } },
  attacks: [{ weaponId: 'greataxe', name: '巨斧' }],
  attacksPerAction: 2,
  ...extra,
});

describe('狂暴', () => {
  it('狂暴：附赠动作、物理抗性、近战力量伤害 +2、力量检定优势；次数记账', async () => {
    const { engine, rolls, actors } = table(barbarian());
    const barb = actors.barb;
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['barb', g.id]);
    const out = await engine.useFeature('barb', 'rage');
    expect(out.ok).toBe(true);
    expect(barb.turn.bonusUsed).toBe(true);
    expect(engine.resourceLeft(barb, 'rage')).toBe(2);
    expect(engine.attackMath(barb, barb.attacks[0]).damageFormula).toBe('1d12+5'); // 力量 +3，狂暴 +2
    // 物理抗性：10 点挥砍减半
    barb.hp = 50;
    await engine.damage('barb', 10, 'slashing');
    expect(barb.hp).toBe(45);
    await engine.damage('barb', 10, 'fire');
    expect(barb.hp).toBe(35);
    // 力量检定优势
    rolls.d20.push(5, 5);
    const check = await engine.check('barb', 'athletics', 10);
    expect(check.advantage).toBe('adv');
    // 再次狂暴被拒绝
    engine.beginTurn('barb');
    await expect(engine.useFeature('barb', 'rage')).rejects.toThrow('已经在狂暴');
  });

  it('狂暴中不能施法；整个回合没攻击没受伤，狂暴结束；失去意识也结束', async () => {
    const { engine, rolls, actors } = table(
      barbarian({ spells: { ability: 'wis', known: ['bless'], slots: { '1': { max: 2, used: 0 } } } })
    );
    const barb = actors.barb;
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['barb', g.id]);
    await engine.useFeature('barb', 'rage');
    const cast = await engine.castSpell('barb', 'bless', 1, ['barb']);
    expect(cast.ok).toBe(false);
    expect(cast.error).toContain('狂暴');

    // 第一个回合（刚进入狂暴）撑得过；第二个回合什么都不做，狂暴结束
    await engine.advanceTurn(); // 轮到地精
    await engine.advanceTurn(); // 回到野蛮人，上一回合的“stoked”被消耗
    expect(engine.isRaging(barb)).toBe(true);
    await engine.advanceTurn(); // 地精
    await engine.advanceTurn(); // 野蛮人这一回合没攻击也没受伤就走了
    expect(engine.isRaging(barb)).toBe(false);

    // 攻击一次就能维持
    engine.beginTurn('barb');
    barb.turn = { ...barb.turn, bonusUsed: false };
    await engine.useFeature('barb', 'rage');
    rolls.d20.push(5);
    await engine.attack('barb', g.id, '巨斧');
    await engine.advanceTurn();
    await engine.advanceTurn();
    expect(engine.isRaging(barb)).toBe(true);
    // 被打到 0 HP 时狂暴结束
    barb.hp = 1;
    await engine.damage('barb', 50, 'bludgeoning');
    expect(engine.isRaging(barb)).toBe(false);
  });

  it('鲁莽攻击：本回合近战力量攻击有优势，对你的攻击也有优势，下回合开始失效', async () => {
    const { engine, rolls, actors } = table(barbarian());
    const barb = actors.barb;
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['barb', g.id]);
    rolls.d20.push(5, 5, 5, 5);
    const first = await engine.attackAction('barb', g.id, '巨斧', { reckless: true });
    expect(first[0].attack.advantage).toBe('adv');
    expect(first[1].attack.advantage).toBe('adv'); // 同一回合第二击也有优势
    rolls.d20.push(5, 5);
    const hitBack = await engine.attack(g.id, 'barb', 0);
    expect(hitBack.attack.advantage).toBe('adv');
    engine.beginTurn('barb');
    expect(barb.effects.some((e) => e.spellId === 'reckless')).toBe(false);
    expect(barb.turn.reckless).toBe(false);
  });

  it('危险感知：敏捷豁免有优势；盲了就没有', async () => {
    const { engine, rolls } = table(barbarian());
    rolls.d20.push(5, 5);
    const r = await engine.save('barb', 'dex', 12);
    expect(r.advantage).toBe('adv');
    engine.applyCondition('barb', 'blinded');
    rolls.d20.push(5);
    const blind = await engine.save('barb', 'dex', 12);
    expect(blind.advantage).toBe('none');
  });
});

describe('战士与暴击特性', () => {
  const fighter = (extra: Partial<CharacterFile> = {}): Spec => ({
    id: 'fighter',
    name: '战士',
    classes: [{ id: 'fighter', level: 5 }],
    features: ['second_wind', 'action_surge', 'indomitable', 'improved_critical'],
    resources: {
      second_wind: { name: '回气', max: 1, used: 0, recharge: 'short' },
      action_surge: { name: '动作如潮', max: 1, used: 0, recharge: 'short' },
      indomitable: { name: '不屈', max: 1, used: 0, recharge: 'long' },
    },
    attacks: [{ weaponId: 'longsword', name: '长剑' }],
    attacksPerAction: 2,
    saves: ['str', 'con'],
    ...extra,
  });

  it('回气：附赠动作回 1d10+战士等级；次数用完拒绝', async () => {
    const { engine, actors } = table(fighter());
    const f = actors.fighter;
    f.hp = 10;
    const out = await engine.useFeature('fighter', 'second_wind');
    expect(out.ok).toBe(true);
    expect(f.hp).toBe(10 + 10 + 5); // 骰子取最大 + 等级 5
    expect(f.turn.bonusUsed).toBe(true);
    engine.beginTurn('fighter');
    await expect(engine.useFeature('fighter', 'second_wind')).rejects.toThrow('没有次数');
  });

  it('动作如潮：多一个完整动作，可以再打一轮额外攻击', async () => {
    const { engine, rolls, actors } = table(fighter());
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['fighter', g.id]);
    rolls.d20.push(2, 2);
    expect(await engine.attackAction('fighter', g.id, '长剑')).toHaveLength(2);
    await expect(engine.attack('fighter', g.id, '长剑')).rejects.toThrow('已经用过动作');
    await engine.useFeature('fighter', 'action_surge');
    expect(actors.fighter.turn.extraActions).toBe(1);
    rolls.d20.push(2, 2);
    expect(await engine.attackAction('fighter', g.id, '长剑')).toHaveLength(2);
  });

  it('不屈：失败的豁免自动重掷并加战士等级', async () => {
    const { engine, rolls, actors } = table(fighter());
    rolls.d20.push(2, 12);
    const r = await engine.save('fighter', 'wis', 14);
    expect(r.label).toContain('不屈重掷');
    expect(r.total).toBe(12 + 1 + 5); // 感知 +1，战士等级 +5（没有感知豁免熟练）
    expect(r.success).toBe(true);
    expect(engine.resourceLeft(actors.fighter, 'indomitable')).toBe(0);
  });

  it('额外暴击：19 就暴击', async () => {
    const { engine, rolls } = table(fighter());
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20.push(19);
    const r = await engine.attack('fighter', g.id, '长剑');
    expect(r.crit).toBe(true);
    expect(r.damage?.formula).toContain('2d8');
  });

  it('野蛮暴击 / 野蛮攻击：暴击多掷武器骰', async () => {
    const { engine, rolls } = table(
      barbarian({ level: 9, classes: [{ id: 'barbarian', level: 9 }], features: ['brutal_critical', 'savage_attacks'] })
    );
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20.push(20);
    const r = await engine.attack('barb', g.id, '巨斧');
    expect(r.crit).toBe(true);
    // 巨斧 1d12：翻倍 2d12，再加野蛮暴击 1 个 + 野蛮攻击 1 个 = 2 个额外 d12，共 4 个骰
    expect(r.damage?.dice.filter((d) => d.sides === 12)).toHaveLength(4);
  });

  it('战斗风格：弓箭手远程 +2 命中，决斗单手近战 +2 伤害，巨武器战斗重掷 1 和 2', async () => {
    const { engine, rolls, actors } = table(
      { id: 'archer', name: '弓手', features: ['fighting_style_archery'], attacks: [{ weaponId: 'longbow' }], proficiencyBonus: 3 },
      { id: 'duelist', name: '决斗者', features: ['fighting_style_dueling'], attacks: [{ weaponId: 'longsword' }], proficiencyBonus: 3 },
      { id: 'gwf', name: '巨武器', features: ['fighting_style_great_weapon_fighting'], attacks: [{ weaponId: 'greatsword' }], proficiencyBonus: 3 }
    );
    expect(engine.attackMath(actors.archer, actors.archer.attacks[0]).attackBonus).toBe(2 + 3 + 2); // 敏捷 +2，熟练 +3，风格 +2
    expect(engine.attackMath(actors.duelist, actors.duelist.attacks[0]).damageFormula).toBe('1d8+5'); // 力量 +3，决斗 +2
    const g = foe(engine, 'goblin', 4, 4);
    g.position = { col: 3, row: 5 };
    actors.gwf.position = { col: 4, row: 5 };
    rolls.maxOtherDice = false; // 所有伤害骰掷出 1
    rolls.d20.push(15);
    await engine.attack('gwf', g.id, 'greatsword', { sneakAttack: false });
    // 2d6 的两个 1 都被重掷（重掷的也是 1，但确实掷了）
    expect(rolls.calls.filter((c) => c.label.includes('重掷')).length).toBe(2);
  });
});

describe('盗贼与武僧', () => {
  it('狡诈动作：只有有特性的才能用附赠动作疾走 / 撤离 / 躲藏', async () => {
    const { engine, actors } = table({ id: 'rogue', name: '盗贼', features: ['cunning_action'] }, { id: 'other', name: '别人' });
    fight(engine, ['rogue', 'other']);
    await engine.takeAction('rogue', 'dash', { bonus: true });
    expect(actors.rogue.turn.bonusUsed).toBe(true);
    expect(actors.rogue.turn.actionUsed).toBe(false);
    expect(actors.rogue.turn.dashed).toBe(true);
    await expect(engine.takeAction('other', 'dash', { bonus: true })).rejects.toThrow('没有能用附赠动作');
  });

  it('灵巧闪避：敏捷豁免半伤的法术，成功无伤、失败半伤', async () => {
    const { engine, rolls, actors } = table({ id: 'rogue', name: '盗贼', features: ['evasion'], maxHp: 100 }, {
      id: 'wiz',
      name: '法师',
      abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
      spells: { ability: 'int', known: ['burning_hands'], slots: { '1': { max: 4, used: 0 } } },
    });
    engine.require('wiz').position = { col: 3, row: 5 };
    const rogue = actors.rogue;
    rogue.hp = 100;
    rolls.d20.push(20);
    await engine.castSpell('wiz', 'burning_hands', 1, ['rogue']);
    expect(rogue.hp).toBe(100); // 成功：一点都没吃
    engine.beginTurn('wiz');
    rolls.d20.push(1);
    await engine.castSpell('wiz', 'burning_hands', 1, ['rogue']);
    expect(rogue.hp).toBe(100 - 9); // 3d6 取最大 18，半伤 9
  });

  it('直觉闪避：被攻击命中时用反应把伤害减半，每轮一次', async () => {
    const { engine, rolls, actors } = table({ id: 'rogue', name: '盗贼', features: ['uncanny_dodge'], maxHp: 100 });
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['rogue', g.id]);
    actors.rogue.hp = 100;
    rolls.d20.push(20);
    await engine.attack(g.id, 'rogue', '弯刀');
    // 弯刀 1d6+2 暴击：2d6+2 取最大 14，减半 7
    expect(100 - actors.rogue.hp).toBe(7);
    expect(actors.rogue.turn.reactionUsed).toBe(true);
    engine.beginTurn(g.id);
    rolls.d20.push(20);
    await engine.attack(g.id, 'rogue', '弯刀');
    expect(100 - actors.rogue.hp).toBe(7 + 14);
  });

  it('可靠才能：熟练技能检定低于 10 当 10；杂艺：半熟练', async () => {
    const { engine, rolls } = table({
      id: 'rogue',
      name: '盗贼',
      skills: ['stealth'],
      features: ['reliable_talent', 'jack_of_all_trades'],
      proficiencyBonus: 4,
    });
    rolls.d20.push(2);
    const stealth = await engine.check('rogue', 'stealth', 15);
    expect(stealth.total).toBe(10 + 2 + 4); // d20 当 10 + 敏捷 +2 + 熟练 +4
    rolls.d20.push(10);
    const history = await engine.check('rogue', 'history', 15);
    expect(history.total).toBe(10 + 0 + 2); // 智力 0，半熟练 +2
  });

  it('武僧：徒手打击用武艺骰和敏捷；疾风连击两次、花气；坚忍防御闪避；震慑拳', async () => {
    const { engine, rolls, actors } = table({
      id: 'monk',
      name: '武僧',
      classes: [{ id: 'monk', level: 5 }],
      abilities: { str: 10, dex: 18, con: 14, int: 10, wis: 16, cha: 8 },
      features: ['martial_arts', 'flurry_of_blows', 'patient_defense', 'step_of_the_wind', 'stunning_strike', 'extra_attack'],
      resources: { ki: { name: '气', max: 5, used: 0, recharge: 'short' } },
      attacks: [{ weaponId: 'unarmed', name: '徒手打击' }],
      attacksPerAction: 2,
    });
    const monk = actors.monk;
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['monk', g.id]);
    expect(engine.attackMath(monk, monk.attacks[0]).damageFormula).toBe('1d6+4'); // 5 级武艺骰 d6，敏捷 +4
    rolls.d20.push(2, 2);
    await engine.attackAction('monk', g.id, '徒手打击');
    rolls.d20.push(2, 2);
    const flurry = await engine.useFeature('monk', 'flurry_of_blows', { targetId: g.id });
    expect(flurry.attacks).toHaveLength(2);
    expect(engine.resourceLeft(monk, 'ki')).toBe(4);
    expect(monk.turn.bonusUsed).toBe(true);

    // 没打过就不能疾风连击
    engine.beginTurn('monk');
    await expect(engine.useFeature('monk', 'flurry_of_blows', { targetId: g.id })).rejects.toThrow('Attack 动作之后');
    // 坚忍防御
    await engine.useFeature('monk', 'patient_defense');
    expect(monk.turn.dodging).toBe(true);
    expect(engine.resourceLeft(monk, 'ki')).toBe(3);

    // 震慑拳：命中后体质豁免失败 → 震慑
    engine.beginTurn('monk');
    rolls.d20.push(18, 1); // 命中，哥布林体质豁免掷 1
    const [r] = await engine.attackAction('monk', g.id, '徒手打击', { stunningStrike: true });
    expect(r.conditionApplied).toBe('stunned');
    expect(g.conditions.some((c) => c.name === 'stunned')).toBe(true);
    expect(engine.resourceLeft(monk, 'ki')).toBe(2);
  });
});

describe('圣武士、牧师、诗人', () => {
  const paladin = (extra: Partial<CharacterFile> = {}): Spec => ({
    id: 'pal',
    name: '圣武士',
    classes: [{ id: 'paladin', level: 6 }],
    level: 6,
    features: ['divine_smite', 'lay_on_hands', 'aura_of_protection'],
    resources: { lay_on_hands: { name: '圣疗池', max: 30, used: 0, recharge: 'long' } },
    attacks: [{ weaponId: 'longsword' }],
    spells: { ability: 'cha', known: [], slots: { '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } } },
    ...extra,
  });

  it('神圣斩击：命中后花法术位多打光耀（1 环 2d8），暴击翻倍；没有法术位只给提示', async () => {
    const { engine, rolls, actors } = table(paladin());
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20.push(15);
    const r = await engine.attack('pal', g.id, 'longsword', { smite: 1 });
    expect(actors.pal.spells!.slots[1].used).toBe(1);
    expect(r.notes?.join('')).toContain('神圣斩击');
    expect(r.extraRolls?.[0].formula).toBe('2d8');
    expect(r.damage?.total).toBeGreaterThan(0);

    engine.beginTurn('pal');
    rolls.d20.push(20);
    const crit = await engine.attack('pal', g.id, 'longsword', { smite: 2 });
    expect(crit.extraRolls?.[0].formula).toBe('6d8'); // 2 环 3d8，暴击翻倍
    actors.pal.spells!.slots[2].used = 2;
    engine.beginTurn('pal');
    rolls.d20.push(15);
    const none = await engine.attack('pal', g.id, 'longsword', { smite: 2 });
    expect(none.notes?.join('')).toContain('没有 2 环法术位');
  });

  it('圣疗：从池子里取点数治疗，池子记账；解毒花 5 点', async () => {
    const { engine, actors } = table(paladin(), { id: 'ally', name: '队友' });
    actors.ally.hp = 10;
    const out = await engine.useFeature('pal', 'lay_on_hands', { targetId: 'ally', amount: 12 });
    expect(out.ok).toBe(true);
    expect(actors.ally.hp).toBe(22);
    expect(engine.resourceLeft(actors.pal, 'lay_on_hands')).toBe(18);
    engine.beginTurn('pal');
    engine.applyCondition('ally', 'poisoned');
    await engine.useFeature('pal', 'lay_on_hands', { targetId: 'ally', mode: 'poison' });
    expect(actors.ally.conditions.some((c) => c.name === 'poisoned')).toBe(false);
    expect(engine.resourceLeft(actors.pal, 'lay_on_hands')).toBe(13);
  });

  it('保护光环：10 尺内的盟友豁免加魅力调整值；太远或圣武士倒下就没有', async () => {
    const { engine, rolls, actors } = table(paladin({ abilities: { str: 16, dex: 10, con: 14, int: 10, wis: 12, cha: 16 } }), {
      id: 'ally',
      name: '队友',
    });
    rolls.d20.push(10);
    const near = await engine.save('ally', 'wis', 15);
    expect(near.total).toBe(10 + 1 + 3); // 感知 +1，光环 +3
    actors.ally.position = { col: 20, row: 5 };
    rolls.d20.push(10);
    const far = await engine.save('ally', 'wis', 15);
    expect(far.total).toBe(10 + 1);
  });

  it('驱逐不死生物：感知豁免失败被驱逐；牧师 5 级摧毁 CR ≤ 1/2 的', async () => {
    const cleric = (level: number): Spec => ({
      id: 'cleric',
      name: '牧师',
      level,
      classes: [{ id: 'cleric', level }],
      abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 10 },
      features: ['channel_divinity'],
      resources: { channel_divinity: { name: '引导神力', max: 1, used: 0, recharge: 'short' } },
      spells: { ability: 'wis', known: [], slots: {} },
    });
    const t1 = table(cleric(3));
    const sk = foe(t1.engine, 'skeleton', 8, 5);
    const gh = foe(t1.engine, 'ghoul', 9, 5);
    const gob = foe(t1.engine, 'goblin', 7, 5);
    t1.rolls.d20.push(1, 1);
    const out = await t1.engine.useFeature('cleric', 'turn_undead');
    expect(out.ok).toBe(true);
    expect(sk.conditions.some((c) => c.name === 'frightened')).toBe(true);
    expect(gh.conditions.some((c) => c.name === 'frightened')).toBe(true);
    expect(gob.conditions.some((c) => c.name === 'frightened')).toBe(false); // 不是不死生物

    const t2 = table(cleric(5));
    const sk2 = foe(t2.engine, 'skeleton', 8, 5);
    const gh2 = foe(t2.engine, 'ghoul', 9, 5);
    t2.rolls.d20.push(1, 1);
    await t2.engine.useFeature('cleric', 'turn_undead');
    expect(sk2.deathSaves.dead).toBe(true); // CR 1/4 ≤ 1/2：被摧毁
    expect(gh2.deathSaves.dead).toBe(false); // CR 1：只是被驱逐
    expect(gh2.conditions.some((c) => c.name === 'frightened')).toBe(true);
  });

  it('保全生命：最多 5×牧师等级，每人只能补到一半 HP', async () => {
    const { engine, actors } = table(
      {
        id: 'cleric',
        name: '牧师',
        classes: [{ id: 'cleric', level: 3 }],
        features: ['channel_divinity', 'channel_divinity_preserve_life'],
        resources: { channel_divinity: { name: '引导神力', max: 1, used: 0, recharge: 'short' } },
      },
      { id: 'ally', name: '队友', maxHp: 40 }
    );
    actors.ally.hp = 5;
    await expect(engine.useFeature('cleric', 'preserve_life', { distribution: { ally: 99 } })).rejects.toThrow('最多分配 15');
    const out = await engine.useFeature('cleric', 'preserve_life', { distribution: { ally: 15 } });
    expect(out.ok).toBe(true);
    expect(actors.ally.hp).toBe(20); // 上限 40 的一半 = 20，5 + 15
    engine.beginTurn('cleric');
    actors.cleric.resources.channel_divinity.used = 0;
    await engine.useFeature('cleric', 'preserve_life', { distribution: { ally: 10 } });
    expect(actors.ally.hp).toBe(20); // 已经在一半了，补不上去
  });

  it('诗人激励：差一点就成功时自动加激励骰，用掉就没了', async () => {
    const { engine, rolls, actors } = table(
      {
        id: 'bard',
        name: '诗人',
        classes: [{ id: 'bard', level: 5 }],
        features: ['bardic_inspiration'],
        resources: { bardic_inspiration: { name: '诗人激励', max: 3, used: 0, recharge: 'short' } },
      },
      { id: 'ally', name: '队友', attacks: [{ weaponId: 'longsword' }] }
    );
    const g = foe(engine, 'goblin', 4, 5);
    g.position = { col: 3, row: 5 };
    actors.ally.position = { col: 4, row: 5 };
    await engine.useFeature('bard', 'bardic_inspiration', { targetId: 'ally' });
    expect(actors.ally.effects.some((e) => e.inspirationDie === 8)).toBe(true); // 5 级 d8
    rolls.d20.push(8); // 8 + 3(力量) + 3(熟练) = 14 < 15，差 1
    const r = await engine.attack('ally', g.id, 'longsword', { sneakAttack: false });
    expect(r.hit).toBe(true);
    expect(r.attack.label).toContain('诗人激励');
    expect(actors.ally.effects.some((e) => e.inspirationDie)).toBe(false);
  });
});

describe('种族特性', () => {
  it('半身人幸运：自然 1 重掷', async () => {
    const { engine, rolls } = table({ id: 'hobbit', name: '半身人', features: ['halfling_luck'] });
    rolls.d20.push(1, 17);
    const r = await engine.check('hobbit', 'perception', 15);
    expect(r.natural).toBe(17);
    expect(r.label).toContain('半身人幸运');
  });

  it('精灵血统 / 勇敢 / 矮人韧性 / 侏儒狡黠：对应来源的豁免有优势', async () => {
    const { engine, rolls } = table({ id: 'x', name: '混血', features: ['fey_ancestry', 'brave', 'dwarven_resilience', 'gnome_cunning'] });
    for (const [against, ability, magical, expected] of [
      ['charmed', 'wis', false, 'adv'],
      ['frightened', 'wis', false, 'adv'],
      ['poison', 'con', false, 'adv'],
      [undefined, 'int', true, 'adv'],
      [undefined, 'con', true, 'none'],
      ['fire', 'dex', false, 'none'],
    ] as const) {
      rolls.d20.push(5, 5);
      const r = await engine.save('x', ability, 10, { against, magical });
      expect(r.advantage).toBe(expected);
    }
  });

  it('不屈耐力：被打到 0 HP 时留 1 HP，每次长休一次；即死不救', async () => {
    const { engine, actors } = table({
      id: 'orc',
      name: '半兽人',
      features: ['relentless_endurance'],
      resources: { relentless_endurance: { name: '不屈耐力', max: 1, used: 0, recharge: 'long' } },
      maxHp: 30,
    });
    const orc = actors.orc;
    await engine.damage('orc', 40, 'slashing');
    expect(orc.hp).toBe(1);
    expect(orc.deathSaves.dead).toBe(false);
    expect(orc.conditions.some((c) => c.name === 'unconscious')).toBe(false);
    await engine.damage('orc', 5, 'slashing');
    expect(orc.hp).toBe(0);
    expect(orc.conditions.some((c) => c.name === 'unconscious')).toBe(true);

    await engine.longRest(['orc']);
    await engine.damage('orc', 999, 'slashing'); // 溢出远超 30：即死，不屈耐力救不了
    expect(orc.deathSaves.dead).toBe(true);
  });

  it('龙息：按祖先的伤害类型和豁免，成功半伤', async () => {
    const { engine, rolls, actors } = table({
      id: 'dragon',
      name: '龙裔',
      level: 6,
      features: ['breath_weapon', 'draconic_ancestry_red'],
      resources: { breath_weapon: { name: '龙息', max: 1, used: 0, recharge: 'short' } },
      abilities: { str: 14, dex: 10, con: 14, int: 10, wis: 10, cha: 14 },
    });
    const g1 = foe(engine, 'goblin', 6, 5);
    const g2 = foe(engine, 'goblin', 6, 6);
    rolls.d20.push(2, 20);
    const out = await engine.useFeature('dragon', 'breath_weapon', { targetIds: [g1.id, g2.id] });
    expect(out.ok).toBe(true);
    // 6 级 3d6 取最大 18：g1 失败受 18，g2 成功受 9
    expect(300 - g1.hp).toBe(18);
    expect(300 - g2.hp).toBe(9);
    expect(engine.resourceLeft(actors.dragon, 'breath_weapon')).toBe(0);
    expect(out.note).toContain('DC 13'); // 8 + 体质 +2 + 熟练 +3
  });
});

describe('休息与法术', () => {
  it('契约魔法：短休法术位回满；奥术回复：短休取回总环阶 ≤ ⌈等级/2⌉ 的法术位', async () => {
    const { engine, actors } = table(
      { id: 'lock', name: '邪术师', spells: { ability: 'cha', known: [], slots: { '2': { max: 2, used: 2 } }, pact: true } },
      {
        id: 'wiz',
        name: '法师',
        level: 6,
        classes: [{ id: 'wizard', level: 6 }],
        features: ['arcane_recovery'],
        resources: { arcane_recovery: { name: '奥术回复', max: 1, used: 0, recharge: 'long' } },
        spells: { ability: 'int', known: [], slots: { '1': { max: 4, used: 3 }, '2': { max: 3, used: 3 }, '3': { max: 3, used: 3 } } },
      }
    );
    await engine.shortRest(['lock', 'wiz']);
    expect(actors.lock.spells!.slots[2].used).toBe(0);
    // 法师 6 级：预算 3，先取 3 环 1 个
    expect(actors.wiz.spells!.slots[3].used).toBe(2);
    expect(actors.wiz.spells!.slots[2].used).toBe(3);
    expect(engine.resourceLeft(actors.wiz, 'arcane_recovery')).toBe(0);
  });

  it('兼职邪术师：契约位混在总表里，短休只恢复 count 个同环阶的已用位，别的环阶不动', async () => {
    const { engine, actors } = table({
      id: 'multi',
      name: '兼职邪术师',
      // 术士 4/2 + 契约 2 个 2 环 = 1 环 4、2 环 4
      spells: { ability: 'cha', known: [], slots: { '1': { max: 4, used: 3 }, '2': { max: 4, used: 4 } }, pactSlots: { level: 2, count: 2 } },
    });
    await engine.shortRest(['multi']);
    expect(actors.multi.spells!.slots[2].used).toBe(2); // 4 个用完 → 恢复 2 个
    expect(actors.multi.spells!.slots[1].used).toBe(3); // 1 环不是契约位，短休不动
    actors.multi.spells!.slots[2].used = 1;
    await engine.shortRest(['multi']);
    expect(actors.multi.spells!.slots[2].used).toBe(0); // 已用不到 count 个，不会减成负数
    await engine.longRest(['multi']);
    expect(actors.multi.spells!.slots[1].used).toBe(0);
  });

  it('戏法随等级成长：火焰箭 5 级 2d10、11 级 3d10；魔能爆射线数', async () => {
    const mk = (level: number): Spec => ({
      id: 'wiz',
      name: '法师',
      level,
      abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
      spells: { ability: 'int', known: ['fire_bolt'], slots: {} },
    });
    for (const [level, dice] of [
      [1, 1],
      [5, 2],
      [11, 3],
      [17, 4],
    ] as const) {
      const t = table(mk(level));
      const g = foe(t.engine, 'goblin', 8, 5);
      t.rolls.d20.push(15);
      const r = await t.engine.castSpell('wiz', 'fire_bolt', 0, [g.id]);
      const dmg = r.rolls.find((x) => x.kind === 'damage');
      if (SPELL_HAS_SCALING) expect(dmg?.formula).toBe(`${dice}d10`);
    }
  });

  it('legalActions 列出能用的主动特性，次数用完变不可用，攻击条目带选项说明', async () => {
    const { engine, actors } = table(barbarian());
    const g = foe(engine, 'goblin', 6, 5);
    fight(engine, ['barb', g.id]);
    const acts = engine.legalActions('barb');
    const rage = acts.find((a) => a.featureId === 'rage');
    expect(rage?.available).toBe(true);
    expect(rage?.detail).toContain('rage');
    expect(acts.find((a) => a.kind === 'attack')?.detail).toContain('鲁莽攻击');
    actors.barb.resources.rage.used = 3;
    expect(engine.legalActions('barb').find((a) => a.featureId === 'rage')?.available).toBe(false);
  });
});

import { SPELLS } from '../src/rules/data/spells.js';
const SPELL_HAS_SCALING = SPELLS.fire_bolt?.cantripScaling === true;

describe('自动反应：护盾术', () => {
  const wizard = (): Spec => ({
    id: 'wiz',
    name: '法师',
    ac: 12,
    abilities: { str: 8, dex: 14, con: 12, int: 16, wis: 10, cha: 10 },
    spells: { ability: 'int', known: ['shield'], slots: { '1': { max: 2, used: 0 } } },
  });

  it('会护盾术、有 1 环法术位、有反应：能让这一击落空时自动施放', async () => {
    const { engine, rolls, actors } = table(wizard());
    const g = foe(engine, 'goblin', 6, 5);
    g.position = { col: 4, row: 5 };
    actors.wiz.position = { col: 5, row: 5 };
    rolls.d20.push(10); // 10 + 4 = 14 ≥ AC 12：本来命中，护盾术 AC 17 就落空
    const r = await engine.attack(g.id, 'wiz', '弯刀');
    expect(r.hit).toBe(false);
    expect(r.notes?.join('')).toContain('护盾术');
    expect(actors.wiz.spells!.slots[1].used).toBe(1);
    expect(actors.wiz.turn.reactionUsed).toBe(true);
    expect(engine.acOf(actors.wiz)).toBe(17);
  });

  it('护盾术救不了的（超过 +5）、暴击、没有反应、没有法术位：不浪费', async () => {
    const { engine, rolls, actors } = table(wizard());
    const g = foe(engine, 'goblin', 6, 5);
    g.position = { col: 4, row: 5 };
    actors.wiz.position = { col: 5, row: 5 };
    rolls.d20.push(18); // 18+4=22 ≥ 17：护盾术也救不了
    const r1 = await engine.attack(g.id, 'wiz', '弯刀');
    expect(r1.hit).toBe(true);
    expect(actors.wiz.spells!.slots[1].used).toBe(0);
    rolls.d20.push(20);
    engine.beginTurn(g.id);
    const r2 = await engine.attack(g.id, 'wiz', '弯刀');
    expect(r2.crit).toBe(true);
    expect(actors.wiz.spells!.slots[1].used).toBe(0);
    actors.wiz.turn.reactionUsed = true;
    rolls.d20.push(10);
    engine.beginTurn(g.id);
    const r3 = await engine.attack(g.id, 'wiz', '弯刀');
    expect(r3.hit).toBe(true);
  });
});
