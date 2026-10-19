import { describe, expect, it } from 'vitest';
import { MONSTERS } from '../src/rules/data/monsters.js';
import { RulesEngine } from '../src/rules/engine.js';
import { crProficiencyBonus, makeMonster, skillBonus } from '../src/rules/sheet.js';
import type { Skill } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

/**
 * SRD 5.1 怪物数据对账。食尸鬼、巨蜘蛛对的是 ODM 带的 Open5e 原文
 * （open-dungeon-master/scripts/fixtures/srd-monster-rows.json）；其余是 2026-10-18 按 SRD 5.1 对的，没有机读原文。
 * 数值是 SRD 写在怪物卡上的那些：AC、HP、被动察觉、技能加值、每个攻击的命中和伤害。
 */
interface Expect {
  ac: number;
  hp: number;
  speed: number;
  swim?: number;
  passive: number;
  skills?: Partial<Record<Skill, number>>;
  attacks: Record<string, [bonus: number, damage: string]>;
}

const SRD: Record<string, Expect> = {
  goblin: {
    ac: 15, hp: 7, speed: 30, passive: 9,
    skills: { stealth: 6 },
    attacks: { 弯刀: [4, '1d6+2'], 短弓: [4, '1d6+2'] },
  },
  bandit: {
    ac: 12, hp: 11, speed: 30, passive: 10,
    attacks: { 弯刀: [3, '1d6+1'], 轻弩: [3, '1d8+1'] },
  },
  bandit_captain: {
    ac: 15, hp: 65, speed: 30, passive: 10,
    skills: { athletics: 4, deception: 4 },
    attacks: { 弯刀: [5, '1d6+3'], 匕首: [5, '1d4+3'] },
  },
  wolf: {
    ac: 13, hp: 11, speed: 40, passive: 13,
    skills: { perception: 3, stealth: 4 },
    attacks: { 啮咬: [4, '2d4+2'] },
  },
  skeleton: {
    ac: 13, hp: 13, speed: 30, passive: 9,
    attacks: { 短剑: [4, '1d6+2'], 短弓: [4, '1d6+2'] },
  },
  zombie: {
    ac: 8, hp: 22, speed: 20, passive: 8,
    attacks: { 猛击: [3, '1d6+1'] },
  },
  cultist: {
    ac: 12, hp: 9, speed: 30, passive: 10,
    skills: { deception: 2, religion: 2 },
    attacks: { 弯刀: [3, '1d6+1'] },
  },
  scout: {
    ac: 13, hp: 16, speed: 30, passive: 15,
    skills: { nature: 4, perception: 5, stealth: 6, survival: 5 },
    attacks: { 短剑: [4, '1d6+2'], 长弓: [4, '1d8+2'] },
  },
  sahuagin: {
    ac: 12, hp: 22, speed: 30, swim: 40, passive: 15,
    skills: { perception: 5 },
    attacks: { 啮咬: [3, '1d4+1'], 爪击: [3, '1d4+1'], 矛: [3, '1d6+1'] },
  },
  giant_crab: {
    ac: 15, hp: 13, speed: 30, swim: 30, passive: 9,
    skills: { stealth: 4 },
    attacks: { 钳击: [3, '1d6+1'] },
  },
  swarm_of_rats: {
    ac: 10, hp: 24, speed: 30, passive: 10,
    attacks: { 啃咬: [2, '2d6'] },
  },
  animated_armor: {
    ac: 18, hp: 33, speed: 25, passive: 6,
    attacks: { 猛击: [4, '1d6+2'] },
  },
  ghoul: {
    ac: 12, hp: 22, speed: 30, passive: 10,
    attacks: { 啮咬: [2, '2d6+2'], 爪击: [4, '2d4+2'] },
  },
  bugbear: {
    ac: 16, hp: 27, speed: 30, passive: 10,
    skills: { stealth: 6, survival: 2 },
    attacks: { 晨星: [4, '2d8+2'], 标枪: [4, '2d6+2'], '标枪（投掷）': [4, '1d6+2'] },
  },
  giant_spider: {
    ac: 14, hp: 26, speed: 30, passive: 10,
    skills: { stealth: 7 },
    attacks: { 啮咬: [5, '1d8+3'] },
  },
};

describe('SRD 怪物数据', () => {
  it('表里的怪物都对过账，没有漏的', () => {
    expect(Object.keys(MONSTERS).sort()).toEqual(Object.keys(SRD).sort());
  });

  const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });

  for (const [id, want] of Object.entries(SRD)) {
    it(`${id}: AC / HP / 速度 / 被动察觉 / 技能 / 攻击`, () => {
      const m = makeMonster(id);
      expect(m.ac).toBe(want.ac);
      expect(m.maxHp).toBe(want.hp);
      expect(m.speed).toBe(want.speed);
      expect(m.swimSpeed ?? 0).toBe(want.swim ?? 0);
      expect(engine.passivePerception(m)).toBe(want.passive);
      for (const [skill, bonus] of Object.entries(want.skills ?? {})) {
        expect(skillBonus(m, skill as Skill), `${id} ${skill}`).toBe(bonus);
      }
      for (const [name, [bonus, damage]] of Object.entries(want.attacks)) {
        const atk = m.attacks.find((a) => a.name === name);
        expect(atk, `${id} 没有攻击 ${name}`).toBeDefined();
        expect(atk!.attackBonus).toBe(bonus);
        expect(atk!.damage).toBe(damage);
      }
    });
  }

  it('熟练加值按 CR 走', () => {
    const table: [number, number][] = [
      [0, 2], [0.125, 2], [1, 2], [4, 2], [5, 3], [8, 3], [9, 4], [12, 4], [13, 5], [16, 5], [17, 6], [20, 6], [21, 7], [24, 7], [25, 8], [28, 8], [29, 9], [30, 9],
    ];
    for (const [cr, pb] of table) expect(crProficiencyBonus(cr), `CR ${cr}`).toBe(pb);
  });
});
