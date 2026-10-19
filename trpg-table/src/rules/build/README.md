# 角色构建器（`src/rules/build/`）

给一份「构建规格」`CharacterBuild`（种族、背景、职业与等级、属性、各种选择），按 **D&D 5e 2014 规则（SRD 5.1）**
算出完整的 `CharacterFile`（能直接交给 `actorFromCharacter`），同时报告 `errors`（不能用）和 `warnings`（能用，但要注意）。

```ts
import { buildCharacter } from './rules/build/index.js';

const r = buildCharacter(build);   // BuildResult
r.file       // CharacterFile：ac / maxHp / 豁免 / 技能 / 攻击 / 法术位 / 资源 / 特性 id …
r.errors     // string[]：输入非法。有 errors 时 file 是尽力而为的结果（或占位卡），不要拿去玩
r.warnings   // string[]：自动选了什么、规则近似、数据缺失
r.features   // BuildFeature[]：这个角色所有已获得特性的 { id, name, zh, source, level, text }
r.info       // BuildInfo：最终属性、HP/AC 算式、法术上限、自动做的属性提升、被丢掉的法术 …
```

- 入口签名：`buildCharacter(build: CharacterBuild): BuildResult`（`src/rules/build/index.ts`）。纯函数，不读文件，不掷骰，不修改输入。
- 每个「不给就自动选」的地方都有**确定、可复现**的默认（同一份输入永远得到同一份输出），并在 `warnings` 里写清楚选了什么。
- `FEATURE_CATALOG`（`catalog.ts`）：特性 id → `{ name, zh?, source, level, text, data }`，给提示词展示用。id 一律是 `contract.ts` 的 `featureId(英文名)`。
- `src/table/characters.ts` 的 `loadParty` 读 `campaign-vault/characters/<seat>.json`：json 里有 `build` 字段就走构建器；没有就走老路径（整张卡）。

## 示例：`campaign-vault/characters/player_a.json`（新格式）

<!-- test:build -->
```json
{
  "build": {
    "name": "布拉姆",
    "race": "hill_dwarf",
    "background": "acolyte",
    "classes": [{ "id": "cleric", "level": 3, "subclass": "life_domain" }],
    "abilityScores": { "str": 14, "dex": 8, "con": 14, "int": 10, "wis": 15, "cha": 12 },
    "skills": ["medicine", "persuasion"],
    "equipment": { "armor": "chain_mail", "shield": true, "weapons": ["mace"] },
    "raceOptions": { "tools": ["mason's tools"], "languages": ["Celestial", "Giant"] },
    "spells": {
      "cantrips": ["sacred_flame", "guidance", "light"],
      "prepared": ["guiding_bolt", "healing_word", "shield_of_faith", "hold_person", "silence", "aid"]
    },
    "hp": { "method": "average" },
    "persona": "人类生命牧师……（build 里的 persona）"
  },
  "persona": "（可选）顶层的 persona 会覆盖 build.persona；顶层的 notes 追加在构建器的备注后面，顶层的 name 会覆盖角色名"
}
```

兼职 + 属性提升 + 专长的写法：

<!-- test:build -->
```json
{
  "name": "薇克丝",
  "race": "variant_human",
  "raceOptions": { "abilityBonuses": ["dex", "con"], "skills": ["perception"], "feat": "alert" },
  "background": "criminal",
  "classes": [
    { "id": "rogue", "level": 5, "subclass": "thief" },
    { "id": "fighter", "level": 1 }
  ],
  "abilityScores": { "str": 13, "dex": 15, "con": 14, "int": 10, "wis": 12, "cha": 8 },
  "skills": ["stealth", "acrobatics", "investigation", "insight"],
  "expertise": ["stealth", "thieves_tools"],
  "asi": { "4": { "abilities": { "dex": 2 } } },
  "fightingStyles": ["dueling"],
  "equipment": { "armor": "leather", "weapons": [{ "id": "rapier", "magicBonus": 1 }, "shortbow"] }
}
```

## `CharacterBuild` 字段

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `name` | string | 必填 |
| `seat?` | `'player_a' \| 'player_b'` | 缺省时 `loadParty` 按文件名补 |
| `persona?` | string | 人设（内容层，不参与规则）。`loadParty` 里顶层 `persona` 可覆盖 |
| `race` | string | `hill_dwarf mountain_dwarf high_elf wood_elf drow lightfoot_halfling stout_halfling human variant_human dragonborn rock_gnome forest_gnome half_elf half_orc tiefling` |
| `raceOptions?` | 对象 | `abilityBonuses`（半精灵：除魅力外 2 项；变体人类：任意 2 项，各 +1）、`skills`（半精灵 2 / 变体人类 1）、`feat` + `featChoice`（变体人类 1 级专长）、`dragonAncestry`（龙裔：`black blue brass bronze copper gold green red silver white`）、`cantrip`（高等精灵：1 个法师戏法）、`tools`（矮人：`smith's tools` / `brewer's supplies` / `mason's tools` 选 1）、`languages`（自选语言，只写进 notes） |
| `background` | string | `acolyte charlatan criminal entertainer folk_hero guild_artisan hermit noble outlander sage sailor soldier urchin` |
| `classes` | `{ id, level, subclass? }[]` | 第一个是起始职业（豁免、起始熟练项、1 级满骰都按它）。`id` 是 12 个 SRD 职业之一（没有奇械师）。总等级 ≤ 20，同一个职业只写一条。子职业可以写 id、英文名或别名（`life_domain` / `"Life Domain"` / `life`） |
| `abilityScores` | `Record<Ability, number>` | **种族加值之前**的基础值，每项 1–20 的整数；点购 / 标准数组 / 掷骰由调用方定 |
| `skills?` | `Skill[]` | 起始职业的技能选择（数量由职业规定：战士 2、游荡者 4、诗人 3 …），必须在职业列表里 |
| `bonusSkills?` | `Skill[]` | 其它来源的自选技能**池**：兼职（诗人 / 游侠 / 盗贼各 1）、子职业（学识学院 3、知识 / 自然 / 秩序领域…）、背景和种族重复时的补位。按「补位 → 兼职 → 子职业」依次取用，用不上的会报 error |
| `expertise?` | `(Skill \| 'thieves_tools')[]` | 专精，按获得顺序：盗贼 1 / 6 级各 2 个，诗人 3 / 10 级各 2 个；只能给已熟练的技能；盗贼可以写 `thieves_tools`（只进 notes，Actor 没有工具概念） |
| `asi?` | `Record<string, AsiChoice>` | 属性提升 / 专长。键：`"4"`（起始职业的职业等级）或 `"wizard:4"`（任意职业，兼职时用）。值：`{ abilities: { str: 2 } }`、`{ abilities: { str: 1, con: 1 } }` 或 `{ feat: 'alert', featChoice?: { ability?, skills?, weapons? } }`。提升等级：战士 4 6 8 12 14 16 19，盗贼 4 8 10 12 16 19，其它 4 8 12 16 19（按**职业等级**） |
| `fightingStyles?` | `string[]` | `archery defense dueling great_weapon_fighting protection two_weapon_fighting`，按获得顺序（战士 1 级，圣武士 / 游侠 2 级，冠军 10 级再 1 个）。结果是特性 id `fighting_style_<id>`；伤害 / 命中修正由引擎的特性层读，构建器只有「防御 +1 AC」算进了 AC |
| `equipment?` | 对象 | `armor`（ARMOR 里的 id，`null` = 不穿）、`armorBonus`、`shield`、`shieldBonus`、`weapons`（WEAPONS 里的 id，或 `{ id, name?, magicBonus?, twoHanded? }`）、`acBonus`。每项不给就用职业起始装备 |
| `spells?` | `{ cantrips?, known?, prepared?, spellbook? }` | 第一个施法职业的法术选择（法术 id，全是 `SPELLS` 的 key 那种 snake_case）。见下面「法术」 |
| `spellsByClass?` | `Record<classId, 同上>` | 兼职多个施法职业时按职业给 |
| `options?` | 对象 | `invocations`、`pactBoon`（邪术师）、`maneuvers`（战斗大师）、`metamagic`（术士）、`disciplines`（四象宗）、`hunter: { prey, defensiveTactics, multiattack, superiorDefense }`（猎人）、`dragonAncestor`（龙族血脉术士）、`mysticArcanum: { 6: 'mass_suggestion' }`（邪术师）、`landCircle`（大地结社：`arctic coast desert forest grassland mountain swamp underdark`） |
| `hp?` | `{ method?, rolls? }` | `method`：`average`（默认）\| `max` \| `rolled`；`rolled` 时 `rolls` 是 1 级以后每一级的骰点（按职业顺序、等级顺序） |
| `notes?` | string | 补充说明，加到 `file.notes` 末尾 |

## 自动选择的默认规则

没给的项目按下面选，选了什么都会写进 `warnings`。偏好表都在代码里，可以直接改：

| 项目 | 默认 |
| --- | --- |
| 子职业 | 到了选择等级没填 → SRD 里的那个（`berserker lore life_domain land champion open_hand devotion hunter thief draconic_bloodline fiend evocation`）；没到等级的写了也不生效（warning） |
| 属性提升 | 按职业主属性自动 +2（`ClassDef.asiPriority`：战士 力量 > 体质 > 敏捷 > 感知，敏捷高于力量时敏捷排前；盗贼 敏捷 > 体质 > 感知；法师 智力 > 体质 > 敏捷 …）；到 20 封顶，多出来的点数顺延给下一项 |
| 种族自选属性 | 半精灵 / 变体人类没给 → 起始职业的属性优先顺序 |
| 变体人类专长 | `tough` |
| 技能 | 不足的按 `proficiency.ts` 里 `SKILL_PREF`（每个职业一串偏好）补；背景 / 种族 / 职业重复的，按规则换成下一个能选的 |
| 专精 | 不足的按职业偏好补（盗贼：隐匿 > 察觉 > 巧手 …；诗人：说服 > 表演 …） |
| 战斗风格 | 看装备：弓 → 箭术；双手 / 重型近战且没盾 → 巨武器战斗；单手 + 盾 → 决斗；没武器 → 防御；该职业不能选的顺延 |
| 装备 | 职业起始装备（`data/equipment.ts` 的 `STARTER_KITS`，每个「A 或 B」按固定规则选好）；战士敏捷高于力量用皮甲 + 刺剑 + 长弓；牧师有重甲熟练（生命 / 战争 / 暴风…领域）拿链甲；手里全是双手武器时不默认持盾 |
| 法术 | 戏法 / 已知 / 准备 / 法术书都按 `data/spell-tables.ts` 的 `DEFAULT_SPELLS`（每个职业每个环阶一串偏好）**从最高环阶往下轮流**取，偏好表用完再按 PHB 法术表的 id 顺序补。选择与 `SPELLS` 里现在有哪些法术**无关**（不然 SPELLS 一长，已有角色的法术就变了），选完才用 `SPELLS` 过滤 |
| 祈唤 / 契约恩赐 / 战技 / 超魔 / 元素修行 / 猎人选择 | `features.ts` 里 `GROUPS[].prefer` 的偏好顺序，满足前置（等级、契约恩赐、魔能爆戏法）。邪术师默认契约恩赐 = 利刃 |
| 龙祖先 | 红龙 `red` |
| 大地结社地貌 | `forest` |
| 神秘秘法 | 每一环偏好表里的第一个 |
| 高等精灵戏法 | 法师偏好表里第一个没选过的 |
| 矮人工具 | `smith's tools` |
| 语言 / 工具自选 | 只写进 `notes`（「另有 N 门自选语言未指定」） |
| HP | `average`：1 级满骰，之后每级 `floor(die/2)+1`，每级至少 1 点 |

## 算什么、怎么算

- **属性**：基础值 + 种族加值（上限 20）→ 按等级顺序应用属性提升 / 专长（上限 20，浪费的点数会提示）→ 野蛮人 20 级原初勇士（力量、体质 +4，上限 24）。
- **熟练加值**按总等级。**豁免**只取起始职业（兼职从不给豁免），再加坚韧专长、武僧 14 级钻石之魂（全部）、盗贼 15 级滑溜心智（感知）。
- **熟练项**：起始职业整套；其它职业只给兼职那一行（SRD 的兼职熟练表）；加种族、子职业额外熟练（生命领域重甲、勇气诗人中甲 + 军用武器…）、专长。
- **HP**：1 级起始职业满骰 + 体质；之后每级取 `hp.method`；兼职每个职业用自己的骰；每级加值：丘陵矮人 +1、强韧专长 +2、龙族血脉 +1（按术士等级）。
- **AC**：护甲表（轻甲 + 敏捷，中甲 + 敏捷（最多 +2；中甲大师最多 +3），重甲不加）+ 盾 +2 + 魔法加值 + 防御风格 +1（要穿甲）；没穿甲取最好的无甲算法：10 + 敏捷、野蛮人 + 体质、武僧 + 感知（不能持盾）、龙族血脉 13 + 敏捷。力量不足、不熟练的护甲 / 盾只给 warning（劣势和不能施法由引擎另算）。
- **速度**：种族（木精灵 35）；野蛮人 5 级快速移动 +10（不穿重甲）；武僧无甲移动 +10/15/20/25/30（2/6/10/14/18 级，不穿甲不持盾）；灵动专长 +10。
- **攻击**：装备里每把武器 → `AttackDef { weaponId, … }`，不熟练写 `proficient: false`；武僧另有一条 `{ weaponId: 'unarmed', name: '徒手打击' }`（WEAPONS 里的徒手打击；武艺骰和敏捷 / 力量取高由引擎的 `martial_arts` 特性层算）。`attacksPerAction`：战士 5/11/20 级 2/3/4；野蛮人 / 武僧 / 圣武士 / 游侠 5 级 2；勇气诗人、剑舞诗人、剑咏法师 6 级 2（职业间不叠加）。`sneakAttackDice` = ⌈盗贼等级 / 2⌉。
- **法术位**：单个施法职业按它自己的表（全 / 半 / 三分之一施法者）；两个以上按 5e 多职业施法者表（全施法者按等级，半施法者按 ⌊等级 / 2⌋，奥法骑士 / 诡术师按 ⌊等级 / 3⌋）；契约魔法单独：只有邪术师时 `spells.pact = true`，和别的施法职业兼职时并进总表并给 warning，同时写 `spells.pactSlots = { level, count }`，引擎短休时按它近似恢复（该环阶已用位至多恢复 count 个）。
- **法术数量上限**：戏法按职业表；已知型（诗人 术士 邪术师 游侠 奥法骑士 诡术师）按已知数表；准备型（牧师 德鲁伊 = 属性调整值 + 等级；圣武士 = 属性调整值 + ⌊等级 / 2⌋，至少 1）；法师准备数 = 智力调整值 + 等级，法术书 6 + 2 × (等级 - 1)。每个职业最高环阶按它**自己**的表。
- **永久准备法术**（领域 / 誓言 / 大地结社地貌 / 魔典…）：不占上限，直接放进 `known`。邪术师宗主的法术是「扩展法术表」：可选，不白送。
- **`spells.known`**：现在能施放的所有法术 id（含戏法）= 戏法 + 已知 / 准备的 + 永久准备的 + 种族戏法，再用 `SPELLS` 过滤；不在 `SPELLS` 里的放进 warnings 并丢掉（`info.spellcasting.droppedSpells` 里也有）。
- **资源**：`second_wind action_surge indomitable rage ki bardic_inspiration channel_divinity lay_on_hands divine_sense sorcery_points wild_shape arcane_recovery superiority_dice breath_weapon relentless_endurance`，key 和 recharge 用 `contract.ts` 的 `RESOURCE_SPECS`；狂暴次数 2/3/4/5/6/无限（无限 = 99）；气 = 武僧等级；诗人激励 = 魅力调整值（至少 1），5 级起改短休；圣疗池 = 圣武士等级 × 5；引导神力 牧师 1/2/3 次、圣武士 1 次。另有 `natural_recovery cleansing_touch stroke_of_luck wholeness_of_body dark_ones_own_luck hurl_through_hell` 六个，也在 `RESOURCE_SPECS` 里（原来单放在 `resources.ts` 的 `EXTRA_RESOURCE_SPECS`，2026-10-18 晚合并了）。
- **特性**：`file.features` 是所有已获得特性的 id（种族 / 背景 / 职业 / 子职业 / 战斗风格 / 专长 / 祈唤等选项），占位用的（战斗风格、子职业入口、超魔、祈唤…）换成了具体选择：战斗风格是 `fighting_style_<风格>`（`fighting_style_dueling`），祈唤 / 契约恩赐 / 战技 / 超魔 / 元素修行 / 猎人选择用选项本身的名字（`agonizing_blast`、`pact_of_the_blade`、`riposte`、`quickened_spell`、`colossus_slayer`），龙祖先是 `draconic_ancestry_blue`（龙裔）/ `dragon_ancestor_red`（龙族血脉术士）。引擎特性层（`src/rules/features/`、`engine.ts`）要找的 id 都对得上：武僧 2 级起有 `flurry_of_blows` `patient_defense` `step_of_the_wind`（SRD 把它们写在「气」里，构建器单独列出来），半身人是 `halfling_luck`，牧师生命领域是 `channel_divinity_preserve_life`。
- **抗性 / 免疫**：种族（丘陵矮人、敦实半身人 毒素；提夫林 火焰；龙裔按祖先）；武僧 10 级、大地结社 10 级毒素免疫 + 中毒状态免疫；圣武士 10 级免疫恐惧；虔诚誓言 7 级免疫魅惑。
- **notes**：种族 / 背景、护甲 / 武器 / 工具熟练、语言、施法属性与 DC、法术书、种族天生法术、神秘秘法、护甲的隐匿劣势等。

## 合法性检查

`errors`（不能用）：属性不是 1–20 的整数；等级不在 1–20、总等级 > 20、同一职业写了两次；未知种族 / 背景 / 职业 / 子职业 / 专长 / 选项 / 护甲；技能选多了 / 不在职业列表里 / 重复；专精超名额或给了没熟练的技能；兼职属性要求（SRD：新旧职业各自的主属性都 ≥ 13）；属性提升写法不对（总和不是 2、键对不上提升等级、属性和专长二选一）；专长前置条件不满足（属性、护甲熟练、施法能力、种族）；法术数量超过上限、环阶超过职业能学的最高环阶、不在职业法术表上（魔法奥秘 / 扩展法术表 / 额外戏法除外）、不在法术书里；战斗风格 / 祈唤 / 战技等超名额或前置不满足；`hp.rolls` 骰点超出骰面。

`warnings`（能用但要注意）：所有自动选择、自动提升、技能重复补位；不熟练的护甲 / 盾 / 武器；力量不足；金属护甲的德鲁伊、穿甲的武僧、重甲的野蛮人；兼职时 `hitDice` 只有一种骰面；多个施法职业的施法属性不同；邪术师兼职时契约位并入总表；`SPELLS` 里没有的法术被丢掉。

## 数据来源

见 `NOTICE.md`。`data/` 下 `*.gen.ts` 是 `data/gen/generate.mjs` 从 Open Dungeon Master（MIT，提交 `df3fec7`）生成的，不要手改；
其余（职业、SRD 子职业、种族、装备、法术位表、默认法术偏好、子职业数值效果）是手写的，职业特性的名字和等级逐项和 ODM 核对过。

- 数据出处标注：种族 `RaceDef.source`、子职业 `SubclassDef.source`：`srd` = SRD 5.1 里有的，`odm` = ODM 用自己的话复述的 2014 机制（山地矮人、木精灵、卓尔、敦实半身人、变体人类、森林侏儒，以及 101 个非 SRD 子职业）。`FEATURE_CATALOG[id].data` 同理。
- 说明文字（`text`）是一句话的规则说明：SRD 部分是我们自己的话，ODM 部分是 ODM 自己写的复述，没有照抄 SRD 原文。

## 没有实现的规则

- **特性的数值效果**（狂暴伤害、神圣斩击、偷袭骰的结算、战斗风格的命中 / 伤害修正、武艺骰、半熟练、专长效果…）：只给特性 id，由引擎的特性层读。构建器只直接算：`attacksPerAction`、`sneakAttackDice`、AC / 速度 / HP / 抗性、资源次数。
- **种族天生法术**（卓尔 / 提夫林的 3、5 级法术，每长休一次）：只写进 notes 和 `info.spellcasting.racialSpells`，引擎还不能按「每长休一次」施放；天生戏法放进 `known`。
- **神秘秘法**（邪术师 11+ 级）、**契约之书的额外戏法**、契约锁链的魔宠、专长附带的法术（魔法学徒、妖精之触…）：没有放进可施放列表。
- **多个施法职业用不同的施法属性**：`Spellcasting` 只有一个 `ability`，用第一个施法职业的并给 warning。
- 不熟练护甲的劣势、负重、起始财富 / 金钱、装备重量：不算（前一项只给 warning）。力量不够穿重甲的**步行速度 -10 尺**从 2026-10-18 起会扣（并给 warning）；游泳等其它速度不动；矮人不扣。
- **野蛮人图腾 / 游侠宿敌与自然探索者的选择 / 野性变形的兽形 / 动物伙伴 / 魔宠 / 召唤物**：只有特性 id，没有选择。
- **子职业的数值效果**只覆盖 PHB 常见的几个（`data/subclass-effects.ts`：额外熟练、自选技能、额外攻击、额外戏法、龙族韧性、无甲 AC、状态免疫、大地结社地貌法术）；其它 ODM 子职业只有特性 id + 一句话说明。知识领域的专精没做。
- **专长**：只做了 +1 属性、护甲熟练、豁免熟练（坚韧）、每级生命（强韧）、速度（灵动）、技能（技能娴熟，不含工具）、武器熟练（武器大师）、幸运的资源、前置条件检查。
- **2024 规则、奇械师、ODM 原创种族**（aasimar 起）：不支持。
- 没有经验值 / 升级流程：构建器只算「这个规格对应的角色卡」，升级就是改规格里的等级再算一遍。

## 测试与维护

- `test/builder.test.ts`：手算过的黄金用例（战士 1 / 丘陵矮人生命牧师 5 / 盗贼 3 / 野蛮人 5 / 武僧 5 / 邪术师 3 / 兼职 / 战士 11 / 法师 20 …）、非法输入、`actorFromCharacter` 兼容、每个职业 × 每个子职业 20 级全量构建 + 特性目录完整性、`loadParty` 新旧格式、本文件里的示例 json 能构建。
- 换 ODM 版本：`node src/rules/build/data/gen/generate.mjs <ODM 的 src/lib/srd 目录>`，然后 `npm test`。
