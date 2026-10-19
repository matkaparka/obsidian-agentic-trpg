import { describe, expect, it } from 'vitest';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { SPELLS } from '../src/rules/data/spells.js';
import { actorFromCharacter, type CharacterFile } from '../src/rules/sheet.js';
import type { Actor } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

const caster = (extra: Partial<CharacterFile> = {}): CharacterFile => ({
  name: '施法者',
  level: 7,
  abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 12 },
  ac: 12,
  maxHp: 50,
  spells: {
    ability: 'int',
    known: [],
    slots: { '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 3, used: 0 }, '4': { max: 1, used: 0 } },
  },
  ...extra,
});

function setup(...extras: Partial<CharacterFile>[]) {
  const rolls = new ScriptedRollSource();
  const engine = new RulesEngine({ rollSource: rolls });
  const actors: Actor[] = [];
  (extras.length ? extras : [{}]).forEach((extra, i) => {
    const a = actorFromCharacter({ ...caster(), name: `角色${i}`, ...extra }, `c${i}`, i === 0 ? 'player_a' : 'player_b');
    a.position = { col: 5 + i, row: 5 };
    engine.addActor(a);
    actors.push(a);
  });
  return { engine, rolls, actors, c: actors[0] };
}

function foe(engine: RulesEngine, id: string, col: number, row: number, hp = 300): Actor {
  const m = spawnMonster(id, `${id}@${col},${row}`);
  m.hp = hp;
  m.maxHp = hp;
  m.position = { col, row };
  engine.addActor(m);
  return m;
}

const cast = (engine: RulesEngine, who: string, spell: string, level: number, targets: string[]) =>
  engine.castSpell(who, spell, level, targets, { ignoreKnown: true });

describe('AC、临时 HP、速度', () => {
  it('法师护甲：基础 AC 13+敏捷，取较大者；树肤术：不低于 16', async () => {
    const { engine, actors } = setup({ ac: 10 });
    const a = actors[0];
    await cast(engine, 'c0', 'mage_armor', 1, ['c0']);
    expect(engine.acOf(a)).toBe(15); // 13 + 敏捷 +2
    a.effects = [];
    a.ac = 18; // 穿了重甲：比 15 高，法师护甲不起作用
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'mage_armor', 1, ['c0']);
    expect(engine.acOf(a)).toBe(18);
    a.effects = [];
    a.ac = 12;
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'barkskin', 2, ['c0']);
    expect(engine.acOf(a)).toBe(16);
  });

  it('虚假生命：1d4+4 临时 HP，升环每环 +5，不叠加取大的', async () => {
    const { engine, actors } = setup();
    const a = actors[0];
    await cast(engine, 'c0', 'false_life', 1, ['c0']);
    expect(a.tempHp).toBe(8); // 骰子取最大 4 + 4
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'false_life', 3, ['c0']);
    expect(a.tempHp).toBe(18); // 8 + 5×2
    a.tempHp = 30;
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'false_life', 1, ['c0']);
    expect(a.tempHp).toBe(30);
  });

  it('加速术：速度翻倍、AC +2、每个回合多一个动作；大步奔行：速度 +10', async () => {
    const { engine, actors } = setup();
    const a = actors[0];
    await cast(engine, 'c0', 'haste', 3, ['c0']);
    expect(engine.speedOf(a)).toBe(60);
    expect(engine.acOf(a)).toBe(14);
    engine.beginTurn('c0');
    expect(a.turn.extraActions).toBe(1);
    a.effects = [];
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'longstrider', 1, ['c0']);
    expect(engine.speedOf(a)).toBe(40);
  });

  it('大步奔行升环能多一个目标', async () => {
    const { engine, actors } = setup({}, {}, {});
    actors[1].position = { col: 5, row: 6 };
    actors[2].position = { col: 6, row: 6 };
    await cast(engine, 'c0', 'longstrider', 2, ['c0', 'c1', 'c2']);
    expect(actors[0].effects.some((e) => e.speedBonus)).toBe(true);
    expect(actors[1].effects.some((e) => e.speedBonus)).toBe(true);
    expect(actors[2].effects.some((e) => e.speedBonus)).toBe(false);
  });

  it('祝福术升环：2 环能祝福 4 个目标', async () => {
    const { engine, actors } = setup({}, {}, {}, {}, {});
    await cast(engine, 'c0', 'bless', 2, ['c0', 'c1', 'c2', 'c3', 'c4']);
    expect(actors.filter((a) => a.effects.some((e) => e.attackDice)).length).toBe(4);
  });
});

describe('抗性、状态解除、复活', () => {
  it('石肤术：非魔法的钝击 / 穿刺 / 挥砍减半，魔法攻击和火焰照吃', async () => {
    const { engine, actors } = setup();
    const a = actors[0];
    await cast(engine, 'c0', 'stoneskin', 4, ['c0']);
    a.hp = 50;
    await engine.damage('c0', 10, 'slashing');
    expect(a.hp).toBe(45);
    await engine.damage('c0', 10, 'slashing', '魔法', { magical: true });
    expect(a.hp).toBe(35);
    await engine.damage('c0', 10, 'fire');
    expect(a.hp).toBe(25);
  });

  it('次级复原术：解除目盲、耳聋、麻痹、中毒中的一个；没有就说没有', async () => {
    const { engine, actors } = setup({}, {});
    const ally = actors[1];
    engine.applyCondition('c1', 'poisoned');
    engine.applyCondition('c1', 'blinded');
    const r = await cast(engine, 'c0', 'lesser_restoration', 2, ['c1']);
    expect(r.ok).toBe(true);
    expect(ally.conditions.filter((c) => ['poisoned', 'blinded'].includes(c.name))).toHaveLength(1);
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'lesser_restoration', 2, ['c1']);
    expect(ally.conditions.filter((c) => ['poisoned', 'blinded'].includes(c.name))).toHaveLength(0);
    engine.beginTurn('c0');
    const none = await cast(engine, 'c0', 'lesser_restoration', 2, ['c1']);
    expect(none.notes.join('')).toContain('没有能解除');
  });

  it('复活术：死去的 PC 以 1 HP 回来；活着的没有效果；回生术满血', async () => {
    const { engine, actors } = setup({}, {});
    const ally = actors[1];
    ally.hp = 0;
    ally.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
    const r = await cast(engine, 'c0', 'revivify', 3, ['c1']);
    expect(r.ok).toBe(true);
    expect(ally.hp).toBe(1);
    expect(ally.deathSaves.dead).toBe(false);
    engine.beginTurn('c0');
    const again = await cast(engine, 'c0', 'revivify', 3, ['c1']);
    expect(again.notes.join('')).toContain('没有效果');
    ally.hp = 0;
    ally.deathSaves = { successes: 0, failures: 3, stable: false, dead: true };
    engine.beginTurn('c0');
    engine.require('c0').spells!.slots[7] = { max: 1, used: 0 };
    const full = await cast(engine, 'c0', 'resurrection', 7, ['c1']);
    expect(full.ok).toBe(true);
    expect(ally.hp).toBe(ally.maxHp);
    expect(ally.deathSaves.dead).toBe(false);
  });
});

describe('武器附加伤害、减益、朦胧', () => {
  const warrior = (): Partial<CharacterFile> => ({
    abilities: { str: 16, dex: 12, con: 14, int: 10, wis: 14, cha: 12 },
    attacks: [{ weaponId: 'longsword' }],
    features: [],
  });

  it('神恩术：武器命中 +1d4 光耀；猎人印记：只对被标记的目标 +1d6', async () => {
    const { engine, rolls, c } = setup(warrior());
    const g1 = foe(engine, 'goblin', 6, 5);
    const g2 = foe(engine, 'goblin', 4, 5);
    await cast(engine, 'c0', 'divine_favor', 1, ['c0']);
    rolls.d20.push(15);
    const r = await engine.attack('c0', g1.id, 'longsword', { sneakAttack: false });
    expect(r.notes?.join('')).toContain('+4 radiant'); // 1d4 取最大
    c.effects = [];
    engine.beginTurn('c0');
    await cast(engine, 'c0', 'hunters_mark', 1, [g1.id]);
    expect(c.effects.find((e) => e.bonusDamage)?.bonusDamage?.against).toBe(g1.id);
    engine.beginTurn('c0');
    rolls.d20.push(15);
    const marked = await engine.attack('c0', g1.id, 'longsword', { sneakAttack: false });
    expect(marked.notes?.join('')).toContain('猎人印记 +6');
    engine.beginTurn('c0');
    rolls.d20.push(15);
    const other = await engine.attack('c0', g2.id, 'longsword', { sneakAttack: false });
    expect(other.notes?.join('') ?? '').not.toContain('猎人印记');
  });

  it('灼热惩击：下一次武器命中额外 2d6 光耀，用掉就结束，专注也结束；升环加 1d6', async () => {
    const { engine, rolls, c } = setup(warrior());
    const g = foe(engine, 'goblin', 6, 5);
    await cast(engine, 'c0', 'branding_smite', 3, ['c0']);
    expect(c.concentration?.spellId).toBe('branding_smite');
    expect(c.effects.find((e) => e.bonusDamage)?.bonusDamage?.dice).toBe('2d6+1d6');
    engine.beginTurn('c0');
    rolls.d20.push(15);
    const hit = await engine.attack('c0', g.id, 'longsword', { sneakAttack: false });
    expect(hit.notes?.join('')).toContain('+18 radiant'); // 3d6 取最大
    expect(c.effects.some((e) => e.bonusDamage)).toBe(false);
    expect(c.concentration).toBeNull();
  });

  it('灾祸术：失败的目标攻击和豁免 -1d4（负的加值骰能正常掷）', async () => {
    const { engine, rolls, actors } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20.push(1); // 魅力豁免失败
    await cast(engine, 'c0', 'bane', 1, [g.id]);
    expect(g.effects.some((e) => e.attackDice === '-1d4')).toBe(true);
    actors[0].position = { col: 7, row: 5 };
    rolls.d20.push(10);
    const r = await engine.attack(g.id, 'c0', '弯刀');
    expect(r.attack.formula).toContain('-1d4');
    expect(r.attack.total).toBe(10 + 4 - 4); // 命中 +4，-1d4 取最大是 -4
    rolls.d20.push(10);
    const save = await engine.save(g.id, 'dex', 10);
    expect(save.formula).toContain('-1d4');
  });

  it('朦胧术：对施术者的攻击有劣势', async () => {
    const { engine, rolls } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    await cast(engine, 'c0', 'blur', 2, ['c0']);
    rolls.d20.push(5, 5);
    const r = await engine.attack(g.id, 'c0', '弯刀');
    expect(r.attack.advantage).toBe('dis');
  });
});

describe('授予的攻击：灵体武器、火焰之刃', () => {
  it('灵体武器：施法后每回合附赠动作攻击 1d8+施法属性，升环每两环 +1d8；一回合一次', async () => {
    const { engine, rolls, c } = setup({ spells: { ability: 'wis', known: [], slots: { '2': { max: 2, used: 0 }, '4': { max: 1, used: 0 } } } });
    const g = foe(engine, 'goblin', 9, 5);
    await cast(engine, 'c0', 'spiritual_weapon', 4, []);
    expect(c.effects.find((e) => e.grantsAttack)?.grantsAttack?.dice).toBe('1d8+1d8'); // 4 环：比 2 环高两环
    engine.beginTurn('c0');
    expect(engine.legalActions('c0').some((a) => a.featureId === 'granted:spiritual_weapon' && a.available)).toBe(true);
    rolls.d20.push(15);
    const out = await engine.useFeature('c0', 'granted:spiritual_weapon', { targetId: g.id });
    expect(out.attacks?.[0].hit).toBe(true);
    // 2d8 取最大 16 + 感知 +3
    expect(out.attacks?.[0].damage?.total).toBe(19);
    expect(c.turn.bonusUsed).toBe(true);
    await expect(engine.useFeature('c0', 'granted:spiritual_weapon', { targetId: g.id })).rejects.toThrow('附赠动作');
    g.position = { col: 40, row: 5 };
    engine.beginTurn('c0');
    await expect(engine.useFeature('c0', 'granted:spiritual_weapon', { targetId: g.id })).rejects.toThrow('最多打');
  });

  it('火焰之刃：近战法术攻击 3d6 火焰，要贴身', async () => {
    const { engine, rolls } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    await cast(engine, 'c0', 'flame_blade', 2, []);
    engine.beginTurn('c0');
    rolls.d20.push(15);
    const out = await engine.useFeature('c0', 'granted:flame_blade', { targetId: g.id });
    expect(out.attacks?.[0].damage?.formula).toBe('3d6');
    expect(out.attacks?.[0].hit).toBe(true);
    g.position = { col: 12, row: 5 };
    engine.beginTurn('c0');
    await expect(engine.useFeature('c0', 'granted:flame_blade', { targetId: g.id })).rejects.toThrow('最多打 5 尺');
  });
});

describe('推开、飞弹、固定值升环、说明', () => {
  it('雷鸣波：豁免失败的被推开 10 尺（撞到人就停）', async () => {
    const { engine, rolls, c } = setup();
    c.position = { col: 5, row: 5 };
    const near = foe(engine, 'goblin', 6, 5);
    const behind = foe(engine, 'goblin', 7, 5);
    rolls.d20.push(1);
    const r = await cast(engine, 'c0', 'thunderwave', 1, [near.id]);
    expect(r.ok).toBe(true);
    expect(near.position).toEqual({ col: 6, row: 5 }); // 后面站着人，动不了
    expect(r.notes.join('')).not.toContain(`${near.name} 被推开`);
    await engine.damage(behind.id, 999, 'force');
    behind.position = { col: 40, row: 5 };
    engine.beginTurn('c0');
    rolls.d20.push(1);
    await cast(engine, 'c0', 'thunderwave', 1, [near.id]);
    expect(near.position).toEqual({ col: 8, row: 5 });
    // 成功不推
    near.position = { col: 6, row: 5 };
    engine.beginTurn('c0');
    rolls.d20.push(20);
    await cast(engine, 'c0', 'thunderwave', 1, [near.id]);
    expect(near.position).toEqual({ col: 6, row: 5 });
  });

  it('魔法飞弹：三枚可以分给两个目标（2 + 1）；升环多一枚', async () => {
    const { engine } = setup();
    const g1 = foe(engine, 'goblin', 7, 5);
    const g2 = foe(engine, 'goblin', 7, 6);
    const r = await cast(engine, 'c0', 'magic_missile', 1, [g1.id, g2.id]);
    const formulas = r.rolls.filter((x) => x.kind === 'damage').map((x) => x.formula).sort();
    expect(formulas).toEqual(['1d4+1', '2d4+2']);
    engine.beginTurn('c0');
    const up = await cast(engine, 'c0', 'magic_missile', 2, [g1.id]);
    expect(up.rolls.find((x) => x.kind === 'damage')?.formula).toBe('4d4+4');
  });

  it('固定值升环：痊愈术每高一环 +10', async () => {
    const heal = SPELLS.heal;
    expect(heal?.upcast?.heal).toBe('10');
    const { engine, c } = setup({ spells: { ability: 'wis', known: [], slots: { '7': { max: 1, used: 0 }, '6': { max: 1, used: 0 } } } });
    c.hp = 1;
    c.maxHp = 500;
    const r = await cast(engine, 'c0', 'heal', 7, ['c0']);
    expect(r.rolls.find((x) => x.kind === 'damage')?.formula).toBe('70+10');
    expect(c.hp).toBe(81);
  });

  it('法术自带的补充说明（引擎没结算的部分）会交给调用方', async () => {
    const { engine, rolls } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    rolls.d20.push(1);
    const r = await cast(engine, 'c0', 'thunderwave', 1, [g.id]);
    expect(r.notes.join('')).toContain('巨响');
  });
});

describe('传送：迷踪步', () => {
  it('传送到 30 尺内的空格；目的地不合法时不扣法术位', async () => {
    const { engine, c } = setup();
    c.position = { col: 5, row: 5 };
    const slots = c.spells!.slots[2];
    const noDest = await engine.castSpell('c0', 'misty_step', 2, [], { ignoreKnown: true });
    expect(noDest.ok).toBe(false);
    expect(slots.used).toBe(0);
    const tooFar = await engine.castSpell('c0', 'misty_step', 2, [], { ignoreKnown: true, destination: { col: 20, row: 5 } });
    expect(tooFar.ok).toBe(false);
    expect(tooFar.error).toContain('最多 30 尺');
    const g = foe(engine, 'goblin', 8, 5);
    const occupied = await engine.castSpell('c0', 'misty_step', 2, [], { ignoreKnown: true, destination: g.position! });
    expect(occupied.ok).toBe(false);
    expect(slots.used).toBe(0);
    expect(c.turn.bonusUsed).toBe(false);
    const ok = await engine.castSpell('c0', 'misty_step', 2, [], { ignoreKnown: true, destination: { col: 10, row: 5 } });
    expect(ok.ok).toBe(true);
    expect(c.position).toEqual({ col: 10, row: 5 });
    expect(slots.used).toBe(1);
    expect(c.turn.bonusUsed).toBe(true);
  });

  it('传送不引发借机攻击', async () => {
    const { engine, rolls, c } = setup();
    const g = foe(engine, 'goblin', 6, 5);
    engine.combat = { active: true, round: 1, order: [{ actorId: 'c0', initiative: 10, dex: 10 }, { actorId: g.id, initiative: 5, dex: 10 }], index: 0 };
    engine.beginTurn('c0');
    engine.beginTurn(g.id);
    const before = rolls.calls.length;
    await engine.castSpell('c0', 'misty_step', 2, [], { ignoreKnown: true, destination: { col: 11, row: 5 } });
    expect(c.position).toEqual({ col: 11, row: 5 });
    expect(rolls.calls.length).toBe(before);
    expect(g.turn.reactionUsed).toBe(false);
  });
});
