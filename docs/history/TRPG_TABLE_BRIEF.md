# 任务书：AI 跑团桌（trpg-table）——给 DeepSeek / dsh

工作目录：`trpg-table\`（新建）
语言：TypeScript（Node 22+），和 `atlas-agent-link` 一样。
你在用户的电脑上直接工作，**能真跑就真跑**：真模型、真 Obsidian + Atlas、真页面。

先读这些，再动手：

1. 本文件。
2. `atlas-agent-link\docs\HANDOFF.md` 和 `INTEGRATION.md`：Atlas 控制层，已经做完并核验过。
3. `<workspace>\vtuberplay\README.md`：helixus-link 协议，也就是游戏代理和直播页面之间的协议。
4. `<workspace>\bg3_ai\agent\bg3_agent.py`：一个已经在直播里用过的 helixus-link 实现，看它的服务端写法。
5. `<workspace>\aituber-kit\src\features\helixus\minecraft.ts` 和它的测试：页面怎么接游戏代理，已有 civ6 / bg3 两个分支可以照着写。

---

## 0. 工作规则（不要放松）

- **只做本任务书范围内的事。** `atlas-agent-link` 有 bug 可以修，但要写进它的 `docs/HANDOFF.md`。
- **新项目一开始就 `git init`**，小步提交，只做本地提交，**不推送**。提交作者用 `helixus-local <helixus@localhost>`（`git -c user.name=... -c user.email=...`）。
- AITuberKit 在 `unity-stage` 分支上，用户直播时就用这个分支。
  - 只在这个分支上做本地提交。
  - **用户直播时不要保存 `aituber-kit\src` 下的任何文件**：保存会让页面整页重载，以前因此断过弹幕、切掉过正在唱的歌。
  - 动手前问用户现在有没有在播；在别处改好，等用户说可以了再放进去。
  - 放进去之后检查 `GET /api/v1/status/?clientId=helixus`：status 不能是 null，而且是 connected。
- **密钥不进仓库，不进日志，不打印。** 放在 `trpg-table\.env`（加进 gitignore），要用户自己填。
  - 不要去读别的项目的 `.env`。
  - 不要读 `<workspace>\chrome_live` 里的 localStorage。
- 测试只用测试 vault（`vault`）或第 7 节新建的正式跑团 vault。用户别的 Obsidian 数据一律不碰。
- **端口：**
  - Atlas 用 27125。
  - helixus-link 用 8098。同一时间只能有一个游戏代理占着它，起之前先确认没有别的代理在跑。
  - overlay 用 8099。
  - 绑定地址只能是 127.0.0.1。
- 下载素材、装 npm 以外的东西、花钱的 API 之前，**先问用户**。
- 不确定的事问用户，不要猜。没验证过的写「没验证」，不要写成完成。

---

## 1. 目标

用户的 AI 主播叫 Helixus，是 3D 角色，跑在 Unity 舞台 + AITuberKit 页面上，人设是狂妄的机械龙神。现在要加一个**直播跑团**节目：

- 规则：**D&D 5e**。
- 座位：**3 个 AI**，都是固定的。
  - **GM：Claude。** 它是真正的地下城主：推进剧情、扮演 NPC 和怪物、要求检定、裁定结果、操作 Atlas 地图。
  - **玩家 A：DeepSeek。** 一个玩家角色。
  - **玩家 B：Gemini。** 另一个玩家角色。
- **Helixus 是「追剧情的 GM / 锐评员」。** 他不直接操作桌面，但：
  - 能看到剧情、玩家的思维链里有戏剧性的地方、玩家的决定和骰子结果，然后锐评。
  - 可以用 `[game:…]` 给 GM 提**建议**，GM 自己决定采不采纳（见 §5.3）。
  - 观众只能通过 Helixus 间接影响剧情。
- **核心看点是玩家的思维链。** 人类玩家的想法是藏着的，AI 玩家的不藏，爆点就在里面。所以：
  - 用**第四个模型（renderer）**把玩家的思维链加工成观众看得懂的「看点」。
  - 「看点」和随后的「决定」都要放到画面上，**位置挨着但分开**。
  - 这样 Helixus 锐评时，观众知道他在评什么。
- 玩家固定两人。每人一张**立绘**，能换表情。立绘是用户用 GPT 画的，要能随时替换。
- 现在 Atlas 里玩家只出现在右边一条先攻栏里，太小。要做一个**单独的 overlay 页面**来展示玩家。

---

## 2. 整体结构

```
                     ┌──────────── trpg-table（新，Node） ────────────┐
Obsidian + Atlas ⇄ MCP/SSE ⇄ │ AtlasClient   GM(Claude)   PlayerA(DeepSeek) │
 (27125, 已完成)              │ RulesEngine   PlayerB(Gemini)  Renderer      │
                              │ TableLoop（状态机）   EventLog(jsonl)          │
                              │ LinkServer :8098      OverlayServer :8099      │
                              └──────┬──────────────────────┬────────────────┘
                                     │ helixus-link          │ HTTP + SSE
                         AITuberKit 页面（unity-stage）     overlay 页面
                         Helixus 解说 + [game:建议]          （立绘/看点/决定）
                                     │
                               Unity 舞台（Helixus 3D）

直播画面由用户在 B 站直播姬里自己拼：HelixusStage 窗口 + Atlas 玩家窗口 + overlay
```

- **trpg-table 是唯一会写 Atlas 的程序。** 页面和 overlay 都不直接碰 Atlas。
- 所有模型调用都在 trpg-table 里。页面里那个 Helixus 的模型是页面自己配置的，**不归你管**。

---

## 3. 模型接入：一个干净的地方挂 API

用户的要求是「**有一个干净的挂 api 的地方**」：换一个座位用的模型，只改一行配置。

`trpg-table/config/models.yaml`（进仓库，只写引用不写密钥）：

```yaml
providers:
  anthropic: { kind: anthropic,         key_env: ANTHROPIC_API_KEY, proxy: http://127.0.0.1:7897 }
  gemini:    { kind: gemini,            key_env: GEMINI_API_KEY,    proxy: http://127.0.0.1:7897 }
  deepseek:  { kind: openai_compatible, key_env: DEEPSEEK_API_KEY,  base_url: https://api.deepseek.com, proxy: null }
seats:
  gm:       { provider: anthropic, model: claude-sonnet-5-5, max_tokens: 4000 }
  player_a: { provider: deepseek,  model: <推理模型，问用户>, reasoning: raw }
  player_b: { provider: gemini,    model: <问用户>,           reasoning: summary }
  renderer: { provider: anthropic, model: claude-haiku-5-5 }   # 要快要便宜；可以换
```

- `.env.example` 里列出所有 key 名，**值留空**。
- **适配层**：`src/llm/` 下一个统一接口：

  ```ts
  complete({system, messages, tools?, stream?}) → {text, reasoning?, toolCalls?, usage, latencyMs}
  ```

  每个 provider 一个文件。要求：
  - 支持流式。
  - 有超时，有重试（指数退避，最多 3 次）。
  - 记 token 用量，汇总到 `logs/usage.jsonl`。
  - 失败时抛出明确的错误类型。
- **思维链怎么拿：**
  - DeepSeek：推理模型的 `reasoning_content`，是原文。
  - Gemini：打开 thinking 并要回思考内容（`includeThoughts`）。**注意：Gemini 给的是思考摘要，不是原文。** 文档和界面上都要照实写，不要说成「完整思维链」。
  - Claude（GM）：GM 的思考不上屏，不用拿。
  - 先用真 API 确认这几个字段在当前 API 版本里到底叫什么、长什么样，结果写进 `docs/PROBE_MODELS.md`。
- **代理：**
  - 发往回环地址（127.0.0.1 / localhost）的请求**绝不能走代理**。以前 httpx 读了系统代理，导致本地请求全部 502。
  - 每个 provider 自己决定走不走代理。不要读系统代理。
  - Gemini 经代理时可能报 `User location is not supported`，那是代理节点所在地区的问题。报清楚，让用户去换节点；不要绕过去。
- **冒烟脚本** `npm run models:smoke`：每个座位调一次真模型，打印延迟、有没有思维链、token 数，不打印内容和 key。

---

## 4. 规则：D&D 5e

**原则：凡是能用代码算的，都不交给模型。** 包括掷骰、攻击是否命中、伤害、HP、法术位、状态、先攻、检定 DC 比较。模型只负责「想做什么」和「怎么说」。这条是从 BG3 项目学来的：模型凭印象说规则必错。

### 4.1 先做一次选型调研（1 天以内），写 `docs/RULES_SPIKE.md`

候选：

- **Mnehmos/rpg-mcp**（https://github.com/Mnehmos/rpg-mcp）
  - README 写的是：ISC 许可，TypeScript，MCP 工具，SQLite 存状态。
  - 5e 战斗：先攻、AC、伤害、死亡豁免、抗性、借机攻击。
  - 法术位、专注，15+ 个 SRD 法术。
  - 号称 2000+ 测试。
  - 这些**都是它自己说的，要亲手验证**。
- **Railroaded**（在 glama.ai 的 MCP 列表里）：确定性规则引擎，简化版 5e，等级上限 5。确认它的许可证和源码在哪。
- **自己写一个最小规则内核**：按 SRD 5.2.1 写。SRD 5.2.1 是 CC-BY-4.0，**用了要署名**。数据可以从 Open5e / 5e-srd-api 拿，注意它们是 2014 版还是 2024 版。

评估这几项：

- 许可证能不能用在直播里。
- 能不能当库嵌进来（不另起一个进程最好）。
- 测试是真是假：亲手跑一遍。
- 覆盖 3 级以下角色要用的东西了没有：攻击、法术、检定、豁免、状态、短休。
- 状态能不能和 Atlas 的 token 对得上。

**结论写清楚，然后直接按结论推进，不用等我。** 如果要装的东西不在 npm 上，先问用户。

### 4.2 规则层对外的接口（不管选哪个实现，都要有）

- `check(actor, ability|skill, dc, adv?)`
- `save(...)`
- `attack(attacker, target, weapon|spell)`
- `damage(...)`
- `heal(...)`
- `applyCondition(...)` / `removeCondition(...)`
- `castSpell(caster, spell, slotLevel, targets)`：要校验法术位和专注
- `startCombat(...)`
- `legalActions(actor)`：返回这个角色现在能做的事，给玩家看的选项从这里来
- `shortRest()`

每一次掷骰：

- 都走 `atlas_roll_dice`，结果会写进 Atlas 的骰子日志，观众看得到。
- 骰点由代码算；**模型给出的数字一律无视**。
- 结果带上 `natural`（骰面原始点数）和 `crit` / `fumble`。

### 4.3 和 Atlas 对齐

- 角色和怪物的 HP，用 `atlas_set_token_resources` 写到 token 上。
- 状态用 `atlas_set_condition`。
- 先攻用 `atlas_initiative`。
- 规则层是数据的权威；Atlas 只负责显示。
- 每次写完 Atlas，回读一次核对，不一致就记 warning。

---

## 5. 三个座位

### 5.1 GM（Claude）

- 用 Claude 的 tool use。GM 能用的工具：
  - **规则层工具**（§4.2）。
  - **从 Atlas MCP 工具里挑的一部分**，用白名单，大约 25 个：
    - 场景：开场景、看摘要
    - token：加、移、改、删
    - 迷雾
    - 门、灯
    - 先攻
    - 镜头
    - 截图
  - **桌面工具：**
    - `narrate(text)`：GM 对玩家说的话
    - `ask_player(seat, prompt)`：轮到某个玩家行动
    - `request_check(seat, skill, dc, why)`
    - `reveal_area(...)`
    - `end_scene(...)`
  - Atlas 工具由 trpg-table 代理给 Claude，Claude 不直连 27125。
  - `atlas_apply`、`atlas_command`、`atlas_new_scene` **不给 GM**。
- **GM 知道全部秘密**：隐藏的 token、迷雾下面有什么、怪物 HP、剧本里的伏笔。
- **剧本**从正式 vault 的 markdown 读（§7）：
  - trpg-table 直接从磁盘只读读取。Atlas 插件按设计不读 Atlas 以外的文件。
  - 按场景挑相关的几段塞进上下文，不要整本塞。
- **每次只走一步**：GM 的一次调用最多 8 次工具调用，然后把控制权交还给 TableLoop。不能让 GM 一口气把剧情跑完。

### 5.2 玩家（DeepSeek / Gemini）

- **每人每回合调用一次。** 输入：
  - 角色卡（JSON）
  - 人设：草稿由你写，用户定稿
  - **玩家视角的局面**（见下）
  - 本回合 GM 的叙述
  - `legalActions` 列出的选项（可以不照选项来，但战斗里的行动必须是合法的）
  - 最近 N 条桌面记录
- **玩家视角**由代码生成，不能把 GM 视角整个丢给它：
  - 只包含没隐藏、而且在已揭开迷雾里的 token。
  - 怪物 HP 只给「看起来受伤很重 / 有点伤 / 没事」这种描述。
  - 剧本里的秘密不给。
  - 要写测试证明秘密不会漏进玩家输入。
- **输出**（严格 JSON，解析失败重试一次，再失败就给一个保守的默认行动，并发一个事件说明）：

  ```json
  {"say": "角色说出口的话（≤60字）", "action": {"type": "attack|cast|move|check|talk|item|other", "target": "...", "detail": "..."},
   "expression": "neutral|happy|smug|angry|scared|surprised|thinking|hurt"}
  ```

- **两个玩家之间：** 能看到对方说出口的话，**看不到对方的思维链**。这和真人跑团一样，戏剧性也从这里来：A 心里在算计 B，B 不知道。

### 5.3 Helixus 的建议（`[game:…]`）

- 页面发来的 `/command`，给 GM 时标注成「主播 Helixus 的旁白建议」，**不是命令**。GM 自己决定采不采纳，并发一个事件说明「采纳了 / 没采纳，为什么」，让 Helixus 能接着说。
- 防刷：
  - 最长 300 字。
  - 同一条建议 60 秒内不重复。
  - 同时最多保留 2 条，旧的作废。
- 这些建议在提示词里归为**不可信文本**：
  - 不能改规则。
  - 不能凭空给玩家加东西或改骰点。
  - 不能泄露玩家的思维链。
- 配置 `helixus_suggestions: on|off`，默认开。关掉时 `/command` 返回 403，和 BG3 一样。

### 5.4 Renderer（把思维链加工成看点）

- 输入：一个玩家这一回合的思维链原文（或 Gemini 的摘要）、他最终做的决定、简短的局面。
- 输出：

  ```json
  {"beats": [{"text": "≤30字，第一人称，口语，可以原样引用", "tag": "算计|犹豫|恐惧|贪心|背刺念头|自我吐槽|误判|计划", "score": 0-10}],
   "contrast": "想的和做的哪里反差最大，一句话，没有就 null",
   "headline": "≤16字，这回合的看点标题"}
  ```

- beats 最多 3 条，按「观众会不会觉得有意思」排序：
  - 优先：怀疑队友、想背刺、怕死、贪宝、对规则或局面的误判、想的和做的不一样、吐槽 GM。
  - 不要：「我需要计算距离」这种流水账。
- **不能编造。** 每条 beat 都要能在原文里找到依据。
  - 写一个校验：beat 的关键词在原文里的覆盖率，或者让 renderer 同时输出原文出处的偏移。
  - 对不上的 beat 丢掉。
- **安全：** beats 和 headline 会上屏、会被 Helixus 念出来。
  - 过滤网址、联系方式、长串数字、现实里的政治话题。
  - **原始思维链只写进本地日志，永远不上屏，也不进 helixus-link 事件。**
- 时间预算：renderer 在玩家输出结束后 3 秒内出结果。超时就只显示决定，不显示看点。

---

## 6. 桌面循环（TableLoop）

一个显式的状态机：

```
EXPLORE / SOCIAL： GM 叙述 → 轮到谁 → 玩家思考（overlay 显示「思考中…」+ 立绘 thinking）
                  → renderer 出看点 → 上屏「看点」（停 T_thought 秒）
                  → 上屏「决定」+ 立绘换表情（停 T_decision 秒）
                  → GM 裁定（检定 / 掷骰）→ 结果上屏 + 写 Atlas → 下一个
COMBAT：           按先攻轮流，同样走 想 → 看点 → 决定 → 结算；怪物的回合由 GM 直接结算
```

- **节奏是表演出来的。** `T_thought` / `T_decision` / 两步之间的间隔都放在 `config/table.yaml` 里，默认 6 秒 / 4 秒 / 2 秒。
  - 推了 `immediate` 爆点之后，多等 `T_react` 秒（默认 8 秒），给 Helixus 留时间锐评。
  - 页面没有「Helixus 说完了」的回传，所以先用固定等待。等实测之后再决定要不要给 helixus-link 加一个回执。如果要加，先问用户。
- 控制：
  - `POST /pause`：暂停，停在当前这一步结束之后。
  - 启动时默认是暂停的，等页面按 Ctrl+Alt+K 才开始，和其它游戏代理一样。
- 存档：桌面状态（规则层状态 + 剧情进度 + 对话历史摘要）每一步结束就写 `state/` 下的文件。**崩了重启能接着跑。**
- 日志：`logs/table.jsonl` 每步一行，记录：座位、输入摘要、原始输出、思维链原文、renderer 结果、骰子、Atlas 调用、耗时、token 用量。
- **dry-run 模式**：不连 Atlas，用内存里的假桌面，模型照样是真的。M2 就要能用这个模式跑。

---

## 7. 内容：正式 vault、剧本、地图、立绘

- **新建正式 vault** `campaign-vault\`。
  - 不要用测试 vault。
  - 把 Atlas 0.8.0 和 atlas-agent-link 装进去。
  - 用 `obsidian-data` 那套独立 profile 启动。具体怎么启动看 HANDOFF §2。
- **剧本和地图从网上找**，第一场是一个 1–2 小时、给 2 个 3 级角色的 one-shot。
  - **每一份素材都要把许可证记进 `campaign-vault\LICENSES.md`**：来源 URL、作者、许可证原文摘要、能不能用在有收益的直播里。
  - 已知线索（未核实）：
    - cornwielder 的 "Crashed Ship" 地图写的是商用和直播都可以，署名可选。
    - berbmakes 的免费地图包写的是可以用在直播里，但不能再发布。
    - 很多免费地图是 CC BY-NC，**B 站直播有收益，NC 的能不能用要问用户**。
    - SRD 5.2.1 是 CC-BY-4.0，要署名。
    - WotC 官方模组不是开放许可。
  - **先列一张候选清单（剧本 2–3 个，地图若干），给用户挑，用户点头之后再下载。**
  - 也可以选：只用开放许可的地图，剧本由 GM（Claude）基于 SRD 自己编一个大纲，用户审过再用。这个也放进候选清单里。
- **剧本格式**：`campaign-vault\adventures\<名字>\`，分成 `00-overview.md`、`scenes/*.md`。每个场景写：
  - 地图（指向 `.atlasmap`）
  - 读给玩家听的文字
  - GM 才知道的秘密
  - 遭遇（引用 SRD 的怪）
  - 出口条件
- **角色卡**：`campaign-vault\characters\<seat>.json`。
  - 两个 3 级角色，职业搭配要互补，草稿你来写。
  - 人设各一段：要有能让思维链出戏的性格缺陷，比如贪财、多疑、怕死。
  - **都要用户定稿。**
- **立绘**（用户用 GPT 画，要能替换）：

  ```
  campaign-vault\sprites\<seat>\neutral.png happy.png smug.png angry.png scared.png surprised.png thinking.png hurt.png
  ```

  - 透明背景 PNG，同一个人的所有表情画布一样大，建议 1024×1536。
  - 缺了哪张就用 `neutral.png`；连 `neutral.png` 都没有，就画一个占位剪影加名字。
  - overlay 要能热更新：换了文件不用重启。
  - 写 `sprites\README.md` 告诉用户规格，再附一段给 GPT 的出图提示词模板，用来保证同一个角色每张表情长得一样。
  - Atlas 里的 token 头像可以从 `neutral.png` 裁一个圆形。

---

## 8. Overlay 页面（`http://127.0.0.1:8099/overlay`）

- trpg-table 自带一个静态页面，加一个 SSE `/overlay/events`。
  - 不用框架也行；要用，只能用不需要构建服务器的。
  - 页面只做显示，不能控制任何东西。
- 两种模式：
  - `?bg=transparent`：给直播姬当浏览器源。
  - `?bg=solid`：开 Chrome app 窗口，用窗口捕捉。
  - 直播姬到底支不支持浏览器源、透明背景能不能用，**问用户，或者让用户试**。
- **布局**（1920×1080 画布，元素位置都能在 `config/overlay.yaml` 里调；默认把两名玩家放在画面左右两侧，中间留给 Atlas 地图和 Helixus）：

```
┌──────────────┐                                        ┌──────────────┐
│ [看点] A      │                                        │ [看点] B      │
│ 「headline」  │                                        │ 「headline」  │
│ · beat1 #算计 │                                        │ · beat1 #恐惧 │
│ · beat2       │        （中间：Atlas 地图 / Helixus）   │ · beat2       │
├──────────────┤                                        ├──────────────┤
│   立绘 A      │                                        │   立绘 B      │
│ （表情可切）   │                                        │ （表情可切）   │
│ 名字·职业 HP▮▮▮│                                        │ 名字·职业 HP▮▮│
├──────────────┤                                        ├──────────────┤
│ [决定] ⚔ 攻击 │                                        │ [决定] 🗨 说服│
│ 「说出口的话」 │                                        │ 「…」 d20=17 ✔│
└──────────────┘                                        └──────────────┘
                       底部一条：GM 叙述 / 当前回合 / 轮次
```

- **「看点」和「决定」要挨着，但看得出是两块**：不同底色，不同标签（「心里想」/「做了」）。
- 先出看点，再出决定。两者之间的反差（`contrast`）在决定卡上用一行小字标出来。
- 当前行动的玩家要高亮，另一位变暗。
- 思考中显示 thinking 立绘，加一个「思考中…」动效。
- Gemini 那一侧在看点框角上**小字注明「思考摘要」**，DeepSeek 那一侧注明「思维链」，照实写。
- 配色：遵守用户已经定下的配色原则：
  - 环境用带灰的深蓝 / 蓝青，不用纯饱和蓝。
  - 金色只留给高亮（暴击、大成功）。
  - 不要大面积高饱和暖色。
- 字体用系统中文字体，不下载。
- 字要大：在 1080p 推流压缩之后、手机竖屏上也要看得清。看点正文 ≥ 30px。

---

## 9. helixus-link（8098）和页面

### 9.1 trpg-table 这一侧

照 vtuberplay README 实现：

- `GET /status`：

  ```
  {game:"trpg", online, paused, planner:{thinking, executing, pending, givenUp}, lastCommand, latestEventSeq,
   table:{phase, round, turn, scene, players:[{seat, name, hp, maxHp}]}}
  ```

- `GET /events?after=`、`/trace`、`POST /command`、`/pause`、`/forget`：行为和 README 一样。
- **安全：**
  - 只听 127.0.0.1。
  - 校验 Host。
  - 用 CORS 白名单，只放 `http://localhost:3000` 和 `http://127.0.0.1:3000`。
  - 用独占端口：端口被占就直接退出。Windows 默认允许两个进程绑同一个端口，以前因此出过事。
- **事件**：`{seq, at, kind, text, urgency}`。`text` 是给 Helixus 看的中文，要自己就能读懂。

| kind | urgency | text 例子 |
| --- | --- | --- |
| `scene` | soon | 「新场景：坠毁的飞船残骸，夜里」 |
| `gm_narration` | later | GM 叙述的摘要（≤80字） |
| `thought_beat` | score≥7 时 immediate，其余 soon | 「【A 心里想】『这把刀我得先拿到手，别让她看见』#背刺念头」 |
| `decision` | soon | 「【A 做了】说『我去前面探路』，其实往宝箱那边走」 |
| `contrast` | immediate | 「A 想的是独吞宝箱，嘴上说的是探路」 |
| `roll` | 暴击/大失败 immediate，其余 later | 「B 说服 d20=17+3 对 DC15，成功」 |
| `combat_start` / `combat_end` | immediate | |
| `suggestion_result` | soon | 「GM 采纳了 Helixus 的建议：让地精从侧门冲出来」 |
| `system` | later | 暂停、出错、恢复 |

- overlay 上显示的东西，Helixus 要能从事件里拿到同样的文字，**画面和他说的要对得上**。
- 不能进事件的东西：原始思维链、GM 才知道的秘密。
  - 默认设定：Helixus 作为「追剧情的 GM」可以拿到一句剧透级别的暗示（kind `gm_hint`，later），比如「GM：宝箱是个拟形怪」。用来让他调侃，但提示词要求他**不要直接说破**。
  - 这一点做成开关 `helixus_knows_secrets`，默认开，在交付报告里提醒用户确认。

### 9.2 AITuberKit 页面（分支 `unity-stage`，遵守 §0）

照 civ6 / bg3 在 `src/features/helixus/minecraft.ts` 里的写法，加一个 `trpg`：

- `isTrpg`、`gameName`。
- `TRPG_SELF_PLAY_COMMENTARY_PROMPT`：Helixus 是追剧情的 GM / 锐评员，不是玩家。
  - 重点评：玩家心里想的和实际做的之间的反差、骰运、GM 的安排。
  - 按人设说话，句子短而硬。
  - 可以写 `[game:建议]` 给 GM，但一次最多一条，而且要真的有戏剧性。
  - 不要念规则细节。
- `trpgPromptBlock`：
  - 当前场景、回合、两名玩家的名字和 HP。
  - 最近的事件，带【新】标记，和现有逻辑一样。
  - 离线时的提示文字。
- `sendMcCommand` 对 trpg 的策略：
  - 放行 `[game:…]`。
  - 30 秒内的重复照旧丢掉。
  - **不套用 Minecraft 的 90 秒忙碌冷却。**
  - trpg-table 返回 403 时（建议功能关了），安静丢掉。
- 设置页 `helixusLiveSettings.tsx` 的状态文字，加上 trpg 的启动脚本名。
- 测试加在 `src/__tests__/features/helixus/minecraft.test.ts`，照 bg3 那一组的写法。用 `npx jest <文件>` 跑，现有的 22 个测试要保持全过。
- 页面的截图解说：用户共享 **Atlas 玩家窗口**。不要用 `atlas_screenshot`，它会把玩家窗口置顶闪一下。

Unity 舞台**不用改**。它没有显示图片的消息，overlay 是独立页面，由直播姬合成。

---

## 10. 启动

- `<workspace>\start_trpg.bat`：起 trpg-table。
  - 参数：`dry`（不连 Atlas）、`nolink`（不起 8098）。
  - 要设好 `NO_PROXY=127.0.0.1,localhost`。
  - 这台机器的坑：
    - cmd 里用相对名字调用 bat 会失败（NoDefaultCurrentDirectoryInExePath），要写全路径。
    - 目录名里有 `&` 时，start 会截断路径，要用 `start /D`。
- Obsidian 怎么启动、要什么权限，看 HANDOFF §2。trpg-table 起来时：
  - 先检查 27125 的 `/health`。
  - 不通就报清楚，然后退回 dry-run 或者等待。**不要自己去启动 Obsidian。**
- 在 `<workspace>\直播启动流程.md` 里加「AI 跑团」一节，照 BG3 那一节的写法：
  - 步骤
  - 热键
  - 用户要做什么
  - 排错表
  - 已验证 / 未验证清单

  这个文件是用户的，**改之前先问一声**。

---

## 11. 里程碑（按顺序，每一步都能跑、都提交）

| # | 内容 | 验收 |
| --- | --- | --- |
| M0 | 仓库、配置、模型适配层、`models:smoke` | 4 个座位都用真 API 通过；`PROBE_MODELS.md` 写清楚思维链字段的真实样子 |
| M1 | 规则选型调研 + 规则层接口 | `RULES_SPIKE.md`；单测覆盖攻击 / 伤害 / 豁免 / 检定 / 法术位 / 专注 / 先攻；骰子分布测试 |
| M2 | TableLoop dry-run（不连 Atlas）+ 两名真玩家 + 真 GM | 用 SRD 的怪打一场 20 分钟的遭遇；`table.jsonl` 完整；崩了重启能接着跑；秘密不泄漏的测试通过 |
| M3 | 接 Atlas | 在 campaign-vault 里同一场遭遇：token / HP / 状态 / 先攻 / 迷雾 / 骰子日志都和规则层一致；截图存证 |
| M4 | renderer + overlay | 20 回合的真实思维链跑一遍：beats 有原文依据的比例、超时率、平均延迟；overlay 两种背景模式的截图 |
| M5 | helixus-link + 页面 trpg | 真页面（用户不在直播时）按 Ctrl+Alt+K 开始，Helixus 对 `thought_beat` / `contrast` 做出锐评，`[game:]` 建议走完一圈（采纳或不采纳都有事件） |
| M6 | 内容 | 候选清单经用户挑选 → 下载 → `LICENSES.md` → 剧本、地图、角色卡落进 vault（角色卡和人设用户定稿） |
| M7 | 彩排 | 完整 one-shot 跑 60 分钟以上，不中断（可以用 dry-run 加真页面）。报告：每回合平均耗时、每小时 token 和费用估算、失败次数和原因、最好看的 5 个爆点的截图 |

---

## 12. 交付

- `trpg-table\docs\HANDOFF.md`，格式照 atlas-agent-link 的那份：
  - 文件在哪
  - 怎么跑
  - 做了什么
  - **没做到 / 没验证（明确列表）**
  - 已知的坑
  - 风险
  - 下一步
- 不要夸大。真模型、真 Atlas、真页面跑过的写「实测」，只在 dry-run 或假数据上跑过的写清楚。
- 需要用户决定的事，集中列在 HANDOFF 最后：
  - 模型具体版本
  - 用到的素材的许可证
  - 两名玩家的人设定稿
  - `helixus_knows_secrets` 开不开
  - 直播姬里怎么摆这几个窗口
  - 节奏参数

---

## 13. 不在范围内

- 骰子 3D 动画：Atlas 0.8.0 没有可以从外部触发的入口，见 atlas-agent-link 的 HANDOFF。
- 玩家配音：只有 Helixus 有 GSV 声音。玩家先只用文字。以后要配音再说。
- 观众直接控制玩家或 GM（只能通过 Helixus 间接影响）。
- 旧的主播编排程序：不接。现在直播用的是 AITuberKit `unity-stage` 分支 + Unity 舞台。
- 改 Unity 舞台、改 VRM 模型、改动作库。
