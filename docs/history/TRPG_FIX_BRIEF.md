# 任务书 2：把角色界面合进游戏画面 + 实测出的问题（给 DeepSeek / dsh）

接着 `TRPG_TABLE_BRIEF.md` 做。那份任务书的规则（§0）照旧有效。
本文写于 2026-10-17 21:50。下面的问题是在你 21:28 起的那个进程（PID 15844，`dist/main.js --fresh`）和正式 vault 的 Obsidian 上逐条实测出来的；现象都写了，你可以复现。

**最优先：**

1. 把手上没提交的改动先提交。现在有 15 个改过的文件和几个新脚本没进 git。
2. 做 §1。§1 没做完之前，界面上别的东西都不算完成。

---

## 1. 最重要：只要一个窗口

用户 的要求：**角色界面必须和游戏界面在同一个画面里。** 原任务书 §8 让 overlay 当独立页面、在直播姬里和 Atlas 窗口拼在一起，这个设计**作废**。设计错在我，不在你。

### 1.1 目标

**Atlas 玩家窗口本身**就是直播要采集的画面，固定 1920×1080：

- 地图在中间。
- 左右两侧是两名玩家的「心里想 / 立绘 / 做了」。
- 底部是 GM 叙述和轮次。

直播姬只采集这一个窗口，外加 HelixusStage 窗口。页面（AITuberKit）做截图解说时共享的也是这一个窗口，所以 Helixus 看到的地图和角色栏，与观众看到的一致。

独立的 `http://127.0.0.1:8099/overlay` 留着当调试视图，不再用于直播。

### 1.2 已经验证可行（我在你的进程上临时试过，已撤回）

- Atlas 的玩家窗口是 **Obsidian 弹出窗口**，不是独立程序。CDP 9222 上它的标题是「Player view - campaign-vault - Obsidian 1.14.4」，和主窗口在同一个渲染进程里，插件代码能直接操作它的 DOM。
  - `body` 带 `is-popout-window atlas-player-window atlas-player-window--live`
  - 视图类型是 `atlas-vtt-local-player`
  - PIXI 画布挂在 `.atlas-local-player-content` 下面
  - 同一层还有 `.atlas-player-initiative-container`（Atlas 自带的先攻栏）和 `.atlas-player-dice-rolls`
- **把 `.atlas-local-player-content` 缩窄，Atlas 会自己跟着重排画布**，不用碰 PIXI。我试的写法是：
  ```js
  vc.style.marginLeft = '240px'; vc.style.marginRight = '240px';
  vc.style.width = 'calc(100% - 480px)'; vc.style.height = 'calc(100% - 46px)';
  window.dispatchEvent(new Event('resize'));
  ```
  画布从 1024×802 变成 544×756，地图正常渲染。**注意**：用 padding 不行，画布是绝对定位的，会无视 padding。
- 往这个窗口里塞一个**透明背景的 iframe** 指向 `http://127.0.0.1:8099/overlay?bg=transparent`，再设 `position:fixed; inset:0; pointer-events:none; z-index` 到最上层。结果正常：跨域加载、背景透明、能叠在地图上。
- **没解决的问题**：缩窄之后 Atlas 的镜头没有重新适配，地图只露出一部分。需要在布局完成后重新算镜头（见 §1.3 第 5 条）。

### 1.3 要做的

1. **放在哪里：放进 atlas-agent-link**，新文件 `src/atlas/playerFrame.ts`。
   - 碰 Atlas DOM 的选择器只准出现在这个文件和 `adapter.ts` 里，这是 atlas-agent-link HANDOFF §5 第 1 条的规矩。
   - 新增一个 MCP 工具 `atlas_player_frame`，参数 `{enabled, url, insets:{left,right,top,bottom}, hideAtlasInitiative, size:{w,h}}`。
     - trpg-table 启动、连上 Atlas 之后调用它打开演出框，退出时关掉。
     - 用户 不需要手动设置任何东西。
   - 这是一个写工具：受只读模式和急停约束。
   - `url` 只允许 `http://127.0.0.1:<port>/` 开头（写进白名单校验），不能让它加载任意网页。
2. **窗口尺寸**：打开演出框时，把玩家窗口的**内容区**设成 1920×1080。
   - 先试 Electron 的 `getCurrentWindow().setContentSize`。atlas-agent-link 的 `open-vault.js` 用过 `require('electron').remote` 的办法。
   - 试不出来就在文档里写清楚怎么手动设，**不要猜**。
   - 屏幕不够大时，按比例缩放整个演出框，地图、角色栏一起缩，不要让角色栏单独变形。
3. **布局**：
   - 左右两栏和底栏的宽高放在 `config/overlay.yaml`，同时用来算 `insets`。
   - 地图区域 = 窗口减去 insets。**任何面板都不能盖住地图区域**，只有骰子提示可以在地图区底边短暂停留。
4. **Atlas 自带的先攻栏**：打开演出框时把它隐藏，关闭时恢复。
   - 轮次和先攻顺序改在我们自己的底栏里画一条紧凑的头像序列，当前行动的人高亮。
   - `.atlas-player-dice-rolls` 是 Atlas 自己显示骰子的地方：保留，并确认它没被挡住。
5. **镜头**：布局改变之后（打开演出框、换场景、窗口尺寸变了），把镜头调到「整张地图正好装进地图区域」。
   - 先看 Atlas 有没有自带的「适配屏幕」命令（atlas-agent-link 的 PROBE.md 里有 28 个命令）。
   - 没有就用 `atlas_set_camera` 按背景图尺寸自己算。
6. **要稳**：
   - Atlas 关掉又重开玩家窗口、换场景、overlay 服务重启之后，演出框要自己恢复：重新注入，iframe 自动重连。
   - 关闭演出框要把 DOM 和样式**原样还原**。我测试时是把原来的 `style.cssText` 存起来，关的时候写回去。
7. **overlay 页面本身**：iframe 里的页面不再画背景板。透明模式下除了各个面板，整页透明。
8. **atlas-agent-link 的规矩照旧**：
   - 在 `project/` 里构建和测试，同步到交付目录，两份 sha256 要一致。
   - 版本号加一。
   - 更新它的 HANDOFF。
   - 重跑 `e2e.mjs` 和 `security-check.mjs`。跑完 security-check 要等 60 秒，限速窗口过了再测别的，否则会收到 429。
   - 补一个测试：`url` 白名单拒绝外部地址。

### 1.4 验收

- 截图三张，都是**同一个 Atlas 玩家窗口**，1920×1080：
  - 探索中，有人在思考；
  - 看点和决定都在画面上；
  - 战斗中，有一次掷骰。
- 写一个自动检查脚本：通过 CDP 进 iframe 页面，确认每个面板 `scrollHeight <= clientHeight`（没有被裁掉的字），并且面板的矩形和地图区域不相交。
- 关闭演出框后，窗口和截图恢复成原来的样子。

---

## 2. 界面上实测出的问题（都在 1920×1080 下看到的）

1. **字被裁掉**：
   - 薇克丝的「心里想」框只显示了 89px，内容实际有 328px：3 条看点只露出 1 条，第 2 行露一半；标题「贪财盗贼先听水下动静」和第一条看点叠在了一起。
   - 「做了」框显示了 159px，内容有 399px，句子断在半行。
   - 要求：
     - 字不能被裁。超出时先把字号逐步缩小，最小 26px。还放不下，就在句子边界截断，加「…」。
     - 用 `logs/table.jsonl` 里最长的真实 beats 和台词做测试数据。
2. **骰子提示显示 `d20=4+undefined vs AC 12`**：`overlay/app.js:246` 读的是 `roll.modifier`，但事件里只有 `formula`、`natural`、`total`。修法二选一：用 `total - natural` 算出加值，或者事件里补上 modifier 字段。
3. **骰子提示压在布拉姆的「做了」卡片上**（右下角）：给它一个固定位置，不能和任何卡片重叠。
4. **战斗刚开始时底栏显示「第 0 轮」**，状态里已经是 round 1 了。
5. **布拉姆（Gemini）的「心里想」是空的**：
   - 原因：Gemini 的思考摘要是**英文**（开头是 `**My Immediate Concerns in the Dark Cargo Hold**`），renderer（deepseek-chat）在 3 秒预算内超时了（rendererMeta 里写着 `reason:"timeout"`）。
   - 要求：
     - renderer 负责把内容翻成中文。
     - 预算放宽到 6–8 秒。
     - 玩家的思维链一结束就开始渲染，不用等 JSON 解析。
     - 超时就显示一行小字「（思考摘要没来得及整理）」，不要留空框。
     - 统计每名玩家的超时率，写进日志。
6. **renderer 把「选表情」的过程写成了角色的心里话**：
   - 例子：原文「被咬了一口，hurt 更合适，但嘴上带刺是 angry。选 angry。」被渲染成看点「明明疼得龇牙，偏要摆出凶相，气比伤大」。
   - 这是模型在考虑 JSON 的 `expression` 字段该填什么，不是角色在想事情。上屏就等于编造。
   - 要求：
     - 引文里出现输出格式、表情名、JSON、「我需要以 XX 的身份」「选 xxx」这类内容的 beat，一律丢掉。
     - renderer 的提示词里写明这条规则。
     - 加对应的测试。
7. **一次推了 4 条 immediate 事件**（3 条看点加 1 条反差，都在 21:43:17）。页面每收到一条 immediate 都会戳 Helixus 一次。
   - 改成：每回合只有分数最高的那条看点和反差是 immediate，其余是 soon。

---

## 3. 桌面状态实测出的问题

1. **Atlas 里留着上一局的残留**：
   - 场景里有 4 个沙华鱼人 token：「沙华鱼人1/2」是更早那局留下的，「甲/乙」是另一局的，两两叠在同一格。
   - 21:28 用 `--fresh` 重开时，Atlas 的先攻还停在「第 1 轮，鱼人在列」，而桌面状态是探索、没有战斗。
   - `--fresh` 只重置了 `state/table.json`，没有清 Atlas。
   - 要求：
     - 在 `state/` 里记下 trpg-table 自己建过的 token id。
     - 重开局或进新场景时，对齐 Atlas：删掉自己建过、但规则层里已经没有的 token；重置先攻；迷雾按场景定义重画。
     - 不是 trpg-table 建的 token 不要动。
2. **伏击在画面上被剧透了**：
   - 探索阶段 GM 还在讲「水里的白痕」，玩家窗口里鱼人已经明晃晃站在甲板上，Atlas 里它们是 `hidden:false`。
   - 要求：
     - 还没登场的怪，在 Atlas 里必须是 `hidden:true`。
     - GM 揭示或战斗开始时再改成可见。
     - 这个状态和规则层的 `visibleActorIds` 绑在一起。
3. **地图上的 token 从来不动**：
   - 薇克丝「挪到货舱口边」之后，token 还在原地。
   - 鱼人在 3 格（15 尺）外就「啮咬」命中了。
   - 结果整场下来，地图只是一张背景图。这对 VTT 节目是核心问题。要求：
     - 规则层要记录每个角色的位置（格子坐标）。
     - 玩家的行动可以带一个目标格子；`legalActions` 给出按速度能走到的格子。
     - 近战必须相邻（5 尺）。不相邻时，先在速度范围内自动移到相邻格，到不了就算非法行动。
     - 怪物的回合同样要先移动再攻击。
     - 每次移动都调用 `atlas_move_token`，并写进事件，例如「鱼人甲扑到薇克丝身边」。
     - 测试至少要有：超出距离的近战被拒、自动接近、移动之后的位置同步到 Atlas。
4. 我看到过一次画面里 Atlas 先攻栏的高亮比状态慢了一拍（数据本身是对的）。演出框做完、这一栏隐藏后，确认我们自己画的序列不会出现这个问题。

---

## 4. 文档和成本

- **`docs/HANDOFF.md` 过时了**：里面写着「真模型和真 Atlas 都还没接上过」，但 `usage.jsonl` 显示真模型已经跑过不少。
  - 真模型调用次数：GM（claude-sonnet-5-5）54 次，DeepSeek 20 次，Gemini 3.5 flash 11 次。另有更早试过的几个 Gemini 模型。
  - Atlas 也连过：骰子日志里有真实掷骰。
  - 照实更新 HANDOFF。
- 启动时会提示「模型 ID 还是占位名」，可这几个 ID 都已经调通了。要么去掉这条提示，要么只在冒烟测试没通过时提示。
- renderer 换过：Haiku 27 次调用失败 24 次，后来换成了 deepseek-chat。把 Haiku 失败的原因写进 `PROBE_MODELS.md`。
- **GM 每次调用大约 1.5 万输入 token，`cacheReadTokens` 全是 0。** 给 Anthropic 的 system 提示和 tools 加上 prompt caching，再用 usage 证明缓存真的命中了。然后按真实数据估算每小时费用，写进 HANDOFF。

---

## 5. 不要做的

- 不要改 AITuberKit。这一轮页面那边不用动；页面共享的窗口从 overlay 换成 Atlas 玩家窗口，是 用户 在直播姬和页面上自己操作的事。如果你觉得必须改页面，先问。
- 不要动 Unity 舞台。
- 不要让 trpg-table 自己去启动 Obsidian。

## 6. 交付

- 两个仓库都只做本地提交。trpg-table 是 git 仓库；atlas-agent-link 不是，改完照它的规矩同步两份目录。
- HANDOFF 里写清楚哪些已经实测（附截图和自动检查的输出）、哪些没验证。
- 最后跑一场 15 分钟的真实游戏：真模型 + 真 Atlas + 演出框。要求：token 会动；怪物登场前是隐藏的；从头到尾没有字被裁掉，用自动检查脚本证明。
