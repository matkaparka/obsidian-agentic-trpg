# FIX_RUN — 演出框 + 界面修复 + 桌面状态实测（2026-10-17 / 18 夜）

对应任务书：`TRPG_FIX_BRIEF.md`。上一份报告是 `docs/M2_RUN.md`（21 分钟旧版实跑）。

环境：真 Claude GM（`claude-sonnet-5-5`）+ 真 DeepSeek 玩家 A + 真 Gemini 3.5 flash 玩家 B +
真 DeepSeek renderer；真 Obsidian 1.14.4 + Atlas 0.8.0（正式 vault，27125 写入已开）；
Atlas Agent Link **0.3.0**（新增 `atlas_player_frame`）；trpg-table overlay :8099。

---

## 1. 一个窗口（任务书 §1）

### 1.1 做成了什么

`atlas_player_frame`（atlas-agent-link 0.3.0，源码 `src/atlas/playerFrame.ts`，工具 `src/tools/player.ts`）：

- 找到 Atlas 的玩家弹出窗口（`atlas-vtt-local-player`），把 `.atlas-local-player-content` 缩到
  **地图区域**：窗口减去左右栏和底栏。做法是 `left/top/width/height`，不是 padding
  （Atlas 的 canvas 是绝对定位，padding 无效）。
- 在这个窗口的 `body` 上注入一个 **透明 iframe**（`http://127.0.0.1:8099/overlay?bg=transparent`），
  `position:fixed; inset:0; pointer-events:none; z-index:2147483000`。观众看到的是同一个窗口：
  中间 Atlas 地图，左右角色栏，底部 GM 叙述/轮次。
- 打开时把内容区设成设计尺寸 **1920×1080**。屏幕 work area 只有 1707×1019 时默认按比例缩到
  **1707×960**（`screenFit:true`），地图和面板一起缩，overlay 的 `fit()` 同步缩放；
  需要精确 1920×1080 时传 `screenFit:false`（窗口会有一部分在屏幕外，但 `capturePage` 仍能拍全）。
- 隐藏 Atlas 自带先攻栏（`.atlas-player-initiative-container`），关闭时按保存的 `style` 原样恢复。
- Atlas 自己的骰子容器 `.atlas-player-dice-rolls` 移进地图区域底边（`position:fixed`），
  不再压在右下角「做了」卡片上。overlay 自己另有一条骰子提示（见 §2.3）。
- 镜头：布局完成后按背景图尺寸 `setCamera({x:宽/2,y:高/2,scale:min(视口/图)})`；
  换场景、窗口尺寸变化会重新算。地图 1400×1000、地图区域 952×1000 时 scale≈0.600。
- 稳：每 4 秒 `ensure()`，玩家窗口被 Obsidian 恢复成别的尺寸会重新压回设计尺寸；
  iframe 用 `postMessage` 上报心跳，15 秒没消息就重载；关闭时恢复 DOM/样式/窗口尺寸/相机。
- URL 白名单：只接受 `http://127.0.0.1:<port>/...`，拒绝 https、localhost、外网、user:pass、
  `javascript:`/`file:`。有单测（`test/playerFrame.test.ts`）。

### 1.2 实测

| 项 | 结果 |
| --- | --- |
| 玩家窗口注入 | ✅ 真 Obsidian + Atlas，`atlas_player_frame` 返回 `applied:true`，iframe ready |
| 1920×1080 设计尺寸 | ✅ `screenFit:false` 时窗口内容 1920×1080，overlay 报告 `stage.scale=1` |
| 屏幕装不下时等比缩 | ✅ 默认 1707×960，`designScale=0.8890625`；报告 viewport 1707×960，面板/地图一起缩 |
| 地图区域 | ✅ 内容宿主 484..1436（窗口坐标），overlay 报告地图 484..1436；`mapMatches:true` |
| 相机适配 | ✅ 1400×1000 背景在地图区域里 `scale≈0.600`，整张图可见 |
| 面板不压地图/不裁字 | ✅ 见 §5 自动检查；demo 长文本和真实对局都 0 失败 |
| 关闭还原 | ✅ `enabled:false` 后 iframe 移除、`.atlas-local-player-content` 的 `style` 还原、Atlas 先攻栏恢复、窗口内容回到 1024×802、相机回写 |
| 窗口在屏幕边缘时恢复 | ✅ 只按 `setContentSize` 恢复会被 Windows 夹成 377px 宽；改成先 `setBounds(originalBounds)` 再 `setContentSize(originalContentSize)`，实测回到 1024×802 |

截图（都是同一个 Atlas 玩家窗口）：

- `docs/shots/frame-explore-thinking.png` — 探索中，A 正在思考（左侧「思考中…」+ 立绘 thinking）
- `docs/shots/frame-thought-decision.png` — 看点和决定同时在画面上
- `docs/shots/frame-combat-roll.png` — 战斗中，底栏先攻条 + 骰子结果
- `docs/shots/frame-exact-1920.png` — 精确 1920×1080，骰子提示 `d20=13+2 vs DC 12 ✔`（无 `+undefined`）
- `docs/shots/frame-demo-long.png` — 用 logs 里最长的真实 beat/台词做的排版压力图

---

## 2. 界面问题（任务书 §2）

### 2.1 字被裁掉

overlay 的排版改成运行时适配（`overlay/app.js`）：

1. 字号从配置值逐步缩到 **26px**（看点正文/台词），标题最小 26px；
2. 仍放不下就在句子边界截断并加「…」；先截标题，再截最长的 beat，最后截台词；
3. 「做了」卡按 台词 → 动作 → 反差 的顺序缩/截；
4. 底栏叙述按先攻条出现后的实际宽度重排（先攻条会占 380px，之前会把它挤溢出）；
5. 自动检查把 `scrollHeight <= clientHeight`、`scrollWidth <= clientWidth` 都算进去。

压力数据用的是 `logs/table.jsonl` 里最长的真实文本（27/26/25 字 beat、51 字台词、76 字动作描述），
不是编的短句。demo 长文本截图 `frame-demo-long.png`，自动检查 `check-overlay-demo.json` 通过。

### 2.2 骰子 `d20=4+undefined`

- `publishRoll` 现在把 `modifier` 一起发进事件；overlay 仍保留 `total - natural` 的兜底。
- 精确 1920 截图里显示 `薇克丝 感知检定：d20=13+2 vs DC 12 ✔`，没有 undefined。
- link 事件同样：`d20=7+3`、`d20=12+5` 等（`/events` 可查）。

### 2.3 骰子提示位置

- Atlas 的骰子容器移进地图区域底边；
- overlay 新增 `#dice-toast`：地图区域底边居中，最多 880px，8 秒后消失；**攻击骰会保留 1.2 秒**，
  不会被紧跟的伤害骰立刻覆盖，观众能先看清 d20；
- 自动检查里骰子提示不算面板，允许短暂停留在地图底边（任务书明确允许）。

### 2.4 第 0 轮

- overlay 的 round 统一 `Math.max(1, round)`；`combat_start` 事件带 `round` 和先攻序列；
- 实测底栏显示「第 2 轮 · 轮到 锈蚀的守卫铠甲」，没有再出现第 0 轮。

### 2.5 Gemini 的「心里想」是空的

- renderer 预算从 3 秒放宽到 **7 秒**（`runRenderer` 默认和 TableLoop 都传 7000）。
- renderer 提示词明确要求：**英文原文先翻成中文**再写 beat/headline/contrast。
- 超时/没有可上屏内容时，overlay 显示一行小字，不留空框：
  「（思考摘要没来得及整理）」「（这一回合没有思考内容）」「（这回合没有可上屏的看点）」。
- 每回合写 `renderer_stats` 到 `logs/table.jsonl`（该玩家累计 total/timeouts/timeoutRate/latency）。
- 实测（15 分钟最终跑）：renderer 超时 0/26；有 grounded beats 23/26（88%），p50 1.96s，max 3.39s。
- Gemini 的英文摘要被翻成中文后上屏，见 `frame-combat-roll.png` 右侧「思考摘要」。

### 2.6 renderer 把「选表情」写成心里话

- `src/table/safety.ts` 新增 `isMetaReasoning()`：JSON、expression、表情名 + 选/填/更合适、
  「我需要以 XX 的身份」等语境一律丢；普通英文思考（`I am thinking about the lock`）不误杀。
- renderer 提示词写了同一条规则。
- 单测：`把「选表情」这类格式思考当成心里话的 beat 会被丢掉`、`meta 内容也不会变成 headline/contrast`、
  `正常的英文思考不会被当格式丢掉`。

### 2.7 immediate 一次推太多

- 每回合只有 **分数最高的那条 beat** 和 **contrast** 是 immediate，其余 beat 全部 soon。
- `/events?after=0` 实测：3 个回合共 3 条 immediate beat + 3 条 immediate contrast，其余 5 条 beat 是 soon；
  对比修复前同回合 3 条 beat 全 immediate + contrast，一次推 4 条。

---

## 3. 桌面状态（任务书 §3）

### 3.1 `--fresh` 清掉上一局的残留

- `state/atlas-tokens.json` 记录 trpg-table 建过/认领过的 token（按场景 + actorId）。
- 启动 / 进新场景：打开场景 → 删掉「记录里有、规则层已经没有」的 token → 重置先攻 → 清迷雾 →
  按规则层位置补/校正 token。
- 实测日志（`run-final2.log` 开头）：

```
Atlas 清理旧 token：沙华鱼人1、沙华鱼人2、锈蚀的守卫铠甲
Atlas 校正 token 位置：薇克丝 2,1 → 2,3
```

- 不是 trpg-table 建的 token 不动：有记录时只认记录里的 id；没有记录时才按 SRD 怪物名 + 编号兜底。
- 先攻：`resetInitiative()`（reset + end + tracker close）。
- 迷雾：当前三张场景图没有迷雾定义，进新场景/重开局会清空；如果以后场景要固定迷雾，需要加
  pristine 场景文件（见 HANDOFF §5）。

### 3.2 怪登场前不剧透

- 规则层的 `visibleActorIds` 是唯一依据。`AtlasSync.syncActor(actor, visible)` 对怪物写
  `isHidden = !visible.has(actor.id)`；单测覆盖「没揭示 hidden=true，揭示后 false」。
- 本项目在 `start_combat` 时才建怪 token（建出来时战斗已开始，所以 visible），未登场的怪没有 token，
  画面不可能剧透。GM 提示词也明确：不要自己 `atlas_add_token` 放怪，用 `start_combat` / `reveal_area`。
- 旧局留下的可见鱼人 token 已由 §3.1 的清理删掉。

### 3.3 棋子真的移动 / 近战距离

- `Actor.position {col,row}` 进规则层和存档；`legalActions` 的「移动」列出速度范围内可到的格子。
- 玩家 JSON 可带 `action.cell {col,row}`；执行时校验速度，写位置、消耗移动力、调 `atlas_move_token`，
  发 `move` 事件（例：`薇克丝 从 (2,3) 移到 (2,2)`）。
- 近战：`engine.attack()` 会检查相邻（Chebyshev 1 格 = 5 尺），不相邻直接拒绝；
  `approachTarget()` 在速度内自动走到相邻格，走不到就整次行动非法、位置不动。
  玩家攻击和怪物 `monster_attack` 都先调它。
- Atlas 同步：`syncPosition`/`moveActor` 按规则层位置写 `atlas_move_token`，并用 `tokenCells` 记录
  Atlas 的真实格子；复用上一场的同名 token 时先校正位置（实测 2,1→2,3、3,3→2,3）。
- 单测（`test/rules.test.ts`）：超出距离的近战被拒、速度内自动接近、速度不够整次非法、
  legalActions 给可达格、位置进存档；`test/atlasSync.test.ts`：位置变更写 `atlas_move_token`、
  复用 token 校正位置、未揭示怪物 hidden。
- 实测：玩家的移动动作带 cell 时 token 真的动了；怪物 `monster_attack` 从 (8,7) 自动贴到 PCs 身边，
  Atlas 格子与规则层一致（`scripts/check-atlas-full.mjs`）。

---

## 4. 文档和成本（任务书 §4）

- HANDOFF 已按实测更新；Haiku 失败原因写进 `docs/PROBE_MODELS.md`。
- 启动提示：不再说「模型 ID 还是占位名」；只对真正可疑的 ID 提示去核对冒烟结果。
- **prompt caching**：Anthropic system + 最后一个 tool 打 `cache_control`；`usage.jsonl` 里
  `cacheReadTokens` 从 0 变成每回合 1–1.6 万，非缓存输入 200–700。15 分钟那场 GM 58 次调用：
  非缓存 25,519 / 缓存读 882,676 / 缓存写 82,387 / 输出 11,371。
- 费用估算脚本 `scripts/cost-estimate.mjs`（公开标价，不是账单）：
  - M2 21.5 分钟窗口：**$0.91 ≈ $2.53/小时**；
  - 15 分钟最终跑：**$0.86 / 15.3 分钟 ≈ $3.38/小时**（缓存写 8.2 万，首轮建缓存更贵）；
    按 7.1 汇率约 18–24 元/小时。

---

## 5. 自动检查

```powershell
# 演出框：面板不裁字、不压地图、地图区域和 canvas 宿主一致
node scripts\check-overlay.mjs --json state\checks\check.json

# 规则层 ↔ Atlas：HP、格子、先攻、hidden
node scripts\check-atlas-full.mjs

# 15 分钟那场的连续自检（每 5 秒一次）
Get-Content state\frame-check.log
```

15 分钟最终跑（00:19:53 起）的连续自检结果写在 `state/frame-check.log` 与 `state/checks/`；
结果见本文件末尾的「实测记录」。

---

## 6. 明确没验证 / 没做到

| 项 | 现状 |
| --- | --- |
| 直播姬真的采集这个窗口 | ❌ 没碰直播姬；截图是 Electron `capturePage` |
| 直播姬里透明/浏览器源 | ❌ 未测 |
| 屏幕装不下时窗口有一部分在屏幕外 | ⚠️ 精确 1920 模式下会发生；capturePage 能拍全，但直播姬是否能采集屏幕外区域未验证 |
| Atlas 自己的骰子 toast | ⚠️ 容器已移进地图底边，但 Atlas 玩家窗口在 MCP 掷骰时不弹 toast（实测没出现），所以「不压卡片」只在样式层面保证 |
| AITuberKit 真页面 | ❌ 本轮没启动页面（任务书 §5 不让改页面） |
| 60 分钟彩排 | ❌ |
| 机会攻击/掩蔽/路径阻挡 | ❌ 移动是直线贴近，没有墙/借机攻击 |
| 思维链一结束就提前渲染 | ❌ renderer 仍在玩家完整 JSON 返回后才启动；用 7 秒预算覆盖，没做流式提前 |
| overlay 服务重启后 iframe 自动恢复 | ⚠️ 代码有 15 秒 watchdog 重载，但没在直播中真的重启 8099 验证 |
| 关闭演出框后截图逐像素对比 | ⚠️ 只验证了窗口内容 1024×802、iframe 移除、style 还原；没有和开启前截图做像素 diff |
| 死亡怪物的 token 清理 | ⚠️ 现在会把 HP 写 0，但不会删 token（地图上会留尸体） |

---

## 7. 实测记录（15 分钟最终跑）

| 项 | 值 |
| --- | --- |
| 时间 | 2026-10-18 00:19:53 → 00:35:00（15.1 分钟），真模型 + 真 Atlas + 演出框 |
| 玩家回合 / GM 回合 | 26 / 22 |
| 场景 / 战斗 | 第一幕甲板；1 场战斗（start_combat 1、end_combat 1） |
| 连续自动检查 | **182 次，182 次 OK，0 次 FAIL**（每 5 秒一次，`state/frame-check.log` / `docs/checks/frame-check.log`） |
| renderer | grounded 23/26（88%）、超时 0、p50 1.96s、p90 3.13s、max 3.39s |
| GM 延迟 | p50 8.35s、max 27.4s（工具循环最长的一次） |
| 规则层 ↔ Atlas | `check-atlas-full.mjs` 0 mismatch（HP/格子/先攻/hidden）；死亡鱼人在 Atlas 里 HP=0 |
| 起始清理 | 删掉上一局 3 个怪物 token、把薇克丝从 2,1 校正回 2,3 |
| token / 费用 | GM 非缓存 25,519 / 缓存读 882,676 / 缓存写 82,387 / 输出 11,371；按公开价 $0.86，折合 $3.38/小时 |
| 失败 | 无。唯一一次自检失败是更早 00:01 那场里底栏叙述被先攻条挤溢出，已修并复测（v4 之后全过） |

截图（最终跑之前 00:01 那场同窗口，1920×1080 输出）：

- `docs/shots/frame-explore-thinking.png`
- `docs/shots/frame-thought-decision.png`
- `docs/shots/frame-combat-roll.png`
- `docs/shots/frame-exact-1920.png`（精确 1920，`d20=13+2 vs DC 12 ✔`）
- `docs/shots/frame-demo-long.png`（最长真实文本压力图）

自动检查输出：`docs/checks/*.json`、`docs/checks/frame-check.log`、`docs/checks/final-stats.json`、
`docs/checks/atlas-mid.json`。
