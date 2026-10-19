# 第三方代码与数据的署名

## Open Dungeon Master（MIT）

`src/rules/logic/` 下的这些文件，规则逻辑改写自 Open Dungeon Master
（<https://github.com/Lebbitheplow/open-dungeon-master>，提交 `df3fec7`，2026-10-18）：

| 本项目文件 | 来源（ODM 的 `src/lib/`） |
| --- | --- |
| `logic/death.ts` | `dm/death-logic.ts`、`dm/vitals-logic.ts` |
| `logic/conditions.ts` | `dm/condition-logic.ts`（`attackContext`、`rollDerivation`、`mergeAdvantage`、力竭表） |
| `logic/damage.ts` | `dm/damage-logic.ts`（`damageAdjust`） |
| `logic/routines.ts` | `dm/enemy-profile.ts`（`plannedSwings`） |
| `logic/reach.ts` | `dm/opportunity.ts`、`dm/attack-rules.ts`、`dm/attack-spatial.ts`、`battlemap/los.ts` |

改写时换成了本项目的类型（`Actor`、`ConditionInstance`、方格坐标），注释和提示文字改成中文，
并按我们实际核对的规则改了几处（见各文件注释）。

原项目许可证全文：

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

规则数据（武器、法术、怪物数值等）取自 System Reference Document 5.1，
© Wizards of the Coast LLC，CC-BY-4.0。署名文字见 `docs/RULES_SPIKE.md` §3.1。
