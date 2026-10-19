// 角色构建器：给一份 CharacterBuild（种族 / 背景 / 职业与等级 / 属性 / 选择），按 2014 规则（SRD 5.1）算出完整的
// CharacterFile（能直接交给 actorFromCharacter），并报告 errors（不能用）和 warnings（能用但要注意）。
// 字段说明、默认值规则、示例见 README.md；数据出处见 NOTICE.md。
import { ABILITIES, ABILITY_ZH, SKILLS, proficiency, type Ability } from '../types.js';
import type { CharacterFile } from '../sheet.js';
import { resolveAbilities } from './abilities.js';
import { attacksPerAction, buildAttacks, computeAc, computeDefenses, computeHp, computeSpeed, resolveEquipment, sneakAttackDice } from './combat.js';
import { activeSubclass, err, warn, type Ctx, type ResolvedClass } from './ctx.js';
import { assembleFeatures, resolveChoices, resolveLineage } from './features.js';
import { BACKGROUNDS, defaultSubclass, findBackground, findClass, findRace, findSubclass, subclassesOf, toolZh } from './lookup.js';
import { resolveExpertise, resolveProficiencies, resolveSkills } from './proficiency.js';
import { computeResources } from './resources.js';
import { findCasters, resolveSpells } from './spells.js';
import type { BuildInfo, BuildResult, CharacterBuild } from './types.js';
import { WEAPONS } from '../data/weapons.js';

export type {
  AsiChoice,
  BuildFeature,
  BuildInfo,
  BuildResult,
  CharacterBuild,
  ClassBuild,
  ClassOptions,
  ClassSpellChoice,
  ClassSpellInfo,
  EquipmentBuild,
  FeatChoice,
  HpMethod,
  RaceOptions,
  WeaponPick,
} from './types.js';
export { FEATURE_CATALOG, featureInfo, type CatalogEntry } from './catalog.js';
export { CLASS_DEFS } from './data/classes.js';
export { BACKGROUNDS, RACES, SUBCLASSES, FEATS, findSubclass, findRace, findBackground, findClass, spellId } from './lookup.js';

const ARMOR_ZH = { light: '轻甲', medium: '中甲', heavy: '重甲', shield: '盾牌' } as const;

// ---------------------------------------------------------------- 输入检查与解析
function prepare(build: CharacterBuild, errors: string[], warnings: string[]): Ctx | undefined {
  const bad = (m: string): void => {
    if (!errors.includes(m)) errors.push(m);
  };
  if (!build || typeof build !== 'object') {
    bad('构建规格必须是对象');
    return undefined;
  }
  if (typeof build.name !== 'string' || !build.name.trim()) bad('name 不能为空');

  // 属性
  const scores = build.abilityScores;
  if (!scores || typeof scores !== 'object') bad('abilityScores 必须给齐六项属性（str dex con int wis cha）');
  else {
    for (const a of ABILITIES) {
      const v = scores[a];
      if (typeof v !== 'number' || !Number.isInteger(v)) bad(`属性 ${ABILITY_ZH[a]}（${a}）必须是整数，现在是 ${String(v)}`);
      else if (v < 1 || v > 20) bad(`属性 ${ABILITY_ZH[a]}（${a}）= ${v}：基础属性必须在 1–20 之间`);
    }
  }

  for (const key of ['skills', 'bonusSkills', 'expertise', 'fightingStyles'] as const) {
    if (build[key] !== undefined && !Array.isArray(build[key])) bad(`${key} 必须是数组`);
  }
  if (build.equipment?.weapons !== undefined && !Array.isArray(build.equipment.weapons)) bad('equipment.weapons 必须是数组');
  if (build.hp?.rolls !== undefined && !Array.isArray(build.hp.rolls)) bad('hp.rolls 必须是数组');
  for (const key of ['asi', 'spells', 'spellsByClass', 'options', 'equipment', 'raceOptions', 'hp'] as const) {
    const v = build[key];
    if (v !== undefined && (v === null || typeof v !== 'object' || Array.isArray(v))) bad(`${key} 必须是对象`);
  }

  const race = typeof build.race === 'string' ? findRace(build.race) : undefined;
  if (!race) bad(`未知种族 "${String(build.race)}"`);
  const background = typeof build.background === 'string' ? findBackground(build.background) : undefined;
  if (!background) bad(`未知背景 "${String(build.background)}"（可用：${Object.keys(BACKGROUNDS).join(' ')}）`);

  // 职业
  const classes: ResolvedClass[] = [];
  if (!Array.isArray(build.classes) || build.classes.length === 0) bad('classes 至少要有一个职业（第一个是起始职业）');
  else {
    let total = 0;
    build.classes.forEach((cb, index) => {
      const def = typeof cb?.id === 'string' ? findClass(cb.id) : undefined;
      if (!def) {
        bad(`未知职业 "${String(cb?.id)}"（可用：barbarian bard cleric druid fighter monk paladin ranger rogue sorcerer warlock wizard）`);
        return;
      }
      if (typeof cb.level !== 'number' || !Number.isInteger(cb.level) || cb.level < 1 || cb.level > 20) {
        bad(`${def.zh}的等级必须是 1–20 的整数，现在是 ${String(cb.level)}`);
        return;
      }
      if (classes.some((c) => c.def.id === def.id)) {
        bad(`${def.zh}在 classes 里出现了两次，同一个职业只写一条（等级合并）`);
        return;
      }
      total += cb.level;
      classes.push({ def, level: cb.level, index });
    });
    if (total > 20) bad(`总等级 ${total} 超过 20（所有职业的等级加起来不能超过 20）`);
    // 子职业
    for (const c of classes) {
      const given = build.classes[c.index].subclass;
      if (given !== undefined && given !== null && String(given).trim() !== '') {
        const sub = findSubclass(c.def.id, String(given));
        if (!sub) {
          const names = subclassesOf(c.def.id).map((s) => s.id).join(' ');
          bad(`${c.def.zh}没有叫 "${String(given)}" 的子职业（可用：${names}）`);
        } else if (c.level < c.def.subclassLevel) {
          warnings.push(`${c.def.zh} ${c.level} 级还没到选子职业的等级（${c.def.subclassLevel} 级），${sub.name} 先不生效`);
          c.subclass = sub;
        } else c.subclass = sub;
      } else if (c.level >= c.def.subclassLevel) {
        const sub = defaultSubclass(c.def.id);
        if (sub) {
          c.subclass = sub;
          warnings.push(`${c.def.zh} ${c.level} 级没选子职业，自动选了 SRD 里的 ${sub.name}（${sub.id}）`);
        }
      }
    }
  }
  if (errors.length > 0 || !race || !background || classes.length === 0) return undefined;

  return {
    build,
    errors,
    warnings,
    race,
    background,
    classes,
    totalLevel: classes.reduce((s, c) => s + c.level, 0),
    pb: proficiency(classes.reduce((s, c) => s + c.level, 0)),
    abilities: { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 },
    feats: [],
    asiLog: [],
    features: [],
    featureIds: new Set(),
    saves: new Set(),
    skills: new Set(),
    expertise: [],
    armorProf: new Set(),
    weaponCategories: new Set(),
    weaponIds: new Set(),
    tools: [],
    languages: [],
    fightingStyles: [],
    options: [],
    notes: [],
    arcanum: {},
  };
}

/** 输入有硬伤时给一张占位卡（不能用，只是让调用方拿到一个有形状的 file）。 */
function placeholderResult(build: CharacterBuild, errors: string[], warnings: string[]): BuildResult {
  const abilities = Object.fromEntries(ABILITIES.map((a) => [a, Math.max(1, Math.min(20, Math.trunc(Number(build?.abilityScores?.[a])) || 10))])) as Record<Ability, number>;
  const level = Math.max(1, Math.min(20, (Array.isArray(build?.classes) ? build.classes : []).reduce((s, c) => s + (Number.isInteger(c?.level) ? c.level : 0), 0) || 1));
  const file: CharacterFile = {
    ...(build?.seat ? { seat: build.seat } : {}),
    name: typeof build?.name === 'string' && build.name.trim() ? build.name.trim() : '（未命名）',
    class: '（构建失败）',
    level,
    abilities,
    ac: 10,
    maxHp: 1,
    speed: 30,
    attacks: [],
    features: [],
  };
  return {
    file,
    errors,
    warnings,
    features: [],
    info: {
      totalLevel: level,
      proficiencyBonus: proficiency(level),
      abilities,
      hp: { max: 1, method: 'average', perLevelBonus: 0 },
      ac: { value: 10, formula: '构建失败' },
      speed: 30,
      armorProficiencies: [],
      weaponProficiencies: [],
      toolProficiencies: [],
      languages: [],
      asi: [],
    },
  };
}

// ---------------------------------------------------------------- 兼职 / 专长的前置检查
function checkMulticlass(ctx: Ctx): void {
  if (ctx.classes.length < 2) return;
  for (const c of ctx.classes) {
    const ok = c.def.multiclassPrereq.some((alt) => alt.every((a) => ctx.abilities[a] >= 13));
    if (!ok) {
      const need = c.def.multiclassPrereq.map((alt) => alt.map((a) => `${ABILITY_ZH[a]} 13`).join(' 且 ')).join(' 或 ');
      err(ctx, `兼职要求：${c.def.zh}需要 ${need}（SRD 最低 13；兼职要同时满足新旧两个职业的要求），现在不满足`);
    }
  }
}

function checkFeatPrereqs(ctx: Ctx): void {
  const casting = findCasters(ctx).length > 0;
  for (const f of ctx.feats) {
    const pre = f.def.prereq;
    if (!pre) continue;
    let ok = true;
    if (pre.abilities) ok = pre.abilities.some((alt) => alt.every((x) => ctx.abilities[x.ability] >= x.min));
    if (ok && pre.armor) ok = ctx.armorProf.has(pre.armor);
    if (ok && pre.caster) ok = casting;
    if (ok && pre.race) ok = pre.race.includes(ctx.race.id) || (!!ctx.race.baseRace && pre.race.includes(ctx.race.baseRace)) || (pre.race.includes('half_elf') && ctx.race.id === 'half_elf');
    if (!ok) err(ctx, `专长 ${f.def.name} 的前置条件不满足：${pre.text}`);
  }
}

// ---------------------------------------------------------------- 显示用字符串
function classLabel(ctx: Ctx): string {
  return ctx.classes
    .map((c) => {
      const sub = activeSubclass(c);
      return `${c.def.zh}${sub ? `（${sub.zh ?? sub.name}）` : ''} ${c.level}`;
    })
    .join(' / ');
}

function weaponProfText(ctx: Ctx): string[] {
  const out: string[] = [];
  if (ctx.weaponCategories.has('simple')) out.push('简易武器');
  if (ctx.weaponCategories.has('martial')) out.push('军用武器');
  for (const id of ctx.weaponIds) {
    const w = WEAPONS[id];
    if (!w) continue;
    if (ctx.weaponCategories.has(w.category)) continue;
    out.push(w.name.replace(/（.*$/, ''));
  }
  return out;
}

// ---------------------------------------------------------------- 入口
export function buildCharacter(build: CharacterBuild): BuildResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    return buildInner(build, errors, warnings);
  } catch (e) {
    // 输入的类型不对时的兜底：不抛，当成 error 报出来
    errors.push(`构建器内部错误：${(e as Error).message}（多半是 build 里某个字段的类型不对）`);
    return placeholderResult(build, errors, warnings);
  }
}

function buildInner(build: CharacterBuild, errors: string[], warnings: string[]): BuildResult {
  const ctx = prepare(build, errors, warnings);
  if (!ctx) return placeholderResult(build, errors, warnings);

  resolveAbilities(ctx);
  checkMulticlass(ctx);
  resolveProficiencies(ctx);
  checkFeatPrereqs(ctx);
  resolveSkills(ctx);
  resolveExpertise(ctx);
  resolveEquipment(ctx);
  resolveLineage(ctx);
  const spells = resolveSpells(ctx);
  resolveChoices(ctx, spells);

  const hp = computeHp(ctx);
  const ac = computeAc(ctx);
  const speed = computeSpeed(ctx);
  const attacks = buildAttacks(ctx);
  const perAction = attacksPerAction(ctx);
  const defenses = computeDefenses(ctx);
  const resources = computeResources(ctx);
  assembleFeatures(ctx);

  const first = ctx.classes[0];
  if (ctx.classes.length > 1) {
    const dice = ctx.classes.map((c) => `d${c.def.hitDie}×${c.level}`).join(' + ');
    warn(ctx, `兼职：生命骰是 ${dice}，引擎的 hitDice 只有一种骰面，用了起始职业的 d${first.def.hitDie}（总数 ${ctx.totalLevel}）`);
  }

  // 备注
  const notes: string[] = [];
  notes.push(`种族：${ctx.race.zh}；背景：${ctx.background.zh}。`);
  const armorList = [...ctx.armorProf].map((a) => ARMOR_ZH[a]);
  notes.push(`护甲熟练：${armorList.length ? armorList.join('、') : '无'}；武器熟练：${weaponProfText(ctx).join('、') || '无'}。`);
  if (ctx.tools.length) notes.push(`工具熟练：${ctx.tools.map(toolZh).join('；')}。`);
  if (ctx.languages.length) notes.push(`语言：${ctx.languages.join('、')}。`);
  if (ctx.race.dragonAncestry && ctx.dragonAncestry) {
    const conMod = Math.floor((ctx.abilities.con - 10) / 2);
    notes.push(`龙息：${ctx.totalLevel >= 16 ? '5d6' : ctx.totalLevel >= 11 ? '4d6' : ctx.totalLevel >= 6 ? '3d6' : '2d6'}，豁免 DC ${8 + conMod + ctx.pb}（体质调整值 + 熟练加值 + 8），伤害类型和形状见龙族先祖。`);
  }
  if (spells) {
    const mod = Math.floor((ctx.abilities[spells.ability] - 10) / 2);
    notes.push(`施法属性：${ABILITY_ZH[spells.ability]}；法术豁免 DC ${8 + ctx.pb + mod}；法术攻击 ${mod + ctx.pb >= 0 ? '+' : ''}${mod + ctx.pb}。`);
    for (const [cid, book] of Object.entries(spells.spellbooks)) notes.push(book.length <= 20 ? `法术书（${cid}）：${book.join('、')}。` : `法术书（${cid}）共 ${book.length} 个法术（只有准备好的在可施放列表里）。`);
    if (spells.racialSpells.length) notes.push(`种族天生法术（每长休一次）：${spells.racialSpells.join('、')}。`);
  }
  if (Object.keys(ctx.arcanum).length) notes.push(`神秘秘法：${Object.entries(ctx.arcanum).map(([l, id]) => `${l} 环 ${id}`).join('、')}（每长休一次，不占法术位）。`);
  if (ctx.landCircle) notes.push(`大地结社地貌：${ctx.landCircle}。`);
  notes.push(...ctx.notes);
  if (build.notes) notes.push(build.notes);

  const file: CharacterFile = {
    ...(build.seat ? { seat: build.seat } : {}),
    name: build.name.trim(),
    class: classLabel(ctx),
    level: ctx.totalLevel,
    abilities: { ...ctx.abilities },
    proficiencyBonus: ctx.pb,
    saves: ABILITIES.filter((a) => ctx.saves.has(a)),
    skills: SKILLS.filter((s) => ctx.skills.has(s)),
    expertise: SKILLS.filter((s) => ctx.expertise.includes(s)),
    ac: ac.value,
    maxHp: hp.max,
    speed,
    ...(ctx.race.swimSpeed ? { swimSpeed: ctx.race.swimSpeed } : {}),
    attacks,
    ...(spells
      ? {
          spells: {
            ability: spells.ability,
            known: spells.known,
            slots: Object.fromEntries(Object.entries(spells.slots).map(([k, v]) => [k, { max: v.max, used: 0 }])),
            ...(spells.pact ? { pact: true } : {}),
            ...(spells.pactSlots ? { pactSlots: spells.pactSlots } : {}),
          },
        }
      : {}),
    resources,
    hitDice: { die: first.def.hitDie, total: ctx.totalLevel },
    sneakAttackDice: sneakAttackDice(ctx),
    resistances: defenses.resistances,
    ...(defenses.immunities.length ? { immunities: defenses.immunities } : {}),
    features: ctx.features.map((f) => f.id),
    ...(build.persona ? { persona: build.persona } : {}),
    notes: notes.join('\n'),
    race: ctx.race.id,
    background: ctx.background.id,
    classes: ctx.classes.map((c) => ({ id: c.def.id, level: c.level, ...(activeSubclass(c) ? { subclass: activeSubclass(c)!.id } : {}) })),
    attacksPerAction: perAction,
    ...(defenses.conditionImmunities.length ? { conditionImmunities: defenses.conditionImmunities } : {}),
    size: ctx.race.size,
    ...(ctx.equip?.armor?.metal ? { metalArmor: true } : {}),
  };

  const info: BuildInfo = {
    totalLevel: ctx.totalLevel,
    proficiencyBonus: ctx.pb,
    abilities: { ...ctx.abilities },
    hp: { max: hp.max, method: hp.method, perLevelBonus: hp.perLevelBonus },
    ac,
    speed,
    armorProficiencies: armorList,
    weaponProficiencies: weaponProfText(ctx),
    toolProficiencies: ctx.tools.map(toolZh),
    languages: ctx.languages,
    asi: ctx.asiLog,
    ...(spells
      ? {
          spellcasting: {
            ability: spells.ability,
            byClass: spells.byClass,
            droppedSpells: spells.droppedSpells,
            racialSpells: spells.racialSpells,
          },
        }
      : {}),
  };

  return { file, errors: ctx.errors, warnings: ctx.warnings, features: ctx.features, info };
}
