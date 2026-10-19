import { CONDITION_ZH, type ActiveEffect, type Actor, type ConditionName } from '../rules/types.js';

/**
 * 给观众看的状态标签（overlay 角色卡底部那一行）。
 * down = 濒死 / 稳定 / 死亡；debuff = 负面状态和负面效果；buff = 增益（法术、狂暴、隐形…）。
 * conc = 这个效果要专注维持。
 */
export type StatusKind = 'down' | 'debuff' | 'buff';
export interface StatusTag {
  text: string;
  kind: StatusKind;
  conc?: boolean;
}

/** 状态里对持有者有利的几个；其余（目盲、中毒、倒地…）都算负面 */
const GOOD_CONDITIONS: ReadonlySet<ConditionName> = new Set<ConditionName>(['invisible', 'hidden']);

const negativeDice = (d?: string): boolean => !!d && d.trim().startsWith('-');

/**
 * 这个效果对挂着它的人是不是坏事。
 * 按字段判断（不看法术名）：给攻击者优势 / 自己劣势 / 负的加值 / 缓慢类的限制 → 负面；其余按增益算。
 * 鲁莽攻击（给攻击者优势）也算负面：那是自己换来的代价，观众看红色就知道此刻危险。
 */
export function effectIsHarmful(e: ActiveEffect): boolean {
  if (e.grantsAttackersAdvantage || e.grantsAdvantageOnce) return true;
  if (e.attackRoll?.state === 'dis') return true;
  if (e.saveEdges?.some((s) => s.state === 'dis')) return true;
  if (e.checkEdges?.some((c) => c.state === 'dis')) return true;
  if (e.noReactions || e.endSave || e.maxSwings !== undefined) return true;
  if (e.speedMultiplier !== undefined && e.speedMultiplier < 1) return true;
  if ((e.speedBonus ?? 0) < 0) return true;
  if ((e.acBonus ?? 0) < 0 || (e.attackBonus ?? 0) < 0 || (e.saveBonus ?? 0) < 0 || (e.damageBonus ?? 0) < 0) return true;
  if (negativeDice(e.attackDice) || negativeDice(e.saveDice) || negativeDice(e.checkDice)) return true;
  if (e.saveBonuses && Object.values(e.saveBonuses).some((v) => (v ?? 0) < 0)) return true;
  if (e.skillBonuses && Object.values(e.skillBonuses).some((v) => (v ?? 0) < 0)) return true;
  return false;
}

/**
 * 一个角色此刻所有该显示的标签：濒死 / 稳定 / 死亡 → 负面 → 增益。
 * 同名的只留一个（狂暴既是效果又可能被调用方单独传入）。
 */
export function statusTags(a: Actor, raging = false): StatusTag[] {
  const down: StatusTag[] = [];
  const bad: StatusTag[] = [];
  const good: StatusTag[] = [];
  const seen = new Set<string>();
  const push = (list: StatusTag[], tag: StatusTag) => {
    if (seen.has(tag.text)) return;
    seen.add(tag.text);
    list.push(tag);
  };

  if (a.deathSaves.dead) push(down, { text: '死亡', kind: 'down' });
  else if (a.hp <= 0) push(down, { text: a.deathSaves.stable ? '稳定' : `濒死 ${a.deathSaves.successes}成${a.deathSaves.failures}败`, kind: 'down' });

  for (const c of a.conditions) {
    if ((c.name === 'unconscious' || c.name === 'prone') && a.hp <= 0 && c.source === 'dying') continue;
    const text = c.name === 'exhaustion' ? `力竭${c.level ?? 1}` : CONDITION_ZH[c.name];
    push(GOOD_CONDITIONS.has(c.name) ? good : bad, { text, kind: GOOD_CONDITIONS.has(c.name) ? 'buff' : 'debuff' });
  }

  for (const e of a.effects) {
    const harmful = effectIsHarmful(e);
    push(harmful ? bad : good, { text: e.name, kind: harmful ? 'debuff' : 'buff', ...(e.concentration ? { conc: true } : {}) });
  }
  if (raging) push(good, { text: '狂暴', kind: 'buff' });

  return [...down, ...bad, ...good];
}
