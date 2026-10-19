import { describe, expect, it } from 'vitest';
import { SPELLS, type SpellDef } from '../src/rules/data/spells.js';
import { SRD_SPELLS } from '../src/rules/data/spellsSrd.js';
import { mulberry32, rollFormula } from '../src/rules/dice.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { actorFromCharacter } from '../src/rules/sheet.js';
import { ABILITIES, CONDITION_NAMES, DAMAGE_TYPES } from '../src/rules/types.js';
import { ScriptedRollSource } from './helpers.js';

const CLASSES = ['cleric', 'wizard', 'druid', 'bard', 'sorcerer', 'warlock', 'paladin', 'ranger'];
const SCHOOLS = ['塑能', '防护', '咒法', '预言', '附魔', '幻术', '死灵', '变化'];
/** 引擎的 durationRounds 认得的时长 */
const DURATIONS = ['立即', '1 轮', '1 分钟', '10 分钟', '1 小时'];
const RANGE_FORMAT = /^(触碰|自身(（[^）]+）)?|\d+ 尺|视距内)$/;

/** 手写的 27 个核心法术（spells.ts 里的 CORE_SPELLS），SRD 文件里不该再出现 */
const CORE_IDS = [
  'fire_bolt', 'ray_of_frost', 'sacred_flame', 'toll_the_dead', 'guidance', 'mage_hand', 'minor_illusion', 'light',
  'bless', 'shield', 'shield_of_faith', 'magic_missile', 'burning_hands', 'cure_wounds', 'healing_word', 'guiding_bolt',
  'faerie_fire', 'sleep', 'spiritual_weapon', 'hold_person', 'web', 'misty_step', 'scorching_ray', 'invisibility',
  'mirror_image', 'lesser_restoration', 'silence',
];

/** 复制自 engine.ts 的 spellRangeFeet（私有函数）：触碰 5，自身 0，其余取字符串里的数字，读不出来 = 不限 */
function spellRangeFeet(spell: SpellDef): number | null {
  if (spell.range.includes('触碰')) return 5;
  if (spell.range.startsWith('自身')) return 0;
  const m = /(\d+)\s*尺/.exec(spell.range);
  return m ? Number(m[1]) : null;
}

/** 复制自 engine.ts 的 addDice 所认的升环骰格式 */
const ADDABLE = /^\d*d\d+([+-]\d+)?$/;

const ids = Object.keys(SPELLS);
const all = Object.values(SPELLS);

function formulasOf(def: SpellDef): [string, string][] {
  const out: [string, string][] = [];
  const e = def.effect;
  switch (e.kind) {
    case 'attack':
    case 'auto':
      out.push(['effect.damage', e.damage]);
      break;
    case 'save':
      if (e.damage) out.push(['effect.damage', e.damage]);
      break;
    case 'heal':
      out.push(['effect.dice', e.dice]);
      break;
    case 'buff':
      if (e.attackDice) out.push(['effect.attackDice', e.attackDice]);
      if (e.saveDice) out.push(['effect.saveDice', e.saveDice]);
      if (e.checkDice) out.push(['effect.checkDice', e.checkDice]);
      break;
    case 'sleep':
      out.push(['effect.pool', e.pool]);
      break;
  }
  if (def.upcast?.damage) out.push(['upcast.damage', def.upcast.damage]);
  if (def.upcast?.heal) out.push(['upcast.heal', def.upcast.heal]);
  if (def.upcast?.pool) out.push(['upcast.pool', def.upcast.pool]);
  return out;
}

const classesOf = (id: string): string[] => [...SPELLS[id].classes].sort();

describe('SRD 法术表：规模与结构', () => {
  it('SRD 5.1 的 319 个法术都在（手写的亡者丧钟不属于 SRD），按环阶数量对得上', () => {
    const byLevel: Record<number, number> = {};
    for (const def of all) if (def.id !== 'toll_the_dead') byLevel[def.level] = (byLevel[def.level] ?? 0) + 1;
    expect(byLevel).toEqual({ 0: 24, 1: 49, 2: 54, 3: 42, 4: 31, 5: 37, 6: 31, 7: 20, 8: 16, 9: 15 });
    expect(ids.length).toBe(320);
  });

  it('SRD 文件与手写核心表不重叠，核心表恰好是那 27 个', () => {
    const core = ids.filter((id) => !(id in SRD_SPELLS));
    expect(core.sort()).toEqual([...CORE_IDS].sort());
    expect(Object.keys(SRD_SPELLS).length).toBe(293);
    for (const id of CORE_IDS) expect(SRD_SPELLS[id], `${id} 不该出现在 SRD 文件里`).toBeUndefined();
  });

  it('每个法术的必填字段齐全、取值合法', () => {
    const problems: string[] = [];
    const names = new Map<string, string>();
    for (const [key, def] of Object.entries(SPELLS)) {
      const p = (msg: string) => problems.push(`${key}: ${msg}`);
      if (def.id !== key) p(`id「${def.id}」与 key 不一致`);
      if (!/^[a-z][a-z0-9_]*$/.test(def.id)) p('id 不是 snake_case 英文');
      if (!def.name || !/[一-鿿]/.test(def.name)) p(`名字不对：${def.name}`);
      if (names.has(def.name)) p(`名字「${def.name}」和 ${names.get(def.name)} 重了（gm.ts 按名字找法术）`);
      names.set(def.name, key);
      if (!Number.isInteger(def.level) || def.level < 0 || def.level > 9) p(`环阶不合法：${def.level}`);
      if (!SCHOOLS.includes(def.school)) p(`学派不合法：${def.school}`);
      if (!['action', 'bonus', 'reaction'].includes(def.castingTime)) p(`施法时间不合法：${def.castingTime}`);
      if (!RANGE_FORMAT.test(def.range)) p(`射程格式引擎读不出来：${def.range}`);
      if (!/^[VSM](, [VSM])*$/.test(def.components)) p(`成分格式不对：${def.components}`);
      if (!DURATIONS.includes(def.duration)) p(`时长不在引擎认得的集合里：${def.duration}`);
      if (typeof def.concentration !== 'boolean') p('concentration 不是布尔');
      if (!def.classes.length) p('classes 为空');
      if (new Set(def.classes).size !== def.classes.length) p('classes 有重复');
      for (const c of def.classes) if (!CLASSES.includes(c)) p(`职业不合法：${c}`);
      if (def.needs && (!def.needs.length || new Set(def.needs).size !== def.needs.length)) p('needs 为空或有重复');
      if (def.level === 0 && def.concentration && def.duration === '立即') p('专注法术不该是立即');
      if (def.concentration && def.duration === '立即') p('专注法术的时长不该是立即');
    }
    expect(problems).toEqual([]);
  });

  it('射程字符串能被引擎的 spellRangeFeet 读对', () => {
    const problems: string[] = [];
    for (const def of all) {
      const feet = spellRangeFeet(def);
      if (def.range === '触碰' && feet !== 5) problems.push(`${def.id}: 触碰应为 5`);
      if (def.range.startsWith('自身') && feet !== 0) problems.push(`${def.id}: 自身应为 0`);
      if (/^\d+ 尺$/.test(def.range) && feet !== Number(def.range.split(' ')[0])) problems.push(`${def.id}: 读成 ${feet}`);
      if (def.range === '视距内' && feet !== null) problems.push(`${def.id}: 视距内应为不限`);
    }
    expect(problems).toEqual([]);
  });

  it('伤害 / 治疗 / 升环骰子公式都能被 dice.ts 解析，升环骰引擎认得', () => {
    const problems: string[] = [];
    const rng = mulberry32(7);
    for (const def of all) {
      for (const [label, f] of formulasOf(def)) {
        try {
          const r = rollFormula(f, rng);
          if (!Number.isFinite(r.total)) problems.push(`${def.id}.${label} 结果不是数：${f}`);
        } catch (err) {
          problems.push(`${def.id}.${label} 解析失败：${f}（${(err as Error).message}）`);
        }
        // 升环骰要走 engine 的 addDice，它只认 NdM(+K)；heal 的固定值升环是已知缺口（见 needs: upcast_flat）
        if ((label === 'upcast.damage' || label === 'upcast.pool') && !ADDABLE.test(f)) problems.push(`${def.id}.${label} 引擎的 addDice 读不了：${f}`);
        if (label === 'upcast.heal' && !ADDABLE.test(f) && !def.needs?.includes('upcast_flat')) problems.push(`${def.id}.${label} 固定值升环没标 upcast_flat：${f}`);
      }
      if (def.upcast?.attacks !== undefined && (!Number.isInteger(def.upcast.attacks) || def.upcast.attacks < 1)) problems.push(`${def.id}.upcast.attacks 不合法`);
      if (def.upcast?.targets !== undefined && (!Number.isInteger(def.upcast.targets) || def.upcast.targets < 1)) problems.push(`${def.id}.upcast.targets 不合法`);
      if (def.upcast && def.level === 0) problems.push(`${def.id}: 戏法不该有 upcast`);
    }
    expect(problems).toEqual([]);
  });

  it('各 kind 的必填数据：attack / save / auto / heal / buff / utility', () => {
    const problems: string[] = [];
    for (const def of all) {
      const e = def.effect;
      const p = (msg: string) => problems.push(`${def.id}: ${msg}`);
      switch (e.kind) {
        case 'attack':
          if (!Number.isInteger(e.attacks) || e.attacks < 1) p('attacks 不合法');
          if (!DAMAGE_TYPES.includes(e.damageType)) p(`伤害类型不合法：${e.damageType}`);
          if (!def.needsTarget) p('attack 法术要 needsTarget');
          break;
        case 'auto':
          if (!DAMAGE_TYPES.includes(e.damageType)) p(`伤害类型不合法：${e.damageType}`);
          if (!def.needsTarget) p('auto 法术要 needsTarget');
          break;
        case 'heal':
          if (!def.needsTarget) p('heal 法术要 needsTarget');
          break;
        case 'save':
          if (!ABILITIES.includes(e.ability)) p(`豁免属性不合法：${e.ability}`);
          if (e.damage && (!e.damageType || !DAMAGE_TYPES.includes(e.damageType))) p('有伤害却没有合法的伤害类型');
          if (e.halfOnSave && !e.damage) p('halfOnSave 但没有伤害');
          if (e.condition && !CONDITION_NAMES.includes(e.condition)) p(`状态不合法：${e.condition}`);
          if (e.conditionRounds !== undefined && (!Number.isInteger(e.conditionRounds) || e.conditionRounds < 1)) p('conditionRounds 不合法');
          if (e.conditionRounds !== undefined && !e.condition) p('有 conditionRounds 却没有 condition');
          if (e.repeatSave && !e.condition) p('repeatSave 要有 condition');
          if (!e.damage && !e.condition && !e.failEffect) p('save 法术既没伤害、状态也没有标记效果');
          if (!def.needsTarget && !def.aoe) p('单体 save 法术要 needsTarget');
          if (def.maxTargets !== undefined && def.maxTargets < 1) p('maxTargets 不合法');
          break;
        case 'buff':
          if (!e.note) p('buff 没有 note');
          if (e.condition && !CONDITION_NAMES.includes(e.condition)) p(`状态不合法：${e.condition}`);
          break;
        case 'utility':
          if (!e.note || e.note.length < 8) p('utility 的 note 太短');
          break;
        case 'sleep':
          break;
      }
      if (def.cantripScaling && def.level !== 0) p('只有戏法能 cantripScaling');
      if (def.level === 0 && ['attack', 'save', 'auto'].includes(e.kind) && (e as { damage?: string }).damage && !def.cantripScaling) p('伤害戏法没设 cantripScaling');
    }
    expect(problems).toEqual([]);
  });

  it('每个职业都有它该有的最高环阶（半施法者到 5 环，全施法者到 9 环）', () => {
    const maxLevel = (cls: string) => Math.max(...all.filter((d) => d.classes.includes(cls as never)).map((d) => d.level));
    expect(maxLevel('paladin')).toBe(5);
    expect(maxLevel('ranger')).toBe(5);
    for (const cls of ['cleric', 'wizard', 'druid', 'bard', 'sorcerer', 'warlock']) expect(maxLevel(cls), cls).toBe(9);
    // 每个职业的每个环阶（半施法者到 5 环）至少有一个法术
    for (const cls of CLASSES) {
      const top = maxLevel(cls);
      for (let lv = cls === 'paladin' || cls === 'ranger' ? 1 : 0; lv <= top; lv++) {
        if (lv === 0 && (cls === 'paladin' || cls === 'ranger')) continue;
        expect(all.some((d) => d.level === lv && d.classes.includes(cls as never)), `${cls} 没有 ${lv} 环法术`).toBe(true);
      }
    }
  });

  it('SRD 职业法术表抽查', () => {
    const has = (cls: string, id: string) => SPELLS[id].classes.includes(cls as never);
    for (const id of ['fireball', 'wish', 'magic_missile', 'cone_of_cold', 'counterspell', 'teleport']) expect(has('wizard', id), id).toBe(true);
    for (const id of ['spiritual_weapon', 'revivify', 'flame_strike', 'guiding_bolt', 'mass_cure_wounds']) expect(has('cleric', id), id).toBe(true);
    for (const id of ['hunters_mark', 'conjure_animals', 'cure_wounds', 'goodberry']) expect(has('ranger', id), id).toBe(true);
    for (const id of ['divine_favor', 'revivify', 'find_steed', 'bless']) expect(has('paladin', id), id).toBe(true);
    for (const id of ['call_lightning', 'moonbeam', 'barkskin', 'wall_of_thorns']) expect(has('druid', id), id).toBe(true);
    for (const id of ['vicious_mockery', 'hypnotic_pattern', 'healing_word', 'dissonant_whispers']) if (SPELLS[id]) expect(has('bard', id), id).toBe(true);
    for (const id of ['eldritch_blast', 'hellish_rebuke', 'armor_of_agathys']) if (SPELLS[id]) expect(has('warlock', id), id).toBe(true);
    expect(has('sorcerer', 'fireball')).toBe(true);
    // 反例：子职业追加的、别的职业的
    expect(has('cleric', 'fireball')).toBe(false);
    expect(has('wizard', 'faerie_fire')).toBe(false);
    expect(has('wizard', 'cure_wounds')).toBe(false);
    expect(has('paladin', 'hunters_mark')).toBe(false);
  });

  it('各职业各环阶的 SRD 法术数，等于玩家手册职业法术表去掉非 SRD 的部分（不含子职业追加）', () => {
    // 0–9 环；亡者丧钟不在 SRD 里，不计
    const expected: Record<string, number[]> = {
      bard: [9, 20, 19, 15, 8, 16, 7, 10, 5, 3],
      cleric: [7, 15, 17, 19, 8, 13, 10, 8, 4, 4],
      druid: [7, 16, 17, 12, 15, 14, 9, 5, 6, 4],
      paladin: [0, 11, 8, 6, 3, 3, 0, 0, 0, 0],
      ranger: [0, 11, 11, 9, 4, 2, 0, 0, 0, 0],
      sorcerer: [14, 17, 21, 20, 10, 11, 9, 8, 5, 5],
      warlock: [7, 7, 10, 11, 4, 4, 7, 4, 5, 5],
      wizard: [14, 27, 31, 28, 23, 23, 19, 15, 12, 12],
    };
    const actual: Record<string, number[]> = {};
    for (const cls of Object.keys(expected)) {
      actual[cls] = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((lv) => all.filter((d) => d.id !== 'toll_the_dead' && d.level === lv && d.classes.includes(cls as never)).length);
    }
    expect(actual).toEqual(expected);
  });

  it('戏法成长：伤害戏法都设了 cantripScaling，别的法术没设', () => {
    const scaled = all.filter((d) => d.cantripScaling).map((d) => d.id).sort();
    expect(scaled).toEqual([
      'acid_splash', 'chill_touch', 'eldritch_blast', 'fire_bolt', 'poison_spray', 'produce_flame',
      'ray_of_frost', 'sacred_flame', 'shocking_grasp', 'toll_the_dead', 'vicious_mockery',
    ]);
  });
});

describe('黄金用例：数值和字段对得上 SRD 5.1', () => {
  it('火球术：3 环，敏捷豁免 8d6 火焰，成功半伤，范围，升环 +1d6', () => {
    expect(SPELLS.fireball).toMatchObject({
      level: 3, school: '塑能', castingTime: 'action', range: '150 尺', duration: '立即', concentration: false, aoe: true,
      upcast: { damage: '1d6' },
      effect: { kind: 'save', ability: 'dex', damage: '8d6', damageType: 'fire', halfOnSave: true },
    });
    expect(classesOf('fireball')).toEqual(['sorcerer', 'wizard']);
  });

  it('治疗伤害：1d8 + 属性调整值，升环 +1d8，触碰', () => {
    expect(SPELLS.cure_wounds).toMatchObject({ level: 1, range: '触碰', upcast: { heal: '1d8' }, effect: { kind: 'heal', dice: '1d8', addMod: true } });
    expect(classesOf('cure_wounds')).toEqual(['bard', 'cleric', 'druid', 'paladin', 'ranger']);
  });

  it('魔法飞弹：3d4+3 力场必中，升环每环 +1d4+1', () => {
    expect(SPELLS.magic_missile).toMatchObject({ level: 1, range: '120 尺', upcast: { damage: '1d4+1' }, effect: { kind: 'auto', damage: '3d4+3', damageType: 'force' } });
  });

  it('定身人类 / 定身怪物：感知豁免麻痹，专注，升环多 1 个目标；怪物版 5 环', () => {
    expect(SPELLS.hold_person).toMatchObject({ level: 2, concentration: true, upcast: { targets: 1 }, effect: { kind: 'save', ability: 'wis', condition: 'paralyzed' } });
    expect(SPELLS.hold_monster).toMatchObject({
      level: 5, range: '90 尺', concentration: true, upcast: { targets: 1 },
      effect: { kind: 'save', ability: 'wis', condition: 'paralyzed', repeatSave: true },
    });
  });

  it('寒冰锥：5 环，60 尺锥形，体质豁免 8d8 寒冷，升环 +1d8', () => {
    expect(SPELLS.cone_of_cold).toMatchObject({
      level: 5, range: '自身（60 尺锥形）', aoe: true, upcast: { damage: '1d8' },
      effect: { kind: 'save', ability: 'con', damage: '8d8', damageType: 'cold', halfOnSave: true },
    });
    expect(classesOf('cone_of_cold')).toEqual(['sorcerer', 'wizard']);
  });

  it('闪电束：3 环，100 尺线形，敏捷豁免 8d6 闪电，升环 +1d6', () => {
    expect(SPELLS.lightning_bolt).toMatchObject({
      level: 3, range: '自身（100 尺线形）', aoe: true, upcast: { damage: '1d6' },
      effect: { kind: 'save', ability: 'dex', damage: '8d6', damageType: 'lightning', halfOnSave: true },
    });
  });

  it('造成伤害：近战法术攻击 3d10 黯蚀，升环 +1d10，只有牧师', () => {
    expect(SPELLS.inflict_wounds).toMatchObject({ level: 1, range: '触碰', upcast: { damage: '1d10' }, effect: { kind: 'attack', attacks: 1, damage: '3d10', damageType: 'necrotic' } });
    expect(classesOf('inflict_wounds')).toEqual(['cleric']);
  });

  it('光导箭：4d6 光耀，升环 +1d6；灼热射线：3 道射线 2d6，升环多 1 道', () => {
    expect(SPELLS.guiding_bolt).toMatchObject({ level: 1, range: '120 尺', upcast: { damage: '1d6' }, effect: { kind: 'attack', damage: '4d6', damageType: 'radiant' } });
    expect(SPELLS.scorching_ray).toMatchObject({ level: 2, upcast: { attacks: 1 }, effect: { kind: 'attack', attacks: 3, damage: '2d6', damageType: 'fire' } });
  });

  it('恶言相加：吟游诗人戏法，感知豁免 1d4 心灵，60 尺，随等级成长', () => {
    expect(SPELLS.vicious_mockery).toMatchObject({
      level: 0, range: '60 尺', cantripScaling: true, effect: { kind: 'save', ability: 'wis', damage: '1d4', damageType: 'psychic' },
    });
    expect(classesOf('vicious_mockery')).toEqual(['bard']);
  });

  it('魔能爆：只有邪术师，120 尺，1d10 力场，成长是射线数（attacks 固定为 1）', () => {
    expect(SPELLS.eldritch_blast).toMatchObject({ level: 0, range: '120 尺', cantripScaling: true, effect: { kind: 'attack', attacks: 1, damage: '1d10', damageType: 'force' } });
    expect(classesOf('eldritch_blast')).toEqual(['warlock']);
  });

  it('伤害戏法：酸液飞溅 1d6 酸液（可选两个目标）、毒雾喷射 1d12 毒素 10 尺、寒冰之触 1d8 黯蚀、电爪 1d8 闪电触碰、生火术 1d8 火焰', () => {
    expect(SPELLS.acid_splash).toMatchObject({ aoe: true, maxTargets: 2, effect: { kind: 'save', ability: 'dex', damage: '1d6', damageType: 'acid' } });
    expect(SPELLS.poison_spray).toMatchObject({ range: '10 尺', effect: { kind: 'save', ability: 'con', damage: '1d12', damageType: 'poison' } });
    expect(SPELLS.chill_touch).toMatchObject({ range: '120 尺', effect: { kind: 'attack', damage: '1d8', damageType: 'necrotic' } });
    expect(SPELLS.shocking_grasp).toMatchObject({ range: '触碰', effect: { kind: 'attack', damage: '1d8', damageType: 'lightning' } });
    expect(SPELLS.produce_flame).toMatchObject({ effect: { kind: 'attack', damage: '1d8', damageType: 'fire' } });
    expect(classesOf('acid_splash')).toEqual(['sorcerer', 'wizard']);
    expect(classesOf('poison_spray')).toEqual(['druid', 'sorcerer', 'warlock', 'wizard']);
  });

  it('雷鸣波：体质豁免 2d8 雷鸣成功半伤，自身 15 尺立方，升环 +1d8；粉碎音波 3d8，60 尺，升环 +1d8', () => {
    expect(SPELLS.thunderwave).toMatchObject({
      level: 1, range: '自身（15 尺立方）', aoe: true, upcast: { damage: '1d8' },
      effect: { kind: 'save', ability: 'con', damage: '2d8', damageType: 'thunder', halfOnSave: true },
    });
    expect(SPELLS.shatter).toMatchObject({
      level: 2, range: '60 尺', aoe: true, upcast: { damage: '1d8' },
      effect: { kind: 'save', ability: 'con', damage: '3d8', damageType: 'thunder', halfOnSave: true },
    });
  });

  it('炼狱斥责：反应，敏捷豁免 2d10 火焰成功半伤，升环 +1d10，只有邪术师', () => {
    expect(SPELLS.hellish_rebuke).toMatchObject({
      level: 1, castingTime: 'reaction', range: '60 尺', upcast: { damage: '1d10' },
      effect: { kind: 'save', ability: 'dex', damage: '2d10', damageType: 'fire', halfOnSave: true },
    });
    expect(classesOf('hellish_rebuke')).toEqual(['warlock']);
  });

  it('枯萎术 8d8 黯蚀、死亡一指 7d8+30、解离术 10d6+40（成功无伤害）', () => {
    expect(SPELLS.blight).toMatchObject({ level: 4, range: '30 尺', upcast: { damage: '1d8' }, effect: { kind: 'save', ability: 'con', damage: '8d8', damageType: 'necrotic', halfOnSave: true } });
    expect(SPELLS.finger_of_death).toMatchObject({ level: 7, range: '60 尺', effect: { kind: 'save', ability: 'con', damage: '7d8+30', damageType: 'necrotic', halfOnSave: true } });
    expect(SPELLS.disintegrate).toMatchObject({ level: 6, range: '60 尺', upcast: { damage: '3d6' }, effect: { kind: 'save', ability: 'dex', damage: '10d6+40', damageType: 'force' } });
    expect((SPELLS.disintegrate.effect as { halfOnSave?: boolean }).halfOnSave).toBeFalsy();
  });

  it('连环闪电 10d8（主目标 + 3 个，共 4 个目标）、死亡之环 8d6 升环 +2d6、火焰风暴 7d10、火墙术 5d8', () => {
    expect(SPELLS.chain_lightning).toMatchObject({ level: 6, range: '150 尺', aoe: true, maxTargets: 4, effect: { kind: 'save', ability: 'dex', damage: '10d8', damageType: 'lightning', halfOnSave: true } });
    expect(SPELLS.circle_of_death).toMatchObject({ level: 6, range: '150 尺', upcast: { damage: '2d6' }, effect: { kind: 'save', ability: 'con', damage: '8d6', damageType: 'necrotic', halfOnSave: true } });
    expect(SPELLS.fire_storm).toMatchObject({ level: 7, range: '150 尺', effect: { kind: 'save', ability: 'dex', damage: '7d10', damageType: 'fire', halfOnSave: true } });
    expect(SPELLS.wall_of_fire).toMatchObject({ level: 4, concentration: true, upcast: { damage: '1d8' }, effect: { kind: 'save', ability: 'dex', damage: '5d8', damageType: 'fire', halfOnSave: true } });
  });

  it('日爆术：12d6 光耀 + 失败目盲，150 尺；冰冻球 10d6 寒冷 300 尺', () => {
    expect(SPELLS.sunburst).toMatchObject({ level: 8, range: '150 尺', effect: { kind: 'save', ability: 'con', damage: '12d6', damageType: 'radiant', halfOnSave: true, condition: 'blinded' } });
    expect(SPELLS.freezing_sphere).toMatchObject({ level: 6, range: '300 尺', upcast: { damage: '1d6' }, effect: { kind: 'save', ability: 'con', damage: '10d6', damageType: 'cold', halfOnSave: true } });
  });

  it('痊愈术：固定治疗 70（不加属性调整值），升环每环 +10；再生术 4d8+15', () => {
    expect(SPELLS.heal).toMatchObject({ level: 6, range: '60 尺', upcast: { heal: '10' }, effect: { kind: 'heal', dice: '70' } });
    expect((SPELLS.heal.effect as { addMod?: boolean }).addMod).toBeFalsy();
    expect(SPELLS.regenerate).toMatchObject({ level: 7, range: '触碰', effect: { kind: 'heal', dice: '4d8+15' } });
  });

  it('加速术：专注，AC +2；高等隐形术：专注，隐形状态', () => {
    expect(SPELLS.haste).toMatchObject({ level: 3, range: '30 尺', concentration: true, maxTargets: 1, effect: { kind: 'buff', acBonus: 2 } });
    expect(SPELLS.greater_invisibility).toMatchObject({ level: 4, concentration: true, effect: { kind: 'buff', condition: 'invisible' } });
  });

  it('utility 法术的说明里带着关键数值：火焰打击、冰风暴、流星爆、祈愿术', () => {
    const note = (id: string) => (SPELLS[id].effect as { note: string }).note;
    expect(SPELLS.flame_strike).toMatchObject({ level: 5, effect: { kind: 'utility' } });
    expect(note('flame_strike')).toContain('4d6');
    expect(SPELLS.ice_storm).toMatchObject({ level: 4, range: '300 尺', effect: { kind: 'utility' } });
    expect(note('ice_storm')).toContain('2d8');
    expect(note('ice_storm')).toContain('4d6');
    expect(note('meteor_swarm')).toContain('20d6');
    expect(SPELLS.meteor_swarm.range).toBe('5280 尺');
    expect(SPELLS.wish).toMatchObject({ level: 9, castingTime: 'action', classes: expect.arrayContaining(['sorcerer', 'wizard']) });
    expect(note('power_word_kill')).toContain('100');
    expect(note('revivify')).toContain('1 分钟');
  });

  it('时长与专注：长时长法术用 1 小时并在说明里写真实时长', () => {
    expect(SPELLS.mage_armor).toMatchObject({ duration: '1 小时', concentration: false });
    expect((SPELLS.mage_armor.effect as { note: string }).note).toContain('8 小时');
    expect(SPELLS.fireball.concentration).toBe(false);
    expect(SPELLS.wall_of_force).toMatchObject({ duration: '10 分钟', concentration: true });
    expect(SPELLS.cloudkill).toMatchObject({ duration: '10 分钟', concentration: true });
    expect(SPELLS.revivify.duration).toBe('立即');
    expect(SPELLS.alarm).toMatchObject({ ritual: true, castingTime: 'action' });
    expect((SPELLS.alarm.effect as { note: string }).note).toContain('施法时间 1 分钟');
  });
});

// ---------------------------------------------------------------- 用真引擎跑
function world(level = 5) {
  const rolls = new ScriptedRollSource();
  const engine = new RulesEngine({ rollSource: rolls });
  const slots = Object.fromEntries([1, 2, 3, 4, 5, 6, 7, 8, 9].map((l) => [String(l), { max: 3, used: 0 }]));
  const caster = actorFromCharacter(
    {
      name: '测试施法者',
      level,
      abilities: { str: 10, dex: 14, con: 14, int: 16, wis: 16, cha: 16 },
      saves: ['int', 'wis'],
      skills: [],
      ac: 12,
      maxHp: 40,
      attacks: [],
      spells: { ability: 'wis', known: [], slots },
      hitDice: { die: 8, total: level },
    },
    'caster',
    'player_a'
  );
  caster.position = { col: 5, row: 5 };
  engine.addActor(caster);
  const spots = [
    { col: 6, row: 5 },
    { col: 6, row: 6 },
    { col: 5, row: 6 },
  ];
  const foes = ['甲', '乙', '丙'].map((label, i) => {
    const g = spawnMonster('goblin', label);
    g.hp = 200;
    g.maxHp = 200;
    g.position = spots[i];
    engine.addActor(g);
    return g;
  });
  return { engine, rolls, caster, foes, targetIds: foes.map((f) => f.id) };
}

describe('用真引擎施放：数据和引擎兼容', () => {
  it('每个 attack / save / auto / heal / buff / sleep 法术都能施放成功（含高一环升环），utility 也能出说明', async () => {
    const problems: string[] = [];
    for (const def of all) {
      const casts = [def.level];
      if (def.level > 0 && def.level < 9 && def.upcast) casts.push(def.level + 1);
      for (const slot of casts) {
        const w = world();
        try {
          // 传送类法术要给目的地
          const teleport = def.effect.kind === 'buff' && def.effect.teleportFeet ? { destination: { col: 5, row: 9 } } : {};
          // 要选模式的法术（增强属性、降咒术）：给第一个选项的第一个关键词
          const option = def.choices?.length ? { option: def.choices[0].match[0] } : {};
          const r = await w.engine.castSpell('caster', def.id, slot, w.targetIds, { ignoreKnown: true, ...teleport, ...option });
          if (!r.ok) problems.push(`${def.id}@${slot}: ${r.error}`);
          else if (def.effect.kind === 'utility' && !r.notes.some((n) => n === (def.effect as { note: string }).note)) problems.push(`${def.id}: utility 的说明没出现在 notes 里`);
          else if (def.effect.kind === 'buff' && !r.notes.some((n) => n === (def.effect as { note?: string }).note)) problems.push(`${def.id}: buff 的说明没出现在 notes 里`);
          else if (def.level > 0 && !r.slotUsed) problems.push(`${def.id}@${slot}: 没扣法术位`);
        } catch (err) {
          problems.push(`${def.id}@${slot}: 抛错 ${(err as Error).message}`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  it('伤害类法术真的造成了伤害（骰子取最大值，豁免大概率失败）', async () => {
    const problems: string[] = [];
    for (const def of all) {
      const e = def.effect;
      const damaging = (e.kind === 'attack' || e.kind === 'auto' || (e.kind === 'save' && e.damage)) as boolean;
      if (!damaging) continue;
      const w = world();
      const r = await w.engine.castSpell('caster', def.id, def.level, w.targetIds, { ignoreKnown: true });
      if (!r.ok) {
        problems.push(`${def.id}: ${r.error}`);
        continue;
      }
      if (r.damage <= 0) problems.push(`${def.id}: 伤害为 0（${r.notes.join(' / ')}）`);
    }
    expect(problems).toEqual([]);
  });

  it('只带 failEffect / condition 的 save 法术真的把效果挂上了（豁免失败时）', async () => {
    const w = world();
    const r = await w.engine.castSpell('caster', 'bane', 1, w.targetIds, { ignoreKnown: true });
    expect(r.ok).toBe(true);
    const marked = w.foes.filter((f) => f.effects.some((x) => x.spellId === 'bane'));
    expect(marked.length).toBe(3);

    const w2 = world();
    const r2 = await w2.engine.castSpell('caster', 'hold_monster', 5, [w2.targetIds[0]], { ignoreKnown: true });
    expect(r2.ok).toBe(true);
    expect(w2.foes[0].conditions.some((c) => c.name === 'paralyzed' && c.save)).toBe(true);

    const w3 = world();
    const r3 = await w3.engine.castSpell('caster', 'entangle', 1, w3.targetIds, { ignoreKnown: true });
    expect(r3.ok).toBe(true);
    expect(w3.foes.every((f) => f.conditions.some((c) => c.name === 'restrained'))).toBe(true);
  });

  it('只带说明的 buff：效果挂到目标身上，专注法术记进专注，maxTargets 生效', async () => {
    const w = world();
    const r = await w.engine.castSpell('caster', 'blur', 2, [], { ignoreKnown: true });
    expect(r.ok).toBe(true);
    expect(w.caster.effects.some((x) => x.spellId === 'blur' && x.rounds === 10)).toBe(true);
    expect(w.caster.concentration?.spellId).toBe('blur');

    const w2 = world();
    const r2 = await w2.engine.castSpell('caster', 'haste', 3, w2.targetIds, { ignoreKnown: true });
    expect(r2.ok).toBe(true);
    expect(w2.foes.filter((f) => f.effects.some((x) => x.spellId === 'haste' && x.acBonus === 2)).length).toBe(1);
  });

  it('heal 类：痊愈术 +70、再生术 4d8+15（取最大 47），不会超过最大 HP', async () => {
    const w = world();
    w.foes[0].hp = 10;
    const r = await w.engine.castSpell('caster', 'heal', 6, [w.targetIds[0]], { ignoreKnown: true });
    expect(r.ok).toBe(true);
    expect(r.heal).toBe(70);
    expect(w.foes[0].hp).toBe(80);

    const w2 = world();
    w2.foes[0].hp = 10;
    const r2 = await w2.engine.castSpell('caster', 'regenerate', 7, [w2.targetIds[0]], { ignoreKnown: true });
    expect(r2.ok).toBe(true);
    expect(r2.heal).toBe(47);
  });

  it('升环真的加了骰子：火球术 4 环 = 8d6+1d6，解离术 7 环 = 10d6+40+3d6', async () => {
    const w = world();
    await w.engine.castSpell('caster', 'fireball', 4, w.targetIds, { ignoreKnown: true });
    expect(w.rolls.calls.some((c) => c.formula === '8d6+1d6')).toBe(true);

    const w2 = world();
    await w2.engine.castSpell('caster', 'disintegrate', 7, [w2.targetIds[0]], { ignoreKnown: true });
    expect(w2.rolls.calls.some((c) => c.formula === '10d6+40+3d6')).toBe(true);
  });

  it('戏法成长：5 / 11 / 17 级伤害骰 ×2 / ×3 / ×4，魔能爆是射线数', async () => {
    const cases: [string, string][] = [
      ['fire_bolt', '1d10'],
      ['ray_of_frost', '1d8'],
      ['sacred_flame', '1d8'],
      ['poison_spray', '1d12'],
      ['acid_splash', '1d6'],
      ['vicious_mockery', '1d4'],
      ['chill_touch', '1d8'],
      ['shocking_grasp', '1d8'],
      ['produce_flame', '1d8'],
    ];
    for (const [id, base] of cases) {
      const [count, sides] = base.split('d').map(Number);
      for (const [level, factor] of [[1, 1], [4, 1], [5, 2], [11, 3], [17, 4]] as const) {
        const w = world(level);
        const r = await w.engine.castSpell('caster', id, 0, [w.targetIds[0]], { ignoreKnown: true });
        expect(r.ok, `${id}@${level}: ${r.error}`).toBe(true);
        const dmg = w.rolls.calls.find((c) => /伤害/.test(c.label) && /d\d+/.test(c.formula));
        expect(dmg, `${id}@${level} 没有伤害掷骰`).toBeDefined();
        expect(dmg!.formula, `${id}@${level}`).toBe(`${count * factor}d${sides}`);
      }
    }
    for (const [level, beams] of [[1, 1], [5, 2], [11, 3], [17, 4]] as const) {
      const w = world(level);
      const r = await w.engine.castSpell('caster', 'eldritch_blast', 0, [w.targetIds[0]], { ignoreKnown: true });
      expect(r.ok).toBe(true);
      const attacks = w.rolls.calls.filter((c) => /施放 .+ → /.test(c.label));
      expect(attacks.length, `魔能爆@${level}`).toBe(beams);
    }
  });

  it('把所有法术都放进已知列表，legalActions 能列出来而不抛错', () => {
    const w = world();
    w.caster.spells!.known = ids;
    const acts = w.engine.legalActions('caster').filter((a) => a.kind === 'cast');
    expect(acts.length).toBe(ids.length);
    expect(w.engine.legalActionsText('caster').length).toBeGreaterThan(1000);
  });
});
