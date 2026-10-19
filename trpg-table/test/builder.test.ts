import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCharacter, FEATURE_CATALOG, SUBCLASSES, CLASS_DEFS, RACES, BACKGROUNDS, type CharacterBuild } from '../src/rules/build/index.js';
import { CATALOG_COLLISIONS } from '../src/rules/build/catalog.js';
import { SPELL_CLASS_LIST } from '../src/rules/build/data/spell-lists.gen.js';
import { DEFAULT_SPELLS, FULL_CASTER_SLOTS, HALF_CASTER_SLOTS, THIRD_CASTER_SLOTS, PACT_SLOTS } from '../src/rules/build/data/spell-tables.js';
import { CLASS_IDS, featureId, RESOURCE_SPECS } from '../src/rules/contract.js';
import { SPELLS } from '../src/rules/data/spells.js';
import { actorFromCharacter } from '../src/rules/sheet.js';
import { abilityMod, ABILITIES, type Ability } from '../src/rules/types.js';
import { loadParty } from '../src/table/characters.js';
import { RulesEngine, spawnMonster } from '../src/rules/engine.js';
import { ScriptedRollSource } from './helpers.js';

const ZERO: Record<Ability, number> = { str: 10, dex: 10, con: 10, int: 10, wis: 10, cha: 10 };
const scores = (o: Partial<Record<Ability, number>>): Record<Ability, number> => ({ ...ZERO, ...o });

/** 一个最小的合法构建，用 over 覆盖。 */
function mk(over: Partial<CharacterBuild> = {}): CharacterBuild {
  return {
    name: '测试角色',
    race: 'human',
    background: 'acolyte',
    classes: [{ id: 'fighter', level: 1 }],
    abilityScores: scores({ str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 }),
    ...over,
  };
}

describe('黄金用例（2014 规则，手算）', () => {
  it('1 级人类战士：链甲 + 盾 + 长剑，AC 18，HP 12', () => {
    const r = buildCharacter(
      mk({
        background: 'soldier',
        classes: [{ id: 'fighter', level: 1 }],
        abilityScores: scores({ str: 15, dex: 13, con: 14, int: 10, wis: 12, cha: 8 }),
        skills: ['perception', 'survival'],
        fightingStyles: ['dueling'],
        equipment: { armor: 'chain_mail', shield: true, weapons: ['longsword'] },
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    // 人类全属性 +1：16 / 14 / 15 / 11 / 13 / 9
    expect(f.abilities).toEqual({ str: 16, dex: 14, con: 15, int: 11, wis: 13, cha: 9 });
    expect(f.ac).toBe(18); // 链甲 16（不加敏捷）+ 盾 2
    expect(f.maxHp).toBe(12); // d10 满骰 10 + 体质 +2
    expect(f.proficiencyBonus).toBe(2);
    expect(f.saves).toEqual(['str', 'con']);
    // 士兵：运动、威吓；战士自选：察觉、求生
    expect(f.skills).toEqual(['athletics', 'intimidation', 'perception', 'survival']);
    expect(f.expertise).toEqual([]);
    expect(f.speed).toBe(30);
    expect(f.attacks).toEqual([{ weaponId: 'longsword' }]);
    expect(f.attacksPerAction).toBe(1);
    expect(f.hitDice).toEqual({ die: 10, total: 1 });
    expect(f.features).toEqual(expect.arrayContaining(['second_wind', 'fighting_style_dueling', 'military_rank']));
    expect(f.resources?.second_wind).toMatchObject({ max: 1, recharge: 'short' });
    expect(f.class).toBe('战士 1');
  });

  it('5 级丘陵矮人生命牧师：链甲衫 + 盾，AC 16，HP 48，法术位 4/3/2，准备 9 个', () => {
    const r = buildCharacter(
      mk({
        race: 'hill_dwarf',
        background: 'acolyte',
        classes: [{ id: 'cleric', level: 5, subclass: 'life_domain' }],
        abilityScores: scores({ str: 10, dex: 12, con: 14, int: 8, wis: 15, cha: 13 }),
        skills: ['medicine', 'persuasion'],
        asi: { '4': { abilities: { wis: 2 } } },
        equipment: { armor: 'chain_shirt', shield: true, weapons: ['mace'] },
        spells: {
          cantrips: ['sacred_flame', 'guidance', 'light', 'toll_the_dead'],
          prepared: ['guiding_bolt', 'healing_word', 'shield_of_faith', 'hold_person', 'silence', 'spirit_guardians', 'dispel_magic', 'mass_healing_word', 'protection_from_energy'],
        },
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    // 矮人：体质 +2、感知 +1；4 级感知 +2
    expect(f.abilities).toMatchObject({ con: 16, wis: 18, dex: 12 });
    expect(f.speed).toBe(25);
    expect(f.resistances).toEqual(['poison']);
    expect(f.ac).toBe(16); // 链甲衫 13 + 敏捷 +1（中甲上限 2）+ 盾 2
    // 1 级 8+3+1，之后 4 级各 5+3+1（矮人每级 +1）
    expect(f.maxHp).toBe(48);
    expect(f.saves).toEqual(['wis', 'cha']);
    expect(f.skills).toEqual(['insight', 'medicine', 'persuasion', 'religion']);
    expect(f.spells?.ability).toBe('wis');
    expect(f.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 }, '3': { max: 2, used: 0 } });
    const info = r.info.spellcasting!.byClass.cleric;
    expect(info.cantripsMax).toBe(4);
    expect(info.spellsMax).toBe(9); // 感知 +4 + 牧师等级 5
    expect(info.spells).toHaveLength(9);
    expect(info.alwaysPrepared).toEqual(['bless', 'cure_wounds', 'lesser_restoration', 'spiritual_weapon', 'beacon_of_hope', 'revivify']);
    // 生命领域永久准备法术在 known 里（用 SPELLS 里有的那些断言）
    for (const id of ['bless', 'cure_wounds', 'lesser_restoration', 'spiritual_weapon']) {
      expect(f.spells?.known).toContain(id);
    }
    expect(f.spells?.known).toContain('sacred_flame');
    expect(f.resources?.channel_divinity).toMatchObject({ max: 1, recharge: 'short' });
    expect(f.features).toEqual(expect.arrayContaining(['disciple_of_life', 'channel_divinity_preserve_life', 'channel_divinity_turn_undead', 'dwarven_toughness', 'darkvision']));
    expect(r.info.armorProficiencies).toContain('重甲'); // 生命领域额外熟练
  });

  it('3 级提夫林盗贼（神偷）：专精、偷袭 2d6、AC 13、HP 24', () => {
    const r = buildCharacter(
      mk({
        race: 'tiefling',
        background: 'charlatan',
        classes: [{ id: 'rogue', level: 3, subclass: 'thief' }],
        abilityScores: scores({ str: 8, dex: 15, con: 14, int: 12, wis: 10, cha: 13 }),
        skills: ['stealth', 'perception', 'acrobatics', 'investigation'],
        expertise: ['stealth', 'sleight_of_hand'],
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    const f = r.file;
    expect(f.abilities).toMatchObject({ dex: 15, cha: 15, int: 13 });
    expect(f.sneakAttackDice).toBe(2);
    expect(f.expertise).toEqual(['sleight_of_hand', 'stealth']);
    // 骗子：欺瞒、巧手；盗贼自选 4 项
    expect(f.skills).toEqual(['acrobatics', 'deception', 'investigation', 'perception', 'sleight_of_hand', 'stealth']);
    expect(f.saves).toEqual(['dex', 'int']);
    expect(f.ac).toBe(13); // 皮甲 11 + 敏捷 +2
    expect(f.maxHp).toBe(24); // 8+2，之后 2 级各 5+2
    expect(f.resistances).toEqual(['fire']);
    expect(f.attacks?.map((a) => a.weaponId)).toEqual(['rapier', 'shortbow', 'dagger']);
    expect(f.features).toEqual(expect.arrayContaining(['sneak_attack', 'cunning_action', 'fast_hands', 'second_story_work', 'expertise', 'thieves_cant', 'hellish_resistance', 'infernal_legacy']));
    expect(f.hitDice).toEqual({ die: 8, total: 3 });
  });

  it('5 级半兽人野蛮人：无甲防御、狂暴 3 次、额外攻击、快速移动', () => {
    const r = buildCharacter(
      mk({
        race: 'half_orc',
        background: 'outlander',
        classes: [{ id: 'barbarian', level: 5, subclass: 'berserker' }],
        abilityScores: scores({ str: 15, dex: 13, con: 14, int: 8, wis: 10, cha: 8 }),
        skills: ['perception', 'nature'],
        asi: { '4': { abilities: { str: 2 } } },
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.abilities).toMatchObject({ str: 19, con: 15, dex: 13 }); // 半兽人 +2/+1，4 级力量 +2
    expect(f.ac).toBe(13); // 10 + 敏捷 +1 + 体质 +2
    expect(f.maxHp).toBe(50); // 12+2，之后 4 级各 7+2
    expect(f.speed).toBe(40); // 30 + 快速移动 10
    expect(f.attacksPerAction).toBe(2);
    expect(f.resources?.rage).toMatchObject({ max: 3, recharge: 'long' });
    expect(f.resources?.relentless_endurance).toMatchObject({ max: 1, recharge: 'long' });
    expect(f.saves).toEqual(['str', 'con']);
    // 化外之民：运动、求生；半兽人：威吓；自选：察觉、自然
    expect(f.skills).toEqual(['athletics', 'intimidation', 'nature', 'perception', 'survival']);
    expect(f.features).toEqual(
      expect.arrayContaining(['rage', 'unarmored_defense', 'reckless_attack', 'danger_sense', 'extra_attack', 'fast_movement', 'frenzy', 'relentless_endurance', 'savage_attacks'])
    );
    expect(f.size).toBe('Medium');
  });

  it('5 级人类武僧：无甲防御 AC 16、气 5、武艺 d6、无甲移动 +10', () => {
    const r = buildCharacter(
      mk({
        background: 'hermit',
        classes: [{ id: 'monk', level: 5, subclass: 'open_hand' }],
        abilityScores: scores({ str: 10, dex: 15, con: 13, int: 8, wis: 14, cha: 10 }),
        skills: ['acrobatics', 'stealth'],
        asi: { '4': { abilities: { dex: 2 } } },
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.abilities).toMatchObject({ dex: 18, wis: 15, con: 14, str: 11 });
    expect(f.ac).toBe(16); // 10 + 敏捷 +4 + 感知 +2
    expect(f.maxHp).toBe(38); // 8+2，之后 4 级各 5+2
    expect(f.speed).toBe(40); // 30 + 无甲移动 10（5 级；6 级 +15）
    expect(f.attacksPerAction).toBe(2);
    expect(f.resources?.ki).toMatchObject({ max: 5, recharge: 'short' });
    expect(f.saves).toEqual(['str', 'dex']);
    // 徒手打击是 WEAPONS 里的 unarmed，武艺骰和敏捷 / 力量取高由引擎的 martial_arts 特性层算
    expect(f.attacks).toContainEqual({ weaponId: 'unarmed', name: '徒手打击' });
    expect(f.features).toEqual(expect.arrayContaining(['unarmored_defense', 'martial_arts', 'ki', 'flurry_of_blows', 'patient_defense', 'step_of_the_wind', 'unarmored_movement', 'deflect_missiles', 'slow_fall', 'extra_attack', 'stunning_strike', 'open_hand_technique']));
    // 穿甲就失去无甲防御和无甲移动
    const armored = buildCharacter(mk({ classes: [{ id: 'monk', level: 5, subclass: 'open_hand' }], abilityScores: scores({ dex: 15, wis: 14 }), equipment: { armor: 'leather' } }));
    expect(armored.file.speed).toBe(30);
    expect(armored.warnings.some((w) => w.includes('武僧穿甲'))).toBe(true);
  });

  it('3 级邪术师：契约魔法 2 个 2 环法术位，短休恢复', () => {
    const r = buildCharacter(
      mk({
        background: 'criminal',
        classes: [{ id: 'warlock', level: 3, subclass: 'fiend' }],
        abilityScores: scores({ str: 8, dex: 14, con: 14, int: 10, wis: 10, cha: 15 }),
        skills: ['arcana', 'deception'],
        spells: { cantrips: ['eldritch_blast', 'minor_illusion'], known: ['hex', 'armor_of_agathys', 'misty_step', 'hold_person'] },
        options: { invocations: ['agonizing_blast', 'devils_sight'], pactBoon: 'pact_of_the_tome' },
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.spells?.pact).toBe(true);
    expect(f.spells?.slots).toEqual({ '2': { max: 2, used: 0 } });
    expect(f.spells?.ability).toBe('cha');
    expect(f.maxHp).toBe(24); // 8+2，之后 2 级各 5+2
    const info = r.info.spellcasting!.byClass.warlock;
    expect(info.cantripsMax).toBe(2);
    expect(info.spellsMax).toBe(4);
    expect(info.maxSpellLevel).toBe(2);
    expect(f.spells?.known).toEqual(expect.arrayContaining(['minor_illusion', 'misty_step']));
    expect(f.features).toEqual(expect.arrayContaining(['pact_magic', 'dark_ones_blessing', 'agonizing_blast', 'devils_sight', 'pact_of_the_tome']));
    expect(f.saves).toEqual(['wis', 'cha']);
  });

  it('邪术师的祈唤前置：魔能爆戏法、契约恩赐、等级', () => {
    const lock = (level: number, options: NonNullable<CharacterBuild['options']>, cantrips = ['eldritch_blast', 'minor_illusion']) =>
      buildCharacter(mk({ classes: [{ id: 'warlock', level, subclass: 'fiend' }], skills: ['arcana', 'deception'], spells: { cantrips }, options }));
    expect(lock(5, { pactBoon: 'pact_of_the_blade', invocations: ['agonizing_blast', 'thirsting_blade', 'devils_sight'] }).errors).toEqual([]);
    expect(lock(5, { pactBoon: 'pact_of_the_tome', invocations: ['agonizing_blast', 'thirsting_blade', 'devils_sight'] }).errors.some((e) => e.includes('Thirsting Blade'))).toBe(true);
    // 没有魔能爆就不能选痛击魔能爆
    expect(lock(3, { invocations: ['agonizing_blast', 'devils_sight'] }, ['minor_illusion', 'mage_hand']).errors.some((e) => e.includes('魔能爆'))).toBe(true);
    // 3 级不能选 5 级才有的祈唤
    expect(lock(3, { invocations: ['agonizing_blast', 'thirsting_blade'] }).errors.some((e) => e.includes('Thirsting Blade'))).toBe(true);
    // 3 级只有 2 个祈唤名额
    expect(lock(3, { invocations: ['agonizing_blast', 'devils_sight', 'armor_of_shadows'] }).errors.some((e) => e.includes('最多 2'))).toBe(true);
    // 11 级起有神秘秘法
    const arc = lock(11, { mysticArcanum: { 6: 'mass_suggestion' } });
    expect(arc.errors).toEqual([]);
    expect(arc.file.notes).toContain('6 环 mass_suggestion');
    expect(lock(11, { mysticArcanum: { 6: 'fireball' } }).errors.some((e) => e.includes('神秘秘法'))).toBe(true);
  });

  it('兼职 战士（冠军）3 / 法师 3：单施法职业用法师自己的法术位表', () => {
    const r = buildCharacter(
      mk({
        background: 'sage',
        classes: [
          { id: 'fighter', level: 3, subclass: 'champion' },
          { id: 'wizard', level: 3, subclass: 'evocation' },
        ],
        abilityScores: scores({ str: 14, dex: 12, con: 14, int: 14, wis: 10, cha: 8 }),
        skills: ['athletics', 'perception'],
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.level).toBe(6);
    expect(f.proficiencyBonus).toBe(3);
    expect(f.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } });
    // 战士起始满骰 10+2；战士 2 级 × (6+2)；法师 3 级 × (4+2)
    expect(f.maxHp).toBe(46);
    expect(f.hitDice).toEqual({ die: 10, total: 6 });
    expect(r.warnings.some((w) => w.includes('d10×3 + d6×3'))).toBe(true);
    expect(f.saves).toEqual(['str', 'con']); // 兼职不给豁免熟练
    expect(f.classes).toEqual([
      { id: 'fighter', level: 3, subclass: 'champion' },
      { id: 'wizard', level: 3, subclass: 'evocation' },
    ]);
    expect(f.class).toBe('战士（冠军） 3 / 法师（塑能学派） 3');
    expect(r.info.spellcasting!.byClass.wizard.spellsMax).toBe(5); // 智力 +2 + 3
    expect(r.info.spellcasting!.byClass.wizard.spellbookMax).toBe(10);
  });

  it('兼职 奥法骑士 3 / 法师 3：两个施法职业，按多职业施法者表（施法者等级 1 + 3 = 4）', () => {
    const r = buildCharacter(
      mk({
        background: 'sage',
        classes: [
          { id: 'fighter', level: 3, subclass: 'eldritch_knight' },
          { id: 'wizard', level: 3, subclass: 'evocation' },
        ],
        abilityScores: scores({ str: 14, dex: 12, con: 14, int: 14, wis: 10, cha: 8 }),
        skills: ['athletics', 'perception'],
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.file.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 3, used: 0 } });
    expect(Object.keys(r.info.spellcasting!.byClass).sort()).toEqual(['fighter', 'wizard']);
    expect(r.info.spellcasting!.byClass.fighter.spellsMax).toBe(3); // 奥法骑士 3 级已知 3 个
    expect(r.info.spellcasting!.byClass.fighter.cantripsMax).toBe(2);
    expect(r.file.spells?.ability).toBe('int');
  });

  it('11 级战士：每个攻击动作 3 次，动作如潮 1 次，不屈 1 次', () => {
    const r = buildCharacter(
      mk({
        classes: [{ id: 'fighter', level: 11, subclass: 'champion' }],
        abilityScores: scores({ str: 16, dex: 12, con: 14, int: 8, wis: 10, cha: 10 }),
        skills: ['athletics', 'perception'],
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.file.attacksPerAction).toBe(3);
    expect(r.file.resources?.action_surge?.max).toBe(1);
    expect(r.file.resources?.indomitable?.max).toBe(1);
    expect(r.file.proficiencyBonus).toBe(4);
    // 战士 4、6、8 级各一次属性提升：自动加力量（17 → 19 → 20，多出来的 +1 给体质），并写进 warnings
    expect(r.info.asi.map((a) => a.level)).toEqual([4, 6, 8]);
    expect(r.info.asi.every((a) => a.auto)).toBe(true);
    expect(r.file.abilities.str).toBe(20);
    expect(r.warnings.filter((w) => w.includes('自动')).length).toBeGreaterThanOrEqual(3);
    // 冠军 10 级的额外战斗风格：两个不同的风格
    const styles = r.file.features!.filter((id) => id.startsWith('fighting_style_'));
    expect(new Set(styles).size).toBe(2);
    expect(r.file.features).toContain('improved_critical');
    // 20 级战士 4 次
    expect(buildCharacter(mk({ classes: [{ id: 'fighter', level: 20, subclass: 'champion' }], skills: ['athletics', 'perception'] })).file.attacksPerAction).toBe(4);
    expect(buildCharacter(mk({ classes: [{ id: 'fighter', level: 5, subclass: 'champion' }], skills: ['athletics', 'perception'] })).file.attacksPerAction).toBe(2);
  });

  it('20 级法师：9 环法术位表，准备数 = 智力调整值 + 20，法术书 44 个', () => {
    const r = buildCharacter(
      mk({
        background: 'sage',
        classes: [{ id: 'wizard', level: 20, subclass: 'evocation' }],
        abilityScores: scores({ str: 8, dex: 14, con: 14, int: 15, wis: 12, cha: 10 }),
        asi: { '4': { abilities: { int: 2 } }, '8': { abilities: { int: 2 } } },
      })
    );
    expect(r.errors).toEqual([]);
    const slots = Object.fromEntries(Object.entries(r.file.spells!.slots!).map(([k, v]) => [k, v.max]));
    expect(slots).toEqual({ '1': 4, '2': 3, '3': 3, '4': 3, '5': 3, '6': 2, '7': 2, '8': 1, '9': 1 });
    expect(r.file.proficiencyBonus).toBe(6);
    expect(r.file.abilities.int).toBe(20); // 15+1 人类 +4
    const w = r.info.spellcasting!.byClass.wizard;
    expect(w.spellsMax).toBe(25); // 智力 +5 + 20
    expect(w.spellbookMax).toBe(44);
    expect(w.maxSpellLevel).toBe(9);
    expect(w.spellbook).toHaveLength(44);
    expect(w.cantripsMax).toBe(5);
    expect(r.file.features).toEqual(expect.arrayContaining(['spell_mastery', 'signature_spells', 'overchannel']));
    expect(r.file.resources?.arcane_recovery?.max).toBe(1);
  });

  it('各施法职业的法术位表（SRD 5.1 / 多职业施法者表）', () => {
    expect(FULL_CASTER_SLOTS).toHaveLength(20);
    expect(FULL_CASTER_SLOTS[0]).toEqual([2]);
    expect(FULL_CASTER_SLOTS[4]).toEqual([4, 3, 2]);
    expect(FULL_CASTER_SLOTS[8]).toEqual([4, 3, 3, 3, 1]);
    expect(FULL_CASTER_SLOTS[16]).toEqual([4, 3, 3, 3, 2, 1, 1, 1, 1]);
    expect(HALF_CASTER_SLOTS[0]).toEqual([]);
    expect(HALF_CASTER_SLOTS[1]).toEqual([2]);
    expect(HALF_CASTER_SLOTS[4]).toEqual([4, 2]);
    expect(HALF_CASTER_SLOTS[19]).toEqual([4, 3, 3, 3, 2]);
    expect(THIRD_CASTER_SLOTS[2]).toEqual([2]);
    expect(THIRD_CASTER_SLOTS[6]).toEqual([4, 2]);
    expect(THIRD_CASTER_SLOTS[18]).toEqual([4, 3, 3, 1]);
    expect(PACT_SLOTS[0]).toEqual([1, 1]);
    expect(PACT_SLOTS[10]).toEqual([3, 5]);
    expect(PACT_SLOTS[16]).toEqual([4, 5]);
  });

  it('圣武士 / 游侠 5 级：半施法者法术位 4/2，额外攻击，圣疗池 25', () => {
    const pal = buildCharacter(
      mk({
        background: 'noble',
        classes: [{ id: 'paladin', level: 5, subclass: 'devotion' }],
        abilityScores: scores({ str: 15, dex: 10, con: 14, int: 8, wis: 10, cha: 15 }),
        skills: ['athletics', 'persuasion'],
        asi: { '4': { abilities: { str: 2 } } },
        fightingStyles: ['dueling'],
      })
    );
    expect(pal.errors).toEqual([]);
    expect(pal.file.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } });
    expect(pal.file.attacksPerAction).toBe(2);
    expect(pal.file.resources?.lay_on_hands?.max).toBe(25);
    expect(pal.file.resources?.divine_sense?.max).toBe(4); // 1 + 魅力 +3
    expect(pal.file.resources?.channel_divinity?.max).toBe(1);
    expect(pal.info.spellcasting!.byClass.paladin.spellsMax).toBe(5); // 魅力 16 → +3，加圣武士等级的一半（2）
  });
});

describe('属性、技能、专精、专长', () => {
  it('技能重复按规则换一个：背景和种族 / 职业选择重复时换成别的，不会有重复', () => {
    const r = buildCharacter(
      mk({
        race: 'half_orc',
        background: 'soldier', // 运动、威吓；半兽人也给威吓
        classes: [{ id: 'fighter', level: 1 }],
        skills: ['athletics', 'perception'], // 运动和背景重复
      })
    );
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(new Set(f.skills).size).toBe(f.skills!.length);
    // 背景 2 + 战士 2 + 重复补位 1（威吓）+ 运动重复换 1 = 5
    expect(f.skills).toHaveLength(5);
    expect(r.warnings.some((w) => w.includes('重复'))).toBe(true);
  });

  it('变体人类：自选属性 +1、技能、1 级专长；半精灵：魅力 +2 和另外两项 +1', () => {
    const vh = buildCharacter(
      mk({
        race: 'variant_human',
        classes: [{ id: 'fighter', level: 1 }],
        abilityScores: scores({ str: 15, dex: 13, con: 14 }),
        raceOptions: { abilityBonuses: ['str', 'con'], skills: ['stealth'], feat: 'tough' },
        skills: ['athletics', 'perception'],
      })
    );
    expect(vh.errors).toEqual([]);
    expect(vh.file.abilities).toMatchObject({ str: 16, con: 15, dex: 13 });
    expect(vh.file.skills).toContain('stealth');
    expect(vh.file.features).toContain('tough');
    expect(vh.file.maxHp).toBe(10 + 2 + 2); // d10 + 体质 +2 + 强韧每级 +2

    const he = buildCharacter(mk({ race: 'half_elf', raceOptions: { abilityBonuses: ['dex', 'con'], skills: ['stealth', 'insight'] }, skills: ['athletics', 'perception'] }));
    expect(he.errors).toEqual([]);
    expect(he.file.abilities).toMatchObject({ cha: 10, dex: 14, con: 15 });
    expect(he.file.skills).toEqual(expect.arrayContaining(['stealth', 'insight']));
    // 半精灵不能再选魅力
    const bad = buildCharacter(mk({ race: 'half_elf', raceOptions: { abilityBonuses: ['cha', 'con'] } }));
    expect(bad.errors.some((e) => e.includes('魅力'))).toBe(true);
  });

  it('属性提升：+2 / +1 +1 / 专长；上限 20；半专长加 1 点属性', () => {
    const r = buildCharacter(
      mk({
        classes: [{ id: 'fighter', level: 8, subclass: 'champion' }],
        abilityScores: scores({ str: 18, dex: 13, con: 14, int: 10, wis: 12, cha: 8 }),
        skills: ['athletics', 'perception'],
        asi: {
          '4': { abilities: { str: 2 } }, // 19 + 2 → 20，浪费 1 点
          '6': { abilities: { con: 1, dex: 1 } },
          '8': { feat: 'athlete', featChoice: { ability: 'dex' } },
        },
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.file.abilities).toMatchObject({ str: 20, con: 16, dex: 16 }); // 人类 +1 在前：str 19 → 20；敏捷 14 → 15（6 级）→ 16（运动员）
    expect(r.file.features).toContain('athlete');
    expect(r.warnings.some((w) => w.includes('上限'))).toBe(true);
    expect(r.info.asi).toEqual([
      { classId: 'fighter', level: 4, summary: '力量+1', auto: false },
      { classId: 'fighter', level: 6, summary: '敏捷+1 体质+1', auto: false },
      { classId: 'fighter', level: 8, summary: '专长：Athlete', auto: false },
    ]);
  });

  it('兼职的属性提升键：起始职业用 "4"，其它职业用 "wizard:4"；坚韧专长给豁免熟练', () => {
    const r = buildCharacter(
      mk({
        background: 'sage',
        classes: [
          { id: 'fighter', level: 4, subclass: 'champion' },
          { id: 'wizard', level: 4, subclass: 'evocation' },
        ],
        abilityScores: scores({ str: 14, dex: 12, con: 14, int: 14, wis: 10, cha: 8 }),
        skills: ['athletics', 'perception'],
        asi: { '4': { abilities: { str: 2 } }, 'wizard:4': { feat: 'resilient', featChoice: { ability: 'wis' } } },
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.file.abilities).toMatchObject({ str: 17, wis: 12 }); // 人类 +1：str 15 → 17；wis 11 → 12
    expect(r.file.saves).toEqual(['str', 'con', 'wis']);
    expect(r.info.asi.map((a) => `${a.classId}:${a.level}`)).toEqual(['fighter:4', 'wizard:4']);
    // 起始职业以外的职业不能用不带职业名的键
    const bad = buildCharacter(mk({ classes: [{ id: 'fighter', level: 3 }, { id: 'wizard', level: 4 }], abilityScores: scores({ int: 14 }), skills: ['athletics', 'perception'], asi: { '4': { abilities: { int: 2 } } } }));
    expect(bad.errors.some((e) => e.includes('"4"'))).toBe(true);
    // 种族加值把属性推过 20 会提示
    const capped = buildCharacter(mk({ race: 'half_orc', abilityScores: scores({ str: 20 }), skills: ['athletics', 'perception'] }));
    expect(capped.file.abilities.str).toBe(20);
    expect(capped.warnings.some((w) => w.includes('上限'))).toBe(true);
  });

  it('非 SRD 子职业有中文名；职业显示串带子职业', () => {
    const r = buildCharacter(mk({ classes: [{ id: 'fighter', level: 3, subclass: 'battle_master' }], skills: ['athletics', 'perception'] }));
    expect(r.errors).toEqual([]);
    expect(r.file.class).toBe('战士（战斗大师） 3');
    expect(SUBCLASSES.find((s) => s.id === 'battle_master')?.source).toBe('odm');
    expect(r.file.features).toContain('precision_attack');
    expect(r.file.resources?.superiority_dice?.max).toBe(4);
  });

  it('专精：盗贼 1 级和 6 级各 2 个，诗人 3 级起', () => {
    const rogue6 = buildCharacter(
      mk({
        classes: [{ id: 'rogue', level: 6, subclass: 'thief' }],
        abilityScores: scores({ dex: 16, con: 12 }),
        skills: ['stealth', 'perception', 'acrobatics', 'investigation'],
        expertise: ['stealth', 'perception', 'acrobatics', 'investigation'],
      })
    );
    expect(rogue6.errors).toEqual([]);
    expect(rogue6.file.expertise).toHaveLength(4);
    const rogue3 = buildCharacter(mk({ classes: [{ id: 'rogue', level: 3, subclass: 'thief' }], skills: ['stealth', 'perception', 'acrobatics', 'investigation'], expertise: ['stealth', 'perception', 'acrobatics'] }));
    expect(rogue3.errors.some((e) => e.includes('专精名额只有 2 个'))).toBe(true);
    const bard1 = buildCharacter(mk({ classes: [{ id: 'bard', level: 1 }], skills: ['persuasion', 'performance', 'deception'], expertise: ['persuasion'] }));
    expect(bard1.errors.some((e) => e.includes('没有专精名额'))).toBe(true);
    const bard3 = buildCharacter(mk({ classes: [{ id: 'bard', level: 3, subclass: 'lore' }], skills: ['persuasion', 'performance', 'deception'], expertise: ['persuasion', 'performance'] }));
    expect(bard3.errors).toEqual([]);
    expect(bard3.file.expertise).toEqual(['performance', 'persuasion']);
    // 专精只能给熟练的技能
    const wrong = buildCharacter(mk({ classes: [{ id: 'rogue', level: 1 }], skills: ['stealth', 'perception', 'acrobatics', 'investigation'], expertise: ['arcana', 'stealth'] }));
    expect(wrong.errors.some((e) => e.includes('不是熟练技能'))).toBe(true);
  });

  it('不给的地方自动选：确定、可复现，并写进 warnings', () => {
    const b = mk({ classes: [{ id: 'rogue', level: 6 }], abilityScores: scores({ dex: 15 }) });
    const a1 = buildCharacter(b);
    const a2 = buildCharacter(b);
    expect(a1).toEqual(a2);
    expect(a1.errors).toEqual([]);
    expect(a1.warnings.some((w) => w.includes('子职业') && w.includes('thief'))).toBe(true);
    expect(a1.warnings.some((w) => w.includes('技能') && w.includes('自动'))).toBe(true);
    expect(a1.warnings.some((w) => w.includes('专精') && w.includes('自动'))).toBe(true);
    expect(a1.warnings.some((w) => w.includes('属性提升') && w.includes('自动'))).toBe(true);
    expect(a1.file.expertise).toHaveLength(4);
    expect(a1.file.skills!.length).toBe(2 + 4); // 侍僧 2 + 盗贼 4
  });

  it('生命值：满骰 / 掷骰 / 平均值；1 级永远满骰', () => {
    const base = mk({ classes: [{ id: 'fighter', level: 3, subclass: 'champion' }], abilityScores: scores({ con: 13 }), skills: ['athletics', 'perception'] });
    // 人类体质 14 → +2；d10：1 级 12，之后每级 6+2
    expect(buildCharacter(base).file.maxHp).toBe(12 + 8 + 8);
    expect(buildCharacter({ ...base, hp: { method: 'max' } }).file.maxHp).toBe(12 + 12 + 12);
    expect(buildCharacter({ ...base, hp: { method: 'rolled', rolls: [3, 10] } }).file.maxHp).toBe(12 + 5 + 12);
    const bad = buildCharacter({ ...base, hp: { method: 'rolled', rolls: [3, 11] } });
    expect(bad.errors.some((e) => e.includes('d10'))).toBe(true);
    // 负体质调整值每级至少 1 点
    const frail = buildCharacter(mk({ classes: [{ id: 'wizard', level: 3, subclass: 'evocation' }], abilityScores: scores({ con: 1 }), race: 'human' }));
    expect(frail.file.maxHp).toBeGreaterThanOrEqual(3);
  });

  it('龙裔：祖先决定抗性和龙息；龙族血脉术士：龙族韧性 +1 生命 / 级，无甲 AC 13 + 敏捷', () => {
    const d = buildCharacter(mk({ race: 'dragonborn', raceOptions: { dragonAncestry: 'blue' }, skills: ['athletics', 'perception'] }));
    expect(d.errors).toEqual([]);
    expect(d.file.resistances).toEqual(['lightning']);
    expect(d.file.features).toContain('draconic_ancestry_blue');
    expect(d.file.resources?.breath_weapon).toMatchObject({ max: 1, recharge: 'short' });
    const s = buildCharacter(
      mk({
        classes: [{ id: 'sorcerer', level: 3, subclass: 'draconic_bloodline' }],
        abilityScores: scores({ dex: 14, con: 14, cha: 15 }),
        options: { dragonAncestor: 'red' },
        skills: ['arcana', 'persuasion'],
      })
    );
    expect(s.errors).toEqual([]);
    expect(s.file.ac).toBe(13 + 2); // 13 + 敏捷 +2（15 点敏捷 +2）
    expect(s.file.maxHp).toBe(6 + 2 + 2 * (4 + 2) + 3); // d6 满 + 体质 +2，2 级各 4+2，龙族韧性 3
    expect(s.file.features).toContain('dragon_ancestor_red');
    expect(s.file.resources?.sorcery_points?.max).toBe(3);
  });

  it('战斗风格：防御 +1 AC（要穿甲）；选项合法性', () => {
    const base = mk({ skills: ['athletics', 'perception'], equipment: { armor: 'chain_mail', shield: true, weapons: ['longsword'] } });
    expect(buildCharacter({ ...base, fightingStyles: ['defense'] }).file.ac).toBe(19);
    expect(buildCharacter({ ...base, fightingStyles: ['dueling'] }).file.ac).toBe(18);
    expect(buildCharacter({ ...base, equipment: { armor: null, shield: false, weapons: ['longsword'] }, fightingStyles: ['defense'] }).file.ac).toBe(10 + 2); // 没穿甲，防御风格不生效；敏捷 14 → +2
    const dup = buildCharacter({ ...base, fightingStyles: ['archery', 'archery'] });
    expect(dup.errors.some((e) => e.includes('名额'))).toBe(true);
    const wrong = buildCharacter(mk({ classes: [{ id: 'paladin', level: 2 }], skills: ['athletics', 'insight'], fightingStyles: ['archery'] }));
    expect(wrong.errors.some((e) => e.includes('不能选'))).toBe(true);
  });
});

describe('施法细节', () => {
  const all14 = scores({ str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 });

  it('牧师 3 / 法师 2：多职业施法者表（施法者等级 5），施法属性不同会提醒', () => {
    const r = buildCharacter(
      mk({
        background: 'sage',
        classes: [
          { id: 'cleric', level: 3, subclass: 'life_domain' },
          { id: 'wizard', level: 2, subclass: 'evocation' },
        ],
        abilityScores: all14,
        skills: ['medicine', 'persuasion'],
      })
    );
    expect(r.errors).toEqual([]);
    expect(Object.fromEntries(Object.entries(r.file.spells!.slots!).map(([k, v]) => [k, v.max]))).toEqual({ '1': 4, '2': 3, '3': 2 });
    expect(r.file.spells?.ability).toBe('wis'); // 第一个施法职业
    expect(r.warnings.some((w) => w.includes('不同的施法属性'))).toBe(true);
    // 每个职业的最高环阶按它自己的表：3 级牧师 2 环，2 级法师 1 环
    expect(r.info.spellcasting!.byClass.cleric.maxSpellLevel).toBe(2);
    expect(r.info.spellcasting!.byClass.wizard.maxSpellLevel).toBe(1);
  });

  it('邪术师 3 / 术士 3：契约位并进总表，并提醒', () => {
    const r = buildCharacter(
      mk({
        classes: [
          { id: 'warlock', level: 3, subclass: 'fiend' },
          { id: 'sorcerer', level: 3, subclass: 'draconic_bloodline' },
        ],
        abilityScores: all14,
        skills: ['arcana', 'deception'],
      })
    );
    expect(r.errors).toEqual([]);
    expect(r.file.spells?.pact).toBeUndefined();
    expect(r.file.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 4, used: 0 } }); // 术士 4/2 + 契约 2 个 2 环
    expect(r.warnings.some((w) => w.includes('契约魔法的法术位已经并进'))).toBe(true);
    expect(r.file.spells?.pactSlots).toEqual({ level: 2, count: 2 }); // 邪术师 3 级：2 个 2 环
    const solo = buildCharacter(mk({ classes: [{ id: 'warlock', level: 3, subclass: 'fiend' }], abilityScores: all14 }));
    expect(solo.file.spells?.pactSlots).toBeUndefined(); // 单职业邪术师走 pact: true，不需要
    expect(actorFromCharacter(r.file, 'x').spells?.pactSlots).toEqual({ level: 2, count: 2 });
  });

  it('1 级没有施法的半施法者：圣武士 / 游侠 1 级不算施法职业', () => {
    const r = buildCharacter(mk({ classes: [{ id: 'wizard', level: 1 }, { id: 'paladin', level: 1 }], abilityScores: scores({ str: 13, int: 13, cha: 13 }), skills: ['arcana', 'history'] }));
    expect(r.errors).toEqual([]);
    expect(Object.keys(r.info.spellcasting!.byClass)).toEqual(['wizard']);
    expect(r.file.spells?.slots).toEqual({ '1': { max: 2, used: 0 } });
    // 纯圣武士 1 级没有 spells
    expect(buildCharacter(mk({ classes: [{ id: 'paladin', level: 1 }], skills: ['athletics', 'insight'] })).file.spells).toBeUndefined();
  });

  it('奥法骑士 / 诡术师：三分之一施法者的位数、戏法、已知数、学派限制', () => {
    const at = buildCharacter(mk({ classes: [{ id: 'rogue', level: 7, subclass: 'arcane_trickster' }], abilityScores: all14, skills: ['stealth', 'perception', 'acrobatics', 'investigation'], expertise: ['stealth', 'perception'] }));
    expect(at.errors).toEqual([]);
    expect(at.file.spells?.slots).toEqual({ '1': { max: 4, used: 0 }, '2': { max: 2, used: 0 } });
    expect(at.info.spellcasting!.byClass.rogue).toMatchObject({ cantripsMax: 3, spellsMax: 5, maxSpellLevel: 2, ability: 'int' });
    expect(at.file.sneakAttackDice).toBe(4);
    // 奥法骑士 3 级：已知 3 个，只有 1 个能在塑能 / 防护以外
    const ek = (known: string[]) => buildCharacter(mk({ classes: [{ id: 'fighter', level: 3, subclass: 'eldritch_knight' }], abilityScores: all14, skills: ['athletics', 'perception'], spells: { known } }));
    expect(ek(['shield', 'magic_missile', 'sleep']).errors).toEqual([]); // 睡眠术是附魔，占那 1 个任意学派名额
    expect(ek(['shield', 'sleep', 'charm_person']).errors.some((e) => e.includes('以外学派'))).toBe(true);
    expect(ek(['shield', 'magic_missile', 'burning_hands', 'thunderwave']).errors.some((e) => e.includes('已知法术最多 3'))).toBe(true);
  });

  it('魔法奥秘和大地结社地貌法术、额外戏法', () => {
    // 6 级学识诗人：额外魔法奥秘 2 个，可以从别的职业表里选（火球术是法师 / 术士的）
    const bard = (known: string[]) =>
      buildCharacter(mk({ classes: [{ id: 'bard', level: 6, subclass: 'lore' }], abilityScores: all14, skills: ['persuasion', 'performance', 'deception'], bonusSkills: ['stealth', 'perception', 'arcana'], spells: { known } }));
    const ok = bard(['healing_word', 'faerie_fire', 'hold_person', 'invisibility', 'fireball', 'counterspell', 'dispel_magic', 'sleep', 'charm_person']);
    expect(ok.errors).toEqual([]);
    const bad = bard(['healing_word', 'faerie_fire', 'hold_person', 'invisibility', 'fireball', 'counterspell', 'fly', 'sleep', 'charm_person']);
    expect(bad.errors.some((e) => e.includes('fly') && e.includes('法术表'))).toBe(true);
    // 5 级大地结社（森林）：地貌法术永久准备；戏法 = 德鲁伊 3 个 + 额外 1 个
    const land = buildCharacter(mk({ classes: [{ id: 'druid', level: 5, subclass: 'land' }], abilityScores: all14, skills: ['nature', 'perception'], options: { landCircle: 'forest' } }));
    expect(land.errors).toEqual([]);
    expect(land.info.spellcasting!.byClass.druid.alwaysPrepared).toEqual(['barkskin', 'spider_climb', 'call_lightning', 'plant_growth']);
    expect(land.info.spellcasting!.byClass.druid.cantripsMax).toBe(4);
    expect(land.file.resources?.natural_recovery?.max).toBe(1);
    // 光明领域白送光亮术
    const light = buildCharacter(mk({ classes: [{ id: 'cleric', level: 1, subclass: 'light_domain' }], skills: ['insight', 'religion'], spells: { cantrips: ['sacred_flame', 'guidance', 'toll_the_dead'] } }));
    expect(light.errors).toEqual([]);
    expect(light.file.spells?.known).toContain('light');
    // 高等精灵的法师戏法
    const elf = buildCharacter(mk({ race: 'high_elf', classes: [{ id: 'fighter', level: 1 }], skills: ['athletics', 'perception'], raceOptions: { cantrip: 'fire_bolt' } }));
    expect(elf.errors).toEqual([]);
    expect(elf.file.spells?.known).toEqual(['fire_bolt']);
    expect(elf.file.spells?.ability).toBe('int');
  });
});

describe('非法输入给 errors', () => {
  const errs = (b: Partial<CharacterBuild>): string[] => buildCharacter(mk(b)).errors;

  it('属性超范围', () => {
    expect(errs({ abilityScores: scores({ str: 0 }) }).some((e) => e.includes('力量') && e.includes('1–20'))).toBe(true);
    expect(errs({ abilityScores: scores({ dex: 21 }) }).some((e) => e.includes('敏捷'))).toBe(true);
    expect(errs({ abilityScores: scores({ con: 12.5 }) }).some((e) => e.includes('体质'))).toBe(true);
    expect(errs({ abilityScores: { str: 10 } as Record<Ability, number> }).length).toBeGreaterThan(0);
  });

  it('等级超范围、总等级超过 20、重复职业', () => {
    expect(errs({ classes: [{ id: 'fighter', level: 21 }] }).some((e) => e.includes('1–20'))).toBe(true);
    expect(errs({ classes: [{ id: 'fighter', level: 0 }] }).length).toBeGreaterThan(0);
    expect(errs({ classes: [{ id: 'fighter', level: 11 }, { id: 'wizard', level: 10 }] }).some((e) => e.includes('总等级 21'))).toBe(true);
    expect(errs({ classes: [{ id: 'fighter', level: 3 }, { id: 'fighter', level: 3 }] }).some((e) => e.includes('出现了两次'))).toBe(true);
    expect(errs({ classes: [] }).length).toBeGreaterThan(0);
  });

  it('未知种族 / 背景 / 职业 / 子职业', () => {
    expect(errs({ race: 'elf_of_doom' }).some((e) => e.includes('未知种族'))).toBe(true);
    expect(errs({ background: 'pirate' }).some((e) => e.includes('未知背景'))).toBe(true);
    expect(errs({ classes: [{ id: 'artificer', level: 3 }] }).some((e) => e.includes('未知职业'))).toBe(true);
    expect(errs({ classes: [{ id: 'fighter', level: 3, subclass: 'berserker' }] }).some((e) => e.includes('子职业'))).toBe(true);
  });

  it('技能选多了、不在职业列表里、重复', () => {
    expect(errs({ skills: ['athletics', 'perception', 'survival'] }).some((e) => e.includes('只能选 2 项'))).toBe(true);
    expect(errs({ skills: ['arcana', 'perception'] }).some((e) => e.includes('只能从'))).toBe(true);
    expect(errs({ skills: ['perception', 'perception'] }).some((e) => e.includes('选了两次'))).toBe(true);
    expect(errs({ skills: ['basket_weaving' as never, 'perception'] }).some((e) => e.includes('未知技能'))).toBe(true);
  });

  it('兼职属性要求（≥13，新旧职业都要满足）', () => {
    const e = errs({ classes: [{ id: 'fighter', level: 1 }, { id: 'wizard', level: 1 }], abilityScores: scores({ str: 13, int: 8 }), race: 'half_orc' });
    expect(e.some((x) => x.includes('兼职要求') && x.includes('法师'))).toBe(true);
    // 起始职业不满足也要报
    const e2 = errs({ classes: [{ id: 'monk', level: 1 }, { id: 'fighter', level: 1 }], abilityScores: scores({ str: 14, dex: 8, wis: 8 }), race: 'half_orc' });
    expect(e2.some((x) => x.includes('武僧'))).toBe(true);
    const ok = buildCharacter(mk({ classes: [{ id: 'fighter', level: 1 }, { id: 'rogue', level: 1 }], abilityScores: scores({ str: 13, dex: 13 }), skills: ['athletics', 'perception'], race: 'human' }));
    expect(ok.errors).toEqual([]);
  });

  it('法术数量 / 环阶 / 职业表', () => {
    const wiz = (spells: Record<string, string[]>, extra: Partial<CharacterBuild> = {}) =>
      buildCharacter(mk({ classes: [{ id: 'wizard', level: 1 }], abilityScores: scores({ int: 14 }), skills: ['arcana', 'history'], spells, ...extra })).errors;
    // 1 级法师：智力 15 → +2，准备 3 个；戏法 3 个
    expect(wiz({ cantrips: ['fire_bolt', 'mage_hand', 'light', 'ray_of_frost'] }).some((e) => e.includes('戏法最多 3'))).toBe(true);
    expect(wiz({ spellbook: ['magic_missile', 'shield', 'sleep', 'burning_hands', 'mage_armor', 'thunderwave'], prepared: ['magic_missile', 'shield', 'sleep', 'burning_hands'] }).some((e) => e.includes('最多准备 3'))).toBe(true);
    expect(wiz({ spellbook: ['magic_missile', 'fireball', 'shield', 'sleep', 'burning_hands', 'mage_armor'] }).some((e) => e.includes('fireball') && e.includes('3 环'))).toBe(true);
    expect(wiz({ spellbook: ['cure_wounds', 'shield', 'sleep', 'burning_hands', 'mage_armor', 'thunderwave'] }).some((e) => e.includes('cure_wounds') && e.includes('法术表'))).toBe(true);
    expect(wiz({ spellbook: ['magic_missile', 'shield', 'sleep', 'burning_hands', 'mage_armor', 'thunderwave'], prepared: ['detect_magic'] }).some((e) => e.includes('不在法术书里'))).toBe(true);
    // 3 级邪术师：2 环位，3 环法术不行
    const lock = buildCharacter(mk({ classes: [{ id: 'warlock', level: 3, subclass: 'fiend' }], skills: ['arcana', 'deception'], spells: { known: ['counterspell'] } }));
    expect(lock.errors.some((e) => e.includes('counterspell'))).toBe(true);
    // 已知型：诗人 1 级已知 4 个
    const bard = buildCharacter(mk({ classes: [{ id: 'bard', level: 1 }], skills: ['persuasion', 'performance', 'deception'], spells: { known: ['healing_word', 'charm_person', 'sleep', 'faerie_fire', 'heroism'] } }));
    expect(bard.errors.some((e) => e.includes('已知法术最多 4'))).toBe(true);
  });

  it('属性提升的写法', () => {
    const f = (asi: CharacterBuild['asi']) => buildCharacter(mk({ classes: [{ id: 'fighter', level: 4, subclass: 'champion' }], skills: ['athletics', 'perception'], asi })).errors;
    expect(f({ '4': { abilities: { str: 3 } } }).some((e) => e.includes('1 或 2'))).toBe(true);
    expect(f({ '4': { abilities: { str: 1 } } }).some((e) => e.includes('必须是 +2'))).toBe(true);
    expect(f({ '5': { abilities: { str: 2 } } }).some((e) => e.includes('"5"'))).toBe(true);
    expect(f({ '4': { abilities: { str: 2 }, feat: 'alert' } }).some((e) => e.includes('二选一'))).toBe(true);
    expect(f({ '4': { feat: 'not_a_feat' } }).some((e) => e.includes('未知专长'))).toBe(true);
    expect(f({ 'fighter:4': { abilities: { dex: 1, con: 1 } } })).toEqual([]);
  });

  it('专长前置条件', () => {
    const r = buildCharacter(mk({ classes: [{ id: 'fighter', level: 4, subclass: 'champion' }], skills: ['athletics', 'perception'], asi: { '4': { feat: 'war_caster' } } }));
    expect(r.errors.some((e) => e.includes('War Caster') && e.includes('前置'))).toBe(true);
    const ok = buildCharacter(mk({ classes: [{ id: 'fighter', level: 4, subclass: 'champion' }], skills: ['athletics', 'perception'], asi: { '4': { feat: 'heavy_armor_master' } } }));
    expect(ok.errors).toEqual([]); // 战士有重甲熟练
    expect(ok.file.abilities.str).toBe(16 + 1);
  });

  it('警告：不熟练的护甲 / 武器、力量要求、元素风格', () => {
    const wizPlate = buildCharacter(mk({ classes: [{ id: 'wizard', level: 1 }], abilityScores: scores({ str: 10 }), skills: ['arcana', 'history'], equipment: { armor: 'plate' } }));
    expect(wizPlate.errors).toEqual([]);
    expect(wizPlate.warnings.some((w) => w.includes('不熟练') && w.includes('板甲'))).toBe(true);
    expect(wizPlate.warnings.some((w) => w.includes('力量 15'))).toBe(true);
    expect(wizPlate.file.ac).toBe(18);
    const wizSword = buildCharacter(mk({ classes: [{ id: 'wizard', level: 1 }], skills: ['arcana', 'history'], equipment: { weapons: ['longsword'] } }));
    expect(wizSword.file.attacks).toEqual([{ weaponId: 'longsword', proficient: false }]);
    expect(wizSword.warnings.some((w) => w.includes('不熟练'))).toBe(true);
    const unknownWeapon = buildCharacter(mk({ skills: ['athletics', 'perception'], equipment: { weapons: ['longsword', 'lightsaber'] } }));
    expect(unknownWeapon.file.attacks).toHaveLength(1);
    expect(unknownWeapon.warnings.some((w) => w.includes('lightsaber'))).toBe(true);
    expect(buildCharacter(mk({ skills: ['athletics', 'perception'], equipment: { armor: 'mithril' } })).errors.some((e) => e.includes('未知护甲'))).toBe(true);
  });

  it('不存在于 SPELLS 的法术放进 warnings 并丢掉，不崩', () => {
    const r = buildCharacter(
      mk({
        classes: [{ id: 'wizard', level: 1 }],
        skills: ['arcana', 'history'],
        abilityScores: scores({ int: 14 }),
        spells: { cantrips: ['fire_bolt', 'mage_hand', 'light'], spellbook: ['magic_missile', 'shield', 'sleep', 'burning_hands', 'mage_armor', 'thunderwave'], prepared: ['magic_missile', 'sleep', 'mage_armor'] },
      })
    );
    expect(r.errors).toEqual([]);
    for (const id of r.file.spells!.known) expect(SPELLS[id]).toBeDefined();
    const dropped = r.info.spellcasting!.droppedSpells;
    for (const id of dropped) expect(SPELLS[id]).toBeUndefined();
    if (dropped.length) expect(r.warnings.some((w) => w.includes('SPELLS 里还没有'))).toBe(true);
    // 乱写的 id 也只是 warning
    const typo = buildCharacter(mk({ classes: [{ id: 'wizard', level: 1 }], skills: ['arcana', 'history'], spells: { cantrips: ['fire_bolt', 'mage_hand', 'definitely_not_a_spell'] } }));
    expect(typo.errors).toEqual([]);
    expect(typo.warnings.some((w) => w.includes('definitely_not_a_spell'))).toBe(true);
  });
});

describe('输出和引擎一致', () => {
  it('buildCharacter 的输出能喂给 actorFromCharacter，字段和 Actor 一致', () => {
    const r = buildCharacter(
      mk({
        race: 'hill_dwarf',
        classes: [{ id: 'cleric', level: 5, subclass: 'life_domain' }],
        abilityScores: scores({ wis: 15, con: 14, dex: 12 }),
        skills: ['medicine', 'persuasion'],
        seat: 'player_b',
        persona: '测试人设',
      })
    );
    expect(r.errors).toEqual([]);
    const a = actorFromCharacter(r.file, 'player_b', 'player_b');
    expect(a.name).toBe(r.file.name);
    expect(a.level).toBe(5);
    expect(a.kind).toBe('pc');
    expect(a.abilities).toEqual(r.file.abilities);
    expect(a.proficiencyBonus).toBe(3);
    expect(a.saves).toEqual(r.file.saves);
    expect(a.skills).toEqual(r.file.skills);
    expect(a.ac).toBe(r.file.ac);
    expect(a.maxHp).toBe(r.file.maxHp);
    expect(a.hp).toBe(r.file.maxHp);
    expect(a.speed).toBe(25);
    expect(a.attacks).toEqual(r.file.attacks);
    expect(a.spells?.ability).toBe('wis');
    expect(a.spells?.known).toEqual(r.file.spells?.known);
    expect(a.spells?.slots[3]).toEqual({ max: 2, used: 0 });
    expect(a.resources.channel_divinity).toMatchObject({ name: '引导神力', max: 1, used: 0, recharge: 'short' });
    expect(a.resistances).toEqual(['poison']);
    expect(a.features).toEqual(r.file.features);
    expect(a.classes).toEqual([{ id: 'cleric', level: 5, subclass: 'life_domain' }]);
    expect(a.race).toBe('hill_dwarf');
    expect(a.background).toBe('acolyte');
    expect(a.size).toBe('Medium');
    expect(a.hitDice).toEqual({ die: 8, total: 5, used: 0 });
    expect(a.persona).toBe('测试人设');
    expect(a.charClass).toBe(r.file.class);
    expect(a.attacksPerAction).toBe(1);
    expect(a.seat).toBe('player_b');
  });

  it('12 个职业 × 1/5/11/20 级：默认全自动也不出错，资源 key 都在约定里', () => {
    for (const id of CLASS_IDS) {
      for (const level of [1, 5, 11, 20]) {
        const r = buildCharacter(mk({ classes: [{ id, level }], abilityScores: scores({ str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 }) }));
        expect(r.errors, `${id} ${level}`).toEqual([]);
        const a = actorFromCharacter(r.file, 'x');
        expect(a.maxHp).toBeGreaterThan(0);
        expect(a.level).toBe(level);
        for (const [key, res] of Object.entries(r.file.resources ?? {})) {
          const spec = RESOURCE_SPECS[key];
          expect(spec, `${id} ${level} 资源 ${key}`).toBeDefined();
          expect(res.max).toBeGreaterThan(0);
          if (key !== 'bardic_inspiration' && key !== 'luck') expect(res.recharge).toBe(spec.recharge);
        }
        // 特性 id 都是 featureId(名字)，没有重复
        expect(new Set(r.file.features).size).toBe(r.file.features!.length);
        for (const f of r.features) expect(f.id).toBe(featureId(f.name));
        expect(r.file.features).toEqual(r.features.map((f) => f.id));
      }
    }
  });

  it('资源按职业等级和属性算：狂暴 2/3/4/5/6/无限，气 = 武僧等级，诗人激励随魅力并在 5 级改短休', () => {
    const rage = (level: number) => buildCharacter(mk({ classes: [{ id: 'barbarian', level }], abilityScores: scores({ str: 15 }) })).file.resources?.rage?.max;
    expect([1, 3, 6, 12, 17, 20].map(rage)).toEqual([2, 3, 4, 5, 6, 99]);
    const bard = (level: number, cha: number) =>
      buildCharacter(mk({ classes: [{ id: 'bard', level }], abilityScores: scores({ cha }), asi: level >= 4 ? { '4': { abilities: { dex: 2 } } } : {} })).file.resources?.bardic_inspiration;
    expect(bard(1, 8)).toMatchObject({ max: 1, recharge: 'long' }); // 魅力调整值至少 1（人类 9 → -1 → 1）
    expect(bard(3, 17)).toMatchObject({ max: 4, recharge: 'long' }); // 魅力 18 → +4
    expect(bard(5, 17)).toMatchObject({ max: 4, recharge: 'short' }); // 5 级起短休恢复
    const cd = (cls: string, level: number) => buildCharacter(mk({ classes: [{ id: cls, level }] })).file.resources?.channel_divinity?.max;
    expect([cd('cleric', 1), cd('cleric', 2), cd('cleric', 6), cd('cleric', 18), cd('paladin', 3), cd('paladin', 20)]).toEqual([undefined, 1, 2, 3, 1, 1]);
    expect(buildCharacter(mk({ classes: [{ id: 'monk', level: 1 }] })).file.resources?.ki).toBeUndefined();
    expect(buildCharacter(mk({ classes: [{ id: 'monk', level: 11 }] })).file.resources?.ki?.max).toBe(11);
    expect(buildCharacter(mk({ classes: [{ id: 'fighter', level: 17 }] })).file.resources).toMatchObject({ action_surge: { max: 2 }, indomitable: { max: 3 }, second_wind: { max: 1 } });
    expect(buildCharacter(mk({ classes: [{ id: 'sorcerer', level: 7 }] })).file.resources?.sorcery_points?.max).toBe(7);
    expect(buildCharacter(mk({ classes: [{ id: 'druid', level: 2 }] })).file.resources?.wild_shape).toMatchObject({ max: 2, recharge: 'short' });
    expect(buildCharacter(mk({ classes: [{ id: 'druid', level: 20 }] })).file.resources?.wild_shape?.max).toBe(99);
    const bm = buildCharacter(mk({ classes: [{ id: 'fighter', level: 7, subclass: 'battle_master' }], skills: ['athletics', 'perception'] }));
    expect(bm.file.resources?.superiority_dice).toMatchObject({ max: 5, recharge: 'short' });
    expect(bm.features.filter((x) => x.source === 'option:maneuver')).toHaveLength(5);
  });
});

describe('引擎特性层认的特性 id', () => {
  // 这些 id 是 src/rules/features/（passive.ts / registry.ts）和 engine.ts 里写死要找的；构建器必须能产出它们。
  const ids = (b: Partial<CharacterBuild>): string[] => buildCharacter(mk({ skills: ['athletics', 'perception'], ...b })).file.features!;

  it('职业特性：战士 / 野蛮人 / 盗贼 / 武僧 / 圣武士 / 牧师 / 诗人 / 法师', () => {
    expect(ids({ classes: [{ id: 'fighter', level: 17, subclass: 'champion' }] })).toEqual(expect.arrayContaining(['second_wind', 'action_surge', 'indomitable', 'improved_critical', 'superior_critical', 'extra_attack']));
    expect(ids({ classes: [{ id: 'barbarian', level: 9, subclass: 'berserker' }] })).toEqual(expect.arrayContaining(['rage', 'reckless_attack', 'danger_sense', 'extra_attack', 'brutal_critical']));
    expect(ids({ classes: [{ id: 'rogue', level: 11, subclass: 'thief' }], skills: ['stealth', 'perception', 'acrobatics', 'investigation'] })).toEqual(
      expect.arrayContaining(['sneak_attack', 'cunning_action', 'evasion', 'uncanny_dodge', 'expertise', 'reliable_talent'])
    );
    expect(ids({ classes: [{ id: 'monk', level: 5, subclass: 'open_hand' }], skills: ['acrobatics', 'stealth'] })).toEqual(
      expect.arrayContaining(['martial_arts', 'flurry_of_blows', 'patient_defense', 'step_of_the_wind', 'stunning_strike', 'extra_attack'])
    );
    expect(ids({ classes: [{ id: 'paladin', level: 6, subclass: 'devotion' }], skills: ['athletics', 'insight'] })).toEqual(expect.arrayContaining(['divine_smite', 'lay_on_hands', 'aura_of_protection', 'channel_divinity']));
    expect(ids({ classes: [{ id: 'cleric', level: 2, subclass: 'life_domain' }], skills: ['insight', 'religion'] })).toEqual(
      expect.arrayContaining(['channel_divinity', 'channel_divinity_preserve_life', 'channel_divinity_turn_undead', 'disciple_of_life'])
    );
    expect(ids({ classes: [{ id: 'bard', level: 2, subclass: undefined }], skills: ['persuasion', 'performance', 'deception'] })).toEqual(expect.arrayContaining(['bardic_inspiration', 'jack_of_all_trades']));
    expect(ids({ classes: [{ id: 'fighter', level: 7, subclass: 'champion' }] })).toContain('remarkable_athlete');
    expect(ids({ classes: [{ id: 'wizard', level: 1 }], skills: ['arcana', 'history'] })).toContain('arcane_recovery');
    expect(ids({ classes: [{ id: 'warlock', level: 2 }], skills: ['arcana', 'deception'], spells: { cantrips: ['eldritch_blast', 'minor_illusion'] }, options: { invocations: ['agonizing_blast', 'devils_sight'] } })).toContain('agonizing_blast');
  });

  it('战斗风格和种族特性', () => {
    for (const style of ['archery', 'defense', 'dueling', 'great_weapon_fighting', 'two_weapon_fighting']) {
      expect(ids({ fightingStyles: [style] })).toContain('fighting_style_' + style);
    }
    expect(ids({ race: 'lightfoot_halfling' })).toEqual(expect.arrayContaining(['halfling_luck', 'brave']));
    expect(ids({ race: 'hill_dwarf' })).toContain('dwarven_resilience');
    expect(ids({ race: 'rock_gnome' })).toContain('gnome_cunning');
    expect(ids({ race: 'half_elf', raceOptions: { abilityBonuses: ['dex', 'con'], skills: ['stealth', 'insight'] } })).toContain('fey_ancestry');
    expect(ids({ race: 'half_orc' })).toEqual(expect.arrayContaining(['relentless_endurance', 'savage_attacks']));
    expect(ids({ race: 'dragonborn', raceOptions: { dragonAncestry: 'red' } })).toEqual(expect.arrayContaining(['breath_weapon', 'draconic_ancestry_red']));
  });
});

describe('构建出来的角色在引擎里能用', () => {
  function seat(builds: CharacterBuild[]) {
    const rolls = new ScriptedRollSource();
    const engine = new RulesEngine({ rollSource: rolls });
    const actors = builds.map((b, i) => {
      const r = buildCharacter(b);
      expect(r.errors).toEqual([]);
      const a = actorFromCharacter(r.file, `pc${i}`, i === 0 ? 'player_a' : 'player_b');
      a.position = { col: 5 - i, row: 5 };
      engine.addActor(a);
      return a;
    });
    const goblin = spawnMonster('goblin', 'g');
    goblin.hp = 300;
    goblin.maxHp = 300;
    goblin.position = { col: 6, row: 5 };
    engine.addActor(goblin);
    engine.combat = { active: true, round: 1, order: [...actors.map((a) => ({ actorId: a.id, initiative: 10, dex: 10 })), { actorId: goblin.id, initiative: 1, dex: 10 }], index: 0 };
    for (const a of actors) engine.beginTurn(a.id);
    return { engine, rolls, actors, goblin };
  }

  it('武僧：徒手打击 1d6+4，疾风连击花气、两次打击', async () => {
    const { engine, rolls, actors, goblin } = seat([
      mk({ background: 'hermit', classes: [{ id: 'monk', level: 5, subclass: 'open_hand' }], abilityScores: scores({ str: 10, dex: 16, con: 14, wis: 14 }), skills: ['acrobatics', 'stealth'], asi: { '4': { abilities: { dex: 2 } } } }),
    ]);
    const monk = actors[0];
    expect(engine.attackMath(monk, monk.attacks.find((a) => a.name === '徒手打击')!).damageFormula).toBe('1d6+4');
    rolls.d20.push(2, 2);
    await engine.attackAction(monk.id, goblin.id, '徒手打击');
    rolls.d20.push(2, 2);
    const flurry = await engine.useFeature(monk.id, 'flurry_of_blows', { targetId: goblin.id });
    expect(flurry.attacks).toHaveLength(2);
    expect(engine.resourceLeft(monk, 'ki')).toBe(4);
  });

  it('战士回气 / 动作如潮，野蛮人狂暴，圣武士圣疗，牧师保全生命', async () => {
    const { engine, actors } = seat([
      mk({ background: 'soldier', classes: [{ id: 'fighter', level: 5, subclass: 'champion' }], skills: ['perception', 'survival'] }),
      mk({ race: 'half_orc', classes: [{ id: 'barbarian', level: 5, subclass: 'berserker' }], skills: ['perception', 'nature'] }),
    ]);
    const [fighter, barb] = actors;
    fighter.hp = 5;
    const sw = await engine.useFeature(fighter.id, 'second_wind', {});
    expect(sw.ok).toBe(true);
    expect(fighter.hp).toBeGreaterThan(5);
    expect(engine.resourceLeft(fighter, 'second_wind')).toBe(0);
    await engine.useFeature(fighter.id, 'action_surge', {});
    expect(engine.resourceLeft(fighter, 'action_surge')).toBe(0);
    await engine.useFeature(barb.id, 'rage', {});
    expect(engine.resourceLeft(barb, 'rage')).toBe(2); // 5 级 3 次
    expect(engine.isRaging(barb)).toBe(true);

    const pair = seat([
      mk({ background: 'noble', classes: [{ id: 'paladin', level: 5, subclass: 'devotion' }], skills: ['athletics', 'persuasion'] }),
      mk({ race: 'hill_dwarf', classes: [{ id: 'cleric', level: 5, subclass: 'life_domain' }], abilityScores: scores({ wis: 15 }), skills: ['medicine', 'persuasion'] }),
    ]);
    const [pal, cleric] = pair.actors;
    cleric.hp = 3;
    const loh = await pair.engine.useFeature(pal.id, 'lay_on_hands', { targetId: cleric.id, amount: 10 });
    expect(loh.ok).toBe(true);
    expect(pair.engine.resourceLeft(pal, 'lay_on_hands')).toBe(15);
    pal.hp = 1;
    pair.engine.beginTurn(cleric.id);
    const pl = await pair.engine.useFeature(cleric.id, 'preserve_life', { distribution: { [pal.id]: 5 } });
    expect(pl.ok).toBe(true);
    expect(pal.hp).toBe(6);
  });
});

describe('数据完整性', () => {
  it('默认法术偏好表里的每个 id 都在 PHB 法术表里，环阶和职业对得上', () => {
    for (const [key, pref] of Object.entries(DEFAULT_SPELLS)) {
      const list = key === 'eldritch_knight' || key === 'arcane_trickster' ? 'wizard' : key;
      for (const id of pref!.cantrips) {
        expect(SPELL_CLASS_LIST[id], `${key} 戏法 ${id}`).toBeDefined();
        expect(SPELL_CLASS_LIST[id][0], `${key} ${id} 环阶`).toBe(0);
        expect(SPELL_CLASS_LIST[id][1].split(','), `${key} ${id} 职业`).toContain(list);
      }
      for (const [lv, ids] of Object.entries(pref!.levels)) {
        for (const id of ids) {
          expect(SPELL_CLASS_LIST[id], `${key} ${lv} 环 ${id}`).toBeDefined();
          expect(SPELL_CLASS_LIST[id][0], `${key} ${id} 环阶`).toBe(Number(lv));
          expect(SPELL_CLASS_LIST[id][1].split(','), `${key} ${id} 职业`).toContain(list);
        }
      }
    }
  });

  it('每个职业 × 每个子职业 20 级：不出错，所有特性都在 FEATURE_CATALOG 里且有说明', () => {
    let combos = 0;
    for (const id of CLASS_IDS) {
      const subs = SUBCLASSES.filter((s) => s.classId === id);
      expect(subs.length, `${id} 至少有一个子职业`).toBeGreaterThan(0);
      expect(subs.some((s) => s.source === 'srd'), `${id} 有 SRD 子职业`).toBe(true);
      for (const s of subs) {
        const r = buildCharacter(mk({ classes: [{ id, level: 20, subclass: s.id }], abilityScores: scores({ str: 14, dex: 14, con: 14, int: 14, wis: 14, cha: 14 }) }));
        expect(r.errors, `${id}/${s.id}`).toEqual([]);
        for (const f of r.features) {
          const e = FEATURE_CATALOG[f.id];
          expect(e, `${id}/${s.id} 特性 ${f.id}`).toBeDefined();
          expect(e.text.length, `${f.id} 说明`).toBeGreaterThan(3);
          expect(f.text.length, `${f.id} 个人说明`).toBeGreaterThan(3);
        }
        combos += 1;
      }
    }
    expect(combos).toBe(SUBCLASSES.length);
  });

  it('种族 / 背景 / 子职业的数据范围和出处标注', () => {
    expect(Object.keys(RACES).sort()).toEqual(
      ['dragonborn', 'drow', 'forest_gnome', 'half_elf', 'half_orc', 'high_elf', 'hill_dwarf', 'human', 'lightfoot_halfling', 'mountain_dwarf', 'rock_gnome', 'stout_halfling', 'tabaxi', 'tiefling', 'triton', 'variant_human', 'wood_elf'].sort()
    );
    expect(Object.values(RACES).filter((r) => r.source === 'custom').map((r) => r.id).sort()).toEqual(['tabaxi', 'triton']);
    const odmRaces = Object.values(RACES).filter((r) => r.source === 'odm').map((r) => r.id).sort();
    expect(odmRaces).toEqual(['drow', 'forest_gnome', 'mountain_dwarf', 'stout_halfling', 'variant_human', 'wood_elf']);
    expect(Object.keys(BACKGROUNDS)).toHaveLength(13);
    const srdSubs = SUBCLASSES.filter((s) => s.source === 'srd').map((s) => `${s.classId}/${s.id}`).sort();
    expect(srdSubs).toEqual(
      ['barbarian/berserker', 'bard/lore', 'cleric/life_domain', 'druid/land', 'fighter/champion', 'monk/open_hand', 'paladin/devotion', 'ranger/hunter', 'rogue/thief', 'sorcerer/draconic_bloodline', 'warlock/fiend', 'wizard/evocation'].sort()
    );
    expect(Object.keys(CLASS_DEFS)).toHaveLength(12);
    expect(Object.keys(CLASS_DEFS)).not.toContain('artificer');
    // 每个种族每个亚种都能构建
    for (const id of Object.keys(RACES)) {
      const r = buildCharacter(mk({ race: id, skills: ['athletics', 'perception'] }));
      expect(r.errors, id).toEqual([]);
    }
    for (const id of Object.keys(BACKGROUNDS)) {
      const r = buildCharacter(mk({ background: id, skills: ['athletics', 'perception'] }));
      expect(r.errors, id).toEqual([]);
    }
  });

  it('子职业输入可以用 id / 英文名 / 别名', () => {
    for (const sub of ['life_domain', 'Life Domain', 'life-domain', 'life']) {
      const r = buildCharacter(mk({ classes: [{ id: 'cleric', level: 1, subclass: sub }], skills: ['insight', 'religion'] }));
      expect(r.errors, sub).toEqual([]);
      expect(r.file.classes?.[0].subclass).toBe('life_domain');
    }
  });

  it('目录里同 id 出处不同、说明不同的，都已经换成通用说明', () => {
    for (const id of Object.keys(CATALOG_COLLISIONS)) {
      expect(FEATURE_CATALOG[id], id).toBeDefined();
    }
    expect(FEATURE_CATALOG.spellcasting.text).toContain('class');
    expect(FEATURE_CATALOG.fighting_style_archery.name).toBe('Fighting Style: Archery');
    expect(FEATURE_CATALOG.rage.zh).toBe('狂暴');
    expect(FEATURE_CATALOG.second_wind.source).toBe('class:fighter');
    expect(FEATURE_CATALOG.darkvision.source).toMatch(/^race:/);
    expect(FEATURE_CATALOG.agonizing_blast.source).toBe('option:invocation');
  });
});

describe('loadParty 读新格式 build', () => {
  function vault(files: Record<string, unknown>): string {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-vault-'));
    mkdirSync(join(dir, 'characters'));
    for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, 'characters', name), typeof content === 'string' ? content : JSON.stringify(content));
    return dir;
  }

  const fighter = { name: '新战士', race: 'human', background: 'soldier', classes: [{ id: 'fighter', level: 3, subclass: 'champion' }], abilityScores: scores({ str: 15, dex: 13, con: 14 }), skills: ['athletics', 'perception'], persona: '构建里的人设' };
  const wizard = { name: '新法师', race: 'high_elf', background: 'sage', classes: [{ id: 'wizard', level: 3, subclass: 'evocation' }], abilityScores: scores({ int: 15, dex: 14, con: 13 }) };

  it('json 里有 build 字段就走构建器，errors / warnings 并进 PartyRuntime.warnings', () => {
    const dir = vault({ 'player_a.json': { build: fighter }, 'player_b.json': { build: wizard, persona: '顶层人设覆盖' } });
    try {
      const party = loadParty(dir);
      expect(party.source).toBe('vault');
      expect(party.a.name).toBe('新战士');
      expect(party.a.level).toBe(3);
      expect(party.a.seat).toBe('player_a');
      expect(party.a.persona).toBe('构建里的人设');
      expect(party.a.classes).toEqual([{ id: 'fighter', level: 3, subclass: 'champion' }]);
      expect(party.a.attacksPerAction).toBe(1);
      expect(party.b.name).toBe('新法师');
      expect(party.b.persona).toBe('顶层人设覆盖');
      expect(party.b.spells?.slots[2]).toEqual({ max: 2, used: 0 });
      expect(party.warnings.some((w) => w.includes('player_b.json（build）'))).toBe(true); // 法术自动选择的 warning
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('build 有 errors：这个座位退回内置草稿，错误写进 warnings', () => {
    const dir = vault({ 'player_a.json': { build: { ...fighter, abilityScores: scores({ str: 0 }) } }, 'player_b.json': { build: wizard } });
    try {
      const party = loadParty(dir);
      expect(party.source).toBe('default');
      expect(party.a.name).toBe('薇克丝'); // 内置草稿
      expect(party.b.name).toBe('新法师');
      expect(party.warnings.some((w) => w.includes('错误') && w.includes('力量'))).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('旧格式（整张卡）照旧能用，和 build 可以混着放', () => {
    const old = {
      name: '老角色',
      abilities: { str: 10, dex: 12, con: 12, int: 10, wis: 10, cha: 10 },
      ac: 12,
      maxHp: 11,
      level: 1,
      class: '老卡',
    };
    const dir = vault({ 'player_a.json': old, 'player_b.json': { build: wizard } });
    try {
      const party = loadParty(dir);
      expect(party.source).toBe('vault');
      expect(party.a.name).toBe('老角色');
      expect(party.a.maxHp).toBe(11);
      expect(party.b.name).toBe('新法师');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // 没有文件：内置草稿
    const empty = mkdtempSync(join(tmpdir(), 'trpg-vault-'));
    try {
      const party = loadParty(empty);
      expect(party.source).toBe('default');
      expect(party.a.name).toBe('薇克丝');
      expect(party.warnings).toEqual([]);
    } finally {
      rmSync(empty, { recursive: true, force: true });
    }
  });

  it('没有 persona 会提示，build.seat 缺省按文件名补', () => {
    const noPersona = { ...fighter } as Record<string, unknown>;
    delete noPersona.persona;
    const dir = vault({ 'player_a.json': { build: noPersona }, 'player_b.json': { build: wizard } });
    try {
      const party = loadParty(dir);
      expect(party.a.persona).toBeUndefined();
      expect(party.warnings.some((w) => w.includes('没有 persona'))).toBe(true);
      expect(party.a.seat).toBe('player_a');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('杂项', () => {
  it('README 里标了 test:build 的示例 json 都能构建、没有 errors', () => {
    const md = readFileSync(new URL('../src/rules/build/README.md', import.meta.url), 'utf8');
    const re = /<!-- test:build -->\s*```json\r?\n([\s\S]*?)```/g;
    const blocks = [...md.matchAll(re)].map((m) => JSON.parse(m[1]) as Record<string, unknown>);
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    for (const b of blocks) {
      const r = buildCharacter((b.build ?? b) as CharacterBuild);
      expect(r.errors, JSON.stringify(b).slice(0, 60)).toEqual([]);
    }
  });

  it('abilityMod 约定和构建器一致（单调、向下取整）', () => {
    expect(ABILITIES.map((a) => abilityMod({ str: 8, dex: 9, con: 10, int: 11, wis: 20, cha: 1 }[a]))).toEqual([-1, -1, 0, 0, 5, -5]);
  });

  it('输入对象不会被修改', () => {
    const b = mk({ skills: ['athletics', 'perception'], asi: {}, classes: [{ id: 'fighter', level: 4 }] });
    const snapshot = JSON.stringify(b);
    buildCharacter(b);
    expect(JSON.stringify(b)).toBe(snapshot);
  });
});

describe('Triton / Tabaxi（非 SRD 的补充种族）和两张当前角色卡', () => {
  const vespoi = (): CharacterBuild => ({
    name: '维斯坡伊',
    race: 'triton',
    background: 'acolyte',
    classes: [{ id: 'cleric', level: 1, subclass: 'life_domain' }],
    abilityScores: scores({ str: 11, dex: 9, con: 16, int: 11, wis: 17, cha: 15 }),
    skills: ['medicine', 'persuasion'],
    equipment: { armor: 'chain_mail', shield: true, weapons: ['mace'] },
    spells: { cantrips: ['sacred_flame', 'guidance', 'spare_the_dying'], prepared: ['healing_word', 'guiding_bolt', 'shield_of_faith', 'sanctuary'] },
  });
  const sapertefi = (): CharacterBuild => ({
    name: '萨珀特菲',
    race: 'tabaxi',
    background: 'outlander',
    classes: [{ id: 'barbarian', level: 1 }],
    abilityScores: scores({ str: 17, dex: 11, con: 18, int: 10, wis: 10, cha: 8 }),
    skills: ['intimidation', 'nature'],
    equipment: { armor: null, weapons: ['greataxe', 'javelin'] },
  });

  it('维斯坡伊（Triton 生命牧师 1）和角色卡一致：属性 / HP / AC / 豁免 / 技能 / 法术位 / 抗性 / 游泳', () => {
    const r = buildCharacter(vespoi());
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.abilities).toEqual({ str: 12, dex: 9, con: 17, int: 11, wis: 17, cha: 16 }); // 种族 +1 力量 / 体质 / 魅力
    expect(f.maxHp).toBe(11); // d8 满骰 8 + 体质 +3
    expect(f.ac).toBe(18); // 链甲 16 + 盾 2
    expect(f.saves).toEqual(['wis', 'cha']);
    expect([...(f.skills ?? [])].sort()).toEqual(['insight', 'medicine', 'persuasion', 'religion']);
    expect(f.swimSpeed).toBe(30);
    expect(f.resistances).toEqual(['cold']);
    expect(f.spells?.slots).toEqual({ '1': { max: 2, used: 0 } });
    // 戏法 3 个 + 准备 4 个 + 领域法术（祝福术、疗伤术）
    expect(f.spells?.known).toEqual(expect.arrayContaining(['sacred_flame', 'guidance', 'spare_the_dying', 'healing_word', 'guiding_bolt', 'shield_of_faith', 'sanctuary', 'bless', 'cure_wounds']));
    expect(f.features).toEqual(expect.arrayContaining(['amphibious', 'control_air_and_water', 'emissary_of_the_sea', 'guardians_of_the_depths', 'disciple_of_life']));
  });

  it('力量不够穿重甲：步行速度 -10 尺，游泳速度不动（维斯坡伊 力量 12 穿链甲 → 20 尺）', () => {
    const r = buildCharacter(vespoi());
    expect(r.file.speed).toBe(20);
    expect(r.file.swimSpeed).toBe(30);
    expect(r.warnings.some((w) => w.includes('要求力量 13') && w.includes('已扣'))).toBe(true);
    // 力量够了就不扣
    const strong = buildCharacter({ ...vespoi(), abilityScores: scores({ str: 12, dex: 9, con: 16, int: 11, wis: 17, cha: 15 }) });
    expect(strong.file.speed).toBe(30);
    // 矮人的速度不受重甲影响：力量 8 的丘陵矮人穿链甲仍是 25 尺
    const dwarf = buildCharacter(mk({ race: 'hill_dwarf', classes: [{ id: 'cleric', level: 1, subclass: 'life_domain' }], abilityScores: scores({ str: 8, wis: 15 }), skills: ['medicine', 'persuasion'], equipment: { armor: 'chain_mail', weapons: ['mace'] } }));
    expect(dwarf.errors).toEqual([]);
    expect(dwarf.file.speed).toBe(25);
    expect(dwarf.warnings.some((w) => w.includes('矮人的速度不受重甲影响'))).toBe(true);
  });

  it('萨珀特菲（Tabaxi 野蛮人 1）和角色卡一致：属性 / HP / 无甲 AC / 技能 / 狂暴 / 猫爪', () => {
    const r = buildCharacter(sapertefi());
    expect(r.errors).toEqual([]);
    const f = r.file;
    expect(f.abilities).toEqual({ str: 17, dex: 13, con: 18, int: 10, wis: 10, cha: 9 }); // 种族 +2 敏捷 +1 魅力
    expect(f.maxHp).toBe(16); // d12 满骰 12 + 体质 +4
    expect(f.ac).toBe(15); // 无甲防御 10 + 敏捷 +1 + 体质 +4
    expect(f.saves).toEqual(['str', 'con']);
    expect([...(f.skills ?? [])].sort()).toEqual(['athletics', 'intimidation', 'nature', 'perception', 'stealth', 'survival']);
    expect(f.resources?.rage).toMatchObject({ max: 2, recharge: 'long' });
    expect(f.speed).toBe(30);
    expect(f.attacks?.map((a) => a.weaponId)).toEqual(['greataxe', 'javelin', 'claws']);
    expect(f.attacks?.find((a) => a.weaponId === 'claws')?.name).toBe('猫爪');
    expect(f.features).toEqual(expect.arrayContaining(['darkvision', 'cats_talent', 'feline_agility', 'cats_claws', 'rage', 'unarmored_defense']));
  });

  it('猫爪是天生武器：1d4 挥砍，加力量调整值，引擎里能打出来', () => {
    const r = buildCharacter(sapertefi());
    const engine = new RulesEngine({ rollSource: new ScriptedRollSource() });
    const a = actorFromCharacter(r.file, 'player_b', 'player_b');
    engine.addActor(a);
    const claws = a.attacks.find((x) => x.weaponId === 'claws')!;
    const math = engine.attackMath(a, claws);
    expect(math.damageFormula).toBe('1d4+3'); // 力量 17 → +3
    expect(math.damageType).toBe('slashing');
    expect(math.attackBonus).toBe(5); // 力量 +3 + 熟练 +2
  });

  it('两个角色都能进 actorFromCharacter，游泳速度带过去', () => {
    const a = actorFromCharacter(buildCharacter(vespoi()).file, 'player_a', 'player_a');
    expect(a.swimSpeed).toBe(30);
    expect(a.race).toBe('triton');
    const b = actorFromCharacter(buildCharacter(sapertefi()).file, 'player_b', 'player_b');
    expect(b.swimSpeed ?? 0).toBe(0);
    expect(b.race).toBe('tabaxi');
  });
});
