// 熟练项：豁免、护甲 / 武器 / 工具 / 语言、技能（含重复补位）、专精。
import { SKILLS, SKILL_ZH, type Ability, type Skill } from '../types.js';
import { WEAPONS } from '../data/weapons.js';
import { activeSubclass, err, warn, type Ctx } from './ctx.js';
import type { ClassId } from '../contract.js';
import { SUBCLASS_EFFECTS } from './data/subclass-effects.js';

const isSkill = (s: unknown): s is Skill => typeof s === 'string' && (SKILLS as readonly string[]).includes(s);

/** 没人指定时各职业自选技能的偏好顺序。 */
const SKILL_PREF: Record<ClassId, Skill[]> = {
  barbarian: ['athletics', 'perception', 'survival', 'intimidation', 'nature', 'animal_handling'],
  bard: ['persuasion', 'performance', 'deception', 'perception', 'insight', 'acrobatics', 'sleight_of_hand', 'stealth', 'history', 'arcana'],
  cleric: ['insight', 'religion', 'medicine', 'persuasion', 'history'],
  druid: ['nature', 'perception', 'survival', 'medicine', 'animal_handling', 'insight', 'arcana', 'religion'],
  fighter: ['athletics', 'perception', 'intimidation', 'acrobatics', 'survival', 'insight', 'history', 'animal_handling'],
  monk: ['acrobatics', 'stealth', 'athletics', 'insight', 'history', 'religion'],
  paladin: ['athletics', 'persuasion', 'insight', 'intimidation', 'religion', 'medicine'],
  ranger: ['perception', 'stealth', 'survival', 'nature', 'athletics', 'investigation', 'insight', 'animal_handling'],
  rogue: ['stealth', 'perception', 'sleight_of_hand', 'acrobatics', 'deception', 'investigation', 'insight', 'persuasion', 'athletics', 'intimidation', 'performance'],
  sorcerer: ['persuasion', 'deception', 'intimidation', 'insight', 'arcana', 'religion'],
  warlock: ['deception', 'intimidation', 'arcana', 'investigation', 'history', 'religion', 'nature'],
  wizard: ['arcana', 'investigation', 'history', 'insight', 'medicine', 'religion'],
};

/** 任意技能的通用偏好顺序。 */
const ANY_PREF: Skill[] = [
  'perception', 'stealth', 'insight', 'persuasion', 'athletics', 'acrobatics', 'investigation', 'arcana', 'deception', 'survival',
  'intimidation', 'medicine', 'history', 'nature', 'religion', 'sleight_of_hand', 'performance', 'animal_handling',
];

const EXPERTISE_PREF: Record<string, Skill[]> = {
  rogue: ['stealth', 'perception', 'sleight_of_hand', 'acrobatics', 'investigation', 'deception', 'persuasion', 'athletics', 'insight', 'intimidation', 'performance'],
  bard: ['persuasion', 'performance', 'deception', 'perception', 'insight', 'acrobatics', 'stealth', 'sleight_of_hand', 'history', 'arcana'],
};

const EXPERTISE_LEVELS: Record<string, number[]> = { rogue: [1, 6], bard: [3, 10] };

export const fmtSkill = (s: Skill): string => SKILL_ZH[s];

// ---------------------------------------------------------------- 豁免 / 护甲 / 武器 / 工具 / 语言
export function resolveProficiencies(ctx: Ctx): void {
  const first = ctx.classes[0];

  // 豁免：只看起始职业（兼职不给豁免），再加专长、钻石之魂、滑溜心智
  for (const a of first.def.saves) ctx.saves.add(a);
  for (const f of ctx.feats) if (f.def.saveProf && f.ability) ctx.saves.add(f.ability);
  if (ctx.classes.some((c) => c.def.id === 'monk' && c.level >= 14)) for (const a of ['str', 'dex', 'con', 'int', 'wis', 'cha'] as Ability[]) ctx.saves.add(a);
  if (ctx.classes.some((c) => c.def.id === 'rogue' && c.level >= 15)) ctx.saves.add('wis');

  // 护甲 / 武器 / 工具：起始职业整套，其它职业只给兼职那一行
  for (const c of ctx.classes) {
    if (c.index === 0) {
      c.def.armor.forEach((a) => ctx.armorProf.add(a));
      c.def.weapons.categories.forEach((w) => ctx.weaponCategories.add(w));
      c.def.weapons.ids.forEach((w) => ctx.weaponIds.add(w));
      ctx.tools.push(...c.def.tools);
    } else {
      const g = c.def.multiclassGrant;
      g.armor.forEach((a) => ctx.armorProf.add(a));
      g.weaponCategories.forEach((w) => ctx.weaponCategories.add(w));
      g.weaponIds.forEach((w) => ctx.weaponIds.add(w));
      ctx.tools.push(...g.tools);
    }
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    if (fx) {
      fx.armor?.forEach((a) => ctx.armorProf.add(a));
      fx.weaponCategories?.forEach((w) => ctx.weaponCategories.add(w));
      fx.weaponIds?.forEach((w) => ctx.weaponIds.add(w));
      if (fx.tools) ctx.tools.push(...fx.tools);
    }
  }
  // 种族
  const race = ctx.race;
  race.armor?.forEach((a) => ctx.armorProf.add(a));
  race.weaponIds?.forEach((w) => ctx.weaponIds.add(w));
  if (race.tools) ctx.tools.push(...race.tools);
  if (race.toolChoice) {
    const wanted = ctx.build.raceOptions?.tools ?? [];
    const pick = wanted.filter((t) => race.toolChoice!.from.includes(t)).slice(0, race.toolChoice.count);
    if (wanted.length > race.toolChoice.count) err(ctx, `${race.zh}只能选 ${race.toolChoice.count} 种工具熟练`);
    for (const t of wanted) if (!race.toolChoice.from.includes(t)) err(ctx, `${race.zh}的工具熟练只能从 ${race.toolChoice.from.join(' / ')} 里选，给的是 "${t}"`);
    while (pick.length < race.toolChoice.count) {
      pick.push(race.toolChoice.from[0]);
      warn(ctx, `${race.zh}没选工具熟练（raceOptions.tools），自动选了 ${race.toolChoice.from[0]}`);
    }
    ctx.tools.push(...pick);
  }
  // 背景
  ctx.tools.push(...ctx.background.tools);
  // 专长
  for (const f of ctx.feats) {
    f.def.armor?.forEach((a) => ctx.armorProf.add(a));
    if (f.def.weapons) {
      const picks = f.choice?.weapons ?? [];
      const valid: string[] = [];
      for (const w of picks) {
        if (!WEAPONS[w]) err(ctx, `${f.def.name}：未知武器 id "${w}"`);
        else valid.push(w);
      }
      if (picks.length > f.def.weapons) err(ctx, `${f.def.name}只能选 ${f.def.weapons} 件武器，给了 ${picks.length} 件`);
      // 没选满：从还不熟练的军用武器里按表顺序补
      for (const w of Object.values(WEAPONS)) {
        if (valid.length >= f.def.weapons) break;
        if (w.category !== 'martial' || valid.includes(w.id) || weaponProficient(ctx, w.id)) continue;
        valid.push(w.id);
        warn(ctx, `${f.def.name}没选满 ${f.def.weapons} 件武器（featChoice.weapons），自动加了 ${w.id}`);
      }
      valid.slice(0, f.def.weapons).forEach((w) => ctx.weaponIds.add(w));
    }
  }
  ctx.tools = [...new Set(ctx.tools)];

  // 语言
  const langs = [...race.languages];
  for (const c of ctx.classes) {
    if (c.def.id === 'druid' && c.index === 0) langs.push('Druidic');
  }
  const free = (race.bonusLanguages ?? 0) + ctx.background.languages;
  const chosen = ctx.build.raceOptions?.languages ?? [];
  for (const l of chosen.slice(0, free)) langs.push(l);
  if (chosen.length > free) warn(ctx, `自选语言只有 ${free} 门，多给的 ${chosen.length - free} 门没有记录`);
  const missing = free - Math.min(free, chosen.length);
  if (missing > 0) langs.push(`（另有 ${missing} 门自选语言未指定）`);
  ctx.languages = [...new Set(langs)];
}

export function weaponProficient(ctx: Ctx, weaponId: string): boolean {
  const w = WEAPONS[weaponId];
  if (!w) return false;
  return ctx.weaponCategories.has(w.category) || ctx.weaponIds.has(weaponId);
}

// ---------------------------------------------------------------- 技能
type Slot = { label: string; count: number; from: Skill[] | 'any'; pref: Skill[] };

function pickFromPool(pool: Skill[], from: Skill[] | 'any', held: Set<Skill>): Skill | undefined {
  const i = pool.findIndex((s) => !held.has(s) && (from === 'any' || from.includes(s)));
  if (i < 0) return undefined;
  return pool.splice(i, 1)[0];
}

/** 自动选一个：避开已有熟练和调用方明确点名要的技能（claimed），偏好顺序见各职业的 SKILL_PREF。 */
function autoPick(from: Skill[] | 'any', pref: Skill[], held: Set<Skill>, claimed: Set<Skill>): Skill | undefined {
  const list = from === 'any' ? [...pref, ...ANY_PREF] : [...pref.filter((s) => from.includes(s)), ...from];
  return list.find((s) => !held.has(s) && !claimed.has(s));
}

export function resolveSkills(ctx: Ctx): void {
  const held = ctx.skills;
  const first = ctx.classes[0];
  // 调用方明确点名的技能（起始职业、种族、技能池、技能娴熟）：自动补位 / 换技能时避开它们
  const claimed = new Set<Skill>();
  for (const list of [ctx.build.skills, ctx.build.raceOptions?.skills, ctx.build.bonusSkills, ...ctx.feats.map((f) => f.choice?.skills)]) {
    for (const x of Array.isArray(list) ? list : []) if (isSkill(x)) claimed.add(x);
  }

  // 1. 固定给的：背景、种族、子职业
  const fixed: { src: string; skill: Skill }[] = [];
  for (const s of ctx.background.skills) if (isSkill(s)) fixed.push({ src: `背景${ctx.background.zh}`, skill: s });
  for (const s of ctx.race.skills ?? []) fixed.push({ src: ctx.race.zh, skill: s });
  for (const c of ctx.classes) {
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    for (const s of fx?.skills ?? []) fixed.push({ src: sub!.zh ?? sub!.name, skill: s });
  }
  let owedReplacements = 0;
  for (const { src, skill } of fixed) {
    if (held.has(skill)) {
      owedReplacements += 1;
      warn(ctx, `${src}给的 ${fmtSkill(skill)} 和别处重复了，按规则可以换一门技能（用 bonusSkills 指定，没给就自动选）`);
    } else held.add(skill);
  }

  // 2. 起始职业的选择
  const cls = first.def.skillChoices;
  const given = ctx.build.skills ?? [];
  const classPicks: Skill[] = [];
  const seen = new Set<Skill>();
  for (const s of given) {
    if (!isSkill(s)) {
      err(ctx, `skills：未知技能 "${String(s)}"`);
      continue;
    }
    if (seen.has(s)) {
      err(ctx, `skills：${fmtSkill(s)}选了两次`);
      continue;
    }
    seen.add(s);
    if (!cls.from.includes(s)) {
      err(ctx, `${first.def.zh}的技能只能从 ${cls.from.map(fmtSkill).join('、')} 里选，${fmtSkill(s)}不行`);
      continue;
    }
    classPicks.push(s);
  }
  if (given.length > cls.count) err(ctx, `${first.def.zh}只能选 ${cls.count} 项技能，给了 ${given.length} 项`);
  const pref = SKILL_PREF[first.def.id];
  const accepted = classPicks.slice(0, cls.count);
  const finalClass: Skill[] = [];
  for (const s of accepted) {
    if (held.has(s)) {
      const alt = autoPick(cls.from, pref, held, claimed);
      if (alt) {
        warn(ctx, `${fmtSkill(s)}和背景 / 种族给的技能重复了，按规则换成了 ${fmtSkill(alt)}`);
        finalClass.push(alt);
        held.add(alt);
      }
    } else {
      finalClass.push(s);
      held.add(s);
    }
  }
  const autoAdded: Skill[] = [];
  while (finalClass.length < cls.count) {
    const alt = autoPick(cls.from, pref, held, claimed);
    if (!alt) break;
    finalClass.push(alt);
    held.add(alt);
    autoAdded.push(alt);
  }
  if (autoAdded.length) warn(ctx, `${first.def.zh}的技能要选 ${cls.count} 项，只给了 ${accepted.length} 项，自动补了 ${autoAdded.map(fmtSkill).join('、')}`);

  // 3. 种族自选
  if (ctx.race.skillChoice) {
    const want = ctx.race.skillChoice.count;
    const picks = ctx.build.raceOptions?.skills ?? [];
    if (picks.length > want) err(ctx, `${ctx.race.zh}只能自选 ${want} 项技能（raceOptions.skills），给了 ${picks.length} 项`);
    let n = 0;
    for (const s of picks.slice(0, want)) {
      if (!isSkill(s)) {
        err(ctx, `raceOptions.skills：未知技能 "${String(s)}"`);
        continue;
      }
      if (held.has(s)) {
        const alt = autoPick('any', ANY_PREF, held, claimed);
        if (alt) {
          warn(ctx, `${ctx.race.zh}自选的 ${fmtSkill(s)} 和已有熟练重复，按规则换成了 ${fmtSkill(alt)}`);
          held.add(alt);
        }
      } else held.add(s);
      n += 1;
    }
    while (n < want) {
      const alt = autoPick('any', ANY_PREF, held, claimed);
      if (!alt) break;
      held.add(alt);
      n += 1;
      warn(ctx, `${ctx.race.zh}的自选技能没给齐（raceOptions.skills），自动选了 ${fmtSkill(alt)}`);
    }
  }

  // 4. 技能池：补位 → 兼职 → 子职业 → 专长（技能娴熟单独验证）
  const pool: Skill[] = [];
  for (const s of ctx.build.bonusSkills ?? []) {
    if (!isSkill(s)) err(ctx, `bonusSkills：未知技能 "${String(s)}"`);
    else if (pool.includes(s)) err(ctx, `bonusSkills：${fmtSkill(s)}重复了`);
    else pool.push(s);
  }
  const slots: Slot[] = [];
  for (let i = 0; i < owedReplacements; i++) slots.push({ label: '重复补位', count: 1, from: 'any', pref: ANY_PREF });
  for (const c of ctx.classes) {
    if (c.index === 0) continue;
    const g = c.def.multiclassGrant.skills;
    if (g) slots.push({ label: `兼职${c.def.zh}`, count: g.count, from: g.from, pref: SKILL_PREF[c.def.id] });
  }
  for (const c of ctx.classes) {
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    if (fx?.skillPick) slots.push({ label: sub!.zh ?? sub!.name, count: fx.skillPick.count, from: fx.skillPick.from, pref: SKILL_PREF[c.def.id] });
  }
  for (const slot of slots) {
    for (let i = 0; i < slot.count; i++) {
      const fromPool = pickFromPool(pool, slot.from, held);
      const s = fromPool ?? autoPick(slot.from, slot.pref, held, claimed);
      if (!s) continue;
      held.add(s);
      if (!fromPool) warn(ctx, `${slot.label}的自选技能没指定（bonusSkills），自动选了 ${fmtSkill(s)}`);
    }
  }
  if (pool.length > 0) err(ctx, `bonusSkills 里多出来的技能用不上（没有对应的自选名额）：${pool.map(fmtSkill).join('、')}`);

  // 技能娴熟（Skilled）：3 个技能
  for (const f of ctx.feats) {
    if (!f.def.skills) continue;
    const picks = f.choice?.skills ?? [];
    if (picks.length > f.def.skills) err(ctx, `${f.def.name}只能选 ${f.def.skills} 个技能，给了 ${picks.length} 个`);
    let n = 0;
    for (const s of picks.slice(0, f.def.skills)) {
      if (!isSkill(s)) {
        err(ctx, `${f.def.name}：未知技能 "${String(s)}"`);
        continue;
      }
      if (held.has(s)) {
        const alt = autoPick('any', ANY_PREF, held, claimed);
        if (alt) {
          warn(ctx, `${f.def.name}选的 ${fmtSkill(s)} 已经有熟练，换成了 ${fmtSkill(alt)}`);
          held.add(alt);
        }
      } else held.add(s);
      n += 1;
    }
    while (n < f.def.skills) {
      const alt = autoPick('any', ANY_PREF, held, claimed);
      if (!alt) break;
      held.add(alt);
      n += 1;
      warn(ctx, `${f.def.name}的技能没选满（featChoice.skills），自动选了 ${fmtSkill(alt)}`);
    }
  }
}

// ---------------------------------------------------------------- 专精
export function resolveExpertise(ctx: Ctx): void {
  // 每个职业按它自己的等级算名额；顺序 = 职业顺序
  const slotsByClass: { classId: string; count: number }[] = [];
  for (const c of ctx.classes) {
    const lv = EXPERTISE_LEVELS[c.def.id];
    if (!lv) continue;
    const count = lv.filter((l) => l <= c.level).length * 2;
    if (count > 0) slotsByClass.push({ classId: c.def.id, count });
  }
  const total = slotsByClass.reduce((s, x) => s + x.count, 0);
  const given = ctx.build.expertise ?? [];
  const picks: (Skill | 'thieves_tools')[] = [];
  const seen = new Set<string>();
  for (const e of given) {
    if (e !== 'thieves_tools' && !isSkill(e)) {
      err(ctx, `expertise：未知技能 "${String(e)}"`);
      continue;
    }
    if (seen.has(e)) {
      err(ctx, `expertise：${e === 'thieves_tools' ? '盗贼工具' : fmtSkill(e as Skill)}选了两次`);
      continue;
    }
    seen.add(e);
    if (e === 'thieves_tools') {
      if (!ctx.classes.some((c) => c.def.id === 'rogue')) {
        err(ctx, '专精「盗贼工具」只有盗贼能选');
        continue;
      }
      if (!ctx.tools.some((t) => /thieves/i.test(t))) {
        err(ctx, '专精盗贼工具需要先有盗贼工具熟练');
        continue;
      }
    } else if (!ctx.skills.has(e)) {
      err(ctx, `专精只能给已经熟练的技能，${fmtSkill(e)}不是熟练技能`);
      continue;
    }
    picks.push(e);
  }
  if (total === 0) {
    if (given.length > 0) err(ctx, '这个构建没有专精名额（盗贼 1 级起、诗人 3 级起），但给了 expertise');
    return;
  }
  if (given.length > total) err(ctx, `专精名额只有 ${total} 个，给了 ${given.length} 个`);
  const finalPicks = picks.slice(0, total);
  const prefs: Skill[] = [];
  for (const s of slotsByClass) prefs.push(...(EXPERTISE_PREF[s.classId] ?? []));
  const chosenSkills = new Set(finalPicks.filter((x): x is Skill => x !== 'thieves_tools'));
  while (finalPicks.length < total) {
    const alt = [...prefs, ...ANY_PREF].find((s) => ctx.skills.has(s) && !chosenSkills.has(s));
    if (!alt) break;
    chosenSkills.add(alt);
    finalPicks.push(alt);
    warn(ctx, `专精名额 ${total} 个，只给了 ${picks.length} 个，自动补了 ${fmtSkill(alt)}`);
  }
  ctx.expertise = finalPicks.filter((x): x is Skill => x !== 'thieves_tools');
  if (finalPicks.includes('thieves_tools')) ctx.notes.push("专精：盗贼工具（工具检定熟练加值翻倍）");
}
