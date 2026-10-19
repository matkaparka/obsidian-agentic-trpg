// 特性目录：特性 id → 英文名、中文名、出处、获得等级、一句话说明。给提示词 / 面板展示用。
// id 全部由 contract.ts 的 featureId(英文名) 生成。同一个 id 出现在多处（额外攻击、神圣打击…）时，
// 目录里只留第一处（说明相同或相近）；某个角色实际拿到的精确说明在 BuildResult.features 里。
import { featureId } from '../contract.js';
import { PLACEHOLDER_FEATURES, CLASS_DEFS } from './data/classes.js';
import { FIGHTING_STYLES } from './data/equipment.js';
import { RACE_DEFS, DRACONIC_ANCESTRY } from './data/races.js';
import type { DataSource } from './data/schema.js';
import { OPTION_DEFS } from './data/options.gen.js';
import { FEATS } from './data/feats.js';
import { BACKGROUND_DEFS } from './data/backgrounds.gen.js';
import { SUBCLASSES } from './lookup.js';

export interface CatalogEntry {
  /** 英文名（带选择的写成 "Fighting Style: Dueling" 这种） */
  name: string;
  zh?: string;
  /** class:fighter | subclass:champion | race:hill_dwarf | background:soldier | fighting_style | feat | option:invocation */
  source: string;
  /** 获得时的职业等级（种族 / 背景 / 战斗风格 = 1） */
  level: number;
  text: string;
  /** 数据出处：srd = SRD 5.1；odm = ODM 用自己的话复述的 2014 机制；custom = 非 SRD 的官方补充种族（Triton、Tabaxi） */
  data: DataSource;
}

export const FEATURE_CATALOG: Record<string, CatalogEntry> = {};
/** 同一个 id 在不同出处下说明不一样的（开发时看用）：id → 出处列表 */
export const CATALOG_COLLISIONS: Record<string, string[]> = {};

function reg(name: string, zh: string | undefined, text: string, source: string, level: number, data: DataSource): void {
  const id = featureId(name);
  if (!id) return;
  const existing = FEATURE_CATALOG[id];
  if (existing) {
    if (existing.text !== text) (CATALOG_COLLISIONS[id] ??= [existing.source]).push(source);
    return;
  }
  FEATURE_CATALOG[id] = { name, ...(zh ? { zh } : {}), source, level, text, data };
}

const cap1 = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

// 种族 → 职业 → 子职业 → 专长 → 选项 → 背景（先注册的优先）
for (const r of RACE_DEFS) for (const t of r.traits) reg(t.name, t.zh, t.text, `race:${r.id}`, 1, r.source);
for (const [id, a] of Object.entries(DRACONIC_ANCESTRY)) {
  const text = `${cap1(id)} dragon ancestry: breath weapon and resistance use ${a.damage}; ${a.shape}, ${a.save.toUpperCase()} save.`;
  reg(`Draconic Ancestry: ${cap1(id)}`, `龙族先祖：${a.zh}`, text, 'race:dragonborn', 1, 'srd');
  reg(`Dragon Ancestor: ${cap1(id)}`, `龙族先祖：${a.zh}`, text, 'subclass:draconic_bloodline', 1, 'srd');
}
for (const b of BACKGROUND_DEFS) reg(b.feature, undefined, b.featureText, `background:${b.id}`, 1, 'srd');

for (const c of Object.values(CLASS_DEFS)) {
  for (const [lv, list] of Object.entries(c.features)) {
    for (const f of list) if (!PLACEHOLDER_FEATURES.has(f.name)) reg(f.name, f.zh, f.text, `class:${c.id}`, Number(lv), 'srd');
  }
}
for (const s of SUBCLASSES) {
  for (const [lv, list] of Object.entries(s.features)) {
    for (const f of list) reg(f.name, f.zh, f.text, `subclass:${s.id}`, Number(lv), s.source);
  }
}
for (const s of Object.values(FIGHTING_STYLES)) reg(`Fighting Style: ${s.name}`, `战斗风格：${s.zh}`, s.text, 'fighting_style', 1, 'srd');
for (const f of Object.values(FEATS)) reg(f.name, f.zh, f.text, 'feat', 1, 'odm');
for (const o of OPTION_DEFS) reg(o.name, undefined, o.text, `option:${o.kind}`, 1, 'odm');

/**
 * 同一个 id 在不同职业 / 子职业里说明不一样的，目录里改用不偏向任何一边的通用说明
 * （某个角色实际拿到的精确说明在 BuildResult.features 里）。
 */
const GENERIC: Record<string, { zh?: string; text: string }> = {
  spellcasting: { zh: '施法', text: 'You cast spells from your class spell list using your spellcasting ability; slots, cantrips and spells known or prepared depend on the class.' },
  channel_divinity: { zh: '引导神力', text: 'Channel divine energy a limited number of times per short or long rest to fuel your class and subclass options (clerics gain more uses with level).' },
  unarmored_defense: { zh: '无甲防御', text: 'Without armor your AC is 10 + Dexterity modifier + a second ability modifier (Constitution for barbarians, Wisdom for monks).' },
  timeless_body: { zh: '永恒之躯', text: 'You age much more slowly than other creatures and suffer no frailty of old age.' },
  extra_attack: { zh: '额外攻击', text: 'You can attack more than once (two attacks; fighters later get three and four) when you take the Attack action.' },
  expertise: { zh: '专精', text: "Double your proficiency bonus for two chosen skills (rogues may swap one for thieves' tools)." },
  bonus_proficiencies: { zh: '额外熟练', text: 'Your subclass grants extra skill, tool, weapon or armor proficiencies.' },
  bonus_proficiency: { zh: '额外熟练', text: 'Your subclass grants an extra proficiency (an armor type, a weapon type or a skill).' },
  bonus_cantrip: { zh: '额外戏法', text: 'Your subclass teaches you one extra cantrip.' },
  divine_strike: { zh: '神圣打击', text: 'Once per turn a weapon hit deals extra damage of a type set by your domain (1d8, 2d8 from 14th level).' },
  lands_stride: { zh: '林地行者', text: 'Nonmagical difficult terrain costs you no extra movement and plants cannot hinder you.' },
  psychic_blades: { zh: '心灵之刃', text: 'Your subclass lets you attack with blades of psychic energy that deal psychic damage.' },
  psionic_power: { zh: '灵能', text: 'You hold a pool of psionic energy dice that fuel your subclass abilities.' },
  channel_divinity_guided_strike: { zh: '引导神力：引导打击', text: 'Channel Divinity: add +10 to an attack roll after seeing the d20 result.' },
};
for (const [id, g] of Object.entries(GENERIC)) {
  const e = FEATURE_CATALOG[id];
  if (e) FEATURE_CATALOG[id] = { ...e, ...(g.zh ? { zh: g.zh } : {}), text: g.text };
}

/** 目录里的一项（找不到返回 undefined）。 */
export const featureInfo = (id: string): CatalogEntry | undefined => FEATURE_CATALOG[id];
