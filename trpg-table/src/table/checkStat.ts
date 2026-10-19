import { ABILITY_ZH, SKILLS, SKILL_ZH, type Ability, type Skill } from '../rules/types.js';

const ABILITIES: Ability[] = ['str', 'dex', 'con', 'int', 'wis', 'cha'];

const ABILITY_NAMES: Record<string, Ability> = {
  strength: 'str',
  dexterity: 'dex',
  constitution: 'con',
  intelligence: 'int',
  wisdom: 'wis',
  charisma: 'cha',
};

/** 官方中文译名和常见说法 → 技能 id（引擎自己的中文名在 SKILL_ZH 里，下面再按它认一遍）。 */
const SKILL_ALIASES: Record<string, Skill> = {
  动物驯养: 'animal_handling',
  驯养: 'animal_handling',
  驯服动物: 'animal_handling',
  洞悉: 'insight',
  察觉: 'perception',
  观察: 'perception',
  侦查: 'investigation',
  妙手: 'sleight_of_hand',
  欺骗: 'deception',
  潜行: 'stealth',
  生存: 'survival',
  体育: 'athletics',
  恐吓: 'intimidation',
  医疗: 'medicine',
  奥术: 'arcana',
  知识: 'history',
};

/**
 * GM 传给 request_check / roll_check 的 skill 字符串 → 引擎认的技能或属性 id。
 * 认：英文 id（大小写、空格、连字符、驼峰都行）、属性全称、中文名（引擎的、官方译名、常见别名），可以带「检定 / 豁免」后缀。
 * 不认识返回 null：不能原样交给引擎，不然会被当成属性、modifier 变成 NaN（骰子公式 `1d20nan`）。
 */
export function resolveCheckStat(raw: string): Skill | Ability | null {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const id = text
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  if ((SKILLS as readonly string[]).includes(id)) return id as Skill;
  if ((ABILITIES as string[]).includes(id)) return id as Ability;
  if (ABILITY_NAMES[id]) return ABILITY_NAMES[id];

  const zh = text.replace(/[（(].*$/u, '').replace(/(?:检定|豁免)$/u, '').trim();
  for (const sk of SKILLS) if (SKILL_ZH[sk] === zh) return sk;
  for (const ab of ABILITIES) if (ABILITY_ZH[ab] === zh || `${ABILITY_ZH[ab]}值` === zh) return ab;
  return SKILL_ALIASES[zh] ?? null;
}

/** 写进错误返回里，让 GM 下一次能直接改对。 */
export function checkStatHelp(): string {
  return `技能：${SKILLS.map((s) => `${s}（${SKILL_ZH[s]}）`).join('、')}；属性：${ABILITIES.map((a) => `${a}（${ABILITY_ZH[a]}）`).join('、')}`;
}
