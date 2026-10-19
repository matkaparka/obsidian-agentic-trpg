// 从 Open Dungeon Master（MIT，提交 df3fec7）的整理数据生成 build/data 下的 *.gen.ts。
// 用法：node src/rules/build/data/gen/generate.mjs [ODM 的 src/lib/srd 目录]
// 生成的文件已经提交；只有换 ODM 版本时才需要重跑。手写的数据（SRD 职业特性、种族、
// SRD 子职业、中文名）不在这里生成。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const outDir = join(here, '..');
const srd = process.argv[2] ?? 'open-dungeon-master/src/lib/srd';
const load = (f) => JSON.parse(readFileSync(join(srd, f), 'utf8'));

const snake = (s) =>
  s
    .replace(/\([^)]*\)/g, ' ')
    .replace(/['’]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

const HEADER = (what) =>
  `// 自动生成：node src/rules/build/data/gen/generate.mjs\n` +
  `// 来源：Open Dungeon Master（MIT，Copyright (c) 2026 Jacob Ferrari, Kaleb Lutterman），提交 df3fec7，${what}\n` +
  `// 说明文字是 ODM 用自己的话写的 2014 机制复述（非 SRD 原文）。见 ../NOTICE.md。不要手改。\n`;

const q = (v) => JSON.stringify(v);

// ---------------------------------------------------------------- 子职业（ODM 复述的）
const SRD_SUBCLASSES = new Set([
  'barbarian/Path of the Berserker',
  'bard/College of Lore',
  'cleric/Life Domain',
  'druid/Circle of the Land',
  'fighter/Champion',
  'monk/Way of the Open Hand',
  'paladin/Oath of Devotion',
  'ranger/Hunter',
  'rogue/Thief',
  'sorcerer/Draconic Bloodline',
  'warlock/The Fiend',
  'wizard/School of Evocation',
]);

const subIdOf = (name) =>
  snake(
    name
      .replace(/^(Path of the|Path of|College of|Circle of the|Circle of|Way of the|Way of|Oath of the|Oath of|School of|Order of|The) /, '')
  );

{
  const sub = load('subclasses.json').classes;
  const out = [];
  for (const [classId, list] of Object.entries(sub)) {
    if (classId === 'artificer') continue;
    for (const s of list) {
      if (SRD_SUBCLASSES.has(`${classId}/${s.name}`)) continue;
      const features = {};
      for (const [lvl, fs] of Object.entries(s.levels)) {
        features[lvl] = fs.map((f) => ({ name: f.n, text: f.d }));
      }
      const spells = {};
      for (const [lvl, names] of Object.entries(s.spells ?? {})) spells[lvl] = names.map(snake);
      out.push({
        id: subIdOf(s.name),
        classId,
        name: s.name,
        source: 'odm',
        aliases: s.aliases ?? [],
        desc: s.desc,
        features,
        ...(Object.keys(spells).length ? { spells } : {}),
      });
    }
  }
  const ids = new Set();
  for (const s of out) {
    const key = `${s.classId}/${s.id}`;
    if (ids.has(key)) throw new Error(`子职业 id 重复：${key}`);
    ids.add(key);
  }
  const body =
    HEADER('data/srd/subclasses.json') +
    `import type { SubclassDef } from './schema.js';\n\n` +
    `/** ODM 复述的 2014 子职业（不含 SRD 里有的那 12 个，那些手写在 srd-subclasses.ts）。 */\n` +
    `export const ODM_SUBCLASSES: SubclassDef[] = ${JSON.stringify(out, null, 2)};\n`;
  writeFileSync(join(outDir, 'odm-subclasses.gen.ts'), body);
  console.log('odm-subclasses.gen.ts', out.length);
}

// ---------------------------------------------------------------- 选项（invocations 等）
{
  const o = load('options.json');
  const keep = ['invocation', 'maneuver', 'metamagic', 'pact_boon', 'discipline', 'hunters_prey', 'defensive_tactics', 'hunter_multiattack', 'superior_hunters_defense'];
  const options = o.options
    .filter((x) => keep.includes(x.k))
    .map((x) => ({ kind: x.k, id: snake(x.n), name: x.n, text: x.d, ...(x.req ? { req: x.req } : {}) }));
  const body =
    HEADER('data/srd/options.json') +
    `import type { OptionDef } from './schema.js';\n\n` +
    `export const OPTION_DEFS: OptionDef[] = ${JSON.stringify(options, null, 2)};\n`;
  writeFileSync(join(outDir, 'options.gen.ts'), body);
  console.log('options.gen.ts', options.length);
}

// ---------------------------------------------------------------- 专长
{
  const f = load('authored-feats.json').feats;
  const feats = f.map((x) => ({ id: snake(x.name), name: x.name, prerequisite: x.prerequisite || '', text: x.desc }));
  const body =
    HEADER('data/srd/authored-feats.json') +
    `import type { FeatDef } from './schema.js';\n\n` +
    `export const FEAT_DEFS: FeatDef[] = ${JSON.stringify(feats, null, 2)};\n`;
  writeFileSync(join(outDir, 'feats.gen.ts'), body);
  console.log('feats.gen.ts', feats.length);
}

// ---------------------------------------------------------------- 背景
{
  const b = load('backgrounds.json').backgrounds;
  const bgs = b.map((x) => ({
    id: x.id,
    name: x.name,
    skills: x.skills,
    tools: x.tools ?? [],
    languages: x.languages ?? 0,
    equipment: x.equipment ?? [],
    feature: x.feature,
    featureText: x.featureDesc ?? x.blurb ?? '',
    blurb: x.blurb ?? '',
  }));
  const body =
    HEADER('data/srd/backgrounds.json（SRD 5.1 的 13 个背景）') +
    `import type { BackgroundDef } from './schema.js';\n\n` +
    `export const BACKGROUND_DEFS: BackgroundDef[] = ${JSON.stringify(bgs, null, 2)};\n`;
  writeFileSync(join(outDir, 'backgrounds.gen.ts'), body);
  console.log('backgrounds.gen.ts', bgs.length);
}

// ---------------------------------------------------------------- 法术表（PHB）
{
  const m = load('manifest/spells.json').spells;
  // ODM 的 spell-lists.ts 里给圣武士 / 游侠补的 SRD 法术表（open5e 的清单漏了很多）。
  const SUPP = {
    paladin: [
      'Bless', 'Command', 'Cure Wounds', 'Detect Evil and Good', 'Detect Magic', 'Detect Poison and Disease', 'Divine Favor', 'Heroism',
      'Protection from Evil and Good', 'Purify Food and Drink', 'Shield of Faith', 'Aid', 'Branding Smite', 'Find Steed', 'Lesser Restoration',
      'Locate Object', 'Magic Weapon', 'Protection from Poison', 'Zone of Truth', 'Create Food and Water', 'Daylight', 'Dispel Magic',
      'Magic Circle', 'Remove Curse', 'Revivify', 'Banishment', 'Death Ward', 'Locate Creature', 'Dispel Evil and Good', 'Geas', 'Raise Dead',
    ],
    ranger: [
      'Alarm', 'Animal Friendship', 'Cure Wounds', 'Detect Magic', 'Detect Poison and Disease', 'Fog Cloud', 'Goodberry', "Hunter's Mark", 'Jump',
      'Longstrider', 'Speak with Animals', 'Animal Messenger', 'Barkskin', 'Darkvision', 'Find Traps', 'Lesser Restoration', 'Locate Animals or Plants',
      'Locate Object', 'Pass without Trace', 'Protection from Poison', 'Silence', 'Spike Growth', 'Conjure Animals', 'Daylight', 'Nondetection',
      'Plant Growth', 'Protection from Energy', 'Speak with Plants', 'Water Breathing', 'Water Walk', 'Wind Wall', 'Conjure Woodland Beings',
      'Freedom of Movement', 'Locate Creature', 'Stoneskin', 'Commune with Nature', 'Tree Stride',
    ],
  };
  const suppById = new Map();
  for (const [cls, names] of Object.entries(SUPP)) for (const n of names) suppById.set(snake(n), [...(suppById.get(snake(n)) ?? []), cls]);
  const CLASSES = ['bard', 'cleric', 'druid', 'paladin', 'ranger', 'sorcerer', 'warlock', 'wizard'];
  const rows = [];
  for (const s of m) {
    if (s.b !== 'phb') continue;
    const id = snake(s.n);
    const classes = new Set((s.c ?? '').split(',').map((c) => c.trim()).filter((c) => CLASSES.includes(c)));
    for (const c of suppById.get(id) ?? []) classes.add(c);
    rows.push([id, s.l, CLASSES.filter((c) => classes.has(c)).join(','), s.s]);
  }
  rows.sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]));
  const lines = rows.map((r) => `  ${r[0]}: [${r[1]}, ${q(r[2])}, ${q(r[3])}],`);
  const body =
    HEADER('data/srd/manifest/spells.json（PHB 法术清单，只有名字/环阶/职业，不含规则文本）') +
    `/** 法术 id → [环阶, 职业（逗号分隔）, 学派]。PHB 2014 全部法术，圣武士/游侠按 SRD 法术表补过。 */\n` +
    `export const SPELL_CLASS_LIST: Record<string, readonly [level: number, classes: string, school: string]> = {\n${lines.join('\n')}\n};\n`;
  writeFileSync(join(outDir, 'spell-lists.gen.ts'), body);
  console.log('spell-lists.gen.ts', rows.length);
}
