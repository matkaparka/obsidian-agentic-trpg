# NOTICE — 许可证范围 / License scope

The root [`LICENSE`](LICENSE) is the **MIT License**. It covers this repository's own code and text:
`trpg-table/` (source, config, tests, scripts, docs), `campaign-vault/` (adventure text, character cards,
vault settings, scene files), `vault/`, `launch/`, `scripts/` and `docs/`.

本仓库自己的代码和文字（`trpg-table/`、`campaign-vault/` 里的剧本 / 角色卡 / 配置 / 场景文件、`vault/`、`launch/`、`scripts/`、`docs/`）按根目录 [`LICENSE`](LICENSE) 的 **MIT** 许可。下面这些**不在**这个许可范围里，各自按自己的条款：

| 部分 | 许可证 | 说明 |
| --- | --- | --- |
| [`atlas-agent-link/`](atlas-agent-link) | **AGPL-3.0-only** | Obsidian 插件，见其目录下的 `LICENSE`。`trpg-table` 只通过它的 MCP/HTTP 协议通信，没有复制它的代码 |
| 规则数据：武器、法术、怪物、种族、子职业等（`trpg-table/src/rules/data/`、`trpg-table/src/rules/build/data/`，条目带 `source` 字段） | 按条目的来源 | `source: srd` → **CC-BY-4.0**（System Reference Document 5.1，© Wizards of the Coast LLC，使用时必须保留下面的署名）；`source: odm` 和 `*.gen.ts` → 来自 Open Dungeon Master 的 **MIT** 数据，署名见 [`trpg-table/src/rules/NOTICE.md`](trpg-table/src/rules/NOTICE.md)；`source: custom` → **不在 SRD 里**的条目（Triton、Tabaxi 两个种族，法术亡者丧钟 / Toll the Dead），是按官方补充资料的机制用自己的话写的，MIT 只覆盖我们的措辞，不覆盖 Wizards of the Coast 的名字和原文。法术的详细说明见 [`trpg-table/src/rules/data/NOTICE-spells.md`](trpg-table/src/rules/data/NOTICE-spells.md) |
| `trpg-table/src/rules/logic/` 下的规则逻辑 | **MIT**（上游） | 改写自 [Open Dungeon Master](https://github.com/Lebbitheplow/open-dungeon-master)，© Jacob Ferrari, Kaleb Lutterman；署名和许可证全文见 [`trpg-table/src/rules/NOTICE.md`](trpg-table/src/rules/NOTICE.md) |
| D&D / 被遗忘的国度 / Phandalin 等地名、人名、专有名词 | **不授权** | 属于 Wizards of the Coast 或其权利人。剧本《通往凡达林的路》是使用这些名字写的原创同人故事；本项目与 Wizards of the Coast 无关，也未获其认可。MIT 只覆盖我们自己写的文字，不覆盖这些名字和世界观 |
| 第三方地图、token、立绘、Obsidian、Atlas VTT | 各自的条款 | **不在这个仓库里**，要自己下载 / 准备；见 [`campaign-vault/LICENSES.md`](campaign-vault/LICENSES.md) |

## SRD 5.1 署名（必须保留）

> This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

## 其他

- 商标（Obsidian、Atlas、Claude、Gemini、DeepSeek、Dungeons & Dragons 等）属于各自的所有者，这里只用于说明兼容性。
- 项目的大部分代码和文档是在 AI 编码助手的协作里写出来的；MIT 声明的是仓库发布者能授予的权利，不构成对 AI 生成内容权属的法律意见。
