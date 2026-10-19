// overlay 角色卡底下的状态标签：条件、法术效果、狂暴合成一串，分增益 / 负面 / 濒死，并按「濒死 → 负面 → 增益」排序。
import { describe, expect, it } from 'vitest';
import { RulesEngine } from '../src/rules/engine.js';
import { actorFromCharacter, type CharacterFile } from '../src/rules/sheet.js';
import type { ActiveEffect, Actor } from '../src/rules/types.js';
import { effectIsHarmful, statusTags } from '../src/table/statusTags.js';
import { ScriptedRollSource } from './helpers.js';

const allSlots = Object.fromEntries([1, 2, 3].map((l) => [String(l), { max: 4, used: 0 }]));
const cleric: CharacterFile = {
  name: '牧师',
  level: 3,
  abilities: { str: 10, dex: 10, con: 14, int: 10, wis: 16, cha: 12 },
  ac: 16,
  maxHp: 24,
  attacks: [{ weaponId: 'mace' }],
  spells: { ability: 'wis', known: [], slots: allSlots },
};

function setup() {
  const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
  const a = actorFromCharacter(cleric, 'c0', 'player_a');
  a.position = { col: 5, row: 5 };
  engine.addActor(a);
  return { engine, a };
}

const eff = (name: string, extra: Partial<ActiveEffect> = {}): ActiveEffect => ({
  id: `e-${name}`,
  spellId: name,
  name,
  concentration: false,
  ...extra,
});

describe('effectIsHarmful', () => {
  it('增益：加值、加骰、AC、优势、抗性', () => {
    expect(effectIsHarmful(eff('御盾术', { acBonus: 2 }))).toBe(false);
    expect(effectIsHarmful(eff('祝福术', { attackDice: '1d4', saveDice: '1d4' }))).toBe(false);
    expect(effectIsHarmful(eff('加速术', { speedMultiplier: 2, extraAction: true }))).toBe(false);
    expect(effectIsHarmful(eff('指引术', { checkDice: '1d4' }))).toBe(false);
    expect(effectIsHarmful(eff('狂暴', { resistances: ['slashing'] }))).toBe(false);
    expect(effectIsHarmful(eff('克敌先击', { attackRoll: { state: 'adv', once: true } }))).toBe(false);
  });

  it('负面：给攻击者优势、自己劣势、负加值、缓慢类限制', () => {
    expect(effectIsHarmful(eff('鲁莽攻击', { grantsAttackersAdvantage: true }))).toBe(true);
    expect(effectIsHarmful(eff('妖火', { grantsAttackersAdvantage: true, blocksInvisibility: true }))).toBe(true);
    expect(effectIsHarmful(eff('光导箭', { grantsAdvantageOnce: true }))).toBe(true);
    expect(effectIsHarmful(eff('恶言相加', { attackRoll: { state: 'dis', once: true } }))).toBe(true);
    expect(effectIsHarmful(eff('灾祸术', { attackDice: '-1d4', saveDice: '-1d4' }))).toBe(true);
    expect(effectIsHarmful(eff('缓慢术', { saveBonuses: { dex: -2 }, noReactions: true, maxSwings: 1, speedMultiplier: 0.5 }))).toBe(true);
    expect(effectIsHarmful(eff('减速', { speedBonus: -10 }))).toBe(true);
    expect(effectIsHarmful(eff('脆弱', { saveEdges: [{ abilities: ['all'], state: 'dis' }] }))).toBe(true);
  });
});

describe('statusTags', () => {
  it('没有任何状态 → 空', () => {
    expect(statusTags(setup().a)).toEqual([]);
  });

  it('条件算负面（隐形 / 躲藏算增益），法术效果分正负，专注的带 conc', async () => {
    const { engine, a } = setup();
    engine.applyCondition(a.id, 'poisoned', {});
    engine.applyCondition(a.id, 'invisible', {});
    const r = await engine.castSpell(a.id, 'bless', 1, [a.id], { ignoreKnown: true });
    expect(r.ok).toBe(true);
    a.effects.push(eff('鲁莽攻击', { grantsAttackersAdvantage: true }));
    const tags = statusTags(a);
    // 负面在前（中毒、鲁莽攻击），增益在后（隐形、祝福术）
    expect(tags.map((t) => `${t.kind}:${t.text}`)).toEqual(['debuff:中毒', 'debuff:鲁莽攻击', 'buff:隐形', 'buff:祝福术']);
    expect(tags.find((t) => t.text === '祝福术')?.conc).toBe(true);
    expect(tags.find((t) => t.text === '中毒')?.conc).toBeUndefined();
  });

  it('濒死 / 稳定 / 死亡排最前；濒死时系统自动挂的昏迷和倒地不重复显示', () => {
    const { engine, a } = setup();
    a.hp = 0;
    engine.applyCondition(a.id, 'unconscious', { source: 'dying' });
    engine.applyCondition(a.id, 'prone', { source: 'dying' });
    engine.applyCondition(a.id, 'poisoned', {});
    expect(statusTags(a).map((t) => t.text)).toEqual(['濒死 0成0败', '中毒']);
    a.deathSaves.stable = true;
    expect(statusTags(a)[0]).toMatchObject({ text: '稳定', kind: 'down' });
    a.deathSaves.dead = true;
    expect(statusTags(a)[0]).toMatchObject({ text: '死亡', kind: 'down' });
  });

  it('狂暴只出现一次：效果里有、又被单独传入也一样', () => {
    const a: Actor = setup().a;
    a.effects.push(eff('狂暴', { resistances: ['slashing'] }));
    expect(statusTags(a, true).filter((t) => t.text === '狂暴')).toHaveLength(1);
    const b = setup().a; // 只传 raging、效果表里没有
    expect(statusTags(b, true)).toEqual([{ text: '狂暴', kind: 'buff' }]);
  });

  it('一个人身上挂很多个也都在：3 级以后标签多，overlay 靠滚动显示，这里不截断', () => {
    const { a } = setup();
    for (const n of ['祝福术', '御盾术', '指引术', '庇护术', '圣洁光环', '长者之相']) a.effects.push(eff(n, { acBonus: 1 }));
    expect(statusTags(a)).toHaveLength(6);
  });
});
