# HANDOFF — trpg-table 现状

> **2026-10-18：UI V2（场景为主 + 棋子气泡 + 右侧主播区）已替换左右人物栏，17:00 已用真实对局验证。
> 最新交接见 `HANDOFF_UI_V2.md`（实测和没验证分开写）。本文件 §2.2–§2.4、§3 里的
> 「一个窗口 / 左右 464px 人物栏 / 布局 A/B/C」是旧轮次内容，已作废。**

给下一个人（或下一个 AI 会话）看的。最后更新：2026-10-18 凌晨（演出框 + 15 分钟实测）。
配套：`docs/RULES_SPIKE.md`、`docs/PROBE_MODELS.md`、`campaign-vault/LICENSES.md`、
`campaign-vault/sprites/README.md`、`docs/ADVENTURE_CANDIDATES.md`。

---

## 0. 一句话现状

**已经真跑起来了**：真 Claude GM、真 DeepSeek 玩家 A、真 Gemini 玩家 B、真 DeepSeek renderer、
真 Obsidian + Atlas 0.8.0。**连续跑了 21.25 分钟真模型实况**（46 个玩家回合、2 场战斗、1 次切场景），
HP/先攻/骰子日志与 Atlas 对账一致；Helixus 建议走了完整的「提出 → GM 拒绝并给理由」一圈。
**2026-10-18 又做了「一个窗口」**：Atlas 玩家窗口 = 1920×1080 演出框（地图中间、左右角色栏、底部 GM/轮次），
真 Atlas + 真 overlay 跑了 15 分钟并每 5 秒自动检查；排版、骰子、移动/近战、重开局清理都改过。
详见 `docs/FIX_RUN.md`。

还没做的：完整 one-shot（第三幕）、AITuberKit 真页面 Ctrl+Alt+K（M5）、直播姬真实采集、60 分钟彩排（M7）。

**当前进程状态（2026-10-18 01:56）**：本轮结束时已把 trpg-table（8098/8099）和正式 vault 的
Obsidian（27125/9222）都停掉，四个端口没有 LISTENING；重启命令见 `HANDOFF.md` §4。
根目录的 `HANDOFF.md` 是本轮收尾摘要，本文件是长期交接。

---

## 1. 文件在哪

| 路径 | 是什么 |
| --- | --- |
| `trpg-table\` | 本项目（git，本地提交） |
| `src\llm\` | Anthropic / Gemini / OpenAI-compatible 适配层；超时、3 次指数退避、usage |
| `src\rules\` | 自写 SRD 5.1 子集规则内核 + 武器/法术/怪物数据 |
| `src\table\` | TableLoop、GM、玩家、renderer、视角隔离、事件总线 |
| `src\atlas\` | Atlas MCP 客户端、`atlas_roll_dice` 骰子源、规则层→Atlas 镜像 |
| `src\link\server.ts` | helixus-link :8098 |
| `src\overlay\server.ts` + `overlay\` | overlay :8099 静态页 + SSE |
| `config\{models,table,overlay}.yaml` | 模型 / 节奏 / 布局（overlay.yaml 同时决定地图 inset） |
| `docs\PROBE_MODELS.md` | **真 API 冒烟结果**（自动生成）+ Haiku 失败原因 |
| `docs\M2_RUN.md` | 21 分钟真模型 + 真 Atlas 连跑报告（旧版，2 条 beat、3 秒 renderer） |
| `docs\FIX_RUN.md` | **本轮：一个窗口 / 排版修复 / 桌面状态 / 15 分钟跑**（最新） |
| `docs\shots\frame-*.png` | 同一个 Atlas 玩家窗口的 1920×1080 截图（探索思考/看点+决定/战斗掷骰/精确 1920/长文本压力） |
| `docs\checks\*.json` | `check-overlay.mjs` 的输出（面板不裁字、不压地图、地图区域一致） |
| `scripts\check-overlay.mjs` | 演出框自动检查（CDP 读 overlay 自检报告） |
| `scripts\check-atlas-full.mjs` | 规则层 ↔ Atlas 对账：HP、格子、先攻、hidden |
| `scripts\capture-player.mjs` / `capture-on-roll.mjs` | 截玩家窗口 / 等到下一次掷骰再截 |
| `scripts\run-stats.mjs` / `cost-estimate.mjs` | 回合与 renderer 指标 / 按真实 usage 估算每小时费用 |
| `state\atlas-tokens.json` | trpg-table 自己建过/认领过的 token（重开局只删自己的） |
| `atlas-agent-link\` | Atlas Agent Link **0.3.0**：新增 `atlas_player_frame`（`src/atlas/playerFrame.ts`） |
| `scripts\` | 占位素材生成、open vault、CDP/Electron 截图、vitest 沙箱补丁 |
| `campaign-vault\` | 正式跑团 vault（Atlas 插件已装、写入已开、端口 27125） |
| `obsidian-data-campaign\` | 指向正式 vault 的独立 Obsidian profile |
| `<workspace>\start_trpg.bat` | 启动脚本（实测 `fake dry`；参数 dry/nolink/fake） |
| `<workspace>\aituber-kit\`（`unity-stage`） | 页面 trpg 接入，本地提交 `ec1e01ca`，没推送 |

---

## 2. 怎么跑（现在就能用）

### 2.1 模型

`config\models.yaml` 现在是**实测可用**的：

| 座位 | provider | model | 备注 |
| --- | --- | --- | --- |
| GM | anthropic | `claude-sonnet-5-5` | temperature **null**（5.5 已弃用这个参数） |
| 玩家 A | deepseek | `deepseek-reasoner` | `reasoning_content` 是**原文** |
| 玩家 B | gemini | `gemini-3.5-flash` | `includeThoughts` 给的是**思考摘要**；pro-preview 单回合 19s（有一次 197s），直播用 flash |
| renderer | deepseek | `deepseek-chat` | 654ms–3.4s；Claude haiku 之前 24/27 失败（temperature 400 + 3s 超时），见 `PROBE_MODELS.md` |

> **renderer 是谁**：它不是玩家，也不是 GM，是第四个模型座位（`seats.renderer`）。输入是玩家的
> 思维链原文/摘要 + 最终决定 + 简短局面，输出 `{beats, contrast, headline}`——也就是画面上
> 「心里想 / 反差 / 看点标题」。它不参与剧情、不掷骰、不改规则。和 AITuberKit 页面里 Helixus 的
> 模型是两回事。

冒烟（真 API，已跑过，4/4 OK）：

```powershell
cd trpg-table
npm run models:smoke -- --write-doc
```

### 2.2 Obsidian + Atlas

**当前这台机器上曾经有一个 Obsidian 用正式 profile 在跑**（我按用户授权启动的；本轮收尾已停，
重启命令见根目录 `HANDOFF.md` §4）：

```powershell
obsidian\Obsidian.exe --user-data-dir=obsidian-data-campaign --remote-debugging-port=9222
```

- 插件：Atlas VTT 0.8.0 + atlas-agent-link；`data.json` 里 `allowWrite: true`、端口 27125。
- 健康：`GET http://127.0.0.1:27125/health`（要 Bearer token；trpg-table 会自动从 vault 的 data.json 读，不打印）。
- Obsidian 首次会落在 starter 窗口；`scripts\open-campaign-vault.js` 走 CDP 打开正式 vault（已跑通）。

### 2.3 起桌面

```powershell
<workspace>\start_trpg.bat          # 默认 8098/8099，暂停
# 或 npm start -- --dry / --nolink / --fresh
```

- 默认暂停；`POST /pause {"paused":false}` 或页面 Ctrl+Alt+K 开始。
- `--fresh` 会清桌面存档，并**对齐 Atlas**：删掉自己建过、规则层已经没有的 token；校正 token 位置；
  重置先攻；清迷雾。实测日志：`Atlas 清理旧 token：沙华鱼人1、沙华鱼人2、锈蚀的守卫铠甲` /
  `Atlas 校正 token 位置：薇克丝 2,1 → 2,3`。
- 连上 Atlas 后会自动调用 `atlas_player_frame`，把玩家窗口变成 1920×1080 演出框；
  overlay 起来之后会再刷一次（`loop.refreshFrame()`）。
- `curl http://127.0.0.1:8098/status`、`/events?after=0`、`/trace`。

### 2.4 overlay / 演出框

- **直播采集的是 Atlas 玩家窗口**：Atlas 地图在中间，左右两栏和底栏由透明 iframe
  `http://127.0.0.1:8099/overlay?bg=transparent` 叠上去。用户 在直播姬里只采这个窗口 + HelixusStage。
- 调试视图（不再用于直播）：
  <http://127.0.0.1:8099/overlay?bg=solid>
  <http://127.0.0.1:8099/overlay?bg=transparent>
  <http://127.0.0.1:8099/overlay?bg=solid&demo=1>（长文本压力样例，不连桌面）
- 手动打开/关闭演出框：MCP 工具 `atlas_player_frame {enabled:true/false, url, insets, size, screenFit}`；
  trpg-table 正常启动/切场景会自动调。
- 自动检查：`node scripts\check-overlay.mjs --json state\checks\check.json`。

---

## 3. 真实验证记录（2026-10-17）

### M0 模型
`npm run models:smoke -- --write-doc`：4/4 OK。

| 座位 | 延迟 | 思维链 | 备注 |
| --- | --- | --- | --- |
| GM | 3.5s | 无 | 工具调用回合 6–11s，输入 ~32k tokens/回合 |
| 玩家 A | 1.7s | `raw` 30 字（复杂问题 265 字） | DeepSeek 原文 |
| 玩家 B | 3.7s | `summary` 883 字 | Gemini 摘要 |
| renderer | 0.65s | 无 | DeepSeek chat |

踩到的真问题（已修）：
- Claude 5.5 拒绝 `temperature` → 适配层支持 `temperature: null` 时不发字段。
- `gemini-3-pro` 不存在（404）→ 改用列表里真实存在的模型。
- Gemini pro-preview 有一次 197s → 换 flash，并把 thinking_budget 降到 2048。

**本会话实际 token**：早前小测试累计约 99 万 Claude 输入；之后 M2 21 分钟跑了
93 次 GM 调用（非缓存 4.5 万 + **缓存读 140 万**，缓存按 0.1x 计）、DeepSeek 5.1 万输入、
Gemini 5.3 万输入、renderer 4.4 万输入。明细见 `docs/M2_RUN.md`。

GM 的费用主要来自工具循环：一次 GM 回合通常要 2–3 次模型调用，每次带 30 多个工具 schema + 记录。
**已开 Anthropic prompt caching**（system + 最后一个 tool 打 `cache_control`），第二次起命中缓存，
非缓存输入从 ~32k 降到 1–2k。这一晚总费用约数美元，可能超过用户说的「几元以内」；
下次大测试前先确认预算。进一步优化：裁 Atlas 工具白名单、缩短系统提示词/记录。

### M3 Atlas（真 Obsidian + 真 Atlas）
- `atlas_open_scene` 打开 `scenes/crashed-ship-deck.atlasmap`；玩家窗显示地图（`atlas-vtt:show-map-in-player-window`）。
- 补 token：薇克丝 / 布拉姆 / 沙华鱼人甲/乙；图片用 `assets/tokens/*.png`。
- HP：`atlas_set_token_resources` 写入并回读，24/24、11/24、5/22、4/22 都一致。
- 先攻：`atlas_initiative` add/update/start，真桌面里 `isActive:true, round:2`，条目 19/19/18/0，与规则层一致。
- 骰子日志：`atlas_dice_log` 有 20 条真实记录（攻击、伤害、暴击、怪物攻击），例如
  `1d20+5 → 25`、`2d6+3 → 7（暴击）`、`1d20+3 → 11`。
- 条件：手工验证 `atlas_set_condition {ids,conditionId,active}` + `atlas_clear_conditions {id}` 成功；
  `AtlasSync` 已按单数 `id` 修正（之前写成 `ids` 导致每回合报错）。
- **切场景的 bug（M2 真跑发现）**：`AtlasSync` 换场景后还留着上一场的 token id，HP 写到旧 token 报
  `No token with id ... in the open scene`。修复：`openScene()` 清空 token 映射，再按名字重新找/补 token；
  重启后货舱 4 个 token 的 HP 全部一致。新增单测覆盖。
- 21 分钟跑完时 0 处 HP 不一致（抽查甲板、货舱、战斗回合）。

### M4 renderer + overlay
- **修复前 46 回合**（旧版）：grounded 18/46（39%），3 秒超时 10/46（22%）。原因：Gemini 摘要 1200–1900 字、
  DeepSeek 玩家约 1/4 回合不返回 reasoning。
- **7 秒预算 + 修复后 26 回合（最终跑）**：grounded 23/26（88%），超时 0，延迟 p50 1.96s / max 3.39s。
  更早一场 27 回合是 24/27（89%）。
  修复：Gemini 摘要截 600 字、局面截 450 字、maxTokens 400、英文先翻中文、prompt 最多 3 条；
  无 reasoning 时补一次「内心独白」，overlay 标「内心独白」（`reasoningElicited`）；
  超时显示一行小字。
- overlay 现在是演出框（见 §2.4）：左右各 464px，地图区域 952×1000（insets 484/484/0/80）；
  看点正文 30px，排版可缩到 26px 再按句截断。
- **overlay 显示 3 条 beat**（数据层最多 3 条）；长文本压力图 `frame-demo-long.png` 通过自动检查。
- Atlas 自带先攻栏在演出框里隐藏，轮次/先攻画在底栏（头像序列 + 当前高亮）。

### M5 helixus-link + 页面
- link 单测：Host/CORS/403/413/pause 映射都过。
- `[game:]` 在页面代码里的策略：放行、30 秒去重、不套 Minecraft 90 秒忙碌冷却、403 安静丢掉；
  AITuberKit 测试 27/27 过（原 22 + trpg 5）。
- **真页面没启动过**（见 §4）。

### 2026-10-18 修复轮（详见 `docs/FIX_RUN.md`）
- **一个窗口**：`atlas_player_frame`（atlas-agent-link 0.3.0）把玩家弹出窗口变成 1920×1080 演出框；
  屏幕 1707×1019 时装不下时等比缩到 1707×960，地图和面板一起缩；精确 1920 模式实测通过。
  同一窗口截图见 `docs/shots/frame-*.png`。
- **排版**：字号 30→26 逐步缩、再按句子截断；3 条 beat 能完整上屏；底栏叙述按先攻条宽度重排；
  连续自检 0 个面板溢出/压地图（见 §5 与 `docs/FIX_RUN.md`）。
- **骰子**：事件补 `modifier`，overlay 另加地图底边 `#dice-toast`，攻击骰保留 1.2 秒；
  截图里 `d20=13+2 vs DC 12 ✔`，不再 `+undefined`。
- **renderer**：预算 7 秒、英文摘要先翻中文、`isMetaReasoning` 丢掉「选表情」段、超时给一行小字、
  每回合写 `renderer_stats`。最终 15 分钟跑：超时 0/26，grounded 23/26（88%），p50 1.96s，max 3.39s。
- **桌面**：规则层位置 + `atlas_move_token` + 近战相邻/自动贴近；未揭示怪物 hidden；
  `state/atlas-tokens.json` 记录自己建的 token，重开局只删自己的并重置先攻/迷雾。
- **prompt caching**：system + 最后一个 tool 打 `cache_control`；GM 每回合非缓存输入 200–700，
  缓存读 1–1.6 万。费用按公开价估算：M2 21.5 分钟 $0.91（$2.53/小时）；15 分钟最终跑 $0.86
  （$3.38/小时，含首次缓存写 8.2 万）。详见 `docs/FIX_RUN.md`。

---

## 4. 没做到 / 没验证（明确列表）

| 项 | 现状 |
| --- | --- |
| M2 完整 20 分钟真遭遇 | ✅ **21.25 分钟、46 玩家回合、2 场战斗、1 次切场景**（旧版，2 条 beat/3 秒 renderer）；报告 `docs/M2_RUN.md` |
| 一轮「一个窗口」实测 | ✅ `docs/FIX_RUN.md`；15 分钟跑 + 同一玩家窗口截图 + 连续自动检查 |
| M4 renderer 20 回合指标 | ✅ 最终 15 分钟跑 26 个玩家回合：grounded 23/26（88%）、超时 0、p50 1.96s、max 3.39s |
| 精确 1920×1080 | ✅ `screenFit:false` 实测内容区 1920×1080，overlay `stage.scale=1`；平时默认按屏幕缩到 1707×960 |
| 面板不裁字 / 不压地图 | ✅ `check-overlay.mjs` 在 demo 长文本和真实对局均 0 失败；最终 15 分钟跑每 5 秒连续自检 **182/182 通过** |
| 骰子 `+undefined` | ✅ 截图 `d20=13+2 vs DC 12 ✔`；事件/schema 已补 modifier |
| 骰子提示不压卡片 | ⚠️ overlay 自己的骰子提示已固定在地图底边；Atlas 自带 `atlas-player-dice-rolls` 容器已移进地图区，但 MCP 掷骰时 Atlas 玩家窗不弹 toast，无法在真画面观察 |
| 怪物未登场隐藏 | ✅ 单测覆盖 hidden 语义；本项目未登场怪物没有 token（start_combat 才建），不会有可见残留 |
| 棋子移动 / 近战距离 | ✅ 真跑里玩家带 cell 的移动会动 token；怪物 monster_attack 自动贴近；规则层与 Atlas 格子一致（`check-atlas-full.mjs` 位置项） |
| 死亡怪物 HP=0 | ✅ 修复后 `syncActors` 不再跳过倒地怪物；最终跑里 Atlas HP 与规则层一致 |
| 直播姬采集 | ❌ 没碰直播姬；截图是 Electron `capturePage`，透明浏览器源也没测 |
| M5 AITuberKit 真页面 Ctrl+Alt+K | ❌ 页面没启动；只跑了 jest。但 helixus-link 侧建议闭环已用真 GM 验证（提出→拒绝并给理由） |
| M7 60 分钟彩排 | ❌ |
| 立绘 | ❌ 没有；overlay 是占位剪影 |
| M6 正式地图/剧本候选下载 | ❌ 当前用自编《银鸥号的残骸》+ 原创占位图；用户已同意 |
| 费用 | ✅ `docs/FIX_RUN.md` + `cost-estimate.mjs`：M2 $2.53/小时；15 分钟最终跑 $3.38/小时（含首次缓存写）；公开标价，不是账单 |
| 2024/SRD 5.2.1 | ❌ 当前 SRD 5.1 子集 |
| renderer 提前启动 | ❌ 仍是玩家完整 JSON 返回后才跑 renderer；用 7 秒预算覆盖，没做「思维链结束就开跑」的流式提前 |
| overlay 重启恢复 | ⚠️ 有 15 秒 watchdog 重载，但没在直播中真的重启 8099 验证 |
| 机会攻击/掩蔽/材料成分/路径阻挡 | ❌ 未自动判定；移动是直线贴近，没有墙/借机攻击 |
| 怪物特性自动化 | ⚠️ 部分只有 traits 文本 |
| 两个玩家同时倒地 / 团灭流程 | ⚠️ 没有专门收尾 |
| `atlas_screenshot` | ⚠️ GM 白名单里有，但强制 `target:"gm"`（防玩家窗闪烁）；没实测 |
| 页面共享的 Player view | ✅ 实测 Atlas 的 Player view 窗口出现了；但没在直播姬里合成 |

---

## 5. 已知坑（务必读）

1. **沙箱里不能用 esbuild/tsx/vitest forks/Edge**：构建用 `tsc`；`npm test` 走 `scripts/patch-exec.cjs` + threads；
   截图走 `scripts/capture-player.mjs` / `capture-on-roll.mjs`（CDP + Electron capturePage）。
   这些补丁只影响本机开发，不影响 `npm start`。
2. **Claude 5.5 不能发 `temperature`**；`config/models.yaml` 里用 `temperature: null`。
3. **`gemini-3-pro` 不存在**；Gemini 的模型名用 `/v1beta/models` 的列表核对。
4. **renderer 预算 7 秒**：DeepSeek chat 对 A 通常 1.2–2.3s；B 的摘要截到 600 字后大多 1.5–3.8s。
   超时会在画面上留「（思考摘要没来得及整理）」，不会空框。改回 3 秒前先测 B。
5. **GM 输入**：开了 prompt caching 后非缓存输入 1–2k/次，缓存读每次 1–1.6 万（0.1x）。
   别把 `cache_control` 去掉；去掉后单次回到 ~32k。
6. **token 归属**：`state/atlas-tokens.json` 记录 trpg-table 建过/认领过的 token；
   重开局只删记录里、规则层已经没有的。没有记录时才按 SRD 怪物名 + 编号兜底（可能误删同名 NPC）。
7. **切场景/重开局**：`AtlasSync.openScene()` 清空 token/位置/可见性缓存再按名字找；
   `--fresh` 还会 `cleanupOrphanMonsters()` + `resetInitiative()` + `clearFog()`。
8. **同名 token 可能在别的位置**：复用时必须按规则层 `actor.position` 校正（`syncAll` 会调
   `atlas_move_token` 并更新 `tokenCells`）。只改内存缓存不挪 token 会“看起来同步了，画面还在原处”。
9. **移动只有一个入口**：玩家 `action.cell` / 怪物 `monster_attack` 的 `approachTarget` /
   `AtlasSync.moveActor`。别在 GM 里手动 `atlas_move_token`，规则层位置会不一致。
10. **近战距离**：`engine.attack()` 会拒绝不相邻的近战；调用方要先 `approachTarget`。速度不够时
    整次行动非法，位置不动（不要让模型自己“走一半”）。
11. **没揭示的怪物 hidden=true**：`syncActor(actor, visibleActorIds)` 是唯一依据；
    `start_combat` 把怪加进 visible 后才可见。未登场的怪不要自己 `atlas_add_token`。
12. **演出框尺寸会被 Obsidian 抢回去**：`atlas_player_frame` 每 4 秒 `ensure()` 重新压回设计尺寸；
    实测 1707→1734 后 overlay 面板整体右移 15px，就是这一步救回来的。
    关闭时只 `setContentSize` 会被 Windows 夹宽（实测从 1920 恢复到 377px）；要先 `setBounds(originalBounds)`
    再 `setContentSize`，现在实测回到 1024×802。
13. **`atlas_player_frame` 要在 8099 起来之后调**：trpg 的 `init()` 早于 overlay 监听，
    main 在 `overlay.start()` 后又调 `refreshFrame()`；否则要等 15 秒 watchdog。
14. **overlay 布局和地图 inset 是同一份配置**：`config/overlay.yaml` 的左右栏 + `frame.gap`
   算出 insets，trpg 把它传给 `atlas_player_frame`。改面板位置/宽高后要重启 trpg（不是只刷新页面），
    否则 Atlas canvas 和面板会对不上。
15. **骰子提示只允许在地图底边**：`#dice-toast` 固定在地图区域底部；攻击骰保留 1.2 秒不被伤害骰盖掉。
    别把它移进角色栏，会压「做了」卡片。
16. **overlay 只显示 3 条 beat**：数据层最多 3 条；排版会缩到 26px 后按句子截断，
    自动检查保证 `scrollHeight <= clientHeight`。加第 4 条需要重排面板。
17. **Atlas 自带先攻栏在演出框里隐藏**：轮次/先攻改画在我们自己的底栏（头像序列 + 当前高亮）；
    关闭演出框会恢复 Atlas 的栏。
18. **overlay 卡片恢复**：新开窗口/刷新时通过 `overlayState().thoughts/decisions` 恢复最近一回合；
    重启进程后这些内存数据没了（只有存档，不含卡片）。
19. **Windows 端口复用**：link/overlay 用 `exclusive: true`；起之前确认没别的游戏代理占 8098。
20. **AITuberKit 保存会整页重载**：用户直播时不要保存 `src` 下任何文件；本次改动在 `unity-stage` 的 `ec1e01ca`。
21. **启动脚本是 CRLF + ASCII**：cmd 对 LF/中文编码很敏感；不要用 PowerShell `Set-Content` 改它。
22. **不要用 PowerShell `Set-Content` 改带中文的 YAML/JSON/TS**（本会话把 `overlay.yaml` 改成过乱码）；
    用编辑器/原样 UTF-8 写。PowerShell 5.1 默认还会写 BOM，Node JSON.parse 会报错。
23. **Atlas 条件 API**：`atlas_clear_conditions` 是单数 `{id}`；`atlas_set_condition` 是 `{ids:[…]}`。别写反。
24. **先攻同步是“镜像”**：规则层和 Atlas 各有一套轮转；trpg-table 在每步后调 `initiative next`，没做双向对账。
    15 分钟跑里条目/值一致，但长时间跑要观察。

---

## 6. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| GM 输入/缓存 | 费用与延迟 | prompt caching 已开（$2.5–3.4/小时估算）；继续裁工具 schema/缩短记录 |
| renderer 7 秒 | 超时就没有看点 | 15 分钟跑 0 超时；超时给一行小字，不空框 |
| 切场景/重开局 token | HP 写到旧 token | 已修 + 单测；token 记录 + 位置校正 |
| 同名 token 在别处 | 画面位置和规则层不一致 | `tokenCells` + 每次 sync 校正位置 |
| Atlas 场景残留 token | 画面出现上一场怪物 | `--fresh`/进场景清自己建的 token；不是自己的不动 |
| 迷雾 | 新场景留上一场的雾 | 进场景/重开局清雾；以后要固定迷雾需 pristine 场景 |
| 规则层与 Atlas 不一致 | 观众看到 HP/先攻对不上 | 每次写后回读；`check-atlas-full.mjs` 对账 |
| 直播中崩溃 | 断流 | 每步存档；重启恢复；Ctrl+C 优雅收尾 |
| 窗口尺寸被 Obsidian 抢回 | 面板和地图错位 | `ensure()` 每 4 秒重新压回 |
| NC 素材/版权 | 下播风险 | 当前全原创；第三方必须先进 LICENSES 再下载 |
| AITuberKit 改动 | 页面行为 | 只加分支；27 测试；未推送 |

---

## 7. 下一步（按顺序）

1. 在真页面上按 Ctrl+Alt+K，确认 Helixus 能对 `thought_beat` / `contrast` 锐评，并走一圈 `[game:]`（M5）。
2. 在直播姬里只采 Atlas 玩家窗口 + HelixusStage，验证透明 iframe、窗口捕获（尤其屏幕外的精确 1920 模式）。
3. 给 Atlas 玩家窗口的骰子 toast 做一次真实观察（MCP 掷骰时它不弹；如果直播里需要，改成 overlay 的 toast 就够了）。
4. 用户画立绘，按 `sprites/README.md` 放进去；overlay 热更新。
5. 60 分钟彩排（M7），出失败率、每小时费用和 5 个爆点截图。
6. 如果以后场景要固定迷雾：加 `scenes/pristine/` 或在场景 md 里写雾定义，别让 `clearFog()` 清掉。

---

## 8. 需要用户决定的事

1. **正式内容**：用户已选「自编 + 原创占位图」；正式直播前要不要换地图（候选见 `docs/ADVENTURE_CANDIDATES.md`）。
2. **人设定稿**：`campaign-vault/characters/player_{a,b}.json`（薇克丝 / 布拉姆）名字、性格、数值都可改。
3. **立绘**：按 `sprites/README.md` 出 8 张表情；没有就用剪影。
4. **`helixus_knows_secrets`**：默认开（GM 可给 Helixus 一句剧透暗示，prompt 要求不直接说破）；确认开/关。
5. **直播窗口**：只采 Atlas 玩家窗口 + HelixusStage。屏幕只有 1707×1019 时默认 1707×960；
   要精确 1920×1080 会有一部分窗口在屏幕外（`screenFit:false`），直播姬能否采到屏幕外区域要你试。
6. **节奏**：`config/table.yaml` 默认 看点 6s / 决定 4s / 间隔 2s / 锐评 8s。
7. **费用**：按公开价估算约 $2.5–3.4/小时（约 18–24 元/小时），15 分钟最终跑 $0.86；确认每小时预算。
8. **AITuberKit 何时落地页面测试**：用户不播时；保存 `src` 会整页重载。
