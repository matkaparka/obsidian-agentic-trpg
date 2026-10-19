# obsidian-agentic-trpg

**An AI-run D&D 5e table for live streaming.** An LLM Game Master and two LLM players (different models) play a campaign on an [Atlas VTT](https://github.com/atlas-vtt/atlas-vtt) map inside Obsidian. A rules engine keeps the numbers honest, a small overlay draws the stream picture, and a link server feeds events to a VTuber page.

**一个给直播用的 AI 跑团桌**：LLM 当 GM，两个不同厂商的 LLM 各当一名玩家，在 Obsidian 的 Atlas VTT 地图上打一场 D&D 5e 战役。规则内核自己写、负责算数；overlay 画直播画面；link 服务把事件推给 VTuber 页面。

> 状态：能跑通的个人项目，不是产品。作者在 B 站直播里用它，代码里有不少中文提示词和直播用的假设。
> 下面“没有包含的东西”一节写了你需要自己准备什么。

## 它做什么

- **Agentic GM**：GM 不是一次性写剧本，而是拿着工具一步步推进——`narrate`、`request_check`、`start_combat`、`move`、`set_timer`、`world_act`、`mark_beat`、`give_item` / `give_gold`、`note_fact`、`end_scene` ……规则由引擎执行，GM 只能通过工具改变世界。
- **两个 AI 玩家**：各自有角色卡和人设，只看得到“玩家视角”（未揭示的 token、GM 秘密、怪物具体 HP 都被过滤，有测试）。他们的“心里话”会被 renderer 加工成漫画气泡，原始思维链只写日志。
- **回合计**：探索和战斗共用“第 N 轮”，每个能动的 PC / 生物 / 环境条目每轮各动一次；GM 可以挂计时器（`set_timer`）、环境事件（剧本里的 `## 环境`）。
- **战役记忆**：每幕结束写前情（GM 版 / 玩家安全版）和世界事实，下一幕带着走。
- **物品、金币、战利品**：背包 / 金币进引擎状态，剧本里 `## 战利品` 由 GM 发放。
- **进度管理**：剧本里的 `## 节拍` 和 `## 自动出口`（确定性判断）+ 一个“进度导演”模型（每隔几轮读一次全局，判断有没有跑偏、出口是否已满足，输出由桌面强制执行）。防止 GM 把一幕拖长或提前演后面的内容。
- **规则内核（5e SRD 5.1 的可核对子集）**：掷骰、检定、豁免、攻击（多攻、暴击、掩蔽、借机）、伤害、状态、死亡豁免、法术位与专注、先攻与突袭、休息、擒抱 / 推撞、职业与种族特性、角色构建器。覆盖范围见 [`trpg-table/docs/RULES_COVERAGE.md`](trpg-table/docs/RULES_COVERAGE.md)。
- **Atlas VTT 控制层**：[`atlas-agent-link`](atlas-agent-link)（Obsidian 插件）把 Atlas 的地图、token、迷雾、骰子日志通过本机 MCP/HTTP 暴露出来，桌面程序只通过它写地图。
- **配音**：阿里云百炼 qwen3-tts-flash（旁白 / 两个角色三个音色），服务端合成缓存，overlay 排队播放。
- **费用止损**：`trpg-table/scripts/cost-guard.mjs` 按 usage 日志累计，超线自动暂停。

## 架构

```
Obsidian + Atlas VTT ⇄ atlas-agent-link (MCP/SSE, 127.0.0.1:27125) ⇄ trpg-table ── link :8098 ── VTuber 页面（可选）
                                                                         └─── overlay :8099（iframe 叠在 Atlas 玩家窗口上）
```

| 目录 | 是什么 |
| --- | --- |
| [`trpg-table/`](trpg-table) | 桌面主程序（TypeScript / Node ≥ 22）：规则、TableLoop、GM / 玩家 / renderer / 导演、模型适配层、overlay、link、配音。**从这里开始读**，它的 README 有完整说明 |
| [`atlas-agent-link/`](atlas-agent-link) | Obsidian 插件，Atlas VTT 的 Agent 控制层（AGPL-3.0） |
| [`campaign-vault/`](campaign-vault) | Obsidian vault 的文字部分：两个剧本（`adventures/`）、角色卡、`.obsidian` 配置、场景文件 |
| [`vault/`](vault) | Atlas 场景模板（生成脚本用） |
| [`launch/`](launch) | Windows 启动脚本 |
| [`docs/history/`](docs/history) | 开发过程中的任务书和交接文档（中文）——看设计取舍和踩过的坑 |
| [`scripts/`](scripts) | 下载 Atlas VTT release 的脚本 |

## 快速开始

需要：Node ≥ 22、Obsidian（桌面版）、至少一个模型 API key（Anthropic / Gemini / DeepSeek，可在 `trpg-table/config/models.yaml` 里换）。

```bash
cd trpg-table
npm install
cp .env.example .env        # 填 API key；.env 已在 .gitignore
npm test                    # 或 npm run test:plain
npm run build

# 不开 Obsidian、不连 Atlas，用内存桌面看一遍流程（模型仍是真的）
npm start -- --dry

# 完全不要 key，用假模型演示（不要直播）
npm start -- --fake --dry
```

接 Atlas（真实地图）：

1. `node scripts/fetch-atlas.mjs`（仓库根目录运行）下载 Atlas VTT release，放进 `campaign-vault/.obsidian/plugins/atlas-vtt/`；
2. 在 `atlas-agent-link/` 里 `npm install && npm run build`，把 `main.js` / `manifest.json` 放进 `campaign-vault/.obsidian/plugins/atlas-agent-link/`；
3. 用 Obsidian 打开 `campaign-vault`，启用两个插件，把 atlas-agent-link 设置里的 token 填进 `trpg-table/.env` 的 `ATLAS_TOKEN`；
4. `trpg-table` 启动时会连 Atlas（只在启动时连一次，所以 Obsidian 要先开）。

占位地图和 token 图可以用 `python trpg-table/scripts/make_placeholder_assets.py` 生成。

## 没有包含的东西（需要你自己准备）

仓库里**只有文字和代码**，没有任何图片 / 二进制，也没有任何密钥：

- **第三方素材**：战斗地图、token 图、立绘、官方模组资料都没放进来。`campaign-vault/LICENSES.md` 登记了作者本地 vault 里用过哪些来源和各自的许可证状态（其中不少是“未核实”，不要照搬当成可商用）。第二个剧本《通往凡达林的路》用到的场景地图需要自己下载（Manea Roliste 的森林路 / 森林营地战斗地图包、Dyson Logos 的 *The Deep Sepulchre*，链接和署名要求见 LICENSES.md），再用 `trpg-table/scripts/build_phandalin_maps.py` 生成场景文件。第一个剧本《银鸥号的残骸》用的占位图可以直接生成。
- **Atlas VTT**（第三方 Obsidian 插件）和 **Obsidian** 本体：用上面的脚本 / 官网下载。
- **API key、Atlas token**：`.env` 和插件 `data.json` 不进仓库。
- **VTuber 页面端**：link 服务（`:8098`）是为作者的 AITuberKit 分支写的，页面端的提示词和设置不在这个仓库里；不接页面也能跑。
- **Unity 舞台、直播姬 / OBS 的摆法**：不在这个仓库里。

## 许可证与署名

- **本仓库自己的代码（`trpg-table/`、`campaign-vault/` 里的文字、`docs/`）：作者还没选许可证**，在选定之前保留所有权利（可以读、可以学习，复用请先联系作者）。
- [`atlas-agent-link/`](atlas-agent-link)：AGPL-3.0-only（见其 `LICENSE`）。
- `trpg-table/src/rules/logic/`：规则逻辑改写自 [Open Dungeon Master](https://github.com/Lebbitheplow/open-dungeon-master)（MIT），署名和许可证全文见 [`trpg-table/src/rules/NOTICE.md`](trpg-table/src/rules/NOTICE.md)。
- 规则数据（武器、法术、怪物数值等）取自 **System Reference Document 5.1**，© Wizards of the Coast LLC，CC-BY-4.0：

  > This work includes material taken from the System Reference Document 5.1 ("SRD 5.1") by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document. The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License, available at https://creativecommons.org/licenses/by/4.0/legalcode.

- 剧本《通往凡达林的路》是原创故事，但使用了 D&D / 被遗忘的国度的地名和人名（Phandalin 等），属于同人内容；本项目与 Wizards of the Coast 无关，也未获其认可。

## 作者与过程

这个项目的代码和文档大部分是在和 AI 编码助手的协作里写出来的（`docs/history/` 里有当时的任务书）。
