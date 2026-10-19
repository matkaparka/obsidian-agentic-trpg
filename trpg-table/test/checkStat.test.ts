// GM 传给 request_check / roll_check 的技能名：认得就换成引擎的 id，不认识就回错误，不能算出 NaN（骰子公式 1d20nan）。
import { describe, expect, it } from 'vitest';
import type { AppConfig } from '../src/config.js';
import type { LLM } from '../src/llm/index.js';
import { LocalRollSource, mulberry32 } from '../src/rules/dice.js';
import { RulesEngine } from '../src/rules/engine.js';
import { makeDefaultParty } from '../src/rules/sheet.js';
import { checkStatHelp, resolveCheckStat } from '../src/table/checkStat.js';
import { EventBus } from '../src/table/events.js';
import { GameMaster, type GmWorld } from '../src/table/gm.js';

describe('resolveCheckStat', () => {
  it('英文 id、驼峰 / 空格 / 连字符写法、属性全称都认', () => {
    expect(resolveCheckStat('animal_handling')).toBe('animal_handling');
    expect(resolveCheckStat('Animal Handling')).toBe('animal_handling');
    expect(resolveCheckStat('animalHandling')).toBe('animal_handling');
    expect(resolveCheckStat('sleight-of-hand')).toBe('sleight_of_hand');
    expect(resolveCheckStat('STR')).toBe('str');
    expect(resolveCheckStat('Dexterity')).toBe('dex');
  });

  it('中文：引擎的名字、官方译名、常见别名，带「检定」「豁免」后缀或括号说明也行', () => {
    expect(resolveCheckStat('驯兽')).toBe('animal_handling');
    expect(resolveCheckStat('动物驯养')).toBe('animal_handling');
    expect(resolveCheckStat('动物驯养检定')).toBe('animal_handling');
    expect(resolveCheckStat('动物驯养（感知类）')).toBe('animal_handling');
    expect(resolveCheckStat('察觉')).toBe('perception');
    expect(resolveCheckStat('感知')).toBe('perception');
    expect(resolveCheckStat('洞悉')).toBe('insight');
    expect(resolveCheckStat('潜行')).toBe('stealth');
    expect(resolveCheckStat('力量')).toBe('str');
    expect(resolveCheckStat('体质豁免')).toBe('con');
  });

  it('不认识的返回 null（含空串），不会猜', () => {
    expect(resolveCheckStat('')).toBeNull();
    expect(resolveCheckStat('   ')).toBeNull();
    expect(resolveCheckStat('animal_training')).toBeNull();
    expect(resolveCheckStat('魅力四射')).toBeNull();
  });

  it('错误提示里列出全部可用的 id', () => {
    const help = checkStatHelp();
    expect(help).toContain('animal_handling（驯兽）');
    expect(help).toContain('perception（感知）');
    expect(help).toContain('str（力量）');
  });
});

describe('GM 工具 request_check / roll_check', () => {
  function gm() {
    const engine = new RulesEngine({ rollSource: new LocalRollSource(mulberry32(3)) });
    const { a, b } = makeDefaultParty();
    engine.addActor(a);
    engine.addActor(b);
    const world = { engine, bus: new EventBus(), characters: { player_a: a, player_b: b } } as unknown as GmWorld;
    const g = new GameMaster(null as unknown as LLM, {} as AppConfig, world);
    const exec = (name: string, args: Record<string, unknown>) =>
      (g as unknown as { execTool(n: string, a: Record<string, unknown>): Promise<{ ok: boolean; text: string }> }).execTool(name, args);
    return { exec, a };
  }

  it('中文技能名正常检定，结果里没有 NaN', async () => {
    const { exec } = gm();
    const r = await exec('request_check', { seat: 'player_a', skill: '动物驯养', dc: 12, why: '安抚饿狼' });
    expect(r.ok).toBe(true);
    expect(r.text).not.toContain('NaN');
    expect(r.text).toMatch(/d20=\d+/);
  });

  it('不认识的技能不检定，回错误并列出可用清单（不抛 1d20nan）', async () => {
    const { exec } = gm();
    for (const [tool, args] of [
      ['request_check', { seat: 'player_a', skill: 'animal_training', dc: 12, why: 'x' }],
      ['roll_check', { actor: 'player_b', skill: '魅力四射', dc: 12 }],
    ] as const) {
      const r = await exec(tool, { ...args });
      expect(r.ok).toBe(false);
      expect(r.text).toContain('不认识的技能');
      expect(r.text).toContain('animal_handling（驯兽）');
      expect(r.text).not.toMatch(/nan/i);
    }
  });

  it('roll_check 不写技能就是察觉', async () => {
    const { exec } = gm();
    const r = await exec('roll_check', { actor: 'player_a', dc: 10 });
    expect(r.ok).toBe(true);
  });
});
