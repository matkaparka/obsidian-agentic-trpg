// 施法：法术位（单职业 / 多职业合并 / 契约魔法）、戏法数 / 已知数 / 准备数上限、永久准备法术、
// 没人指定时的默认选择，以及用 SPELLS 过滤（引擎里没有的法术丢掉并写进 warnings）。
import { SPELLS } from '../data/spells.js';
import { ABILITY_ZH, type Ability } from '../types.js';
import { activeSubclass, err, mod, warn, type Ctx, type ResolvedClass } from './ctx.js';
import { SPELL_CLASS_LIST } from './data/spell-lists.gen.js';
import { LAND_CIRCLE_SPELLS } from './data/srd-subclasses.js';
import { SUBCLASS_EFFECTS } from './data/subclass-effects.js';
import {
  cantripsKnownFor,
  DEFAULT_SPELLS,
  FULL_CASTER_SLOTS,
  HALF_CASTER_SLOTS,
  PACT_SLOTS,
  SPELLS_KNOWN,
  THIRD_CASTER_SCHOOLS,
  THIRD_CASTER_SLOTS,
  THIRD_CASTER_SPELLS_KNOWN,
  thirdCasterAnySchoolPicks,
} from './data/spell-tables.js';
import { normId } from './lookup.js';
import type { ClassSpellInfo } from './types.js';
import type { ClassSpellChoice } from './types.js';

export type CasterKind = 'full' | 'half' | 'third' | 'pact';

export interface Caster {
  c: ResolvedClass;
  kind: CasterKind;
  ability: Ability;
  style: 'known' | 'prepared' | 'spellbook';
  /** 查 DEFAULT_SPELLS / 职业法术表用的键：奥法骑士 / 诡术师用子职业 id，其它用职业 id */
  key: string;
  /** 法术表所属职业（奥法骑士 / 诡术师 = wizard） */
  list: string;
}

export interface SpellResult {
  ability: Ability;
  slots: Record<number, { max: number; used: number }>;
  pact: boolean;
  /** 兼职时并进总表的契约位（level 环 × count 个），引擎短休时恢复 */
  pactSlots?: { level: number; count: number };
  /** 现在能施放的法术（过滤过 SPELLS） */
  known: string[];
  byClass: Record<string, ClassSpellInfo>;
  droppedSpells: string[];
  racialSpells: string[];
  /** 法师的法术书（过滤前，仅展示用） */
  spellbooks: Record<string, string[]>;
}

const cap = (n: number): number => Math.max(1, Math.min(20, n));

/** 警告里列法术 id：太多就截断。 */
export const listIds = (ids: string[], max = 10): string => (ids.length > max ? `${ids.slice(0, max).join('、')} 等共 ${ids.length} 个` : ids.join('、'));

// ---------------------------------------------------------------- 法术数据查询
const levelOf = (id: string): number | undefined => SPELL_CLASS_LIST[id]?.[0] ?? SPELLS[id]?.level;
const schoolOf = (id: string): string | undefined => SPELL_CLASS_LIST[id]?.[2];
const onList = (id: string, list: string): boolean => {
  const row = SPELL_CLASS_LIST[id];
  if (row?.[1].split(',').includes(list)) return true;
  const s = SPELLS[id];
  return !!s && (s.classes as string[]).includes(list);
};

/** 某职业法术表上、某环阶的全部法术（静态表，不依赖 SPELLS）。 */
function listSpellsOf(list: string, level: number): string[] {
  return Object.entries(SPELL_CLASS_LIST)
    .filter(([, r]) => r[0] === level && r[1].split(',').includes(list))
    .map(([id]) => id)
    .sort();
}

// ---------------------------------------------------------------- 谁在施法
export function findCasters(ctx: Ctx): Caster[] {
  const out: Caster[] = [];
  for (const c of ctx.classes) {
    const d = c.def;
    const sub = activeSubclass(c);
    if (d.caster === 'full' || (d.caster === 'half' && c.level >= 2) || d.caster === 'pact') {
      out.push({ c, kind: d.caster, ability: d.spellAbility!, style: d.spellStyle!, key: d.id, list: d.id });
    } else if (d.caster === 'none' && sub && THIRD_CASTER_SCHOOLS[sub.id] && c.level >= 3) {
      out.push({ c, kind: 'third', ability: 'int', style: 'known', key: sub.id, list: 'wizard' });
    }
  }
  return out;
}

function ownSlots(k: Caster): number[] {
  const lv = k.c.level;
  if (k.kind === 'full') return FULL_CASTER_SLOTS[cap(lv) - 1];
  if (k.kind === 'half') return HALF_CASTER_SLOTS[cap(lv) - 1];
  if (k.kind === 'third') return THIRD_CASTER_SLOTS[cap(lv) - 1];
  return [];
}

function maxSpellLevel(k: Caster): number {
  if (k.kind === 'pact') return PACT_SLOTS[cap(k.c.level) - 1][1];
  return ownSlots(k).length;
}

export function computeSlots(casters: Caster[]): { slots: Record<number, number>; pact?: { count: number; level: number }; casterLevel: number; merged: boolean } {
  const slotCasters = casters.filter((k) => k.kind !== 'pact');
  const slots: Record<number, number> = {};
  let casterLevel = 0;
  let merged = false;
  if (slotCasters.length >= 2) {
    merged = true;
    for (const k of slotCasters) {
      casterLevel += k.kind === 'full' ? k.c.level : k.kind === 'half' ? Math.floor(k.c.level / 2) : Math.floor(k.c.level / 3);
    }
    casterLevel = Math.min(20, casterLevel);
    if (casterLevel >= 1) FULL_CASTER_SLOTS[casterLevel - 1].forEach((n, i) => (slots[i + 1] = n));
  } else if (slotCasters.length === 1) {
    ownSlots(slotCasters[0]).forEach((n, i) => (slots[i + 1] = n));
  }
  const pk = casters.find((k) => k.kind === 'pact');
  const pact = pk ? { count: PACT_SLOTS[cap(pk.c.level) - 1][0], level: PACT_SLOTS[cap(pk.c.level) - 1][1] } : undefined;
  return { slots, pact, casterLevel, merged };
}

// ---------------------------------------------------------------- 上限
function cantripsMax(k: Caster): number {
  const lv = k.c.level;
  let n: number;
  if (k.kind === 'third') n = (lv >= 10 ? 3 : 2) + (k.key === 'arcane_trickster' ? 1 : 0);
  else n = cantripsKnownFor(k.c.def.id, lv);
  const sub = activeSubclass(k.c);
  const fx = sub ? SUBCLASS_EFFECTS[`${k.c.def.id}/${sub.id}`] : undefined;
  if (fx?.extraCantrips) n += fx.extraCantrips.count;
  return n;
}

function spellsMax(ctx: Ctx, k: Caster): number {
  const lv = k.c.level;
  const m = mod(ctx, k.ability);
  if (k.kind === 'third') return THIRD_CASTER_SPELLS_KNOWN[cap(lv) - 1];
  if (k.style === 'known') return SPELLS_KNOWN[k.c.def.id]?.[cap(lv) - 1] ?? 0;
  if (k.c.def.id === 'paladin') return Math.max(1, m + Math.floor(lv / 2));
  return Math.max(1, m + lv);
}

/** 魔法奥秘等允许从别的职业表里选的名额。 */
function offListAllowance(k: Caster): number {
  if (k.c.def.id !== 'bard') return 0;
  const lv = k.c.level;
  let n = lv >= 18 ? 6 : lv >= 14 ? 4 : lv >= 10 ? 2 : 0;
  if (activeSubclass(k.c)?.id === 'lore' && lv >= 6) n += 2;
  return n;
}

// ---------------------------------------------------------------- 永久准备 / 白送
function alwaysPreparedOf(ctx: Ctx, k: Caster): string[] {
  const out: string[] = [];
  const sub = activeSubclass(k.c);
  if (sub?.spells && k.c.def.id !== 'warlock') {
    for (const [lvl, ids] of Object.entries(sub.spells)) if (Number(lvl) <= k.c.level) out.push(...ids);
  }
  if (k.c.def.id === 'druid' && sub?.id === 'land' && ctx.landCircle) {
    const tbl = LAND_CIRCLE_SPELLS[ctx.landCircle];
    for (const [lvl, ids] of Object.entries(tbl ?? {})) if (Number(lvl) <= k.c.level) out.push(...ids);
  }
  return [...new Set(out)];
}

function freeCantripsOf(k: Caster): string[] {
  const sub = activeSubclass(k.c);
  const fx = sub ? SUBCLASS_EFFECTS[`${k.c.def.id}/${sub.id}`] : undefined;
  return fx?.freeCantrips ?? [];
}

/** 邪术师宗主的扩展法术表：可以选，但不是白送的。 */
function expandedListOf(k: Caster): string[] {
  const sub = activeSubclass(k.c);
  if (k.c.def.id !== 'warlock' || !sub?.spells) return [];
  return Object.entries(sub.spells)
    .filter(([lvl]) => Number(lvl) <= k.c.level)
    .flatMap(([, ids]) => ids);
}

// ---------------------------------------------------------------- 默认选择
/** 按环阶轮流（从最高环阶往下一个一个取）补满 count 个。candidates[level] 是按偏好排好的 id。 */
function ladder(candidates: Record<number, string[]>, count: number, maxLevel: number, exclude: Set<string>): string[] {
  const picked: string[] = [];
  const cursor: Record<number, number> = {};
  let progressed = true;
  while (picked.length < count && progressed) {
    progressed = false;
    for (let lv = maxLevel; lv >= 1 && picked.length < count; lv--) {
      const list = candidates[lv] ?? [];
      let i = cursor[lv] ?? 0;
      while (i < list.length && (exclude.has(list[i]) || picked.includes(list[i]))) i++;
      if (i < list.length) {
        picked.push(list[i]);
        cursor[lv] = i + 1;
        progressed = true;
      } else cursor[lv] = list.length;
    }
  }
  return picked;
}

function candidatesFor(k: Caster, maxLevel: number): Record<number, string[]> {
  const pref = DEFAULT_SPELLS[k.key]?.levels ?? {};
  const out: Record<number, string[]> = {};
  for (let lv = 1; lv <= maxLevel; lv++) {
    const curated = (pref[lv] ?? []).filter((id) => onList(id, k.list));
    const rest = listSpellsOf(k.list, lv).filter((id) => !curated.includes(id));
    out[lv] = [...curated, ...rest];
  }
  return out;
}

// ---------------------------------------------------------------- 单个职业
interface ClassPicks {
  cantrips: string[];
  spells: string[];
  spellbook?: string[];
  alwaysPrepared: string[];
  info: ClassSpellInfo;
}

function normList(ctx: Ctx, ids: unknown, where: string): string[] {
  if (ids === undefined) return [];
  if (!Array.isArray(ids)) {
    err(ctx, `${where} 必须是法术 id 数组`);
    return [];
  }
  const out: string[] = [];
  for (const raw of ids) {
    if (typeof raw !== 'string') {
      err(ctx, `${where} 里有不是字符串的项`);
      continue;
    }
    const id = normId(raw);
    if (!out.includes(id)) out.push(id);
    else err(ctx, `${where}：${id} 重复了`);
  }
  return out;
}

function resolveClass(ctx: Ctx, k: Caster, choice: ClassSpellChoice | undefined, unknownIds: Set<string>): ClassPicks {
  const d = k.c.def;
  const lv = k.c.level;
  const label = `${d.zh}的法术`;
  const maxLv = maxSpellLevel(k);
  const cMax = cantripsMax(k);
  const sMax = spellsMax(ctx, k);
  const bookMax = k.style === 'spellbook' ? 6 + 2 * (lv - 1) : undefined;
  const always = alwaysPreparedOf(ctx, k);
  const free = freeCantripsOf(k);
  const sub = activeSubclass(k.c);
  const fx = sub ? SUBCLASS_EFFECTS[`${d.id}/${sub.id}`] : undefined;
  const allowOff = offListAllowance(k);
  const expanded = new Set(expandedListOf(k));

  // ---- 戏法
  const counted: string[] = [];
  const freebies: string[] = [];
  const givenC = normList(ctx, choice?.cantrips, `${label}（cantrips）`);
  const extraSource = fx?.extraCantrips?.list;
  let extraLeft = fx?.extraCantrips?.count ?? 0;
  for (const id of givenC) {
    const lvl = levelOf(id);
    if (lvl === undefined) {
      unknownIds.add(id);
      warn(ctx, `${label}：戏法 "${id}" 不认识（不在 PHB 法术表也不在 SPELLS 里），已丢掉`);
      continue;
    }
    if (lvl !== 0) {
      err(ctx, `${label}：${id} 是 ${lvl} 环法术，不是戏法`);
      continue;
    }
    if (free.includes(id)) freebies.push(id);
    else if (onList(id, k.list)) counted.push(id);
    else if (extraSource && onList(id, extraSource) && extraLeft > 0) {
      extraLeft -= 1;
      counted.push(id);
    } else err(ctx, `${label}：戏法 ${id} 不在${d.zh}的法术表上`);
  }
  if (counted.length > cMax) err(ctx, `${label}：戏法最多 ${cMax} 个，给了 ${counted.length} 个`);
  counted.length = Math.min(counted.length, cMax);
  if (counted.length < cMax) {
    const added: string[] = [];
    const take = (list: string): string[] => {
      const pref = DEFAULT_SPELLS[list]?.cantrips ?? [];
      const listName = list === 'eldritch_knight' || list === 'arcane_trickster' ? 'wizard' : list;
      const rest = Object.entries(SPELL_CLASS_LIST)
        .filter(([, r]) => r[0] === 0 && r[1].split(',').includes(listName))
        .map(([id]) => id)
        .sort();
      return [...new Set([...pref, ...rest])].filter((id) => onList(id, listName));
    };
    if (extraSource) {
      for (const id of take(extraSource)) {
        if (extraLeft <= 0 || counted.length >= cMax) break;
        if (!counted.includes(id) && !free.includes(id)) {
          counted.push(id);
          added.push(id);
          extraLeft -= 1;
        }
      }
    }
    for (const id of take(k.key)) {
      if (counted.length >= cMax) break;
      if (!counted.includes(id) && !free.includes(id)) {
        counted.push(id);
        added.push(id);
      }
    }
    if (added.length) warn(ctx, `${label}：戏法没选满（${cMax} 个），自动补了 ${added.join('、')}`);
  }
  const cantrips = [...new Set([...freebies, ...free, ...counted])];

  // ---- 有环法术
  const exclude = new Set<string>([...always, ...cantrips]);
  let spells: string[] = [];
  let spellbook: string[] | undefined;
  const checkSpell = (id: string, where: string, inBook?: Set<string>): boolean => {
    const lvl = levelOf(id);
    if (lvl === undefined) {
      unknownIds.add(id);
      warn(ctx, `${where}：法术 "${id}" 不认识（不在 PHB 法术表也不在 SPELLS 里），已丢掉`);
      return false;
    }
    if (lvl === 0) {
      err(ctx, `${where}：${id} 是戏法，请放进 cantrips`);
      return false;
    }
    if (lvl > maxLv) {
      err(ctx, `${where}：${id} 是 ${lvl} 环法术，${d.zh} ${lv} 级最高只能学 / 准备 ${maxLv} 环`);
      return false;
    }
    if (inBook && !inBook.has(id)) {
      err(ctx, `${where}：${id} 不在法术书里，不能准备`);
      return false;
    }
    return true;
  };

  const markOff = { n: 0 };
  const classOk = (id: string, where: string): boolean => {
    if (onList(id, k.list)) return true;
    if (expanded.has(id)) return true;
    if (markOff.n < allowOff) {
      markOff.n += 1;
      return true;
    }
    err(ctx, `${where}：${id} 不在${d.zh}的法术表上`);
    return false;
  };

  const pickGiven = (ids: string[], where: string, inBook?: Set<string>): string[] => {
    const out: string[] = [];
    for (const id of ids) {
      if (!checkSpell(id, where, inBook)) continue;
      if (!inBook && !classOk(id, where)) continue;
      if (always.includes(id)) {
        warn(ctx, `${where}：${id} 是永久准备的法术，不占准备名额，不用再选`);
        continue;
      }
      out.push(id);
    }
    return out;
  };

  const cand = candidatesFor(k, maxLv);

  if (k.style === 'spellbook') {
    const givenBook = normList(ctx, choice?.spellbook, `${label}（spellbook）`);
    const givenPrep = normList(ctx, choice?.prepared ?? choice?.known, `${label}（prepared）`);
    spellbook = pickGiven(givenBook, `${label}（法术书）`);
    if (bookMax !== undefined && spellbook.length > bookMax) warn(ctx, `${label}：法术书里有 ${spellbook.length} 个法术，超过 ${bookMax} 个（抄写卷轴可以超，请确认）`);
    if (givenBook.length === 0 && bookMax !== undefined) {
      // 没给法术书：先放进要准备的，再按偏好抄满
      const seed = pickGiven(givenPrep, `${label}（准备）`).filter((id) => onList(id, k.list));
      const filled = [...new Set([...seed, ...ladder(cand, bookMax, maxLv, new Set([...cantrips, ...seed]))])].slice(0, Math.max(bookMax, seed.length));
      spellbook = filled;
      warn(ctx, `${label}：没给法术书，自动抄了 ${spellbook.length} 个：${listIds(spellbook)}`);
    }
    const book = new Set(spellbook);
    spells = givenPrep.length ? pickGiven(givenPrep, `${label}（准备）`, book) : [];
    if (spells.length > sMax) err(ctx, `${label}：每天最多准备 ${sMax} 个（智力调整值 + 法师等级），给了 ${spells.length} 个`);
    spells = spells.slice(0, sMax);
    if (spells.length < sMax) {
      const byLevel: Record<number, string[]> = {};
      for (const id of spellbook) (byLevel[levelOf(id) ?? 1] ??= []).push(id);
      const add = ladder(byLevel, sMax - spells.length, maxLv, new Set(spells));
      spells.push(...add);
      if (add.length) warn(ctx, `${label}：准备的法术没选满（${sMax} 个），自动从法术书里补了 ${listIds(add)}`);
    }
  } else if (k.style === 'prepared') {
    const givenPrep = normList(ctx, choice?.prepared ?? choice?.known, `${label}（prepared）`);
    spells = pickGiven(givenPrep, `${label}（准备）`);
    if (spells.length > sMax) err(ctx, `${label}：每天最多准备 ${sMax} 个（${ABILITY_ZH[k.ability]}调整值 + ${d.id === 'paladin' ? '圣武士等级的一半' : '等级'}，不含永久准备的），给了 ${spells.length} 个`);
    spells = spells.slice(0, sMax);
    if (spells.length < sMax) {
      const add = ladder(cand, sMax - spells.length, maxLv, new Set([...exclude, ...spells]));
      spells.push(...add);
      if (add.length) warn(ctx, `${label}：准备的法术没选满（${sMax} 个），自动补了 ${listIds(add)}`);
      if (spells.length < sMax) warn(ctx, `${label}：候选法术不够，只选了 ${spells.length} / ${sMax} 个`);
    }
  } else {
    const givenKnown = normList(ctx, choice?.known ?? choice?.prepared, `${label}（known）`);
    spells = pickGiven(givenKnown, `${label}（已知）`);
    // 奥法骑士 / 诡术师：学派限制
    if (k.kind === 'third') {
      const schools = THIRD_CASTER_SCHOOLS[k.key];
      const outside = spells.filter((id) => {
        const s = schoolOf(id);
        return s !== undefined && !schools.includes(s);
      }).length;
      const allowed = thirdCasterAnySchoolPicks(lv);
      if (outside > allowed) err(ctx, `${label}：${d.zh} ${lv} 级只能有 ${allowed} 个${schools.join('/')}以外学派的法术，现在有 ${outside} 个`);
    }
    if (spells.length > sMax) err(ctx, `${label}：已知法术最多 ${sMax} 个，给了 ${spells.length} 个`);
    spells = spells.slice(0, sMax);
    if (spells.length < sMax) {
      // 奥法骑士 / 诡术师的默认表本身只含两个学派的法术
      const candK = k.kind === 'third' ? restrictSchools(cand, THIRD_CASTER_SCHOOLS[k.key]) : cand;
      const add = ladder(candK, sMax - spells.length, maxLv, new Set([...exclude, ...spells]));
      spells.push(...add);
      if (add.length) warn(ctx, `${label}：已知法术没选满（${sMax} 个），自动补了 ${listIds(add)}`);
      if (spells.length < sMax) warn(ctx, `${label}：候选法术不够，只选了 ${spells.length} / ${sMax} 个`);
    }
  }

  const info: ClassSpellInfo = {
    classId: d.id,
    style: k.style,
    ability: k.ability,
    cantripsMax: cMax,
    spellsMax: sMax,
    ...(bookMax !== undefined ? { spellbookMax: bookMax } : {}),
    maxSpellLevel: maxLv,
    cantrips: [...cantrips],
    spells: [...spells],
    alwaysPrepared: [...always],
    ...(spellbook ? { spellbook: [...spellbook] } : {}),
  };
  return { cantrips, spells, spellbook, alwaysPrepared: always, info };
}

function restrictSchools(cand: Record<number, string[]>, schools: [string, string]): Record<number, string[]> {
  const out: Record<number, string[]> = {};
  for (const [lv, ids] of Object.entries(cand)) out[Number(lv)] = ids.filter((id) => schools.includes(schoolOf(id) ?? ''));
  return out;
}

// ---------------------------------------------------------------- 总入口
export function resolveSpells(ctx: Ctx): SpellResult | undefined {
  const casters = findCasters(ctx);
  const unknownIds = new Set<string>();
  const byClass: Record<string, ClassSpellInfo> = {};
  const spellbooks: Record<string, string[]> = {};
  const all: string[] = [];

  // 谁用 build.spells（第一个施法职业），谁用 spellsByClass
  casters.forEach((k, i) => {
    const choice = ctx.build.spellsByClass?.[k.c.def.id] ?? (i === 0 ? ctx.build.spells : undefined);
    const r = resolveClass(ctx, k, choice, unknownIds);
    byClass[k.c.def.id] = r.info;
    if (r.spellbook) spellbooks[k.c.def.id] = r.spellbook;
    all.push(...r.cantrips, ...r.spells, ...r.alwaysPrepared);
  });
  if (ctx.build.spellsByClass) {
    for (const id of Object.keys(ctx.build.spellsByClass)) {
      if (!casters.some((k) => k.c.def.id === id)) err(ctx, `spellsByClass 里的 ${id} 不是这个角色的施法职业`);
    }
  }
  if (ctx.build.spells && casters.length === 0) warn(ctx, '这个角色现在没有施法能力，build.spells 被忽略');

  // 种族：天生法术和高等精灵的戏法
  const racialCantrips: string[] = [];
  const racialSpells: string[] = [];
  const race = ctx.race;
  let racialAbility: Ability | undefined;
  if (race.innateSpells) {
    racialAbility = race.innateSpells.ability;
    racialCantrips.push(...race.innateSpells.cantrips);
    for (const s of race.innateSpells.spells) if (ctx.totalLevel >= s.level) racialSpells.push(`${s.id}（${s.castAt} 环，每长休一次）`);
  }
  if (race.wizardCantrip) {
    racialAbility = 'int';
    let id = ctx.build.raceOptions?.cantrip ? normId(ctx.build.raceOptions.cantrip) : undefined;
    if (id && (levelOf(id) !== 0 || !onList(id, 'wizard'))) {
      if (levelOf(id) === undefined) {
        warn(ctx, `高等精灵的戏法 "${id}" 不认识，已丢掉`);
        unknownIds.add(id);
      } else err(ctx, `高等精灵的戏法 ${id} 必须是法师表上的戏法`);
      id = undefined;
    }
    if (!id) {
      const taken = new Set(all);
      id = (DEFAULT_SPELLS.wizard?.cantrips ?? []).find((c) => !taken.has(c)) ?? 'fire_bolt';
      if (!ctx.build.raceOptions?.cantrip) warn(ctx, `高等精灵没选戏法（raceOptions.cantrip），自动选了 ${id}`);
    }
    racialCantrips.push(id);
  }
  // 用 SPELLS 过滤（种族天生戏法单独说，不进 warnings）
  const known: string[] = [];
  const dropped: string[] = [];
  for (const id of [...new Set(all)]) {
    if (SPELLS[id]) known.push(id);
    else if (!unknownIds.has(id)) dropped.push(id);
  }
  const racialMissing: string[] = [];
  for (const id of racialCantrips) {
    if (SPELLS[id]) {
      if (!known.includes(id)) known.push(id);
    } else racialMissing.push(id);
  }
  if (racialMissing.length) ctx.notes.push(`种族天生戏法：${racialMissing.join("、")}（引擎里还没有这个法术，暂时不能施放）。`);
  if (dropped.length > 0) {
    const shown = dropped.slice(0, 14).join('、');
    warn(ctx, `SPELLS 里还没有这些法术，已从可施放列表里去掉（共 ${dropped.length} 个）：${shown}${dropped.length > 14 ? ' 等' : ''}`);
  }

  if (casters.length === 0) {
    if (known.length === 0 || racialAbility === undefined) return undefined;
    return {
      ability: racialAbility,
      slots: {},
      pact: false,
      known,
      byClass,
      droppedSpells: dropped,
      racialSpells,
      spellbooks,
    };
  }

  // 法术位
  const { slots, pact, merged } = computeSlots(casters);
  const slotMap: Record<number, { max: number; used: number }> = {};
  for (const [lv, n] of Object.entries(slots)) if (n > 0) slotMap[Number(lv)] = { max: n, used: 0 };
  let isPact = false;
  let pactSlots: { level: number; count: number } | undefined;
  if (pact) {
    if (Object.keys(slotMap).length === 0) {
      isPact = true;
      slotMap[pact.level] = { max: pact.count, used: 0 };
    } else {
      const cur = slotMap[pact.level]?.max ?? 0;
      slotMap[pact.level] = { max: cur + pact.count, used: 0 };
      pactSlots = { level: pact.level, count: pact.count };
      warn(ctx, `邪术师和其它施法职业兼职：契约魔法的法术位已经并进总法术位表（其中 ${pact.level} 环 ${pact.count} 个是契约位）。总表分不清哪个位是谁的，短休时近似为恢复 ${pact.level} 环已用位中至多 ${pact.count} 个，其余长休才恢复`);
    }
  }
  const abilities = new Set(casters.map((k) => k.ability));
  const ability = casters[0].ability;
  if (abilities.size > 1) {
    warn(ctx, `多个施法职业用不同的施法属性（${[...abilities].map((a) => ABILITY_ZH[a]).join('、')}），引擎的 Spellcasting 只有一个施法属性，用了第一个施法职业的${ABILITY_ZH[ability]}`);
  }
  if (merged) {
    ctx.notes.push(`法术位按多职业施法者表合并（施法者等级 ${computeSlots(casters).casterLevel}）`);
  }
  return { ability, slots: slotMap, pact: isPact, ...(pactSlots ? { pactSlots } : {}), known, byClass, droppedSpells: dropped, racialSpells, spellbooks };
}
