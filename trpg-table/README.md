# trpg-table — AI 跑团桌

给直播用的 D&D 5e 桌面：**Claude 当 GM，DeepSeek 和 Gemini 各当一名玩家**，Helixus（AITuberKit 页面）追剧情、锐评，并可以用 `[game:建议]` 给 GM 提建议。地图/迷雾/先攻/骰子日志走 Atlas VTT（`127.0.0.1:27125`）。

```
Obsidian + Atlas ⇄ MCP/SSE ⇄ trpg-table ── helixus-link :8098 ── AITuberKit 页面
                                    └──── overlay :8099（iframe）── Atlas 玩家窗口（直播只采这一个 + HelixusStage）
```

直播画面是**一个窗口**：Atlas 的玩家窗口里，地图在中间，左右角色栏和底栏由透明 overlay iframe 叠上去，
固定 1920×1080 设计尺寸（屏幕装不下时等比缩）。trpg-table 启动时会自动调
`atlas_player_frame`（atlas-agent-link 0.3.0）把窗口摆好，不需要手动设置。

## 快速开始

```bash
# 1) 密钥（.env 已 gitignore；不要提交、不要打印）
copy .env.example .env
#    填 ANTHROPIC_API_KEY / GEMINI_API_KEY / DEEPSEEK_API_KEY
#    要接 Atlas 再填 ATLAS_TOKEN（campaign-vault\.obsidian\plugins\atlas-agent-link\data.json 里的 token）

# 2) 模型 ID：config/models.yaml 里带 TODO 的四个座位改成真实模型 ID

# 3) 冒烟（每个座位调一次真模型，不打印内容/密钥）
npm run models:smoke -- --write-doc

# 4) 启动（默认暂停；页面按 Ctrl+Alt+K 或 POST /pause 开始）
npm start

# 不连 Atlas（用内存桌面，模型仍然是真的）
npm start -- --dry

# 完全没有密钥时的本机演示（假模型，明确标假；不要直播）
npm start -- --fake --dry
```

- overlay（调试视图，不再单独用于直播）：<http://127.0.0.1:8099/overlay?bg=solid>
- 演出框检查：`node scripts\check-overlay.mjs`（面板不裁字/不压地图）；Atlas 对账：`node scripts\check-atlas-full.mjs`
- helixus-link：<http://127.0.0.1:8098/status>
- 健康检查：`GET /health`

## 文件

| 路径 | 是什么 |
| --- | --- |
| `config/models.yaml` | **换模型只改这里**：provider、模型 ID、max_tokens、代理 |
| `config/table.yaml` | 节奏（看点/决定/间隔/锐评秒数）、工具上限、建议开关、秘密开关 |
| `config/overlay.yaml` | 1920×1080 布局、配色、字号；左右栏 + 底栏同时算出地图 inset |
| `src/llm/` | 模型适配层（Anthropic / Gemini / OpenAI-compatible），流式、超时、重试、usage |
| `src/rules/` | 自写 5e 规则内核（2014 / SRD 5.1）：掷骰、检定、豁免、攻击（多攻、暴击、掩蔽、借机攻击）、伤害、状态、死亡与死亡豁免、法术位与专注、先攻与突袭、休息、擒抱 / 推撞、职业与种族特性。覆盖范围见 `docs/RULES_COVERAGE.md`；`logic/` 下的纯逻辑改写自 Open Dungeon Master（MIT，见 `src/rules/NOTICE.md`） |
| `src/rules/build/` | 角色构建器：种族 / 职业 / 等级 / 背景 / 属性 → 完整角色卡（`CharacterFile`） |
| `src/table/` | TableLoop 状态机、GM、玩家、renderer、视角隔离、事件总线；`roundClock.ts` 是回合计（第 N 轮、谁行动过、环境条目），说明见 `docs/HANDOFF_ROUNDS.md` |
| `src/atlas/` | Atlas MCP 客户端（只读事件/docs/INTEGRATION.md；不复制 AGPL 代码） |
| `src/link/` | helixus-link :8098（Host 校验、CORS 白名单、独占端口） |
| `src/overlay/` + `overlay/` | overlay :8099（静态页 + SSE，只显示） |
| `docs/` | RULES_SPIKE、PROBE_MODELS、HANDOFF、截图 |
| `logs/`、`state/` | 本地日志和存档（gitignore；崩了重启能接着跑） |

## 安全 / 边界

- 只听 `127.0.0.1`；link 校验 Host 与 CORS 白名单；overlay 没有任何写操作。
- 发往回环地址的请求永远不走代理；每个 provider 自己决定代理，不读系统代理。
- 原始思维链只写 `logs/table.jsonl`，**不上屏、不进 helixus-link 事件**；renderer 的每条 beat 必须有原文里逐字出现的 quote 才保留。
- 玩家视角只包含未隐藏、已揭示的 token；怪物 HP 只给描述；剧本秘密不进玩家输入（有测试）。
- Atlas 只由 trpg-table 写；规则层是 HP/先攻/状态的权威，写完回读核对。

## 测试

```bash
npm test          # 规则（含 5e 战斗 / 特性 / 构建器 / 法术数据）、位置/近战、视角隔离、renderer 校验、Atlas 同步、建议队列、服务安全、TableLoop 重启和整场假模型战斗
npm run typecheck
npm run build
```

> 本机沙箱不允许 Vite 的 `exec("net use")` 和 fork 子进程，`npm test` 走 `scripts/patch-exec.cjs` + 线程池；在你自己的机器上可以直接 `npm run test:plain`。

## 文档

- `docs/HANDOFF_PROGRESS.md`：进度管理——剧本里的 `## 节拍` / `## 自动出口`（确定性）+ 进度导演（Haiku 座位 `director`）；GM 工具 `mark_beat`
- `docs/HANDOFF_CAMPAIGN_STATE.md`：战役记忆（前情 / 世界事实）、背包 / 金币 / 战利品、剧本里的 `## 战利品`、角色卡 `kit`
- `docs/HANDOFF_ROUNDS.md`：回合计（探索 / 战斗共用的“第 N 轮”、世界回合、剧本里的 `## 环境`）
- `docs/HANDOFF.md`：做了什么 / 没做到 / 没验证 / 坑 / 风险 / 要用户决定的事
- `docs/FIX_RUN.md`：一个窗口 / 排版修复 / 桌面状态 / 15 分钟跑（最新）
- `docs/M2_RUN.md`：21 分钟真模型 + 真 Atlas 连跑报告（旧版）
- `docs/RULES_COVERAGE.md`：规则覆盖——哪些自动、哪些 GM 裁定、哪些没有
- `docs/RULES_SPIKE.md`：规则层选型调研（rpg-mcp / Railroaded / 自写）
- `docs/PROBE_MODELS.md`：模型字段实测记录
- `docs/ADVENTURE_CANDIDATES.md`：正式剧本/地图候选与许可证
