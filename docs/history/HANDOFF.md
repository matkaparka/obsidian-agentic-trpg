# HANDOFF — trpg-table 本轮收尾（2026-10-18）

> **2026-10-18 15:45：UI V2 已替换左右人物栏。最新状态/交接见
> `HANDOFF_UI_V2.md`；本文件里的左右人物栏、布局 A/B/C 和 15 分钟结论是旧轮次的，
> 不要当成 V2 现状。**

给 用户 / 下一个会话看的。详细实测报告在 `trpg-table/docs/FIX_RUN.md`，详细交接在
`trpg-table/docs/HANDOFF.md`；这一份是本轮结束时的状态和重启方法。

---

## 0. 一句话

「角色界面合进 Atlas 玩家窗口」做完了：Atlas 玩家弹出窗口本身就是 1920×1080 的直播画面
（地图中间、两名玩家左右、底部 GM 叙述/先攻/轮次）。真模型 + 真 Atlas + 真 overlay 跑了
**15 分钟**，每 5 秒自动检查一次，**182/182 通过**（0 个面板裁字、0 个面板压地图）。
后台进程和端口已全部停掉。

---

## 1. renderer 是谁

renderer 不是玩家，也不是 GM，是**第四个模型座位**（`config/models.yaml` 的 `seats.renderer`）：

- 输入：某个玩家这一回合的思维链原文 / Gemini 的思考摘要 + 他最终的决定 + 简短局面；
- 输出：JSON `{beats, contrast, headline}`，也就是观众看到的「心里想」「反差」「看点标题」；
- 它只做「把思维链加工成观众看得懂的话」，不参与剧情、不掷骰、不改规则、不替玩家做决定；
- 当前模型：**DeepSeek `deepseek-chat`**（654ms–3.4s，便宜、中文 JSON 稳）；
- 早期用过 Claude Haiku，27 次失败 24 次（temperature 400 + 3 秒超时），已换掉，原因写在
  `trpg-table/docs/PROBE_MODELS.md`；
- 代码入口：`src/table/renderer.ts` 的 `runRenderer()`；预算 7 秒，超时时画面留一行
  「（思考摘要没来得及整理）」，不会空框；
- 它和 Helixus 无关：Helixus 是 AITuberKit 页面自己的模型，只消费 `helixus-link` 事件。

---

## 2. 这轮做完的

### 2.1 一个窗口（任务书 §1）

- atlas-agent-link 升到 **0.3.0**，新增 MCP 工具 `atlas_player_frame`
  （源码 `src/atlas/playerFrame.ts`，工具 `src/tools/player.ts`）。
- 把 Atlas 玩家窗口的 `.atlas-local-player-content` 缩成地图区域，透明 iframe
  (`http://127.0.0.1:8099/overlay?bg=transparent`) 叠在顶层，画左右角色栏和底栏。
- 设计尺寸 1920×1080；屏幕 work area 只有 1707×1019 时默认等比缩到 1707×960
  （`screenFit:false` 可强制精确 1920，实测 `stage.scale=1`，截图 2880×1620 原生）。
- 隐藏 Atlas 自带先攻栏；把 Atlas 骰子容器移进地图区域底边；镜头自动适配背景图。
- 关闭时恢复 DOM/style/窗口（先 `setBounds` 再 `setContentSize`，否则贴边窗口会被 Windows
  夹成 377px）和相机。
- URL 白名单只允许 `http://127.0.0.1:<port>/…`，有单测。

### 2.2 界面（任务书 §2）

- 字号 30→26 逐步缩、句子边界截断加「…」；3 条 beat 能完整上屏；底栏叙述按先攻条宽度重排。
- 骰子事件补 `modifier`，不再 `+undefined`；overlay 新增地图底边 `#dice-toast`，攻击骰保留 1.2 秒。
- 轮次 clamp，不再第 0 轮。
- Gemini 空看点：预算 7 秒、英文摘要先翻中文、超时一行小字、每回合写 `renderer_stats`。
- 「选表情/JSON/expression」这类格式思考用 `isMetaReasoning()` 丢掉，有 3 个单测。
- 每回合只有最高分 beat + contrast 是 immediate，其余 soon（一次不再推 4 条）。

### 2.3 桌面（任务书 §3）

- `state/atlas-tokens.json` 记录 trpg-table 建过/认领过的 token；`--fresh`/新场景删自己的旧 token、
  校正位置、重置先攻、清迷雾。
- 未揭示怪物 `hidden=true`（单测），战斗开始才可见；不碰不是自己建的 token。
- 规则层 `Actor.position` + `atlas_move_token`；玩家行动可带 `cell`；近战必须相邻，速度内自动贴近，
  够不到整次非法；怪物 `monster_attack` 同样先贴近。
- 死亡怪物 HP 写 0（之前会停在被击杀前）。

### 2.4 文档与成本（任务书 §4）

- `trpg-table/docs/HANDOFF.md` 已按实测重写；`docs/FIX_RUN.md` 是这轮的完整报告。
- `docs/PROBE_MODELS.md` 补了 Haiku 失败原因。
- 启动时不再提示「模型 ID 还是占位名」。
- prompt caching 已开且实测命中（GM 每回合非缓存输入 200–700，缓存读 1–1.6 万）。
- 费用（公开标价估算，不是账单）：M2 21.5 分钟 $0.91（$2.53/小时）；
  15 分钟最终跑 $0.86（$3.38/小时，含首次缓存写 8.2 万）。

---

## 3. 实测与证据

| 项 | 结果 |
| --- | --- |
| 15 分钟真游戏 | 00:19:53 → 00:35:00；26 玩家回合 / 22 GM 回合；1 场战斗 |
| renderer | grounded 23/26（88%），超时 0，p50 1.96s，max 3.39s |
| 连续自动检查 | 182 次，182 OK，0 FAIL（`docs/checks/frame-check.txt`） |
| 规则层 ↔ Atlas | `check-atlas-full.mjs` 0 mismatch（HP / 格子 / 先攻 / hidden） |
| 截图（同一玩家窗口，1920×1080） | `frame-explore-thinking.png`、`frame-thought-decision.png`、`frame-combat-roll.png`、`frame-exact-1920.png`、`frame-demo-long.png` |
| 自动检查输出 | `trpg-table/docs/checks/*.json` |
| e2e / security | e2e 40 次调用 0 失败（第一次有一次场景加载偶发失败，重跑通过）；security 13/13，62 个工具 |

没验证 / 没做到：

- 直播姬真实采集（尤其精确 1920 时窗口有一部分在屏幕外）；
- Atlas 自带骰子 toast（MCP 掷骰时玩家窗不弹，只保证容器位置）；
- AITuberKit 真页面 Ctrl+Alt+K（M5）；
- 60 分钟彩排（M7）；
- renderer 在思维链结束瞬间的流式提前启动（仍等完整 JSON，用 7 秒预算覆盖）；
- overlay 服务重启的直播中验证；关闭前后逐像素对比。

---

## 4. 端口与重启

**现在所有端口都已释放**：8098 / 8099 / 27125 / 9222 都没有 LISTENING。

启动顺序：

```powershell
# 1) Obsidian（正式 vault，独立 profile）
obsidian\Obsidian.exe `
  --user-data-dir=obsidian-data-campaign `
  --remote-debugging-port=9222

# 2) trpg-table（默认暂停；演出框会自动打开）
cd trpg-table
npm start                 # 或 <workspace>\start_trpg.bat（8098/8099）
# 需要干净桌面：npm start -- --fresh
```

- 开播：`POST http://127.0.0.1:8098/pause` body `{"paused":false}`，或页面 Ctrl+Alt+K。
- 状态：`GET http://127.0.0.1:8098/status`。
- 关演出框：MCP 工具 `atlas_player_frame {"enabled":false}`。
- 只跑 overlay 调试：<http://127.0.0.1:8099/overlay?bg=solid>。

---

## 5. 仓库

- trpg-table：本地提交，未推送。最后几个：
  `bac40f1` iframe reload 修复；`38dc435` 去掉占位模型提示；
  `8fcbc24`/`488d163`/`11a4dae` 文档与检查日志；`2d8703c` 一个窗口 + 15 分钟实测。
- atlas-agent-link：不是 git 仓库；交付目录与 `project/` 的 `main.js` sha256 一致：
  `8541AAE0A2661BC8E807B03083DA9983D2F36895987D68A8A87B45E185CBA314`
  （0.3.0，62 个工具，77 个测试）。
- 详细文件索引见 `trpg-table/docs/HANDOFF.md`；详细实测见 `trpg-table/docs/FIX_RUN.md`。
