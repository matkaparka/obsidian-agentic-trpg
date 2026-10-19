# 交接 — Atlas Agent Link 现状

给下一个人（或下一个 AI 会话）看的。**先看这一份，再按需跳到 `docs/PROBE.md` / `docs/E2E.md` /
`docs/INTEGRATION.md`。**

最后更新：2026-10-17

---

## 0. 一句话现状

Atlas VTT 0.8.0 的 AI 控制层**已经真实跑通**：62 个 MCP 工具能读写 token / 迷雾 / 墙门 / 光源 /
先攻 / 骰子 / 镜头 / 玩家窗口，事件流语义化并有断线重放，安全约束按任务书第 6 节做了且逐条验证过。
v0.3.0 新增 `atlas_player_frame`：把 Atlas 的玩家弹出窗口变成直播采集用的 16:9 演出框——地图缩到中间，
透明 overlay iframe 叠在左右两栏和底栏上，窗口尺寸/相机由工具自己算，关闭时原样还原。
**没有**做的：骰子 3D 动画触发、官方扩展 API（不存在）、Atlas 其他版本。

数字：`Atlas 0.8.0 / Obsidian 1.14.4` · 133 个真实 store action · 62 个工具 · 18 种事件 ·
77 个测试 · 13/13 安全检查 · 端到端 40 次调用 0 失败。

---

## 1. 文件在哪

| 路径 | 是什么 |
| --- | --- |
| `atlas-agent-link/` | **交付版**：源码 + 测试 + 文档 + 构建好的 `main.js`（sha256 与已部署的一identical） |
| `project/` | 同一份源码的**可构建副本**（含 `node_modules`）。交付目录对沙箱 shell 只读，所以 `npm` 相关操作都在这里跑 |
| `vault/` | 测试 vault（`scenes/*.atlasmap`、`assets/` 里的测试图）。**不是**用户的真实 vault |
| `obsidian-data/` | 给测试用的独立 Obsidian profile，`obsidian.json` 指向上面的 vault |
| `downloads/atlas-vtt-0.8.0/` | 官方 release 产物（带 sha256 校验）+ 同 tag 源码（读契约用） |
| `docs/shots/*.png` | 端到端每步的真实截图（雾、token、战斗、玩家窗、hex） |

`atlas-agent-link/` 里的文件清单：

```
main.js  manifest.json  package.json  package-lock.json  README.md  LICENSE(AGPL-3.0)
esbuild.mjs  tsconfig.json  vitest.config.ts  .gitignore
src/     main.ts settings.ts events.ts http.ts util.ts errors.ts
         atlas/{adapter,grid,shapes,screenshot,playerFrame}.ts   ← adapter / playerFrame 是仅有的两个碰 Atlas DOM 的文件
         mcp/server.ts   tools/{index,shared,scene,objects,combat,player}.ts
test/    core.test.ts grid.test.ts tools.test.ts fixture.test.ts
         fixtures/scene-snapshot.json  ← 真实 store 快照（3 token / 2 墙 / 1 灯 / 先攻 / 骰子日志）
         stubs/obsidian.ts             ← npm 的 obsidian 包只有类型，测试用桩
docs/    PROBE.md  E2E.md  INTEGRATION.md  HANDOFF.md(本文件)  e2e-raw.json  hex-raw.json
         player-sync-raw.json  shots/
scripts/ cdp.mjs(驱动 Obsidian 渲染进程) e2e.mjs security-check.mjs player-sync.mjs hex-check.mjs
         mcp-client.mjs dump-state.js enable-plugins.js enable-writes.js reload-plugin.js open-vault.js
```

---

## 2. 怎么跑起来 / 怎么复现

```bash
# 构建与测试（在 project/ 里，那里有 node_modules）
cd project
npm test                 # 77 tests（脚本已带 sandbox patch + threads pool）
npm run typecheck        # tsc --noEmit，目前 0 错误
npm run build            # → main.js（esbuild 要起子进程；DSH 沙箱里需要完全权限）

# 部署到测试 vault
copy main.js + manifest.json → vault\.obsidian\plugins\atlas-agent-link\
# 重载插件（改设置、开写入）
node scripts\cdp.mjs --file scripts\enable-writes.js
```

启动 Obsidian（必须在**完全权限**下启动，沙箱内 Electron 会立刻退出）：

```
obsidian\Obsidian.exe --user-data-dir=obsidian-data --remote-debugging-port=9222
```

如果它落在 starter 窗口（没有 vault 列表），用 `scripts/open-vault.js` 那套技巧：CDP 里
`require('electron').remote` 改写 `dialog.showOpenDialog`，再点"打开"。

运行时端点与凭据：

```
MCP      http://127.0.0.1:27125/mcp      Authorization: Bearer <token>
事件     http://127.0.0.1:27125/events   （SSE，Last-Event-ID 重放，?since=<seq> 也行）
健康     http://127.0.0.1:27125/health
token    vault\.obsidian\plugins\atlas-agent-link\data.json 里的 "token"
```

一次性回归（三条命令，覆盖验收）：

```bash
node scripts\e2e.mjs            # 端到端 → docs/e2e-raw.json + docs/shots/
node scripts\security-check.mjs # 13 项安全验收，非 0 退出即失败
node scripts\hex-check.mjs      # 六边形落点 → docs/hex-raw.json + shots/10-hex-grid.png
node scripts\player-sync.mjs    # 玩家窗口是否跟随 store 写入
```

---

## 3. 做了什么（对照任务书 §3 的 9 步）

| 任务书步骤 | 状态 | 证据 / 备注 |
| --- | --- | --- |
| 1. 环境：确认 Obsidian + Atlas 0.8.0，没有就建测试 vault | ✅ | 全机原先没有 Atlas；从 release 装 0.8.0 到 `vault/`，独立 profile 启动 |
| 2. 构建并装载原型 | ✅ | 原型能装能跑，但一跑就发现与真实 store 大量不符（见下一步） |
| 3. 探测真相 → `docs/PROBE.md` | ✅ | CDP 进渲染进程直接读 store：133 action、完整状态形状、28 个命令 |
| 4. 按真实形状修正 + 补工具 | ✅ | 20 → **61** 个工具；网格数学 1:1 移植（方/hex、轴坐标、足迹奇偶偏移） |
| 5. 玩家窗口同步 + `atlas-vtt:` 命令 | ✅ | store 写入后玩家窗画面确实变了（`shots/04` → `shots/05`，像素不同） |
| 6. 端到端 + 截图 + 事件 | ✅ | `docs/E2E.md`；v0.3.0 重跑 40 次调用 0 失败，68 个事件；第一次跑遇到一次「新场景没报 loaded」的偶发失败，重跑即过（见 §4） |
| 7. 事件质量（语义化 + 兜底） | ✅ | 18 种事件；`state_changed` 仅作兜底（实跑只触发 1 次） |
| 8. 加固 + `docs/INTEGRATION.md` | ✅ | 13/13 通过（v0.3.0 重跑，62 个工具）；只读模式与急停单独实测；接法文档给 编排层 |
| 9. 测试（含真实快照 fixture）+ 更多 | ✅ | 77 测试（fixture 测真实像素↔格子、真实骰子日志自洽、真实先攻序） |
| 10. `atlas_player_frame`（v0.3.0，trpg-table 演出框） | ✅ 实测 | 真 Obsidian 1.14.4 + Atlas 0.8.0 + trpg overlay**：窗口内容 1707×960（屏幕装不下 1920×1080，按比例缩），画布宿主 847×889，overlay 报告显示 0 个面板溢出、0 个面板压地图；关闭工具后 DOM/样式/窗口/相机还原 |

顺带修掉的真实 bug（都是在真机上跑出来的）：

1. 新场景加载完成后事件流静默（订阅只在 workspace 事件时重建）→ 改为跟随 view 订阅 + 加载态过滤。
2. AI 掷骰会发两次 `dice_rolled` → 只由 store diff 发一次。
3. `atlas_new_scene` 写出的场景继承了上一场的先攻/骰子日志（Atlas 不重置文件里没有的字段）→ 显式写默认值。
4. 在 Atlas 打开某场景时从外部写该文件会被防抖保存覆盖 → `atlas_new_scene` 直接拒绝覆盖已打开的场景。
5. 玩家窗被主窗遮住时截图全黑（Chromium 不合成隐藏窗口）→ 截图工具临时置顶 + 丢第一帧再拍。
6. 场景正在加载时写入报"未加载"→ MCP 层对这类错误自动重试（4 次 / 250ms）。

---

## 4. 没做到 / 没验证（明确列表，不要当成已完成）

| 项 | 现状 |
| --- | --- |
| **骰子 3D 动画** | ❌ 没找到触发点。骰点由代码算（模型不能作弊）并写进 Atlas 骰子日志（会渲染、会随场景保存），但不会播 3D 动画 |
| **官方扩展 API** | ❌ 0.8.0 不存在（`atlas-physical-dice` / `atlas-vtt-connect` 只说未来会有）。只能走 store |
| **其他 Atlas 版本** | ❌ 只验证 0.8.0。未知版本会 `tested:false` + `missingActions` 报警，但没实测过升级路径 |
| **六边形全覆盖** | ⚠️ 轴坐标 / 负 q / 偶数足迹落点验证过（有截图），但没和 Atlas 手动拖拽在每种缩放逐一对比 |
| **玩家窗截图** | ⚠️ 会临时把玩家窗置顶约 0.9s（副作用可见），否则截不到 |
| **撤销范围** | ⚠️ 动态照明、骰子日志、先攻不在 Atlas 撤销栈里（Atlas 自身设计），工具返回里会写 `undoable:false` |
| **真实用户 vault** | — 没用过。测试全在 `vault/`，用户真实 vault 从没被读写 |
| **e2e 偶发** | ⚠️ v0.3.0 第一次跑有一次 `atlas_open_scene` 报「新场景没报 loaded」、随后 `combat_started` 没到；同环境重跑 40 调用 0 失败。未定位，可能是场景加载时序/事件流重绑，长跑直播要留意 |
| **多人/联机** | — 未涉及（Atlas 的 online play 是实验功能） |

---

## 5. 已知坑（改代码前务必读）

1. **`src/atlas/adapter.ts` 和 `src/atlas/playerFrame.ts` 是仅有的两个允许碰 Atlas 内部/DOM 的文件。**
   别处 import Atlas 私有形状就会把升级风险扩散到全项目；playerFrame 里的选择器（`.atlas-local-player-content`、
   `.atlas-player-initiative-container`、`.atlas-player-dice-rolls`）只在这里出现。
2. **场景文件里没写的字段不会被重置。** Atlas 的 store 保留旧值：所以 `atlas_new_scene` 会把
   `initiative / diceLog / tokenSettings / lighting / selectedIds` 显式写进文件。
3. **在 Atlas 打开某场景时，别从外部改它的 `.atlasmap`。** Atlas 防抖保存会把 store 覆盖上去。
4. **`state.name` 可能陈旧**（同一 view 切 tab 后不会重新取值）；用 `mapPath` 作为身份。
5. **雾的语义**：`isErasing: false` = 画雾（遮住），`true` = 擦雾（揭示）。工具层已重命名为
   `action: "hide" | "reveal"`，别退回原始字段名。
6. **灯的半径是游戏单位**（尺/米），不是像素。
7. **`objects.lightZones` / `objects.audios` 在没对象时不存在**，代码不能假设 key 存在。
8. **`view.reloadActiveScene` 的参数是 rewrite 回调**，不是 boolean。
9. 构建/测试必须在 `project/`（交付目录对沙箱 shell 只读）；`npm` 要用工作区内缓存
   （`npm_config_cache=.npm-cache`），否则写 `%LOCALAPPDATA%` 会被拦。
10. **Obsidian 会在 `setContentSize` 之后恢复 popout 的保存尺寸。** `atlas_player_frame` 每 4 秒的
    `ensure()` 会把窗口尺寸重新压回设计值；如果只调用一次，画布会和 overlay 面板错位（实测遇到过
    1707→1734，面板整体右移 15px）。
11. **`atlas_player_frame` 要在 overlay 服务起来之后调用。** trpg-table 的 `init()` 早于 8099 监听，
    所以 main 在 overlay.start() 之后又调了一次 `refreshFrame()`；否则 iframe 首次加载是失败的，
    要等 15 秒 watchdog 才重连。
12. **弹出窗口标题会变**：刚打开时是 "Atlas player view"，present 之后是
    "Player view - campaign-vault - Obsidian 1.14.4"。找 BrowserWindow 时先按当前 `document.title`
    精确匹配，再退回 `/player|玩家/i`。
13. **1:1 的 1920×1080 只能当设计尺寸。** 这块屏幕 work area 1707×1019，工具默认按比例缩到
    1707×960（overlay 的 `fit()` 也跟着缩，地图和面板一起缩放）。需要精确 1920×1080 时传
    `screenFit:false`，但窗口会有一部分在屏幕外（capturePage 仍能拍到完整内容，实测 2880×1620）。
14. **关闭演出框要先恢复窗口位置再恢复尺寸。** 只 `setContentSize(1024,802)` 时，如果窗口被推到
    屏幕右边缘，Windows 会把宽度夹成 377px（实测）；必须先 `setBounds(originalBounds)`，再
    `setContentSize(originalContentSize)`。现在实测能回到 1024×802。

---

## 6. 风险

| 风险 | 影响 | 缓解 |
| --- | --- | --- |
| Atlas 升级改内部 | 工具集体失效 | `atlas_probe` 报 `tested:false` + `missingActions`；先跑只读探测再开写入 |
| AGPL-3.0 | 分发/商用有传染性要求 | 已放 `LICENSE`；这不是法律意见，分发前请自己确认 |
| AI 乱来 | 场景被改成不可用 | 默认只读；一步一撤销；`atlas_apply` 白名单 + 拦破坏性 action；急停命令 |
| 本地端口 | 同机其他程序 | 只绑 127.0.0.1、Bearer token、拒绝浏览器 Origin、限速、Host 校验 |
| 玩家窗置顶截图 | 直播时会闪一下 | 只在调用 `atlas_screenshot {target:"player"}` 时发生 |

---

## 7. 下一步建议（按性价比排序）

1. **接编排层**：按 `docs/INTEGRATION.md` 写 SSE 客户端（带 `Last-Event-ID` 重连 + `gap` 处理），
   开场先 `atlas_scene_summary` 对齐状态，之后只吃事件。
2. **加一个"演出脚本"层**：把"AI 说一句话 + 一个工具调用"配对，用 `turn_changed` / `dice_rolled`
   驱动台词；`atlas_screenshot` 给视觉模型做"我现在看到什么"。
3. **骰子动画**：如果一定要，去 Atlas 的 `DiceTool` / `dice3d` 里找能外部触发的入口（0.8.0 没暴露；
   可以先做一次 spike 再决定是否值得）。
4. **hex 加强**：造一个 hex 场景，同时用 Atlas 拖拽和 `atlas_move_token` 放同一个格子，比对像素。
5. **升级回归**：新 Atlas 出来后跑 `atlas_probe` → 修 `REQUIRED_ACTIONS` 差异 → 跑
   `e2e.mjs` + `security-check.mjs`，两绿即算通过。

---

## 8. 验收对照（任务书 §7）

| 验收项 | 结果 |
| --- | --- |
| 1. 真实 Atlas 0.8.0 里整套流程成功 + `docs/E2E.md` | ✅ 40 调用 0 失败 + 7 张截图 |
| 2. `docs/PROBE.md` 记录真实 action/状态形状，猜的项标注 | ✅ 含"与任务书假设的差异"和"已验证/未验证"表 |
| 3. `npm test` 通过且含真实快照 fixture | ✅ 77 测试，5 个文件，fixture 来自真机快照 |
| 4. 只读下写工具失败；kill switch 生效；无 token 被拒 | ✅ 三项都实测（`security-check.mjs` + 手动切只读/急停） |
| 5. SSE 语义化 + `Last-Event-ID` 补发 | ✅ 18 种事件；重放与 `gap` 帧实测 |
| 6. 最终报告：做了什么/没做到/风险 | ✅ 本文件第 3、4、6 节 |

---

## 9. 2026-10-18 补丁：主窗口被遮住 / 最小化时玩家窗不更新

**现象**：Atlas 的玩家窗口不是独立渲染的地图，而是把主窗口渲染器的一帧
`drawImage` 到 `#atlas-player-canvas`（`PlayerWindowService` + `KIn` mirror）。主窗口被别的窗口
盖住或最小化后，Chromium 停掉主窗口的 rAF，mirror 就再没有新帧；对主窗口做一次
`Page.captureScreenshot` 会强制出一帧，玩家窗才更新。直播时 GM 主窗口一定在后面，所以必现。

**修法**（`src/atlas/playerFrame.ts`）：

1. 演出框打开时对**主窗口** `webContents.setBackgroundThrottling(false)`，关闭时恢复原值。
   主窗口只要还在渲染，mirror 的 `beforeRender` 就会继续拷贝。
2. 在主窗口被 `document.visibilityState === 'hidden'` 或最小化时，玩家窗口（直播里一直可见）
   的 rAF 里每 120ms 调一次：
   - `app.ticker.update(performance.now())`，让 Atlas 的 token/光照视觉跟上 store；
   - `workspace.trigger('atlas-vtt:collection-settings-changed')`，这是 Atlas
     `PlayerWindowService` 订阅的事件，会 `mirror.markStale()`，强制 mirror 在 250ms 后自己
     渲染一帧（即使主窗口的 rAF 完全停住）。
   这条是为最小化准备的；主窗口只是被盖住时第 1 条通常已经够了。
3. `atlas_move_token` 现在带**像素级自检**：移动前从玩家 canvas 取 token 旧/新格附近区域，
   移动后用玩家窗口的 rAF 逐帧比较，最多等 1 秒，返回
   `frameCheck:{checked,updated,latencyMs,diffPixels,bbox,expected,from,to}`。
   读 canvas 不会 `capturePage`，不会自己制造一帧。同一格移动返回 `checked:false`。
4. 启动参数（可选，但对覆盖窗口更稳）：`start_obsidian_trpg.bat` 带
   `--disable-features=CalculateNativeWinOcclusion --disable-renderer-backgrounding
   --disable-background-timer-throttling --disable-backgrounding-occluded-windows`。

**实测**（Atlas 0.8.0 / Obsidian 1.14.4，真窗口、真 canvas）：

| 情况 | 结果 |
| --- | --- |
| 主窗口被另一个 Electron 窗口完全盖住，移动薇克丝 (12,8)→(9,5) | `frameCheck.updated=true`，67ms，diff 3565 px；前后截图 sha256 不同 |
| 修复前同场景（未设 backgroundThrottling、无 flags，主窗口 `visibilityState:"hidden"`、1.6s rAF 0） | 移动后 3s 内玩家 canvas diff **0**（`scripts` 里的临时探针，未入库） |
| 主窗口最小化（`isMinimized:true`、`visibilityState:"hidden"`、rAF 2/1.2s） | `frameCheck.updated=true`，124ms，diff 4474 px |
| 同一格再 `atlas_move_token` | `checked:false, reason:"same cell"`，不误报 |
| 关闭演出框 | 主窗口的 backgroundThrottling 恢复原值，keepAlive 停止 |

**没验证**：直播姬真实采集这条路径；最小化 + 不同 DPI/多显示器；Atlas 其它版本。

**注意**：`PlayerWindowService` 的 mirror 只在 `markStale` 后强制渲染；token store 变化本身
不会 markStale（Atlas 靠主窗口每帧的 `beforeRender`）。所以不要删掉上面的 ticker update +
collection-settings-changed 心跳，也不要把它改成主窗口的 `setInterval`（主窗口隐藏时定时器
被压到 1Hz，1 秒的验收会刚好卡边）。

