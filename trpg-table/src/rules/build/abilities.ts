// 属性最终值：基础值 + 种族加值 + 属性提升 / 专长（上限 20）+ 原初勇士。
import { ABILITIES, ABILITY_ZH, type Ability } from '../types.js';
import { err, warn, type Ctx, type ResolvedClass } from './ctx.js';
import { findFeat } from './lookup.js';
import type { FeatChoice } from './types.js';

export const ABILITY_CAP = 20;

const isAbility = (a: unknown): a is Ability => typeof a === 'string' && (ABILITIES as readonly string[]).includes(a);

const fmtAbilities = (r: Partial<Record<Ability, number>>): string =>
  ABILITIES.filter((a) => r[a]).map((a) => `${ABILITY_ZH[a]}+${r[a]}`).join(' ');

/** 加分并按上限截断；返回实际加了多少。 */
function bump(ctx: Ctx, a: Ability, n: number, cap = ABILITY_CAP): number {
  const before = ctx.abilities[a];
  ctx.abilities[a] = Math.min(cap, before + n);
  return ctx.abilities[a] - before;
}

/** 加一个专长（含它的属性效果），没有名额检查，只做自己的合法性检查。 */
export function addFeat(ctx: Ctx, featId: string, from: string, level: number, choice: FeatChoice | undefined, where: string): void {
  const def = findFeat(featId);
  if (!def) {
    err(ctx, `${where}：未知专长 "${featId}"`);
    return;
  }
  const repeatable = ['resilient', 'elemental_adept', 'magic_initiate'];
  if (ctx.feats.some((f) => f.def.id === def.id) && !repeatable.includes(def.id)) {
    err(ctx, `${where}：专长 ${def.name} 不能重复选`);
    return;
  }
  let ability: Ability | undefined;
  const allowed: Ability[] | undefined = def.asiAny ? [...ABILITIES] : def.asi;
  if (allowed) {
    ability = choice?.ability;
    if (ability !== undefined && !allowed.includes(ability)) {
      err(ctx, `${where}：专长 ${def.name} 的 +1 属性只能选 ${allowed.map((a) => ABILITY_ZH[a]).join('/')}（给的是 ${ability}）`);
      ability = undefined;
    }
    if (ability === undefined) {
      if (allowed.length === 1) ability = allowed[0];
      else {
        const startSaves = ctx.classes[0]?.def.saves ?? [];
        const prio: Ability[] = def.saveProf
          ? (['con', 'wis', 'dex', 'int', 'cha', 'str'] as Ability[]).filter((a) => !startSaves.includes(a))
          : [...(ctx.classes[0]?.def.asiPriority ?? [])];
        ability = prio.find((a) => allowed.includes(a) && ctx.abilities[a] < ABILITY_CAP) ?? allowed[0];
        warn(ctx, `${where}：专长 ${def.name} 没指定 +1 属性（featChoice.ability），自动选了${ABILITY_ZH[ability]}`);
      }
    }
    const gained = bump(ctx, ability, 1);
    if (gained === 0) warn(ctx, `${where}：${ABILITY_ZH[ability]}已经到上限 ${ABILITY_CAP}，专长 ${def.name} 的 +1 没有效果`);
  }
  ctx.feats.push({ def, from, level, choice, ability });
}

function autoAsi(ctx: Ctx, c: ResolvedClass): Partial<Record<Ability, number>> {
  const prio = priorityFor(ctx, c);
  const gain: Partial<Record<Ability, number>> = {};
  let left = 2;
  for (const a of prio) {
    if (left <= 0) break;
    const room = ABILITY_CAP - ctx.abilities[a];
    const take = Math.min(room, left);
    if (take > 0) {
      gain[a] = take;
      left -= take;
    }
  }
  return gain;
}

/** 自动提升的属性优先顺序：战士在敏捷高于力量时把敏捷排前面。 */
function priorityFor(ctx: Ctx, c: ResolvedClass): Ability[] {
  const prio = [...c.def.asiPriority];
  if (c.def.id === 'fighter' && ctx.abilities.dex > ctx.abilities.str) {
    return ['dex', 'con', 'str', 'wis', ...prio.filter((a) => !['dex', 'con', 'str', 'wis'].includes(a))];
  }
  return prio;
}

function asiSlotKeys(ctx: Ctx): { c: ResolvedClass; level: number; keys: string[] }[] {
  const out: { c: ResolvedClass; level: number; keys: string[] }[] = [];
  for (const c of ctx.classes) {
    for (const lvl of c.def.asiLevels) {
      if (lvl > c.level) continue;
      out.push({ c, level: lvl, keys: [`${c.def.id}:${lvl}`, ...(c.index === 0 ? [String(lvl)] : [])] });
    }
  }
  return out;
}

export function resolveAbilities(ctx: Ctx): void {
  const base = ctx.build.abilityScores;
  for (const a of ABILITIES) ctx.abilities[a] = base[a];

  // 种族固定加值
  const race = ctx.race;
  for (const a of ABILITIES) {
    const v = race.asi[a];
    if (v && bump(ctx, a, v) < v) warn(ctx, `${race.zh}的${ABILITY_ZH[a]}加值让它超过了上限 ${ABILITY_CAP}，只加了一部分`);
  }
  // 种族自选加值
  if (race.asiChoice) {
    const { count, amount, exclude } = race.asiChoice;
    const given = ctx.build.raceOptions?.abilityBonuses ?? [];
    const picked: Ability[] = [];
    for (const a of given) {
      if (!isAbility(a)) err(ctx, `raceOptions.abilityBonuses：未知属性 "${String(a)}"`);
      else if (exclude?.includes(a)) err(ctx, `${race.zh}自选的 +1 属性不能是${ABILITY_ZH[a]}`);
      else if (picked.includes(a)) err(ctx, `raceOptions.abilityBonuses：${ABILITY_ZH[a]}重复了（要选 ${count} 项不同的属性）`);
      else picked.push(a);
    }
    if (given.length > count) err(ctx, `${race.zh}的自选属性加值只有 ${count} 项，给了 ${given.length} 项`);
    const prio = ctx.classes[0].def.asiPriority;
    for (const a of [...prio, ...ABILITIES]) {
      if (picked.length >= count) break;
      if (exclude?.includes(a) || picked.includes(a)) continue;
      picked.push(a);
      warn(ctx, `${race.zh}自选的 +${amount} 属性没给齐，自动选了${ABILITY_ZH[a]}（按起始职业的主属性顺序）`);
    }
    for (const a of picked.slice(0, count)) bump(ctx, a, amount);
  }
  // 变体人类的 1 级专长
  if (race.startingFeat) {
    let feat = ctx.build.raceOptions?.feat;
    if (!feat) {
      feat = 'tough';
      warn(ctx, `${race.zh}没选 1 级专长（raceOptions.feat），自动选了强韧（tough）`);
    }
    addFeat(ctx, feat, 'race', 1, ctx.build.raceOptions?.featChoice, `${race.zh}的 1 级专长`);
  }

  // 属性提升 / 专长
  const given = ctx.build.asi ?? {};
  const used = new Set<string>();
  const slots = asiSlotKeys(ctx);
  for (const slot of slots) {
    const { c, level } = slot;
    const key = slot.keys.find((k) => given[k] !== undefined);
    const choice = key !== undefined ? given[key] : undefined;
    if (key !== undefined) used.add(key);
    const where = `${c.def.zh} ${level} 级属性提升`;
    const hasAbilities = choice?.abilities && Object.keys(choice.abilities).length > 0;
    if (choice && (hasAbilities || choice.feat)) {
      if (hasAbilities && choice.feat) {
        err(ctx, `${where}：属性提升和专长只能二选一`);
        continue;
      }
      if (choice.feat) {
        addFeat(ctx, choice.feat, c.def.id, level, choice.featChoice, where);
        const f = findFeat(choice.feat);
        ctx.asiLog.push({ classId: c.def.id, level, summary: `专长：${f?.name ?? choice.feat}`, auto: false });
        continue;
      }
      const inc = choice.abilities!;
      let sum = 0;
      let bad = false;
      for (const [a, v] of Object.entries(inc)) {
        if (!isAbility(a)) {
          err(ctx, `${where}：未知属性 "${a}"`);
          bad = true;
        } else if (!Number.isInteger(v) || (v as number) < 1 || (v as number) > 2) {
          err(ctx, `${where}：${ABILITY_ZH[a]} 的提升必须是 1 或 2`);
          bad = true;
        } else sum += v as number;
      }
      if (!bad && sum !== 2) {
        err(ctx, `${where}：属性提升总共必须是 +2（+2 给一项，或 +1 给两项），现在是 +${sum}`);
        bad = true;
      }
      if (bad) continue;
      const applied: string[] = [];
      for (const a of ABILITIES) {
        const v = inc[a];
        if (!v) continue;
        const gained = bump(ctx, a, v);
        applied.push(`${ABILITY_ZH[a]}+${gained}`);
        if (gained < v) warn(ctx, `${where}：${ABILITY_ZH[a]}到了上限 ${ABILITY_CAP}，只加了 ${gained}`);
      }
      ctx.asiLog.push({ classId: c.def.id, level, summary: applied.join(' '), auto: false });
      continue;
    }
    // 没给：自动
    const gain = autoAsi(ctx, c);
    for (const a of ABILITIES) if (gain[a]) bump(ctx, a, gain[a]!);
    const summary = fmtAbilities(gain) || '（属性都已到上限，没有可加的）';
    ctx.asiLog.push({ classId: c.def.id, level, summary, auto: true });
    warn(ctx, `${where}没给选择，自动 ${summary}（按${c.def.zh}的主属性顺序）`);
  }
  for (const key of Object.keys(given)) {
    if (!used.has(key)) {
      const valid = slots.map((s) => s.keys[0]).join('、');
      err(ctx, `asi 的键 "${key}" 对不上任何属性提升等级（这个构建可用的键：${valid || '无'}）`);
    }
  }

  // 原初勇士：力量和体质 +4，上限 24
  const barb = ctx.classes.find((c) => c.def.id === 'barbarian');
  if (barb && barb.level >= 20) {
    bump(ctx, 'str', 4, 24);
    bump(ctx, 'con', 4, 24);
  }
}
