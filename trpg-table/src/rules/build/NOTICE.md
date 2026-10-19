# 角色构建器的数据来源与署名

`src/rules/build/` 里的规则数据来自两处：**Open Dungeon Master（MIT）** 已经整理好的数据，和 **SRD 5.1（CC-BY-4.0）**。
上层的规则逻辑（`index.ts`、`abilities.ts`、`combat.ts`、`spells.ts`…）是本项目自己写的，用我们自己的类型。

## Open Dungeon Master（MIT）

来源：<https://github.com/Lebbitheplow/open-dungeon-master>，提交 `df3fec7`（2026-10-18），`src/lib/srd/` 下的数据。

| 本项目文件 | 来源（ODM 的 `src/lib/srd/`） | 怎么用的 |
| --- | --- | --- |
| `data/odm-subclasses.gen.ts` | `subclasses.json` | 101 个非 SRD 子职业（名字、别名、各级特性名、一句话说明、永久准备法术）；奇械师的 4 个没有搬 |
| `data/options.gen.ts` | `options.json` | 魔能祈唤、契约恩赐、战技、超魔、元素修行、猎人的选择（只搬了我们要的 9 类） |
| `data/feats.gen.ts` | `authored-feats.json` | 54 个专长的名字、前置条件文字和一句话说明 |
| `data/backgrounds.gen.ts` | `backgrounds.json` | 13 个背景的技能、工具、语言数、特性名和说明 |
| `data/spell-lists.gen.ts` | `manifest/spells.json`、`spell-lists.ts` | PHB 法术的 id / 环阶 / 学派 / 职业表（只有事实，没有规则文本）；圣武士和游侠的 SRD 法术表是 ODM 补的 |
| `data/spell-tables.ts` | `spell-slots.json`、`third-caster.ts` | 全 / 半 / 三分之一施法者 / 契约魔法的法术位表（逐行核对过） |
| `data/classes.ts`、`data/races.ts`、`data/srd-subclasses.ts` | `classes.json`、`class-features.json`、`races.json` | 手写，但职业的生命骰、豁免、技能表、特性名与等级、SRD 子职业、种族数值和语言逐项和 ODM 核对过；兼职表参考了 `multiclass.ts`，起始装备参考了 `starting-kit-data.ts`，护甲表参考了 `armor.ts` |
| `build/combat.ts`、`resources.ts` 等里的算法 | `hit-points.ts`、`asi.ts`、`class-resources.ts`、`index.ts`（`deriveAc` 等） | 规则逻辑按我们自己的类型重写，数值按 2014 规则复核 |

`data/gen/generate.mjs` 是从 ODM 数据生成 `*.gen.ts` 的脚本。生成的文件头部都标了来源。

ODM 的许可证全文：

```
MIT License

Copyright (c) 2026 Jacob Ferrari
Copyright (c) 2026 Kaleb Lutterman

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## SRD 5.1（CC-BY-4.0）

This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC and available at
<https://dnd.wizards.com/resources/systems-reference-document>. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0
International License available at <https://creativecommons.org/licenses/by/4.0/legalcode>.

## 哪些是 SRD，哪些是 ODM 复述

数据里每一项都标了出处：`source: 'srd'`（SRD 5.1 里有的）或 `'odm'`（ODM 用自己的话复述的 2014 机制，**不在 SRD 里**）。
`FEATURE_CATALOG[id].data` 也有同样的标注。

- **SRD 5.1**：
  - 12 个基础职业（野蛮人到法师）的生命骰、熟练项、豁免、技能表、各级特性名称与等级、法术位表、法术数量表（说明文字是我们自己的话，一句话）；
  - 12 个 SRD 子职业（每个职业一个）：狂战士之道、学识学院、生命领域、大地结社、冠军、空手之道、虔诚誓言、猎人、神偷、龙族血脉、邪魔宗主、塑能学派（`data/srd-subclasses.ts`）；
  - 9 个种族 / 亚种：丘陵矮人、高等精灵、轻足半身人、人类、龙裔、岩地侏儒、半精灵、半兽人、提夫林；
  - 护甲表、武器表（`../data/weapons.ts`）、战斗风格（箭术、防御、决斗、巨武器战斗、保护、双武器战斗）、龙裔祖先表。
- **ODM 复述（非 SRD）**：
  - 6 个种族 / 亚种：山地矮人、木精灵、卓尔、敦实半身人、变体人类、森林侏儒；
  - 101 个其它子职业（`data/odm-subclasses.gen.ts`；ODM 把 Xanathar、Tasha、Wildemount 等 2014 规则书里的子职业用自己的话写成了机制）；
  - 54 个专长（SRD 5.1 只有擒抱手一个）；
  - 魔能祈唤 / 契约恩赐 / 战技 / 超魔 / 元素修行 / 猎人选择（其中祈唤、契约恩赐、超魔的一部分 SRD 里也有，战技和元素修行没有；统一按 ODM 复述标注）；
  - 13 个背景：SRD 5.1 只收了侍僧；其余 12 个背景的名字、技能、工具、语言数是规则事实，特性说明是 ODM 自己写的；
  - 法术表（PHB 的全部法术，只有 id / 环阶 / 学派 / 职业，不含规则文本）。
- **ODM 自己原创的种族**（aasimar 起）：故意没有搬。奇械师：按要求不搬。

没有把 ODM 里不属于 SRD 的受版权保护原文大段照抄进来；所有「说明」都是一句话的规则复述。
