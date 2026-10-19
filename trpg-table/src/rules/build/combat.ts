// 装备、AC、速度、攻击列表、额外攻击、偷袭骰、生命值、抗性与免疫。
import { WEAPONS } from '../data/weapons.js';
import type { AttackDef, ConditionName, DamageType } from '../types.js';
import { activeSubclass, classLevel, err, hasFeat, mod, warn, type Ctx, type ResolvedEquipment, type ResolvedWeapon } from './ctx.js';
import { ARMOR_DEFS, DEX_KITS, STARTER_KITS } from './data/equipment.js';
import { DRACONIC_ANCESTRY } from './data/races.js';
import { CLASS_IMMUNITIES, SUBCLASS_EFFECTS } from './data/subclass-effects.js';
import type { ArmorDef, StarterKit } from './data/equipment.js';
import { weaponProficient } from './proficiency.js';
import type { WeaponPick } from './types.js';

const signed = (n: number): string => (n >= 0 ? `+${n}` : `${n}`);

// ---------------------------------------------------------------- 装备
function starterKitFor(ctx: Ctx): StarterKit {
  const first = ctx.classes[0];
  let kit = STARTER_KITS[first.def.id];
  const dexKit = DEX_KITS[first.def.id];
  if (dexKit && ctx.abilities.dex > ctx.abilities.str) kit = dexKit;
  // 牧师「链甲（如果熟练）」：有重甲熟练就拿链甲
  if (first.def.id === 'cleric' && ctx.armorProf.has('heavy')) kit = { ...kit, armor: 'chain_mail' };
  return kit;
}

export function resolveEquipment(ctx: Ctx): void {
  const eq = ctx.build.equipment ?? {};
  const kit = starterKitFor(ctx);

  // 武器
  const rawWeapons: (string | WeaponPick)[] = eq.weapons ?? kit.weapons;
  const weapons: ResolvedWeapon[] = [];
  const seenW = new Set<string>();
  for (const w of rawWeapons) {
    const pick: WeaponPick = typeof w === 'string' ? { id: w } : w;
    if (!pick || typeof pick.id !== 'string') {
      err(ctx, 'equipment.weapons 里有不是 id 字符串或 { id } 的项');
      continue;
    }
    if (!WEAPONS[pick.id]) {
      warn(ctx, `武器 id "${pick.id}" 不在 WEAPONS 表里（src/rules/data/weapons.ts），已丢掉`);
      continue;
    }
    if (seenW.has(pick.id)) {
      warn(ctx, `武器 ${pick.id} 重复了，只留一把`);
      continue;
    }
    seenW.add(pick.id);
    if (pick.magicBonus !== undefined && (!Number.isInteger(pick.magicBonus) || pick.magicBonus < 0 || pick.magicBonus > 3)) {
      err(ctx, `武器 ${pick.id} 的 magicBonus 必须是 0–3 的整数`);
      continue;
    }
    weapons.push({ id: pick.id, ...(pick.name ? { name: pick.name } : {}), ...(pick.magicBonus ? { magicBonus: pick.magicBonus } : {}), ...(pick.twoHanded ? { twoHanded: true } : {}) });
  }

  // 护甲
  let armor: ArmorDef | undefined;
  const armorId = eq.armor === undefined ? kit.armor : eq.armor;
  if (armorId) {
    const def = ARMOR_DEFS[armorId];
    if (!def) err(ctx, `未知护甲 id "${armorId}"（可用：${Object.keys(ARMOR_DEFS).filter((k) => k !== 'shield').join(' ')}）`);
    else if (def.category === 'shield') err(ctx, '盾牌请用 equipment.shield: true，不要写在 armor 里');
    else armor = def;
  }

  // 盾：没写就按职业起始装备，但手里全是双手武器时不默认持盾
  const allTwoHanded = weapons.length > 0 && weapons.every((w) => WEAPONS[w.id].properties.includes('two-handed'));
  const shield = eq.shield === undefined ? kit.shield && !allTwoHanded : eq.shield;
  if (eq.shield === true && allTwoHanded) warn(ctx, '持盾，但手里的武器全是双手武器（得先放下盾牌才能用）');

  for (const [k, v] of [['armorBonus', eq.armorBonus], ['shieldBonus', eq.shieldBonus], ['acBonus', eq.acBonus]] as const) {
    if (v !== undefined && (!Number.isInteger(v) || v < 0 || v > 10)) err(ctx, `equipment.${k} 必须是 0–10 的整数`);
  }

  const equip: ResolvedEquipment = {
    armor,
    armorBonus: armor ? eq.armorBonus ?? 0 : 0,
    shield,
    shieldBonus: shield ? eq.shieldBonus ?? 0 : 0,
    weapons,
    acBonus: eq.acBonus ?? 0,
  };
  ctx.equip = equip;
  armorWarnings(ctx, equip);
}

function armorWarnings(ctx: Ctx, equip: ResolvedEquipment): void {
  const a = equip.armor;
  if (a && !ctx.armorProf.has(a.category)) {
    warn(ctx, `穿着不熟练的${a.zh}（${a.category}）：力量 / 敏捷的检定、攻击和豁免都有劣势，而且不能施法（引擎另算劣势）`);
  }
  if (equip.shield && !ctx.armorProf.has('shield')) {
    warn(ctx, '持有不熟练的盾牌：力量 / 敏捷的检定、攻击和豁免都有劣势，而且不能施法（引擎另算劣势）');
  }
  if (a?.strReq && ctx.abilities.str < a.strReq) {
    warn(
      ctx,
      ctx.race.baseRace === 'dwarf'
        ? `${a.zh}要求力量 ${a.strReq}，现在 ${ctx.abilities.str}：矮人的速度不受重甲影响，不扣`
        : `${a.zh}要求力量 ${a.strReq}，现在 ${ctx.abilities.str}：按规则步行速度 -10 尺（已扣）`
    );
  }
  if (a?.stealthDisadvantage) ctx.notes.push(`${a.zh}：隐匿检定有劣势。`);
  if (a && ctx.classes.some((c) => c.def.id === 'monk')) warn(ctx, '武僧穿甲或持盾会失去无甲防御、武艺和无甲移动');
  if (ctx.classes.some((c) => c.def.id === 'druid') && ((a && a.metal) || equip.shield)) {
    if (a?.metal) warn(ctx, `德鲁伊不穿金属护甲，${a.zh}是金属的（规则上穿了会失去施法）`);
  }
  if (a?.category === 'heavy' && ctx.classes.some((c) => c.def.id === 'barbarian')) warn(ctx, '野蛮人穿重甲不能狂暴，也失去快速移动');
}

// ---------------------------------------------------------------- AC
export function computeAc(ctx: Ctx): { value: number; formula: string } {
  const eq = ctx.equip!;
  const dex = mod(ctx, 'dex');
  const parts: string[] = [];
  let total: number;
  const a = eq.armor;
  if (a) {
    if (a.category === 'light') {
      total = a.baseAc + dex;
      parts.push(`${a.zh} ${a.baseAc}`, `敏捷 ${signed(dex)}`);
    } else if (a.category === 'medium') {
      const cap = hasFeat(ctx, 'medium_armor_master') && ctx.abilities.dex >= 16 ? 3 : (a.dexCap ?? 2);
      const d = Math.min(dex, cap);
      total = a.baseAc + d;
      parts.push(`${a.zh} ${a.baseAc}`, `敏捷 ${signed(d)}${d < dex ? `（上限 ${cap}）` : ''}`);
    } else {
      total = a.baseAc;
      parts.push(`${a.zh} ${a.baseAc}`);
    }
    if (eq.armorBonus) {
      total += eq.armorBonus;
      parts.push(`魔法护甲 +${eq.armorBonus}`);
    }
  } else {
    // 无甲：取最好的那种
    let best = 10 + dex;
    let label = `基础 10，敏捷 ${signed(dex)}`;
    const barb = classLevel(ctx, 'barbarian') > 0;
    const monk = classLevel(ctx, 'monk') > 0;
    if (barb) {
      const v = 10 + dex + mod(ctx, 'con');
      if (v > best) {
        best = v;
        label = `无甲防御（野蛮人）10，敏捷 ${signed(dex)}，体质 ${signed(mod(ctx, 'con'))}`;
      }
    }
    if (monk && !eq.shield) {
      const v = 10 + dex + mod(ctx, 'wis');
      if (v > best) {
        best = v;
        label = `无甲防御（武僧）10，敏捷 ${signed(dex)}，感知 ${signed(mod(ctx, 'wis'))}`;
      }
    }
    for (const c of ctx.classes) {
      const sub = activeSubclass(c);
      const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
      if (fx?.unarmoredBase) {
        const v = fx.unarmoredBase + dex;
        if (v > best) {
          best = v;
          label = `${sub!.zh ?? sub!.name} ${fx.unarmoredBase}，敏捷 ${signed(dex)}`;
        }
      }
    }
    total = best;
    parts.push(label);
  }
  if (eq.shield) {
    const s = 2 + eq.shieldBonus;
    total += s;
    parts.push(`盾牌 +${s}`);
  }
  if (a && ctx.fightingStyles.includes('defense')) {
    total += 1;
    parts.push('防御战斗风格 +1');
  }
  if (eq.acBonus) {
    total += eq.acBonus;
    parts.push(`其它 +${eq.acBonus}`);
  }
  return { value: total, formula: `${parts.join('，')} = ${total}` };
}

// ---------------------------------------------------------------- 速度
/**
 * 力量不够穿这件护甲（链甲 13、锁子甲 15、板甲 15…）：步行速度 -10 尺（游泳等其它速度不动）。
 * 矮人的速度不受重甲影响，不扣。
 */
function strengthShortfall(ctx: Ctx): boolean {
  const a = ctx.equip?.armor;
  return !!a?.strReq && ctx.abilities.str < a.strReq && ctx.race.baseRace !== 'dwarf';
}

export function computeSpeed(ctx: Ctx): number {
  let speed = ctx.race.speed;
  const eq = ctx.equip!;
  const barb = classLevel(ctx, 'barbarian');
  if (barb >= 5 && eq.armor?.category !== 'heavy') speed += 10;
  const monk = classLevel(ctx, 'monk');
  if (monk >= 2 && !eq.armor && !eq.shield) {
    speed += monk >= 18 ? 30 : monk >= 14 ? 25 : monk >= 10 ? 20 : monk >= 6 ? 15 : 10;
  }
  for (const f of ctx.feats) if (f.def.speed) speed += f.def.speed;
  if (strengthShortfall(ctx)) speed = Math.max(0, speed - 10);
  return speed;
}

// ---------------------------------------------------------------- 攻击
export function buildAttacks(ctx: Ctx): AttackDef[] {
  const attacks: AttackDef[] = [];
  for (const w of ctx.equip!.weapons) {
    const prof = weaponProficient(ctx, w.id);
    if (!prof) warn(ctx, `不熟练${WEAPONS[w.id].name}：攻击不加熟练加值（proficient: false）`);
    attacks.push({
      weaponId: w.id,
      ...(w.name ? { name: w.name } : {}),
      ...(w.magicBonus ? { magicBonus: w.magicBonus } : {}),
      ...(w.twoHanded ? { twoHanded: true } : {}),
      ...(prof ? {} : { proficient: false }),
    });
  }
  // 武僧另有徒手打击：用 WEAPONS 里的 unarmed，武艺骰、敏捷 / 力量取高由引擎的特性层（martial_arts）算
  if (classLevel(ctx, 'monk') > 0) attacks.push({ weaponId: 'unarmed', name: '徒手打击' });
  // 种族天生武器（Tabaxi 的猫爪）
  for (const n of ctx.race.naturalAttacks ?? []) attacks.push({ weaponId: n.weaponId, name: n.name });
  return attacks;
}

export function attacksPerAction(ctx: Ctx): number {
  let n = 1;
  for (const c of ctx.classes) {
    if (c.def.id === 'fighter') n = Math.max(n, c.level >= 20 ? 4 : c.level >= 11 ? 3 : c.level >= 5 ? 2 : 1);
    else if (['barbarian', 'monk', 'paladin', 'ranger'].includes(c.def.id) && c.level >= 5) n = Math.max(n, 2);
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    if (fx?.extraAttackLevel && c.level >= fx.extraAttackLevel) n = Math.max(n, 2);
  }
  return n;
}

export const sneakAttackDice = (ctx: Ctx): number => Math.ceil(classLevel(ctx, 'rogue') / 2);

// ---------------------------------------------------------------- 生命
export function computeHp(ctx: Ctx): { max: number; method: 'average' | 'max' | 'rolled'; perLevelBonus: number } {
  const method = ctx.build.hp?.method ?? 'average';
  if (!['average', 'max', 'rolled'].includes(method)) err(ctx, `hp.method 必须是 average / max / rolled，给的是 "${String(method)}"`);
  const con = mod(ctx, 'con');
  let perLevelBonus = ctx.race.hpPerLevel ?? 0;
  for (const f of ctx.feats) perLevelBonus += f.def.hpPerLevel ?? 0;

  const rolls = ctx.build.hp?.rolls ?? [];
  if (method !== 'rolled' && rolls.length > 0) warn(ctx, `hp.method 是 ${method}，hp.rolls 被忽略`);
  if (method === 'rolled') {
    if (rolls.length > ctx.totalLevel - 1) err(ctx, `hp.rolls 给了 ${rolls.length} 个骰点，但 1 级以后只有 ${ctx.totalLevel - 1} 级`);
    else if (rolls.length < ctx.totalLevel - 1) warn(ctx, `hp.rolls 只有 ${rolls.length} 个骰点，不够 ${ctx.totalLevel - 1} 级，缺的按平均值算`);
  }

  const first = ctx.classes[0].def.hitDie;
  let max = Math.max(1, first + con + perLevelBonus);
  let rollIdx = 0;
  ctx.classes.forEach((c, ci) => {
    const levels = c.level - (ci === 0 ? 1 : 0);
    for (let i = 0; i < levels; i++) {
      const die = c.def.hitDie;
      let face = Math.floor(die / 2) + 1;
      if (method === 'max') face = die;
      else if (method === 'rolled') {
        const r = rolls[rollIdx];
        if (r !== undefined) {
          if (!Number.isInteger(r) || r < 1 || r > die) err(ctx, `hp.rolls[${rollIdx}] = ${r}：${c.def.zh}的生命骰是 d${die}，骰点必须是 1–${die} 的整数`);
          else face = r;
        }
        rollIdx += 1;
      }
      max += Math.max(1, face + con + perLevelBonus);
    }
  });
  // 龙族韧性：每个术士等级 +1
  for (const c of ctx.classes) {
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    if (fx?.hpPerClassLevel) max += fx.hpPerClassLevel * c.level;
  }
  return { max, method: method as 'average' | 'max' | 'rolled', perLevelBonus };
}

// ---------------------------------------------------------------- 抗性 / 免疫
export function computeDefenses(ctx: Ctx): {
  resistances: DamageType[];
  immunities: DamageType[];
  conditionImmunities: ConditionName[];
} {
  const res = new Set<DamageType>(ctx.race.resistances ?? []);
  if (ctx.race.dragonAncestry && ctx.dragonAncestry) res.add(DRACONIC_ANCESTRY[ctx.dragonAncestry].damage as DamageType);
  const imm = new Set<DamageType>();
  const cond = new Set<ConditionName>(ctx.race.conditionImmunities ?? []);
  for (const c of ctx.classes) {
    const own = CLASS_IMMUNITIES[c.def.id];
    for (const x of own?.conditionImmunities ?? []) if (c.level >= x.level) cond.add(x.condition);
    for (const x of own?.damageImmunities ?? []) if (c.level >= x.level) imm.add(x.type);
    const sub = activeSubclass(c);
    const fx = sub ? SUBCLASS_EFFECTS[`${c.def.id}/${sub.id}`] : undefined;
    for (const x of fx?.conditionImmunities ?? []) if (c.level >= x.level) cond.add(x.condition);
    for (const x of fx?.damageImmunities ?? []) if (c.level >= x.level) imm.add(x.type);
  }
  return { resistances: [...res], immunities: [...imm], conditionImmunities: [...cond] };
}
