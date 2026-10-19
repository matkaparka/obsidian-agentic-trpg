# HANDOFF — TRPG UI V2（2026-10-18 17:00，已用真实对局验证）

给 用户 / 下一个会话。这一份取代上午 15:45 那版（那版停在「代码写完、没验证」）。规则见 `TRPG_TABLE_BRIEF.md` §0，任务书是 `TRPG_UI_V2_BRIEF.md`。
旧的 `HANDOFF.md`（左右人物栏 + 布局 A/B/C）已作废。

---

## ★ 17:40 布局改版（用户 看了真实画面后给的草图）

用户 给了一张四块的草图，要求「再紧凑一些、风格化一些」。已按草图做完，并在真实窗口里看过（`docs/shots/v3/`）：

```
┌───────────────────────────────┬─────────────────┐
│ 左上  地图（1312×900）          │ 右上 主播区 608×780 │
│  + 棋子上的气泡 / 骰子          │  （留空，叠 Helixus）│
├───────────────────────────────┼─────────────────┤
│ 左下  滚动剧情 1312×180         │ 右下 两个主角 608×300│
│                               │ 半身立绘+HP+AC+状态 │
└───────────────────────────────┴─────────────────┘
```
- 配置：`config/overlay.yaml` 的 `layout` 现在是 `map / subtitle(滚动剧情) / streamer / characters` 四个框；`insets` 由 map 自动算（right 608、bottom 180）。不能互相重叠，超出画布会报错。
- **滚动剧情**：GM 新的一段淡入、顶到窗口最上面，旧的往上滚走渐隐；超过三行的段落先停 3.5 秒再慢慢往下读。标题栏左边是剧本名、右边是场景名。字体用系统自带的楷体（`narration_family`，找不到退回雅黑）。
- **主角面板**：每人一张卡——半身立绘（`sprites/<seat>/<表情>.png`，没有就用 neutral，再没有用剪影）、名字 + 职业等级、HP 条（≥60% 青、30–60% 橙、<30% 红并脉动）、AC、状态标签（最多 3 个）、「行动中」角标、「正在想」三个点、0 血变灰 + 「倒下」。面板头：探索时写「探索」，战斗时写「第 N 轮」，右边是先攻头像条。
- **风格**：深蓝灰面板 + 四角描边（HUD 的角标）、细线、编号小菱形；金色仍然只留给暴击；气泡和骰子沿用上一轮。地图四周加了暗角，把 Atlas 画布的黑边融进去。
- 主播区还是只有背景（深色 + 脚下一点冷光），没有子元素；自检继续查「主播区为空」。
- 新增 `scripts/preview-real.mjs`：把玩家窗口里的 iframe 临时切到 demo（`?demo=1&hold=1&hp_a=9&active=player_a&thinking=player_a&narr=…`），在真实窗口里预览面板的各种状态，再截图；不带参数就恢复。
- 81 个测试全过（只改了两处布局数值的断言）；`check-overlay`：地图框和 Atlas 画布一致、没有溢出。
- **限制**：Atlas 玩家窗口自己把地图按宽度缩到 90%（我试过改插件的镜头适配，没有用，已还原，插件 `main.js` 仍是 `38B69D28…`），所以地图图四周有黑边，只能靠换比例更合适的图来减小。
- 立绘还是占位图（矢量小人）；换正式立绘后检查 `object-position`（`.card .sprite` 默认顶部偏上 9%，脸在上 1/3 时合适）。
- 假设：草图里的「蓝色」块我当成「两个主角」，「背后的模型」没完全看懂，当成「Helixus 的画面在上面一块，主角面板在它下面」；气泡仍然挂在棋子上。

---

## 0. 一句话

V2 画面做完并在真实对局上验证过：地图 1380 + 右侧 540 空的主播区、棋子上的云朵 / 说话气泡、棋子旁骰子、GM 字幕条、先攻头像条、第一人称 `bubble`、棋子换脸部头像。
最长一次连续真跑 16.7 分钟（真 Claude GM + DeepSeek + Gemini，Obsidian 主窗口被一个窗口盖住），949 次采样，只有 1 次「骰子数字压到气泡」，其余检查全过。

**所有进程已停**（trpg-table、Obsidian、采样脚本）；端口 8098 / 8099 / 27125 / 9222 都没有 LISTENING。`state\` 和 `campaign-vault\scenes\` 已恢复成我开工时的样子（下次起桌面用 `--fresh`）。

---

## 1. 提交（都只在本地，没推送）

| 仓库 | 提交 | 内容 |
| --- | --- | --- |
| trpg-table | `36185e0` | DeepSeek 留下的 V2 代码（原样提交，当时没验证过） |
| trpg-table | `a55887c` | 我这轮的修复（见 §2） |
| trpg-table | `574d108`、`cd2354b` | 气泡文字居中 / 引号去掉 / 主播区纯黑 / 截图 / 检查记录；旧 HANDOFF 指向本文件（本文件在 `ob_vtt\` 根目录，不在 git 里） |
| aituber-kit（unity-stage） | `d78e1545` | trpg 提示词加「观众屏幕上只有气泡和地图」一句（`minecraft.ts` 两处 + 测试），jest 27/27 |
| atlas-agent-link | 没动 | `main.js` sha256 仍是 `38B69D28…696C8404`，交付目录 / project / 已部署的 vault 三份一致 |

---

## 2. 我核实 DeepSeek 的东西后改了什么

DeepSeek 的交接基本属实（76 个测试都过、代码在、停在「没验证」）。真跑起来之后发现并修了这些：

**overlay（`trpg-table/overlay/`）**
- `check-overlay.mjs` 读不到报告：它读的是 `window.__overlayReport`（只在 iframe 里），插件转存的变量叫 `__trpgOverlayReport`。改成只读后者（从主窗口 leaf 或玩家页面都行）。
- 云朵：原来是被压扁的椭圆，真实画面里第二行字被边缘切掉。改成 SVG 画的带凸边的云，文字区是矩形，不会被切。
- 云朵尾巴描边永远是 A 的颜色（SVG 里没带 `--accent`），修了。
- 气泡高度没把 padding 和边框算进去，导致「裁字」误报；而且我自己一度引入了「挂进页面前就量」的 bug，被预览抓到，已修。
- 摆放：原来兜底时竖直平移，会让尾巴离开棋子。现在每个方位（上 / 下 / 右 / 左）× 沿垂直方向滑 5 个位置，尾巴尖永远落在棋子边缘，不盖自己的棋子，尽量不盖别的棋子 / 气泡。
- 骰子数字会压在气泡的字上：现在在棋子的下 / 右 / 左 / 上里挑一个不压气泡、不压别的骰子的位置。
- GM 叙述超过两行原来被截成省略号：改成按句子分页，每页 ≤2 行，一页一页淡入换。
- 气泡文字居中 + `text-wrap: balance`（末行不再只剩一个字）；模型把整句话包在引号里的，上屏时去掉引号。
- 棋子位置没变就不重排（插件每 100 ms 发一次）。
- `?demo=1&hold=1`：预览用，气泡不会到点消失。demo 仍只用来压力测试，右上角有「演示数据」。

**renderer**：模型把某一条 beat 的 `tag` 写成表外的词、或 `score` 写成字符串，原来会让整份输出 `bad_schema`（连 bubble 一起丢，真实第一回合就发生了）。现在只丢出错的那一条。

**规则层（不在任务书里，但它让验收的前提不成立，所以修了）**：活人可以叠在同一格。真实对局里薇克丝、一只倒下的鱼人、另一只鱼人三个同在 (4,6)，气泡尾巴指向了错的棋子。
- `engine.ts`：`moveTo` / `setPosition` / `approachTarget` 不允许停在别的活人的格子上；敌对方的格子走不过去；自己人的格子能穿过但不能停；默认出生格避开已占的格。
- `loop.ts`：玩家把 `cell` 写成敌人站的格子（这在真实对局里立刻出现了两次）：攻击就当没给 `cell`，让近战自动贴到相邻空格；其它行动挪到离它最近的空格。不会整次行动作废。

**其它**：复用上一局留下的 PC 棋子时，头像换成脸部裁图（之前一直是旧的 A / B 圆章）；`streamer_bg` 改成纯黑（和 Atlas 画布底色一致，地图边上的黑边不再像贴上去的）；`sprites/README.md` 补了「画面上不再显示立绘」。

**新增脚本**（`trpg-table/scripts/`）：`sample-overlay.mjs`（每秒读一次自检报告，遇到新情形自动截图）、`dump-link-events.mjs`（存 helixus-link 事件）、`reload-overlay-iframe.mjs`（改完 overlay 文件不用重启）。

---

## 3. 实测（真跑过的）

### 3.1 构建 / 测试
- `trpg-table`：`npm run typecheck` 通过；`npm test` **81 tests / 10 files 全过**（新增：活人不叠格、cell 写成敌人格子、renderer 容错）。
- AITuberKit：`npx jest src/__tests__/features/helixus/minecraft.test.ts` **27/27**。

### 3.2 15 分钟真实对局（run c，16:11:55–16:28，主窗口被盖住）
- 模型：Claude Sonnet 5.5（GM）、DeepSeek reasoner（薇克丝）、Gemini 3.5 flash（布拉姆）、DeepSeek chat（renderer）。从探索一路打进战斗。
- **949 次采样，1 次有问题**：`dice-over-bubble`（骰子数字一瞬间压到布拉姆的气泡）。其余全部通过：
  气泡完整（没有裁字）、尾巴落点离棋子 0 px（≤24 px）、气泡在地图里、不进主播区、不压字幕条、气泡两两不重叠、主播区没有任何子元素 / 文字。
- 27 个玩家回合里 **24 个有云朵**（A 12/13，B 12/14，89%）。其中 12 回合第一版 bubble 不合格、重写了一次；3 回合没有云朵（`label_phrase`、`third_person_self`、`not_grounded`），按规矩直接出说话气泡，没有出空云朵。
- 第一人称校验：把 b–f 几轮日志里 **50 句上屏的心里话**拿同一个校验器重新过一遍，0 句不合格，最长 21 字。
- 像素检查（`atlas_move_token` 自带的 `frameCheck`）：9 次移动 **9/9 更新**，5–8 ms。
- 费用（公开标价估算，不是账单）：这 16.7 分钟 ≈ **$1.05**（GM $0.94）。

### 3.3 helixus-link 事件（对照抽查 5 个回合）
`thought_beat` 每回合 1 条，内容依次是「【观众看到的心里话】」「【只有你看得到】headline / 全部 beats（带标签和分数）」；`decision` 是「【观众看到的说话】」+「【只有你看得到】动作类型 / 目标 / 做法 / 移动到哪」。抽到的 5 回合都对得上。27 个 `thought_beat`、27 个 `decision`、27 个 `contrast`，共 176 条事件（`docs/checks/v2-link-events-c.jsonl`）。

### 3.4 其它真实场景
- **贴边**（run d：把两个 PC 的位置改到地图左上角 / 右边缘）：上方放不下的 3 行气泡翻到棋子下方；右边缘的气泡向左滑开，尾巴仍在棋子上。
- **主窗口最小化**：主窗口 rAF 1.2 秒只有 2 次，玩家窗口 240 次/秒；此时用 `atlas_move_token` 连移 4 次，`frameCheck` **4/4 更新**（65–127 ms，由玩家窗口的保活心跳驱动）。
- **不带 Chromium 开关**启动 Obsidian（只带 `--remote-debugging-port`）：效果一样，见 §4.1。
- Atlas 里 PC 棋子换头像（`atlas_update_token` 改 `imagePath`）真实可用：复用的旧棋子被换成了脸部头像。PC 倒下（0 血）时棋子显示成骷髅，这是 Atlas 自己画的，trpg-table 没有做。

### 3.5 截图（`trpg-table/docs/shots/v2/`，全部来自真实运行、同一个玩家窗口，设计尺寸 1920×1080，实际截图 2561×1440）
1. `1-explore-thinking-cloud.png` 探索阶段，薇克丝头上「…」思考云
2. `2-cloud-and-speech.png` 薇克丝的心里话云朵 + 布拉姆的说话气泡同时在画面上
3. `3-two-pcs-both-bubbles.png` 两个 PC 挨着站，两个都有气泡（一个思考云、一个说话气泡），互不重叠
4. `4-edge-flip-below.png` 棋子贴近地图上边缘，气泡翻到下方
5. `5-combat-dice-and-right-edge.png` 战斗中骰子「10 未中」浮在目标旁边；布拉姆在右边缘，气泡向左滑开
6. `6-streamer-area-empty-top-edge.png` 右侧主播区空；薇克丝贴着上边缘，气泡在上方
- 注意：1–4 是 CSS 改「居中 + 均匀换行」之前拍的（气泡文字是左对齐），5、6 是最终样式。最终样式只在 5、6 和浏览器预览里看过。
- 原始截图在 `docs/shots/v2-raw/`（已 gitignore），采样记录在 `docs/checks/v2-live-{c,d,e,f}.jsonl`。

---

## 4. 没验证 / 已知问题

1. **「主窗口被遮住 → `visibilityState: hidden`」这个状态我没能复现。** 插件打开演出框时对主窗口 `setBackgroundThrottling(false)`，Electron 里这同时会让 Page Visibility 一直是 visible，所以不管带不带 Chromium 开关，盖住主窗口都不会冻结地图（run c 的 949 次采样里主窗口一直是 visible，frameCheck 9/9）。真正会冻结的只有「最小化」，由保活心跳兜住（§3.4）。所以 `start_obsidian_trpg.bat` 里那几个 Chromium 开关现在是双保险，不是必需。
2. **只验证了 `neutral` 一张表情头像。** 其它 7 种表情没有立绘，`setTokenExpression` 的「3 秒限一次 + 按表情换图」没有用真表情图跑过（`atlas_update_token` 改 `imagePath` 这一步是真跑通的）。当前的脸部头像是从占位立绘裁的，不是正式立绘。
3. **AITuberKit 页面没有重启、没有真连**：新加的提示词只过了 jest 并本地提交。这次 Chrome / Unity / 直播姬都没开，所以没有做「改完检查 `GET /api/v1/status/?clientId=helixus` 是 connected」那一步。下次开播前页面起来后看一眼。
4. **云朵出现率 88%，但近一半回合要重写一次 bubble（多花 1–2 秒）。** 校验器偏严：不带「我」的第一人称短句（比如「还是先躲后面吧」）会被判成标签式短语；「他 / 她 + 动词」会把指队友的句子也挡掉。要不要放宽，等你看了成片再定。
5. **Gemini 经常没有思考摘要**（日志写「无思维链」），这种回合布拉姆就没有云朵。
6. **地图四周的黑边**：背景图和地图区域的比例对不上，Atlas 画布底色是黑的，上方约 100 px、左右各一条。`fitCamera` 没给字幕条留位置，地图最下面约 6 px 被字幕盖住（这张图没问题，更高的图会被盖更多）。
7. 气泡有时会盖住旁边的怪物棋子（只回避另一名 PC 的棋子，怪物只是低权重）。
8. 技能检定的骰子只显示「10 失败」，不写是什么检定。
9. 我把 PC 位置改到地图边上跑 run d / f 之后，战斗里薇克丝倒下（0 血、骷髅头像）但没有死亡豁免，鱼人一直在咬，回合数涨到 13。这是我改位置后的测试状态，不是新 bug；规则层本来就没有死亡豁免。
10. P1-1 / P1-2 / P1-3、P2 在 V2 画面下没有单独复测：只靠 run c 里「玩家按地标移动」「Atlas 与桌面一致（`check-atlas-full.mjs` 0 处不一致，含 `currentIndex`）」间接覆盖。

---

## 5. 重启方法

```powershell
# 1) Obsidian（正式 vault，独立 profile，带 CDP 9222）
<workspace>\start_obsidian_trpg.bat debug

# 2) 起桌面（默认暂停；演出框会自动打开）
cd trpg-table
$env:NO_PROXY='127.0.0.1,localhost'
npm run build
node dist/main.js --fresh

# 3) 自检 / 连续采样
node scripts\check-overlay.mjs
node scripts\sample-overlay.mjs --minutes 15 --out docs\checks\v2-live.jsonl --prefix v2live

# 4) 开始 / 暂停（或页面按 Ctrl+Alt+K）
Invoke-RestMethod http://127.0.0.1:8098/pause -Method Post -Headers @{Host='127.0.0.1:8098';'Content-Type'='application/json'} -Body '{"paused":false}'

# 改了 overlay 的 js/css/html：让玩家窗口里的 iframe 重载
node scripts\reload-overlay-iframe.mjs
```

端口：Atlas 27125、link 8098、overlay 8099、CDP 9222，全部只绑 127.0.0.1。
预览气泡样式不用开游戏：浏览器打开 `http://127.0.0.1:8099/overlay?demo=1&hold=1&bg=solid`（trpg-table 在跑时），再在控制台 `postMessage` 一份假的棋子坐标。

---

## 6. 等 用户 定的事

- 最终样式的截图（尤其 5、6）看一眼：气泡字号 31、云朵大小、骰子数字大小。
- bubble 校验要不要放宽（§4.4）。
- 正式立绘出来后：按脸的位置微调 `campaign-vault/sprites/faces.json`，跑 `scripts/make_token_avatars.py`，8 种表情头像就齐了。
- 地图图的比例（§4.6）：换一张和 1380×1080 比例接近的图，黑边就没了。
- 页面那一句提示词放进直播里用之前，页面要重启一次（别在直播时保存 `aituber-kit\src` 下的文件）。

---

## 7. 关键文件

| 路径 | 是什么 |
| --- | --- |
| `trpg-table/config/overlay.yaml` | 布局 / 颜色 / 气泡 / 骰子 / 主播区 / `token_expressions` |
| `trpg-table/overlay/{index.html,style.css,app.js}` | 气泡（云朵 SVG 轮廓、摆放、尾巴）、骰子、字幕分页、先攻条、自检报告 |
| `trpg-table/src/table/renderer.ts` | `bubble` 输出、第一人称校验、重写 / 兜底、容错解析 |
| `trpg-table/src/table/loop.ts` | thought_beat 一条、decision 细节、cell 被占时的处理 |
| `trpg-table/src/rules/engine.ts` | 位置、不叠格、寻路 |
| `trpg-table/src/atlas/sync.ts` | 棋子头像、换表情、复用旧棋子时换头像 |
| `atlas-agent-link/src/atlas/playerFrame.ts` | 主窗口保帧、棋子屏幕矩形 postMessage、frameCheck |
| `trpg-table/scripts/check-overlay.mjs`、`sample-overlay.mjs` | 单次 / 连续检查 |
| `trpg-table/docs/shots/v2/` | 6 张验收截图 |
| `trpg-table/docs/checks/` | 采样记录、link 事件 |
