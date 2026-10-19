# 进度管理：自动出口 + 节拍 + 进度导演（2026-10-19 晚）

起因：第二幕的出口（找到东北小径、往溪水声去）第 2 轮就满足了，GM 却在这一幕里续写了 24 轮——编了「溪石下的伤兽」，登记成事实「Gundren 曾用斧柄伤它」（剧本里 Gundren 被关在洞里），还把第三幕洞口的哨兵、火把、哥布林叫骂提前演了。
GM 的「该推进了」提醒（第 12 / 16 轮）压不住它：出口只是一段文字，谁来判断「满足了没有」全靠 GM 自觉。用户 要加一个专管进度的东西，两层都做，导演用 Haiku。

## 第一层：确定性（不用模型，`src/table/sceneProgress.ts`）

场景 md 里两段，都可选：

```
## 节拍
- camp｜进营地，看清帐篷、篝火和拴着的狼
- trail｜找到东北小径

## 自动出口
- 任一到达 trail 且 第 4 轮起｜找到了东北小径，往溪水声的方向去了
- 第 14 轮起｜时间不早了，你们决定循着溪水声往东北去
```

- **节拍**：一行一个 `- id｜描述`。GM 用新工具 `mark_beat { beat: id }` 打勾，导演也会打勾；画面标题变成「第 N 轮 · 探索 · 进度 2/4」。
- **自动出口**：一行一条规则，`- 条件｜说明`；条件之间用「且」，多行之间是「或」。条件：`任一到达 <地标>` / `全员到达 <地标>`（地标写 id 或名字，**离地标矩形 1 格以内算到达**，只算还能动的 PC）、`第 N 轮起`（这一幕走到第 N 轮；单独写就是强制收尾的上限）、`节拍 <id> 完成`。读不懂的规则整条忽略，不会半条生效。「说明」会当公开版前情的兜底，**别在里面写秘密**。
- **流程**：每一步开头桌面判一次（战斗里不判）。满足了 → 记下，GM 下一次提示里出现【出口已达成 · 这一步必须收尾】（最后一幕写的是 `end_game`）；**GM 两步内没收尾，桌面自己 `requestSceneEnd`**（summary 用导演写的，没有就用「最后两段旁白」，公开版用规则的说明）。
- 五幕都写了节拍和自动出口（每一幕都有一条只看轮数的强制上限：14 / 14 / 18 / 22 / 12 轮）；`test/sceneProgress.test.ts` 会检查规则里引用的地标和节拍真的存在、每幕都有上限。
- 进度（打勾的节拍、正在等收尾的出口）进存档。

## 第二层：进度导演（Haiku，`src/table/director.ts`）

- 一个新的模型座位 `director`（`config/models.yaml`，现在是 `claude-haiku-5-5`，不写就沿用 gm 的模型）。每隔 `every_rounds`（默认 2）个探索轮、在世界回合关轮之后请它判断一次（`config/table.yaml` 的 `director:`，`enabled: false` 整个关掉）；战斗里不请；超时（30 秒）/ 出错 / JSON 不合法就跳过这一次，确定性层照常。
- 它看到的和 GM 一样多：这一幕全文（含 GM 秘密、战利品清单）、节拍和自动出口、前情和世界事实（带 key）、最近 20 条记录、PC 和生物在哪、下一幕的预告（用来判断 GM 有没有提前演它）。只回一个 JSON：`exit_met / exit_reason / beats_done / drift[{what, fact_key}] / stalled / push / summary / public_recap`。
- **桌面强制执行，不指望 GM 听话**（`TableLoop.applyDirector`）：节拍打勾；`drift` 里指到的世界事实（key 必须真的存在）直接删；`exit_met` → 记下出口，走和自动出口一样的「GM 两步内收尾，不收桌面替它收」，收尾文字用导演写的；`push` / `drift` / `stalled` 作为【导演指令】塞进 GM 的下一步提示，只在最近两轮内有效。输出每一项都校验过（节拍 id 只认剧本里的，事实 key 只认现有的）。
- 费用：每次约 4300 入 / 600–1100 出 token，Haiku 5.5 约 $0.001，4–7 秒。

## 顺手修的一个老漏洞：`end_scene` 的 next_scene_id 写错会结束整场

旧版 19:33 那次：GM 的 `end_scene` 带了一个不存在的 `next_scene_id`，`applySceneEnd` 里 `findIndex` 得到 -1，直接走了「一场结束」，存档 `phase: ended`，桌面从此什么都不做（我重启后看到「暂停解除了但没动静」才发现）。现在：GM 工具里校验（认 id、`_` 和 `-` 不分、标题里的词；不认识就报错并列出可用的），桌面这边未知 id 退回「按顺序进下一幕」。直播存档我撤回了 `ended`（备份在 `state/_backup_before_unend_20261019.json`），重启后第二幕立刻被自动出口收尾、进了第三幕。

## 验证了什么 / 没验证什么

- 测试：509 个全过（连跑两遍）；新增 `test/sceneProgress.test.ts`（19 个：解析、求值、存档、正式剧本一致性、导演输出校验、整桌自动出口 / 强制收尾 / 导演强制执行 / 隔轮 / 出错跳过 / 过期、换幕漏洞）。
- 真模型（GM = Haiku 5.5，导演 = Haiku 5.5，连着 Atlas，直播存档）：
  - 重启后第一步自动出口就满足（第 24 轮，任一到达 trail），GM 当场 `mark_beat → narrate → end_scene`（5 秒），前情带公开版，进第三幕，Atlas 补了 token；
  - 第三幕第 2 轮导演第一次判断（4 秒），推的是剧本里的洞口哨兵吹哨，没有越界；
  - 另外在**临时目录**里拿旧的卡死存档（第 24 轮、带「溪石下的伤兽」等事实）只调了一次真导演：判出口满足（理由引用了小径和第 24 轮）、节拍 camp / wolf / trail 做完、指出「GM 提前描写了第三幕洞口的火把光和哥布林叫骂」、写了不含秘密的公开版前情。
- **没验证**：导演删对不上的事实这条真实路径（探测里它指出了 drift，但没给 fact_key，所以没删；删的逻辑只有假导演的单元测试）；`全员到达`、节拍型出口（`节拍 gundren 完成`）、最后一幕的 `end_game` 强制收尾在真模型上；导演长期跑的效果（每 2 轮一次，误判会不会多）；导演的 `push` 会不会被 Haiku GM 老实执行（第三幕才刚开始）。
- 已知取舍：「到达」按 1 格内算，地标是细长条时可能略松；自动出口只在探索 / 谈话里判，战斗打完才会触发；「说明」要玩家安全；出口一满足就收尾，所以要给玩家留搜营地的时间就在规则里加 `第 N 轮起`（第二幕写的是第 4 轮起）。

## 后续（同一晚）：新出现的生物自动放 pin / Helixus 少说话

**自动放 pin（隐藏预放）**。以前剧本 `## 遭遇` 里的怪要等 GM 开战才生成，Atlas 上看不到，用户 说「好像不会自动放新的 pin」。现在 `TableLoop.ensureSceneCreatures` 每幕开始就把本幕全部遭遇预放到场上：标 `[可见]` 的直接露面，其余是隐藏 token（观众的 Player view 看不到，GM 视图能看到）。出现办法三条：GM 的 `reveal_area`、进度导演输出里的 `reveal`（导演每次能看到「藏着的生物」清单 `hidden`/`hiddenIds`）、开战。去重按「种类 + 数量」不按名字（GM 开战时自己起名「哨兵甲」，名字对不上剧本，只按名字会再补一份）；战斗胜负只数 `combat.order` 里的成员，不然预放的隐藏怪会让战斗打不完。旧存档重启曾经重复生成过一批隐藏怪，已换成干净存档、清了 Atlas 里多余的 token。测试在 `test/sceneCreatures.test.ts`（含 2 个去重用例）。

**Helixus 少说话（页面 + 桌面两边）**。症状：旁白、两个玩家、Helixus 同时开口很乱。
- 桌面：`SpeechService.busy`（还有语音在合成 / 排队 / 估计没播完）→ `/status` 的 `table.speaking`。
- 页面（aituber-kit，unity-stage 分支，**没提交**）：新设置 `trpgCommentaryGapSec`（默认 75 秒，`NEXT_PUBLIC_HELIXUS_TRPG_GAP`，设置面板「D&D 跑团：他针对剧情开口的最短间隔」，0 = 不限）。① 只有「值得说」的事件才叫醒他：`gm_decision / combat_start / combat_end / contrast`，掷骰、普通决定、移动、世界回合只当背景进下一轮提示词；② 叫醒和定时都要隔够最短间隔，从上一次**说完**算起（`markEventsNarrated`），immediate 也不例外；③ 桌面报 `speaking` 时每 3 秒再看一次，不抢话；④ 没有未说过的值得说的事就跳过这一轮，不没话找话。改动在 `features/helixus/{minecraft,liveSettings}.ts`、`hooks/useGameCommentaryMode.ts`、`components/settings/helixusLiveSettings.tsx`；测试在 `__tests__/features/helixus/minecraft.test.ts`（36 个）、`__tests__/hooks/useGameCommentaryMode.test.ts`（新增 3 个；该文件里「saves generated commentary to chat log」一个老用例在 HEAD 上就失败，与此无关）。
- **没验证**：真实直播画面里 Helixus 的话是不是变少、75 秒合不合适（太少就把设置调小，太吵就调大）；`speaking` 是按音频估计时长算的，不是 overlay 真实回报。生效要在 chrome_live 里按 F5（页面设置里可以直接改间隔，不用重启）。
