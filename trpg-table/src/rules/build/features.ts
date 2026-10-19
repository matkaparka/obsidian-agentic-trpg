// 职业特性里需要选择的部分（战斗风格、祈唤 / 战技 / 超魔 / 契约恩赐等选项、龙祖先、地貌、神秘秘法），
// 以及把所有已获得的特性拼成最终的特性列表。
import { featureId } from '../contract.js';
import { WEAPONS } from '../data/weapons.js';
import { activeSubclass, classLevel, err, warn, type Ctx } from './ctx.js';
import { FIGHTING_STYLES } from './data/equipment.js';
import { PLACEHOLDER_FEATURES } from './data/classes.js';
import { DRACONIC_ANCESTRY } from './data/races.js';
import type { OptionDef, OptionKind } from './data/schema.js';
import { SPELL_CLASS_LIST } from './data/spell-lists.gen.js';
import { DEFAULT_SPELLS } from './data/spell-tables.js';
import { LAND_CIRCLE_SPELLS } from './data/srd-subclasses.js';
import { findOption, normId, optionsOfKind } from './lookup.js';
import type { SpellResult } from './spells.js';
import type { ClassOptions } from './types.js';

// ---------------------------------------------------------------- 战斗风格
interface StyleSlot {
  classId: string;
  label: string;
  allowed: string[];
}

function styleSlots(ctx: Ctx): StyleSlot[] {
  const out: StyleSlot[] = [];
  const allowedFor = (classId: string): string[] => Object.entries(FIGHTING_STYLES).filter(([, s]) => (s.classes as string[]).includes(classId)).map(([id]) => id);
  for (const c of ctx.classes) {
    const id = c.def.id;
    if (id === 'fighter' && c.level >= 1) out.push({ classId: id, label: '战士的战斗风格', allowed: allowedFor(id) });
    if (id === 'fighter' && activeSubclass(c)?.id === 'champion' && c.level >= 10) out.push({ classId: id, label: '冠军的额外战斗风格', allowed: allowedFor(id) });
    if ((id === 'paladin' || id === 'ranger') && c.level >= 2) out.push({ classId: id, label: `${c.def.zh}的战斗风格`, allowed: allowedFor(id) });
  }
  return out;
}

function primaryWeapon(ctx: Ctx) {
  const ws = ctx.equip!.weapons.map((w) => WEAPONS[w.id]);
  const ranged = ws.find((w) => w.kind === 'ranged');
  if (ranged && ctx.abilities.dex >= ctx.abilities.str) return ranged;
  return ws[0];
}

function autoStyle(ctx: Ctx, allowed: string[], taken: string[]): string {
  const main = primaryWeapon(ctx);
  const shield = ctx.equip!.shield;
  let order: string[];
  if (!main) order = ['defense', 'dueling', 'protection'];
  else if (main.kind === 'ranged') order = ['archery', 'defense'];
  else if (main.properties.includes('two-handed') && !shield) order = ['great_weapon_fighting', 'defense'];
  else if (shield) order = ['dueling', 'defense', 'protection'];
  else order = ['dueling', 'defense', 'two_weapon_fighting'];
  order.push('defense', ...allowed);
  return order.find((s) => allowed.includes(s) && !taken.includes(s)) ?? allowed.find((s) => !taken.includes(s)) ?? allowed[0];
}

function resolveFightingStyles(ctx: Ctx): void {
  const slots = styleSlots(ctx);
  const given = (ctx.build.fightingStyles ?? []).map((s) => normId(String(s)));
  if (given.length > slots.length) err(ctx, `战斗风格只有 ${slots.length} 个名额，给了 ${given.length} 个`);
  const taken: string[] = [];
  slots.forEach((slot, i) => {
    let pick = given[i];
    if (pick !== undefined) {
      const def = FIGHTING_STYLES[pick];
      if (!def) {
        err(ctx, `未知战斗风格 "${pick}"（可用：${Object.keys(FIGHTING_STYLES).join(' ')}）`);
        pick = undefined as unknown as string;
      } else if (!slot.allowed.includes(pick)) {
        err(ctx, `${slot.label}不能选${def.zh}（${slot.allowed.map((a) => FIGHTING_STYLES[a].zh).join('、')}）`);
        pick = undefined as unknown as string;
      } else if (taken.includes(pick)) {
        err(ctx, `战斗风格${def.zh}不能重复选`);
        pick = undefined as unknown as string;
      }
    }
    if (pick === undefined) {
      pick = autoStyle(ctx, slot.allowed, taken);
      warn(ctx, `${slot.label}没指定（fightingStyles），自动选了${FIGHTING_STYLES[pick].zh}（${pick}）`);
    }
    taken.push(pick);
  });
  ctx.fightingStyles = taken;
}

// ---------------------------------------------------------------- 选项（祈唤 / 战技 / 超魔 / ……）
interface OptionGroup {
  kind: OptionKind;
  classId: string;
  /** 需要的子职业 id */
  sub?: string;
  /** [职业等级, 选项数]，从高到低 */
  steps: [number, number][];
  minLevel: number;
  given: (o: ClassOptions) => string[] | undefined;
  prefer: string[];
  label: string;
}

const GROUPS: OptionGroup[] = [
  // 契约恩赐先于祈唤处理：有的祈唤要求特定的契约恩赐
  { kind: 'pact_boon', classId: 'warlock', steps: [[3, 1]], minLevel: 3, given: (o) => (o.pactBoon ? [o.pactBoon] : undefined), prefer: ['pact_of_the_blade', 'pact_of_the_chain', 'pact_of_the_tome', 'pact_of_the_talisman'], label: '契约恩赐' },
  {
    kind: 'invocation',
    classId: 'warlock',
    steps: [[18, 8], [15, 7], [12, 6], [9, 5], [7, 4], [5, 3], [2, 2]],
    minLevel: 2,
    given: (o) => o.invocations,
    prefer: ['agonizing_blast', 'repelling_blast', 'eldritch_spear', 'devils_sight', 'armor_of_shadows', 'fiendish_vigor', 'mask_of_many_faces', 'misty_visions', 'beguiling_influence', 'eldritch_sight', 'thirsting_blade', 'lifedrinker', 'beast_speech', 'eyes_of_the_rune_keeper', 'gaze_of_two_minds', 'thief_of_five_fates', 'eldritch_mind', 'improved_pact_weapon'],
    label: '魔能祈唤',
  },
  {
    kind: 'maneuver',
    classId: 'fighter',
    sub: 'battle_master',
    steps: [[15, 9], [10, 7], [7, 5], [3, 3]],
    minLevel: 3,
    given: (o) => o.maneuvers,
    prefer: ['precision_attack', 'riposte', 'trip_attack', 'parry', 'menacing_attack', 'disarming_attack', 'distracting_strike', 'feinting_attack', 'goading_attack', 'maneuvering_attack', 'pushing_attack', 'rally', 'commanders_strike', 'evasive_footwork', 'lunging_attack', 'sweeping_attack', 'tactical_assessment'],
    label: '战技',
  },
  {
    kind: 'metamagic',
    classId: 'sorcerer',
    steps: [[17, 4], [10, 3], [3, 2]],
    minLevel: 3,
    given: (o) => o.metamagic,
    prefer: ['quickened_spell', 'twinned_spell', 'subtle_spell', 'careful_spell', 'empowered_spell', 'extended_spell', 'distant_spell', 'heightened_spell', 'seeking_spell', 'transmuted_spell'],
    label: '超魔',
  },
  {
    kind: 'discipline',
    classId: 'monk',
    sub: 'four_elements',
    steps: [[17, 5], [11, 4], [6, 3], [3, 2]],
    minLevel: 3,
    given: (o) => o.disciplines,
    prefer: ['elemental_attunement', 'fist_of_unbroken_air', 'fangs_of_the_fire_snake', 'water_whip', 'shape_the_flowing_river', 'rush_of_the_gale_spirits', 'sweeping_cinder_strike', 'fist_of_four_thunders'],
    label: '元素修行',
  },
  { kind: 'hunters_prey', classId: 'ranger', sub: 'hunter', steps: [[3, 1]], minLevel: 3, given: (o) => (o.hunter?.prey ? [o.hunter.prey] : undefined), prefer: ['colossus_slayer', 'horde_breaker', 'giant_killer'], label: '猎人的猎物' },
  { kind: 'defensive_tactics', classId: 'ranger', sub: 'hunter', steps: [[7, 1]], minLevel: 7, given: (o) => (o.hunter?.defensiveTactics ? [o.hunter.defensiveTactics] : undefined), prefer: ['steel_will', 'multiattack_defense', 'escape_the_horde'], label: '防御战术' },
  { kind: 'hunter_multiattack', classId: 'ranger', sub: 'hunter', steps: [[11, 1]], minLevel: 11, given: (o) => (o.hunter?.multiattack ? [o.hunter.multiattack] : undefined), prefer: ['volley', 'whirlwind_attack'], label: '猎人的多重攻击' },
  { kind: 'superior_hunters_defense', classId: 'ranger', sub: 'hunter', steps: [[15, 1]], minLevel: 15, given: (o) => (o.hunter?.superiorDefense ? [o.hunter.superiorDefense] : undefined), prefer: ['evasion', 'uncanny_dodge', 'stand_against_the_tide'], label: '卓越猎人防御' },
];

/** 选项的前置条件（ODM 的 req 文字）：认得的检查，认不得的当作满足。 */
function reqMet(ctx: Ctx, opt: OptionDef, classId: string, cantrips: string[], picked: { kind: string; id: string }[]): string | null {
  if (!opt.req) return null;
  for (const part of opt.req.split(',').map((p) => p.trim())) {
    let m = /^level (\d+)$/.exec(part);
    if (m) {
      if (classLevel(ctx, classId) < Number(m[1])) return `需要${classId === 'warlock' ? '邪术师' : '该职业'}等级 ${m[1]}`;
      continue;
    }
    m = /^Pact of the (\w+)$/.exec(part);
    if (m) {
      if (!picked.some((p) => p.kind === 'pact_boon' && p.id === `pact_of_the_${m![1].toLowerCase()}`)) return `需要契约恩赐：${part}`;
      continue;
    }
    if (part === 'Eldritch Blast cantrip') {
      if (!cantrips.includes('eldritch_blast')) return '需要会魔能爆（eldritch_blast）戏法';
      continue;
    }
  }
  return null;
}

function resolveOptions(ctx: Ctx, spells: SpellResult | undefined): void {
  const o = ctx.build.options ?? {};
  const warlockCantrips = spells?.byClass.warlock?.cantrips ?? [];
  const picked: { kind: string; id: string }[] = [];
  for (const g of GROUPS) {
    const c = ctx.classes.find((x) => x.def.id === g.classId);
    if (!c) {
      if (g.given(o) && g.given(o)!.length > 0) {
        // 没有这个职业却给了选项
        if (!ctx.classes.some((x) => x.def.id === g.classId)) err(ctx, `options 里有${g.label}，但这个角色没有${g.classId}职业`);
      }
      continue;
    }
    if (g.sub && activeSubclass(c)?.id !== g.sub) {
      if ((g.given(o)?.length ?? 0) > 0) err(ctx, `${g.label}只有${g.sub}才有`);
      continue;
    }
    const step = g.steps.find(([lv]) => c.level >= lv);
    const count = step ? step[1] : 0;
    const given = (g.given(o) ?? []).map((x) => normId(String(x)));
    if (count === 0) {
      if (given.length > 0) err(ctx, `${g.label}要到 ${g.minLevel} 级才有，现在不能选`);
      continue;
    }
    const chosen: string[] = [];
    for (const id of given) {
      const opt = findOption(g.kind, id);
      if (!opt) {
        err(ctx, `未知的${g.label} "${id}"`);
        continue;
      }
      if (chosen.includes(id)) {
        err(ctx, `${g.label} ${opt.name} 重复了`);
        continue;
      }
      const miss = reqMet(ctx, opt, g.classId, warlockCantrips, picked);
      if (miss) {
        err(ctx, `${g.label} ${opt.name}：${miss}`);
        continue;
      }
      chosen.push(id);
    }
    if (given.length > count) err(ctx, `${g.label}现在最多 ${count} 个，给了 ${given.length} 个`);
    chosen.length = Math.min(chosen.length, count);
    // 补满
    const added: string[] = [];
    const order = [...g.prefer, ...optionsOfKind(g.kind).map((x) => x.id)];
    // 契约恩赐要先定下来，祈唤的前置才查得到：同一批里先放已选
    const pool = [...new Set(order)];
    for (const id of pool) {
      if (chosen.length >= count) break;
      const opt = findOption(g.kind, id);
      if (!opt || chosen.includes(id)) continue;
      if (reqMet(ctx, opt, g.classId, warlockCantrips, [...picked, ...chosen.map((x) => ({ kind: g.kind, id: x }))])) continue;
      chosen.push(id);
      added.push(id);
    }
    if (added.length) warn(ctx, `${g.label}没选满（${count} 个），自动补了 ${added.join('、')}`);
    for (const id of chosen) picked.push({ kind: g.kind, id });
  }
  ctx.options = picked;
  if (picked.some((p) => p.id === 'pact_of_the_tome')) warn(ctx, '契约之书的 3 个额外戏法（任意职业表）和仪式法术没有实现，不在可施放列表里');

}

/** 龙祖先、地貌、神秘秘法：要在选法术之前定下来（地貌决定白送的法术）。 */
export function resolveLineage(ctx: Ctx): void {
  const o = ctx.build.options ?? {};
  // 龙祖先（龙裔 / 龙族血脉术士）
  if (ctx.race.dragonAncestry) {
    let d = ctx.build.raceOptions?.dragonAncestry ? normId(ctx.build.raceOptions.dragonAncestry) : undefined;
    if (d && !DRACONIC_ANCESTRY[d]) {
      err(ctx, `未知龙祖先 "${d}"（可用：${Object.keys(DRACONIC_ANCESTRY).join(' ')}）`);
      d = undefined;
    }
    if (!d) {
      d = 'red';
      if (!ctx.build.raceOptions?.dragonAncestry) warn(ctx, '龙裔没选龙祖先（raceOptions.dragonAncestry），自动选了红龙（red）');
    }
    ctx.dragonAncestry = d;
  }
  const draconic = ctx.classes.find((c) => c.def.id === 'sorcerer' && activeSubclass(c)?.id === 'draconic_bloodline');
  if (draconic) {
    let d = o.dragonAncestor ? normId(o.dragonAncestor) : undefined;
    if (d && !DRACONIC_ANCESTRY[d]) {
      err(ctx, `未知龙族先祖 "${d}"`);
      d = undefined;
    }
    if (!d) {
      d = ctx.dragonAncestry ?? 'red';
      if (!o.dragonAncestor) warn(ctx, `龙族血脉术士没选龙族先祖（options.dragonAncestor），自动选了 ${d}`);
    }
    ctx.sorcererAncestor = d;
  }
  // 地貌
  const land = ctx.classes.find((c) => c.def.id === 'druid' && activeSubclass(c)?.id === 'land');
  if (land) {
    let t = o.landCircle ? normId(o.landCircle) : undefined;
    if (t && !LAND_CIRCLE_SPELLS[t]) {
      err(ctx, `未知地貌 "${t}"（可用：${Object.keys(LAND_CIRCLE_SPELLS).join(' ')}）`);
      t = undefined;
    }
    if (!t) {
      t = 'forest';
      if (!o.landCircle) warn(ctx, '大地结社没选地貌（options.landCircle），自动选了森林（forest）');
    }
    ctx.landCircle = t;
  } else if (o.landCircle) err(ctx, 'options.landCircle 只有大地结社德鲁伊能用');

  // 神秘秘法
  const wl = ctx.classes.find((c) => c.def.id === 'warlock');
  const given = o.mysticArcanum ?? {};
  if (wl) {
    for (const [lvl, need] of [[6, 11], [7, 13], [8, 15], [9, 17]] as const) {
      const key = lvl as 6 | 7 | 8 | 9;
      if (wl.level < need) {
        if (given[key]) err(ctx, `神秘秘法 ${lvl} 环要邪术师 ${need} 级才有`);
        continue;
      }
      let id = given[key] ? normId(given[key]!) : undefined;
      if (id) {
        const row = SPELL_CLASS_LIST[id];
        if (!row) {
          warn(ctx, `神秘秘法 ${lvl} 环的法术 "${id}" 不认识，已换成默认`);
          id = undefined;
        } else if (row[0] !== lvl || !row[1].split(',').includes('warlock')) {
          err(ctx, `神秘秘法 ${lvl} 环的法术 ${id} 必须是邪术师表上的 ${lvl} 环法术`);
          id = undefined;
        }
      }
      if (!id) {
        id = (DEFAULT_SPELLS.warlock?.levels[lvl] ?? [])[0];
        if (!given[key]) warn(ctx, `神秘秘法 ${lvl} 环没选法术（options.mysticArcanum），自动选了 ${id}`);
      }
      if (id) ctx.arcanum[lvl] = id;
    }
  } else if (Object.keys(given).length > 0) err(ctx, 'options.mysticArcanum 只有邪术师能用');
  if (o.dragonAncestor && !draconic) err(ctx, 'options.dragonAncestor 只有龙族血脉术士能用');
}

export function resolveChoices(ctx: Ctx, spells: SpellResult | undefined): void {
  resolveFightingStyles(ctx);
  resolveOptions(ctx, spells);
}

// ---------------------------------------------------------------- 特性列表
const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

function add(ctx: Ctx, name: string, zh: string | undefined, text: string, source: string, level: number): void {
  const id = featureId(name);
  if (!id || ctx.featureIds.has(id)) return;
  ctx.featureIds.add(id);
  ctx.features.push({ id, name, ...(zh ? { zh } : {}), source, level, text });
}

/** 被具体选择替换掉的子职业占位特性（猎人的四个选项）。 */
const REPLACED_SUBCLASS_FEATURES = new Set(["Hunter's Prey", 'Defensive Tactics', 'Multiattack', "Superior Hunter's Defense"]);

export function assembleFeatures(ctx: Ctx): void {
  // 种族
  for (const t of ctx.race.traits) {
    if (t.name === 'Draconic Ancestry' && ctx.dragonAncestry) {
      const a = DRACONIC_ANCESTRY[ctx.dragonAncestry];
      add(ctx, `Draconic Ancestry: ${cap1(ctx.dragonAncestry)}`, `龙族先祖：${a.zh}`, `${cap1(ctx.dragonAncestry)} dragon: breath weapon deals ${a.damage} damage in a ${a.shape} (${a.save.toUpperCase()} save), and you resist ${a.damage}.`, `race:${ctx.race.id}`, 1);
    } else add(ctx, t.name, t.zh, t.text, `race:${ctx.race.id}`, 1);
  }
  // 背景
  add(ctx, ctx.background.feature, undefined, ctx.background.featureText, `background:${ctx.background.id}`, 1);

  // 职业与子职业
  for (const c of ctx.classes) {
    for (let lv = 1; lv <= c.level; lv++) {
      for (const f of c.def.features[lv] ?? []) {
        if (PLACEHOLDER_FEATURES.has(f.name)) continue;
        add(ctx, f.name, f.zh, f.text, `class:${c.def.id}`, lv);
      }
    }
    const sub = activeSubclass(c);
    if (sub) {
      for (let lv = 1; lv <= c.level; lv++) {
        for (const f of sub.features[lv] ?? []) {
          if (REPLACED_SUBCLASS_FEATURES.has(f.name) && sub.id === 'hunter') continue;
          if (f.name === 'Dragon Ancestor' && ctx.sorcererAncestor) {
            add(ctx, `Dragon Ancestor: ${cap1(ctx.sorcererAncestor)}`, `龙族先祖：${DRACONIC_ANCESTRY[ctx.sorcererAncestor].zh}`, f.text, `subclass:${sub.id}`, lv);
            continue;
          }
          add(ctx, f.name, f.zh, f.text, `subclass:${sub.id}`, lv);
        }
      }
    }
  }

  // 战斗风格
  for (const s of ctx.fightingStyles) {
    const def = FIGHTING_STYLES[s];
    add(ctx, `Fighting Style: ${def.name}`, `战斗风格：${def.zh}`, def.text, 'fighting_style', 1);
  }
  // 选项
  const minLevel = new Map(GROUPS.map((g) => [g.kind, g.minLevel] as const));
  for (const p of ctx.options) {
    const opt = findOption(p.kind as OptionKind, p.id);
    if (!opt) continue;
    add(ctx, opt.name, undefined, opt.text, `option:${p.kind}`, minLevel.get(p.kind as OptionKind) ?? 1);
  }
  // 专长
  for (const f of ctx.feats) add(ctx, f.def.name, f.def.zh, f.def.text, 'feat', f.level);
}
