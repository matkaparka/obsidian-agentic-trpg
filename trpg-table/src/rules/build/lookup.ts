// 数据查找：职业、子职业、种族、背景、专长、选项。输入的 id 都先规范化（小写、去撇号、非字母数字变下划线），
// 所以 "Life Domain" / "life-domain" / "life_domain" 是同一个东西。
import { CLASS_IDS, type ClassId } from '../contract.js';
import { CLASS_DEFS } from './data/classes.js';
import { BACKGROUND_DEFS } from './data/backgrounds.gen.js';
import { FEATS } from './data/feats.js';
import { ODM_SUBCLASSES } from './data/odm-subclasses.gen.js';
import { OPTION_DEFS } from './data/options.gen.js';
import { RACE_DEFS } from './data/races.js';
import type { BackgroundDef, ClassDef, OptionDef, OptionKind, RaceDef, SubclassDef } from './data/schema.js';
import { SRD_SUBCLASSES } from './data/srd-subclasses.js';
import { SUBCLASS_ZH } from './data/subclass-zh.js';

export const normId = (s: string): string =>
  s
    .trim()
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

/** 法术名 → id（和 SPELLS 的 key 同一种写法：Tasha's Hideous Laughter → tashas_hideous_laughter）。 */
export const spellId = normId;

export function isClassId(id: string): id is ClassId {
  return (CLASS_IDS as readonly string[]).includes(id);
}

export function findClass(input: string): ClassDef | undefined {
  const id = normId(input);
  return isClassId(id) ? CLASS_DEFS[id] : undefined;
}

// ---------------------------------------------------------------- 种族
export const RACES: Record<string, RaceDef> = Object.fromEntries(RACE_DEFS.map((r) => [r.id, r]));

export function findRace(input: string): RaceDef | undefined {
  const id = normId(input);
  if (RACES[id]) return RACES[id];
  // 常见写法：dwarf_hill、hill dwarf、elf_high
  const m = /^(dwarf|elf|halfling|gnome)_(hill|mountain|high|wood|drow|lightfoot|stout|rock|forest)$/.exec(id);
  if (m) return RACES[`${m[2]}_${m[1]}`];
  return undefined;
}

// ---------------------------------------------------------------- 背景
const BACKGROUND_ZH: Record<string, string> = {
  acolyte: '侍僧',
  charlatan: '骗子',
  criminal: '罪犯',
  entertainer: '艺人',
  folk_hero: '平民英雄',
  guild_artisan: '公会工匠',
  hermit: '隐士',
  noble: '贵族',
  outlander: '化外之民',
  sage: '贤者',
  sailor: '水手',
  soldier: '士兵',
  urchin: '街头顽童',
};

export interface BackgroundInfo extends BackgroundDef {
  zh: string;
}

export const BACKGROUNDS: Record<string, BackgroundInfo> = Object.fromEntries(
  BACKGROUND_DEFS.map((b) => [b.id, { ...b, zh: BACKGROUND_ZH[b.id] ?? b.name }])
);

export function findBackground(input: string): BackgroundInfo | undefined {
  return BACKGROUNDS[normId(input)];
}

// ---------------------------------------------------------------- 子职业
export const SUBCLASSES: SubclassDef[] = [...SRD_SUBCLASSES, ...ODM_SUBCLASSES].map((s) => (s.zh ? s : { ...s, ...(SUBCLASS_ZH[`${s.classId}/${s.id}`] ? { zh: SUBCLASS_ZH[`${s.classId}/${s.id}`] } : {}) }));

export function subclassesOf(classId: string): SubclassDef[] {
  return SUBCLASSES.filter((s) => s.classId === classId);
}

/** 按 id / 英文名 / 别名找子职业。 */
export function findSubclass(classId: string, input: string): SubclassDef | undefined {
  const want = normId(input);
  if (!want) return undefined;
  return subclassesOf(classId).find((s) => s.id === want || normId(s.name) === want || s.aliases.some((a) => normId(a) === want));
}

/** 没指定子职业时的默认：SRD 里有的那个。 */
export function defaultSubclass(classId: string): SubclassDef | undefined {
  return subclassesOf(classId).find((s) => s.source === 'srd');
}

// ---------------------------------------------------------------- 专长 / 选项
export { FEATS };

export function findFeat(input: string) {
  return FEATS[normId(input)];
}

const OPTION_BY_KIND = new Map<OptionKind, OptionDef[]>();
for (const o of OPTION_DEFS) {
  const list = OPTION_BY_KIND.get(o.kind) ?? [];
  list.push(o);
  OPTION_BY_KIND.set(o.kind, list);
}

export function optionsOfKind(kind: OptionKind): OptionDef[] {
  return OPTION_BY_KIND.get(kind) ?? [];
}

export function findOption(kind: OptionKind, input: string): OptionDef | undefined {
  const id = normId(input);
  return optionsOfKind(kind).find((o) => o.id === id);
}


// ---------------------------------------------------------------- 工具名（只用于 notes 显示）
const TOOL_ZH: Record<string, string> = {
  "thieves' tools": '盗贼工具',
  'disguise kit': '易容工具',
  'forgery kit': '伪造工具',
  'herbalism kit': '草药工具',
  "poisoner's kit": '毒师工具',
  "smith's tools": '锻造工具',
  "brewer's supplies": '酿酒工具',
  "mason's tools": '石匠工具',
  "tinker's tools": '修补匠工具',
  "navigator's tools": '航海工具',
  'one gaming set': '一种游戏套组',
  'one musical instrument': '一种乐器',
  "one artisan's tools": '一种工匠工具',
  'vehicles (land)': '陆地载具',
  'vehicles (water)': '水上载具',
  'three musical instruments of your choice': '三种乐器（自选）',
  "one artisan's tools or one musical instrument of your choice": '一种工匠工具或乐器（自选）',
};

export const toolZh = (name: string): string => TOOL_ZH[name.toLowerCase()] ?? name;
