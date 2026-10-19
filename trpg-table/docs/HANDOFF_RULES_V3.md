# HANDOFF — 5e 规则层 V3（2026-10-18 晚）

给下一个会话。**先读这份，再按 §0 的顺序看别的。** 这一轮把规则层从"两张写死的 3 级卡"做成"任意种族 / 职业 / 等级都能跑"。
**全部只在本地：没提交、没推送**（`git status` 31 个改动文件，基线是 `8093ed3`）。

---

## 0. 新会话先做什么

1. 读这份（尤其 §4 没验证、§6 下一步）。
2. 读 `docs/RULES_COVERAGE.md`（哪些规则自动、哪些 GM 裁定、哪些没有）和 `src/rules/build/README.md`（构建器的字段和默认规则）。
3. 看现场还剩什么在跑（§3）。**这晚是 用户 要求我起的 Obsidian 和热重载监督进程，它们现在还开着**；游戏是**暂停**的，没有人按过开始。
4. `npm test`（约 35 秒，里面有两个整场假模型战斗的测试）和 `npx tsc --noEmit` 先跑一遍确认基线：当前 **362 个测试全过，类型检查干净**（297 是写这份时的数，§6b 之后是 314，§6c 之后是 354，§6d 之后是 362）。

## 1. 做了什么

| 块 | 内容 | 在哪 |
| --- | --- | --- |
| 战斗规则 | 死亡 / 死亡豁免 / 即死、状态对检定和攻击的真实影响、自动暴击、优势合并、借机攻击、掩蔽、夹击（默认关）、多攻、动作经济、擒抱 / 推撞 / 挣脱、突袭、怪物特性（群体战术、不死坚韧、嗜血狂热、命中状态…）、护盾术自动反应 | `src/rules/logic/`（改写自 ODM，署名 `src/rules/NOTICE.md`）+ `engine.ts` |
| 职业 / 种族特性 | 额外攻击、狂暴、鲁莽攻击、回气、动作如潮、不屈、偷袭、狡诈动作、灵巧闪避、直觉闪避、圣疗、神圣斩击、保护光环、驱逐不死生物、保全生命、武艺、疾风连击、震慑拳、诗人激励、龙息、半身人幸运、不屈耐力、战斗风格……（索引：`features/registry.ts`） | `src/rules/features/` + `engine.ts` |
| 法术 | SRD 5.1 的 319 个法术全部录入（0–9 环）；自动结算伤害 / 豁免 / 治疗 / 升环 / 戏法成长 / 专注，以及法师护甲、虚假生命、加速术、石肤术、神恩术、猎人印记、惩击、复原、复活、雷鸣波推开、魔法飞弹逐枚、灵体武器、火焰之刃、迷踪步 | `src/rules/data/spells.ts`、`spellsSrd.ts` |
| 角色构建器 | 种族 + 背景 + 职业与等级（含兼职、子职业）+ 属性 → 完整角色卡；合法性检查 | `src/rules/build/` |
| 桌面层 | 怪物一次打满多攻、走位自动借机攻击、自动死亡豁免换回合、失能的跳过、全员倒地判负、GM 新工具（`monster_action` / `stabilize` / `rest`，`start_combat` 加 `surprised`，`cast_spell` 加 `destination`）、玩家新行动（`feature` / `grapple` / `shove` / `escape` / `dodge` / `dash` / `disengage` / `hide` / `help`）、特性和资源进提示词、overlay 状态标签中文化并显示"濒死" | `src/table/` |
| 开发工具 | `scripts/dev-watch.mjs`：改 `src/`、`config/`、角色卡、剧本就自动构建并重启，保留暂停状态 | `scripts/` |

测试文件：`combat5e`（战斗）、`features5e`（特性）、`spellmech5e`（法术机制）、`spells`（320 个法术逐个真施放）、`builder`（57 个）、`loop`（整场假模型战斗，含构建器造的野蛮人 + 牧师）、以及原有的 rules / view / player / gmView 等。

## 2. 怎么用新角色卡

`campaign-vault/characters/<seat>.json` 里写 `build` 字段就走构建器（完整字段和示例见 `src/rules/build/README.md`）；不写就还是老格式，现有的薇克丝 / 布拉姆两张卡照常能用。
`loadParty` 把构建器的 errors / warnings 并进启动告警；**有 errors 的座位退回内置草稿**，所以改了角色卡后看一眼启动日志（`run-dev.log`）。

```json
{ "build": { "name": "格罗姆", "race": "half_orc", "background": "outlander",
             "classes": [{ "id": "barbarian", "level": 5, "subclass": "berserker" }],
             "abilityScores": { "str": 15, "dex": 13, "con": 14, "int": 8, "wis": 12, "cha": 10 },
             "skills": ["athletics", "survival"],
             "equipment": { "armor": null, "weapons": ["greataxe", "handaxe"] } } }
```

## 3. 现场（写这份时的状态，2026-10-18 约 19:55）

> **这是快照，会过时**：写完之后我起的监督进程（pid 24928）随旧会话结束了，晚些时候看到的是另一个监督进程 + 新的 trpg-table，Obsidian 也已经关了（9222 / 27125 不再监听，桌面会退回 dry-run）。新会话先自己查现状：
> `Get-NetTCPConnection -State Listen | ? { $_.LocalPort -in 8098,8099,27125,9222 }`，再用 `Get-CimInstance Win32_Process -Filter "Name='node.exe'"` 看谁在跑。

| 东西 | 状态 |
| --- | --- |
| Obsidian（正式 vault，独立 profile，带 CDP 9222）+ Atlas 27125 | 开着，pid 28632 / 15348 |
| `scripts/dev-watch.mjs` 监督进程 | 开着，pid 24928；它管着 trpg-table |
| trpg-table（`node dist/main.js`） | pid 6300（20:02 起热重载换成了 32512，见 §6b），8098 / 8099，**暂停中**，已连上 Atlas（"写入已开"） |
| 存档 `state/table.json` | 停在"第一幕：倾斜的甲板"，探索阶段；薇克丝 2/24 HP，布拉姆 16/24（上一轮留下的）；想从头开用 `node dist/main.js --fresh` |

- 应用输出写 `run-dev.log`；监督进程自己的输出在启动它的那个终端 / 后台任务里（新会话看不到，要看就重启它）。
- 停：结束 pid 24928 会带着 trpg-table 一起退出；Obsidian 要的话单独关。
- 开始游戏：页面 Ctrl+Alt+K，或
  `Invoke-RestMethod http://127.0.0.1:8098/pause -Method Post -Headers @{Host='127.0.0.1:8098';'Content-Type'='application/json'} -Body '{"paused":false}'`。

### 热重载（`node scripts/dev-watch.mjs`）

- 改了 `src/` 的 `.ts`：构建失败（类型错）就保留旧进程继续跑，错误打在监督进程输出里；成功才重启。
- 重启前是在跑的就自动继续，是暂停的就保持暂停；存档不丢。
- **直播前必须停掉它**：改文件会重启桌面，打断正在进行的真模型调用（也白花钱）。直播就用 `npm run build && node dist/main.js`。
- 起它的环境：`cd trpg-table; $env:NO_PROXY='127.0.0.1,localhost'; node scripts\dev-watch.mjs`。

## 4. 没验证 / 已知限制

**没验证（只有单元 / 假模型测试，没有真模型真地图跑过）：**
- 新规则在真 Claude GM + 真玩家模型（DeepSeek / Gemini）下的表现：玩家会不会正确用 `type=feature`、会不会在 `detail` 里声明「神圣斩击 / 鲁莽攻击 / 震慑拳 / 副手」、GM 会不会用 `monster_action` / `stabilize` / `rest`。提示词是新写的，没调过。
- Atlas 侧：传送（迷踪步）、擒抱 / 推撞后的 token 位置、借机攻击半路停下，这些走 `sync.moveActor`，只在代码里接了，没在真地图上看过。
- overlay 画面：状态标签（"濒死 1成2败"、"狂暴"）只在 `playerStates()` 里生成，没有看过画面。
- 玩家提示词变长了（特性分组 + 法术列表 + 新动作），token 和延迟没测。

**规则上的已知缺口（详见 `RULES_COVERAGE.md`）：**
- 区域类（难行地形、墙、云雾）/ 召唤类 / 传送（除迷踪步、任意门）/ 变形 / 控制心智 / 反制和解除魔法：GM 口头裁定。法术数据里 `needs` 标签标了每个缺哪种机制（zone 46、roll_modifier 25、summon 21、repeat_action 19、repeat_save 16…）。
- 兼职：`hitDice` 只有一种骰面；施法属性不同时取第一个施法职业；邪术师兼职别的施法职业时契约位并进总表（引擎会按长休恢复，本该短休）。
- 构建器不产：种族天生法术、专长附带法术、力量不足的速度惩罚、野蛮人图腾 / 游侠宿敌 / 魔宠 / 召唤物、非 PHB 子职业的数值效果（只有 id 和一句话说明）。
- 我对 SRD 怪物数据（斥候的长弓、沙华鱼人的多攻套路、强盗首领的多攻）是按记忆改的，**没有逐条对 SRD 原文**。
- 全员倒地后战斗以"失败"结束，怎么收场由 GM 的提示词裁定，没有专门的剧情分支。

## 5. 来源与许可

- `src/rules/logic/` 的纯逻辑和 `src/rules/build/data/*.gen.ts` 的部分数据来自 Open Dungeon Master（MIT，提交 `df3fec7`，稀疏克隆在 `open-dungeon-master`，没装依赖、没运行过它的代码）。署名见 `src/rules/NOTICE.md`、`src/rules/build/NOTICE.md`。
- SRD 5.1 数据（法术、怪物、武器、种族、职业）：CC-BY-4.0，署名文字见 `docs/RULES_SPIKE.md` §3.1 与 `src/rules/data/NOTICE-spells.md`。
- ODM 把 13 个背景都标成 SRD，但 SRD 5.1 只有侍僧；构建器的 `NOTICE.md` 里区分了。

## 6. 下一步（按我的建议排序）

1. **真模型跑一小段**（5–10 分钟）：先开一局探索 + 一场战斗，重点看：玩家有没有用特性、GM 的新工具有没有被用对、overlay 画面上的状态标签、地图上的 token 移动（借机攻击、擒抱、迷踪步）。看日志 `logs/table.jsonl`、`run-dev.log`，有问题改提示词（`src/table/player.ts`、`gm.ts`）。
2. **定角色**：用户 选种族 / 职业 / 等级 / 背景 / 属性，写成 `build` JSON；看启动告警；再对一遍玩家提示词里的特性说明会不会太长（高等级角色"其它特性"最多列 30 个名字）。
3. **对一遍 SRD 怪物数据**（`src/rules/data/monsters.ts`，14 个）。
4. **继续补机制**（按频率）：持续区域、召唤（可以先做"从 MONSTERS 里生成盟友"）、~~`roll_modifier` 类（优势 / 劣势 / 固定加值）~~（§6c 做了 20 个，剩 4 个）、重豁免的其它形态、`multi_damage`。
5. 构建器收尾：`contract.ts` 里 `RESOURCE_SPECS` 和 `build/resources.ts` 的 `EXTRA_RESOURCE_SPECS`（6 个额外 key）合并；兼职契约位按短休恢复。
6. 提交：这轮的改动都没提交。要提交时分几个提交（logic/ + engine、features、spells 数据、build/、table 层、docs），ODM 来源的署名文件要一起带上。

## 6b. 同晚后续（2026-10-18 20:00–20:10，另一个会话接着做的）

做了 §6 里不用花钱的三项，测试 297 → 314，tsc 干净：

- **怪物数据对账（§6.3）**：食尸鬼、巨蜘蛛对的是 ODM 带的 Open5e 原文（`open-dungeon-master/scripts/fixtures/srd-monster-rows.json`，14 行里只有这两个和我们重合）；其余 12 个是我按对 SRD 5.1 的记忆核的，**没有机读原文可对**。查出来的三处：
  - 地精、斥候、沙华鱼人、巨蜘蛛的技能是双倍熟练（SRD 的 +6 / +5 / +7），我们原来只给单倍 → 加了 `MonsterDef.expertise`。影响：怪物的被动察觉（斥候 13→15、沙华鱼人 13→15）和躲藏对抗。
  - 巨蟹少了游泳速度 30。
  - `actorFromMonster` 的熟练加值写死 2 → 改成按 CR（`crProficiencyBonus`，5 级起 +3，往上每 4 级 +1）。现在 14 个怪都 ≤ CR 2 所以没差别，加大怪物时才会咬到。
  - 新测试 `test/monsters.test.ts`：每个怪的 AC / HP / 速度 / 被动察觉 / 技能加值 / 每个攻击的命中和伤害，写成 SRD 数值的表。以后改怪物数据先看它。
  - 没动的差异（都是缺机制，不是数错）：巨蜘蛛的蛛网（充能）、攀爬速度、毒伤打到 0 HP 的瘫痪；沙华鱼人矛的投掷形态和双手 1d8；强盗首领的格挡反应。
- **资源表合并（§6.5 前半）**：`EXTRA_RESOURCE_SPECS` 的 6 个 key 并进 `contract.ts` 的 `RESOURCE_SPECS`，`build/resources.ts` 和 `builder.test.ts` 只认一份。
- **兼职邪术师的契约位短休恢复（§6.5 后半）**：新字段 `Spellcasting.pactSlots = { level, count }`（`types.ts` / `sheet.ts` / `build/spells.ts` / `build/index.ts` 都接了），构建器在契约位并进总表时写它，`engine.shortRest` 据此恢复该环阶已用位中至多 `count` 个。**这是近似**：总表分不清哪个位是契约位，所以玩家若把常规位用在同一环阶上，短休也会多还几个。测试在 `builder.test.ts`（字段写对）和 `features5e.test.ts`（短休只动该环阶、不减成负数、长休全回）。

**§4 里"提示词变长了，token 没测"这一项测了（离线，没调模型）**：用构建器造 6 个高等级角色，战斗中带一只地精，量 `buildPlayerView` 的文本：

| 角色 | 视角文本（字符） | 能做的事 |
| --- | --- | --- |
| 野蛮人 5 / 战士 11 | 1.9k / 1.7k | 16 条 |
| 圣武士 8 + 术士 3 | 3.5k | 35 条 |
| 法师 11 / 术士 20 | 3.3k / 3.5k | 36 条 |
| 牧师 11（生命领域） | **4.7k**（最长） | 47 条 |

加上系统提示（约 1.5k 字符），最坏 6k 字符左右，中文按每字 1–1.5 token 估是 6–9k token，不算大。没量延迟。顺手看到的小问题（没改）：
- 长描述的法术（祈愿术、力场墙、变形术）一行 300–400 字符，占了牧师那 3.9k 里不少；要省的话只截 `kind === 'cast'` 的 detail（别截移动，"可到"列表不能断）。
- 豁免类法术写成"敏捷豁免 DC，…"，**没有 DC 数字**。
- "其它特性"里有没翻译的英文名（`Researcher`、`Quickened Spell`、`False Identity`…），来自 ODM 子职业 / 超魔数据没有 zh。

**现场变化**：这晚改 `src/` 触发了热重载，trpg-table 现在是 **pid 32512**（不是 6300），仍然**暂停**、已连上 Atlas。监督进程 24928、Obsidian 没动。

**还没做的 §6**：1（真模型跑一小段）、2（定角色）、4（补机制：区域 / 召唤 / roll_modifier …）、6（提交）。1 要花钱，2 是 用户 的事，4 比较大，我没有在没确认的情况下开。

## 6c. roll_modifier 类法术（2026-10-18 晚，又一个会话接着做的）

只动 `src/rules/`、`src/table/` 的两处和测试，**没碰真模型、没开游戏**；热重载自动重建过，trpg-table 仍是暂停的。测试 314 → 354，tsc 干净。

**怎么做的：给 `ActiveEffect` 加了一组通用的"掷骰修正"字段**（`types.ts` 的 `RollModFields`，法术数据的 buff / failEffect / choices 和效果共用）：

| 字段 | 管什么 | 引擎里谁读它 |
| --- | --- | --- |
| `attackRoll {state, once, against}` | 持有者自己的攻击掷骰优势 / 劣势；`once` 用掉一次攻击就没；`against` 只对某个目标（数据里写 `$target` / `$caster`，施法时换成 id） | `attackSituation`（武器攻击、法术攻击、授予的攻击都走它） |
| `attackersDisadvantageFrom` | 这些生物类型（`creatureType`）的攻击者打持有者劣势 | `attackSituation` |
| `saveEdges [{abilities, state, against}]` | 豁免优势 / 劣势；`abilities` 可写属性、`all`、`death`；`against` 限定对抗的状态 / 伤害类型 | `save()`、`rollDeathSave()` |
| `checkEdges [{abilities, skills, state}]` | 属性检定 / 技能检定优势 / 劣势（`all` 含先攻） | `check()`、`startCombat` 的先攻 |
| `skillBonuses` / `saveBonuses` | 技能检定、某属性豁免的固定加值 | `check()`、`save()` |
| `maxHealing` | 受到的法术治疗取骰子最大值 | `castSpell` 的 heal |
| `noReactions` | 不能用反应 | 新的 `canReact()`，借机攻击 / 护盾术 / 直觉闪避 / 反应法术 / `legalActions` 全改走它 |
| `maxSwings` | 每个 Attack 动作最多几次攻击 | 新的 `swingBudget()` |

还加了时机字段：`armedAtTurnOf`（等某人的下一个回合开始才生效）、`untilEndOfTurnOf`（到某人的回合结束就没）、`endSave`（持有者每个回合结束再豁免，成功就摘掉）、`lethargyOnEnd`（加速术结束的倦怠）。法术数据侧新增：`SpellDef.choices`（施法时要选的模式）、`allyRadius`（不给目标 = 射程内所有存活盟友）、`SpellEffect.save.typeRules`（按生物类型：免疫 / 豁免劣势 / 受最大伤害）、`attack.advantageIfMetalArmor`、`buff.unlessImmuneTo`。

**20 个法术现在自动结算**（`needs` 里的 `roll_modifier` 已摘掉，其它标签按实际情况留 / 摘）：

| 法术 | 结算 | 还要 GM 管的 |
| --- | --- | --- |
| 恶言相加 | 失败 → 目标下一次攻击检定劣势，用掉一次攻击或它自己的回合结束就没 | — |
| 克敌先击 | 你**下一回合**第一次对该目标的攻击有优势（施法回合不生效），用掉 / 那个回合结束 / 专注断就没 | — |
| 电爪 | 目标 `metalArmor` → 优势；命中后目标到它下回合开始前不能用反应 | — |
| 加速术 | 敏捷豁免优势；结束（专注断 / 10 轮到）时失能 + 速度 0 一个回合 | 额外动作的用途限制靠自觉；战斗外不处理倦怠 |
| 希望信标 | 感知 + 死亡豁免优势；法术治疗取最大值；不给目标 = 30 尺内所有盟友 | 药水 / `heal_dice` / 治疗祷言（GM 手算）不取最大 |
| 无痕步 | 隐匿检定 +10；不给目标 = 30 尺内所有盟友 | 不留痕迹 |
| 防护毒素 | 解中毒；对抗中毒状态和毒素伤害的豁免优势 | — |
| 防护善恶 / 驱散善恶 | 异怪 / 天界 / 元素 / 妖精 / 邪魔 / 亡灵（驱散善恶不含异怪）打你劣势 | 防魅惑 / 恐惧 / 附身；驱散善恶的两个特殊功能 |
| 增强属性 | 施法时选一种：熊（体质检定优势 + 2d6 临时 HP）/ 公牛 / 枭 / 猫（敏捷检定，含先攻）/ 鹰 / 狐；升环多一个目标 | 负重、缓降 |
| 降咒术 | 施法时选：某属性检定和豁免劣势（6 种）/ 对你的攻击劣势 / 你的攻击（含法术攻击）额外 1d8 黯蚀 / 浪费动作 | 浪费动作；升环延长时间（引擎仍按 1 分钟专注） |
| 缓慢术 | AC -2、敏捷豁免 -2、速度减半、不能反应、每个 Attack 动作一次攻击；每回合结束再豁免 | 动作 / 附赠动作二选一；1 动作法术的 d20 延迟 |
| 着迷术 | 失败者感知（察觉）检定劣势 | **引擎对所有察觉检定都劣势**，对施法者本人的那次由 GM 别掷 |
| 难以抗拒之舞 | 速度 0、敏捷豁免和攻击劣势、别人打它优势；免疫魅惑者无效 | 它每回合用动作做感知豁免摆脱 |
| 圣洁光环 | 30 尺内盟友所有豁免优势、被打劣势 | 邪魔 / 亡灵近战命中后的体质豁免致盲 |
| 预知术 | 攻击、检定（含先攻）、豁免优势，被打劣势 | 不会被突袭；按 1 小时算而不是 8 小时 |
| 枯萎术 / 日爆术 / 日光束 / 粉碎音波 | 亡灵 / 构装体不吃枯萎术；植物豁免劣势且受最大伤害；亡灵 + 软泥怪吃日爆 / 日光束豁免劣势；构装体吃粉碎音波劣势 | 粉碎音波的其他"无机材质"生物；日光束 / 日爆的其它部分 |

**没做，仍带 `roll_modifier`（剩 4 个）**：衰弱射线（无伤害的法术攻击 + 力量武器伤害减半，现有 `attack` 类型要伤害骰）、灼热金属（持握者攻击 / 检定劣势，要先有"持握物"）、瘟疫术（选疾病）、魔法圈（区域）。

**顺手改的、会影响别处的（评审时看这几条）：**
1. `tickDurations` 以前只看**施法者自己**身上有没有效果，所以挂在别人身上的专注法术（祝福术、加速术、定身人类……）一轮后就把专注丢了（之后受伤不再做专注豁免）。现在整盘找（`concentrationAlive`）。
2. 法术豁免的 `against` 以前只传状态；现在毒素伤害的法术也传 `poison`，所以矮人韧性对毒雾喷射这类生效，防护毒素也能给豁免优势（规则上本来如此）。
3. 玩家 `cast` 动作：增益 / 治疗不写目标 = 施法者自己（或 `allyRadius` 的默认盟友），**不再默认成眼前的怪物**（以前战斗中写「法师护甲」不带目标，会默认成眼前第一只可见的怪物，够得着就挂在怪物身上）；这类法术也不再因为 `needsTarget` 报错。有选项的法术从 `detail` 里认选项，认不出来就拒绝施法、不扣法术位。
4. GM 工具 `cast_spell` 加了 `option`（增强属性 / 降咒术要写选哪一种）。
5. 带 `markTarget` 的 buff（猎人印记、克敌先击）现在没目标会拒绝，以前会挂在施法者自己身上。
6. 新字段 `Actor.metalArmor`（`CharacterFile`、`MonsterDef` 同名）：构建器按护甲写；默认牧师布拉姆（链甲）、活化盔甲设了；**手写角色卡要自己填**。
7. 测试：`test/spells.test.ts` 的"每个法术都能施放"给有选项的法术补了 `option`。新增 `test/rollmod5e.test.ts`（38 个）、`test/rollmodLoop.test.ts`（2 个，走玩家行动层）。

**没验证：**
- 只有单元 / 假模型测试。真 Claude GM + 真玩家模型会不会在 `detail` 里把选项写对（「熊之耐力」「力量」「额外伤害」）、会不会被「认不出来就拒绝」卡住反复重试，没看过。玩家看到的法术说明末尾多了一句"施法时写明选哪一种：…"（降咒术约 200 字符）。
- 一个玩家一次 `cast` 只能写一个目标：加速术、增强属性升环、祝福术的多目标只有 GM 的 `cast_spell` 能用；`allyRadius` 的三个（无痕步 / 希望信标 / 圣洁光环）不写目标就是全员，是现在玩家侧唯一的"群体增益"。
- Atlas / overlay 上这些效果显示成什么没看（效果名是「降咒术：力量检定与豁免劣势」「加速术的倦怠（失能、速度 0）」这类）。
- 模型提示词里没有教它们用这些法术的时机（比如恶言相加→之后怪物攻击有劣势）；GM 的 `monster_action` 路径会自动吃到劣势，但 GM 描述里不会知道。

## 6d. 角色换成维斯坡伊 / 萨珀特菲（2026-10-18 21:40–21:55）

用户 给了两张角色卡 + 立绘表（`characters\`：`角色卡deepseek.txt` / `角色卡gemini.txt`、`character_*.png` 全身图、`sprits_*.png` 4×2 表情表）。
**座位对应**：`player_a` = deepseek = **维斯坡伊**（Triton 生命牧师 1 级）；`player_b` = gemini = **萨珀特菲**（Tabaxi 野蛮人 1 级）。

**已装进正式 vault，桌面是新开的局（暂停中）：**
- `campaign-vault/characters/player_a.json`、`player_b.json`：`build` + `aliases` + `persona`（persona 是卡里的背景 / 性格 / 与对方的关系 / "不要用你对《凡达林的失落矿坑》的了解"）。构建结果和卡一致（有测试，`builder.test.ts` 末尾）：维斯坡伊 HP 11、AC 18、豁免 感知 / 魅力；萨珀特菲 HP 16、AC 15（无甲防御）、豁免 力量 / 体质、技能 6 项、狂暴 2 次、猫爪。
- 构建器新增种族 `triton`、`tabaxi`（`source: 'custom'`，非 SRD，说明是自己的话）；`RaceDef.naturalAttacks`（猫爪 → `WEAPONS.claws` 1d4 挥砍）；`DataSource` 加了 `'custom'`。
- **力量不够穿重甲 → 步行速度 -10 尺，现在真扣了**（以前只警告）；矮人例外。维斯坡伊 力量 12 穿链甲（要 13）→ 步行 **20 尺**、游泳 30。这是按规则做的，卡上没写速度；要保持 30 尺就得改他的护甲或力量，告诉我。
- 写死的旧名字改掉了：GM 系统提示的"玩家有两个 AI…"现在从角色卡生成（`GameMaster.partyIntro`）；看点渲染的英文别名改读 `Actor.aliases`（角色卡顶层 `aliases`）；overlay 找不到角色名时的兜底改成"玩家 A / B"。**`aliases` 里的英文名是我猜的拼法（Vespoi、Sapertefi…），卡上只有中文，请 用户 按他们真名改。**
- Atlas 同步：座位换了角色时，旧 token 按**头像路径**（`player_a-*.png` / `sprites/player_a/`）认出来、改成新名字，不另补一个；改过名就重置先攻条（从存档恢复时才需要）。有测试（假 Atlas 客户端），**没在真 Atlas 上跑过**。
- 立绘：8 张 × 2 人切好放进 `campaign-vault/sprites/player_a|b/`（半身特写 433×419 / 423×414，抠掉白底，`scripts/slice_sprite_sheets.py`）；棋子头像 256×256 × 16 张在 `assets/tokens/faces/`（`scripts/make_token_avatars.py` 加了 `autoCenterX`、`allowOutside`，`faces.json` 重量了，圆形预览看过头发没被切）。**白底下沿是出图自带的毛边（身体渐隐成白），没处理**，头像不用那一块。原来的占位图在 `sprites/_replaced/`、`assets/tokens/faces/_replaced/`。overlay V2 不显示立绘，所以这些现在只用在棋子头像上。
- 旧数据没删，都在：`campaign-vault/characters/_archive_vex_bram/`（薇克丝、布拉姆）、`state/_archive_vex_bram_20261018/`（`table.json`、`atlas-tokens.json`，薇克丝 2 HP 那一局）。

**（2026-10-18 晚 22:xx 更新）监督进程和 trpg-table 已经被 用户 要求关掉了**，现在没有任何后台进程在跑（8098 / 8099 没有监听，Obsidian 也没开）。存档 `state/table.json` 是新角色的开局，再启动会从存档恢复；要重开用 `node dist/main.js --fresh`。下面"现场变了"写的是关掉之前的状态。

**现场变了：**
- Obsidian **没在运行**（27125 没有监听）。这次启动日志写着 `Atlas 27125 不通 … 退回 dry-run`，所以**新开局没有碰地图**。
- 监督进程我重启过，输出现在写进 `trpg-table/dev-watch.out.log` / `dev-watch.err.log`（以前写不到文件）。当前 pid：dev-watch 32044、trpg-table 随热重载会换（用 `Get-CimInstance Win32_Process` 找 `dist/main.js`）。仍然暂停、dry-run。
- **用户 要真正连 Atlas 开局时**：先开 Obsidian，再重启 trpg-table。这次重启走"从存档恢复"，会把旧 token 改名、重置先攻，但**不会清迷雾**；想要完全干净就先删 `state/table.json` 再启动（或 `node dist/main.js --fresh`）。

**没验证 / 要注意：**
- 真模型下两个新人设的表现（话少的萨珀特菲 / 爱唠叨的维斯坡伊）没看过；人设里有"现在你们在尼弗温特接了 Gundren 的护送活"，**和现在的剧本《银鸥号的残骸》（搁浅船）对不上**——GM 开场会讲搁浅船，玩家人设说在去凡达林的路上。要么给他们换个说得通的开场，要么写凡达林开场的剧本（哥布林伏击 + 地图），这是内容决定，我没动剧本。
- 种族特性里**引擎不自动结算**的：Triton 的控气御水（云雾术 / 阵风术 / 水墙术，每长休一次，引擎还不能"每长休一次"地施放，`wall_of_water` 也不在法术表里）、海洋使者；Tabaxi 的猫科敏捷（速度翻倍）、攀爬速度 20。都作为特性出现，GM 口头裁定。猫爪是攻击列表里的一项，能打。
- 萨珀特菲 1 级所以没有子职业；3 级要狂战士之路就把 `build.classes` 改成 `{ "id": "barbarian", "level": 3, "subclass": "berserker" }`（不写子职业也默认狂战士）。
- 维斯坡伊的法术：戏法 圣火 / 指引 / 维稳术，准备 治愈真言 / 光导箭 / 信仰之盾 / 庇护术，加上领域法术 祝福术 / 治疗伤害；1 环 2 个位。

## 6e. 新剧本《通往凡达林的路》和它的地图（2026-10-18 22:00–23:05）

用户 说"不要自己画地图，用素材"。结果：剧本 `campaign-vault/adventures/phandalin-road/`（`00-overview.md` + 5 幕），`config/table.yaml` 已经切到它（`adventure: phandalin-road`；旧的 `crashed-ship` 还在 vault 里，改回去即可，存档的剧本 id 对不上会自动开新局）。
**全部是原创文字**，不是任何官方模组的文本，只保留了角色卡里已有的 Gundren Rockseeker 和凡达林这两个名字。

| 幕 | 地图 | 遭遇（全程 1 级） |
| --- | --- | --- |
| 1 路上的死马 | Manea「Forest road」（Forest #1），17×12.75 格 | 2 个哥布林埋伏，会逃 / 求饶 |
| 2 林间血迹 | Manea「Forest camp」day，20×15 格 | 1 只拴着的狼，可以安抚；这里给一次长休 |
| 3 溪边洞口 | Dyson「The Deep Sepulchre」第一层，23×13.5 格 | 2 个哨兵（强攻 / 潜行 / 维斯坡伊走水道），栏里有狼（可选） |
| 4 水下大厅 | Dyson 第二层，22×12 格 | 受伤的熊地精头目"肉锤"（开场用 `damage_dice` 2d8），救 Gundren |
| 5 营火边 | Manea camp night | 无战斗，报酬 + 龙的传闻，`end_game` |

**地图是怎么来的**（都能重跑）：
- `scripts/build_phandalin_maps.py`：把 `resource_pack/` 里 Manea 的 jpg 和 `incoming/dyson-deep-sepulchre/` 的 png 裁 / 缩成整数格（森林 120 / 100 px，洞穴 100 px），写 `assets/maps/phandalin-*` 和 `scenes/phandalin-*.atlasmap`（5 张；`lighting` 关了，所以画面不会变暗；要黑暗氛围自己在 Atlas 里开）。
- `scripts/measure_phandalin_maps.py <输出目录>`：量每张图的 `地图信息`。洞穴是"粗黑线当墙 → 从种子格灌水 → 少数没画封口的地方补线 → 缺的桥格手补"；森林里的树 / 岩石 / 帐篷是我对着叠格子的图**手工标**的（颜色分类行不通）。起始格、怪物出场格、地标也在这个脚本的 `EXTRAS` 里，它会把结果写回各幕 md 的 `## 地图信息`。**改了 md 里这一节会被覆盖，要改去改脚本。**
- 洞穴图是 Dyson 的黑白墨线，没改画面，只裁出两层、去掉页脚；森林图原样缩放。

**代码层新增**（都有测试）：
- `MapInfo.start`（每个座位的起始格）和 `MapInfo.spawns`（怪物 id → 出场格列表）：`engine.placeParty()` 在开局和每次换幕时把 PC 放过去；GM 的 `start_combat` 优先用 `spawns`（按生成顺序），没写才用老的 (8,7) 默认格。以前换幕 PC 位置原样带过去、怪物固定出在 (8,7)，在新地图上会站进障碍里。
- 怪物表加了 SRD 的熊地精（`bugbear`），进了 `monsters.test.ts` 的对账表。
- `test/phandalinAdventure.test.ts`（9 个）：5 幕齐全、地图文件在、起始格 / 出场格合法且连通、地标没写在墙里、第三幕能走到暗道、第四幕能走到铁笼和石室、`TableLoop` 开局和换幕的位置。它读 用户 的正式 vault，没有就跳过。

**没验证 / 要 用户 看的：**
- **真 Atlas 上验过（23:05–23:10）**：5 张 `.atlasmap` 都能打开，背景铺满，格线和画面对得上（洞穴第二层的 50 px 偏移也对）；开局后两个角色的新头像 token 在第一幕起始格；又用真 `AtlasSync` 依次把第 2–5 幕过了一遍，PC 在各自起始格，隐藏的怪物 token（狼、哨兵、栏里的狼、熊地精）落在 `spawns` 写的格子上，位置和 Atlas 里的格子一致。截图在 `docs/shots/phandalin/`。验完我把第 2–5 幕里加的 token 都删了（第 1 幕两个 PC token 留着）。**只是地图和 token 位置**：没跑过 GM 驱动的换幕、没跑过战斗。
- **现场（23:10）**：trpg-table 和监督进程都没在跑；Obsidian（带 Atlas）开着，Atlas 停在第一幕地图；`state/table.json` 是新剧本第一幕的开局（探索阶段，暂停状态保存），下次启动会从它恢复，要重开用 `node dist/main.js --fresh`。`dist/` 已经按最新代码构建过。
- **启动带 Atlas 的 Obsidian 要用 `<workspace>\start_obsidian_trpg.bat debug`**（独立 profile `obsidian-data-campaign`）。直接双击 Obsidian 用的是默认 profile，没有 Atlas 插件，27125 不会起来。这晚 用户 先用默认的开了一个，我又用脚本开了一个带 Atlas 的；两个都开着，默认那个可以关。
- 没跑过真模型。GM 提示词里没有教它"第三幕吹哨 → 狼 / 头目警觉"这类分支怎么落地，写在 md 的 GM 秘密里，要看它会不会照着做。
- 平衡是按 5e 难度表估的，**没打过**：第一幕 2 个哥布林（对 2 个 1 级角色是"难"），第三幕同样，第四幕熊地精带伤。维斯坡伊只有 11 HP、2 个法术位，长休只在第二幕给一次。
- 怪物 token 还是占位图（没有狼、熊地精的图，会退回通用 `monster.png`）；DeepSeek 提的 Dungeon Crawl Stone Soup tiles（CC0）和 game-icons.net（CC BY 3.0）是对路的，我没下。
- 死马、货车、铁笼在地图上没有 token / 画面，只有地标和文字。
- **许可证**：Manea 的森林图只在创作者页面声明了"收费直播和视频"，zip 里没有许可证文件，页面原文我没读到；直播要署名 "Maps by Manea Roliste" 和 "Cartography by Dyson Logos"。见 `campaign-vault/LICENSES.md`。
- 营地的树丛手标得比较粗（约 40 个矩形），边缘有几棵树没标，会让 token 能站在树冠上；中间空地是准的。

## 6f. 第一次真模型跑《通往凡达林的路》第一幕（2026-10-19 09:36–09:42）

用户 点头后跑的：真 Claude GM（claude-sonnet-5-5）+ DeepSeek reasoner（维斯坡伊）+ Gemini 3.5 flash（萨珀特菲）+ deepseek-chat 渲染，连着真 Atlas，用 `scripts/cost-guard.mjs --limit 2 --stop-after-scene` 兜底。**第一幕约 6 分钟，47 次调用，实际花了 $0.344**（GM 22 次 $0.30、玩家 A $0.019、渲染 $0.018、玩家 B $0.007；价格按 claude-api 文档的 Sonnet 5.5 $2/$10、缓存读 $0.20，缓存写按 1.25 倍估，DeepSeek / Gemini 单价是旧脚本的假设）。

**发生了什么**（事件流 seq 1–144，没有 step_error，没有 Atlas 报错）：
- 两人都去查死马：维斯坡伊察觉 4+3 对 DC 13 失败，萨珀特菲 13+2 对 DC 11 成功（GM 把 DC 降了，写的是 13），闻到两边灌木里的臊味；萨珀特菲用了狂暴（`feature` rage）当"吓唬 / 先手"，GM 顺势让两个哥布林暴露、开战。
- 战斗 2 轮：南侧哥布林命中萨珀特菲（暴击，狂暴抗性后 4 点），北侧命中维斯坡伊 4 点（剩 7/11）；维斯坡伊暴击钉头锤、萨珀特菲巨斧砍倒北侧哥布林，南侧的撤离 + 疾走逃进林子（灵巧逃脱按设计用了）。
- 战后搜查：箭是骨头削的、哨子、沾红胡须的破布、血迹拖进北林，医药检定判断被拖的人还活着；GM 在玩家表示追进北边林子后 `end_scene`，换到第二幕；守卫在场景切换那一刻暂停了桌面。
- **人设没跑偏**：维斯坡伊全程"尊贵的客人"，连对哥布林都客气（"刀口对着人，这可不成体统——先坐下歇歇吧"），劝别追逃兵；萨珀特菲短句、叫他"水里的"、"太小，没肉。听你的，不追。"。
- **Atlas**：开战时哥布林 token 按 `spawns` 的出场格建出来（日志里是它们移动之后的格），换幕后地图自动切到营地、两个角色 token 站在第二幕起始格、维斯坡伊的血条是黄的（7/11）。

**没看到 / 要注意**：
- 没出现"哥布林求饶、维斯坡伊想救"那个分歧点：北侧哥布林被打死了，南侧是逃走的。
- 第一幕没有真的"被伏击"：玩家主动查了、闻到了，所以没有 `surprised`；难度比预估轻（两个哥布林只打了 2 轮，只有 2 次命中）。
- 桌面现在停在**第二幕开头**（暂停），`state/table.json` 是这个状态；要重来第一幕用 `node dist/main.js --fresh`。第 2–5 幕还没用真模型跑过；第三幕的哨子警报、第四幕头目战（开场 `damage_dice` 让他带伤）都是新机制，没验证。
- 守卫的用法：`node scripts/cost-guard.mjs --limit <美元> --pid <trpg-table 的 pid> [--stop-after-scene]`；输出写到哪里自己重定向。累计只算启动之后新增的真实调用，超限先 `POST /pause` 再结束进程。

## 6g. 直播画面右下角的角色卡改成「立绘探出卡片」（2026-10-19，只动了 overlay）

起因：用户 说角色卡里立绘只露一小块、名字压在下巴上，想展示全身或让立绘露出方框外。

- **没做全身**：能用的全身图只有 `characters\character_deepseek.png / character_gemini.png`（白底、只有 neutral 一个表情，而且是接近正方形的带武器大图），表情切换用的 `campaign-vault/sprites/player_a|b/<表情>.png` 都是透明底的**半身像**（433×419 / 423×414），底边是毛的。面板只有 608×300，放不下全身。要全身得再让 ChatGPT 按表情逐张出全身图，并且改面板高度。
- **改法**（`overlay/style.css` 的 `.card .portrait / .sprite`，三个变量在 `.card .portrait` 里：`--portrait-h:158px`、`--sprite-w:232px`、`--sprite-sink:16px`）：立绘按宽度 232px 贴着暗色底的下沿站着，比底高的部分（头）探出卡片上沿、盖在面板标题行上；`.card` / `.portrait` 的 `overflow` 改成 `visible`，`#party .cards` 抬到 `z-index:2`。立绘用 `mask-image` 把左右和底边各渐隐一小段（原图从表情表切出来，左右有竖直硬边）；底部再下沉 16px 藏到 `.vitals`（现在有 `z-index:1` 和不透明底）下面，毛边就看不见了。`.vitals` 的内边距收紧了一点（6/12/8，行距 6）来腾高度。
- **战斗时的先攻条**在标题行右边，会被探出来的头盖住；所以标题行的文字（`.tag`）和 `#initiative` 在 `#party` 里提到了 `z-index:3`（线 `.rule` 留在下面），先攻圆片透明度 0.7→0.88。`--sprite-sink` 不能调小：调小了萨珀特菲的眼睛会落到先攻条那一行。
- 预览：`/overlay?demo=1&hold=1&bg=solid&combat=1&active=player_a`（`combat=1` 是这次加的，伪造一条 6 人先攻条）；倒下 + 状态：`&hp_a=0&cond_b=祝福术,中毒`。截图在 `docs/shots/overlay/`。
- **验证了什么**：overlay 单页（`bg=solid`，1920×1080 精确截图）里看了探索 / 战斗（6 个先攻圆片）/ 行动中 / 思考点 / 倒下 + 状态标签；`npx tsc --noEmit` 和 `npm test`（376 个）通过。头顶最高处基本落在面板上沿，不会伸进 Helixus 那块区域，所以**不依赖** 直播姬 里图层的上下关系。
- **量过 8 个表情**（透明度包围盒 + 拼图）：头顶位置各表情一致；眼睛大多在先攻条那一行以下，**例外是萨珀特菲的 `hurt`（眼睛比先攻条底边高约 2%）**：战斗里先攻条放满 5–6 个圆片时会盖到他的右眼。没为它再把立绘往下沉（再沉就没有"探出"了）；真遇到再把 `.card[data-seat="player_b"] .portrait` 的 `--sprite-sink` 单独加大，或战斗时把先攻圆片缩小。
- **没验证**：没有在真实 Atlas 玩家窗口里看（overlay 是叠在上面的透明 iframe），只看了单页；没跑过真实对局里的表情切换动画（`opacity`/`filter` 过渡我没动）。

## 6h. 状态标签滚动 + 增益显示 + 凡达林 token 包（2026-10-19 上午）

**状态标签（角色卡底部）**
- 原来页面上的「状态」只有 `conditions`（中毒、倒地…）和狂暴；**法术增益（祝福术、御盾术…）和鲁莽攻击根本没送到页面**，而且页面里写死 `.slice(0, 3)` 只显示前三个。
- 新增 `src/table/statusTags.ts`：`statusTags(actor, raging)` → `{ text, kind: 'down'|'debuff'|'buff', conc? }[]`，顺序「濒死/稳定/死亡 → 负面 → 增益」，同名去重；`effectIsHarmful(effect)` 按字段判断正负（给攻击者优势、自己劣势、负加值、缓慢类限制 = 负面；隐形/躲藏这两个状态算增益；其余效果算增益）。`loop.playerStates()` 现在同时送 `tags`（结构化）和 `conditions`（同一批的纯文字，旧页面兜底）；`overlay/server.ts` 的 `/overlay/demo` 也带上 `tags`。
- 页面（`overlay/app.js` 的 `renderTags / fitTags`，样式在 `style.css` 的 `.conds*`）：增益青色、负面红色、濒死暗红、专注的带 ◎；一行放不下时整条**自动来回滚动**（速度 38px/s，两头各停 1.8s；`TAG_SPEED` / `TAG_HOLD`），下面一条 3px 的**滑轨**（滑块和标签同步）指示位置，两头各虚掉一小段。内容没变不会重建，滚动不会被频繁的 state 事件打断。直播里没人能拨滚动条，所以是自动的。
- 预览：`?demo=1&hold=1&bg=solid&cond_b=+*祝福术,+狂暴,-中毒,+御盾术,-鲁莽攻击,+指引术&cond_a=-目盲,+隐形`（`+` 增益、`-` 负面、`*` 专注）。截图 `docs/shots/overlay/party_tags_overflow.png`。
- **验证了**：无头 Edge 1.5 倍截图看了样式；用 Web Animations 的 `currentTime` 跳到 30% 位置，标签平移 −136px、滑块平移 54px（预期值）；单测 `test/statusTags.test.ts`（7 个）+ `atlasSync.test.ts` 加 1 个；`npm test` 384 个通过。**没验证**：真实对局里标签随回合变化（`effects` 过期移除）的显示；动画在真实 Atlas 窗口里的流畅度（无头截图不走动画时间，只能用跳时间的办法看）。
- `dist/` 已重新构建，**但正在跑的 trpg-table 进程（pid 29872）是旧代码**，要重启才会送 `tags`（重启前先开带 Atlas 的 Obsidian，不然会退成 dry-run）。

**凡达林 token 包**（用户 放在 `campaign-vault/resource_pack/Tokens PNG 300ppi/`）
- 77 张透明底 PNG：72 张 300×300，5 张 600×600（巨蜘蛛、赭黄果冻怪、食人魔、枭熊、毒牙龙）；一半是怪物（地精、熊地精、狼、骷髅、丧尸、食尸鬼、巨蜘蛛、邪教徒、赤印恶徒、食人魔、枭熊、刺蝠、窥视者、窥视怪、格里克、赭黄果冻怪、焰颅、荆棘枯萎者、幽灵、绿龙…），另一半是模组 NPC（Sildar、Gundren、Elmar Barthen…）。人类 NPC 头像角落有 "artflow.ai" 水印，怪物没有。
- `scripts/import_lmop_tokens.py`（重复运行无副作用）：全部复制到 `assets/tokens/lmop/<id>.png`；引擎里已有的 9 个怪物（goblin wolf bugbear skeleton zombie ghoul giant_spider cultist bandit←赤印恶徒）复制成 `assets/tokens/<id>.png`，原来的占位图留在 `_replaced/`。`AtlasSync.imageFor` 现在查 `assets/tokens/<id>.png` → `assets/tokens/lmop/<id>.png` → `monster.png`，所以以后给引擎加 `hobgoblin / orc / ogre / owlbear / stirge / nothic / grick / ochre_jelly / flameskull / twig_blight` 时 token 自动有。没有对应图的：bandit_captain、scout、swarm_of_rats、sahuagin、giant_crab、animated_armor（后四个不是凡达林的怪）继续用原占位图。
- **没验证**：新 token 在真实 Atlas 里的样子（当时 Obsidian 被关了）；圆形裁切 / 光环下会不会把整身立绘切掉头。
- 许可证见 `LICENSES.md`：包里只有一份 legal 文件，说是 WotC Fan Content Policy 下的非官方粉丝内容；没有作者 / 来源。收益直播是否在范围内**未核实**，等 用户 定。

**这批资源里的地图**（没用，只检查了）
- `Official Maps/` 5 张 jpg：劫掠巢穴 2800×1900（28×19 格，100 px/格）、红标藏身处 2800×1900、索恩树废墟 2800×1900、劫掠堡 3000×2100、回响洞窟 3500×4800。是 WotC 官方地图（legal 文件写着 Cartographer: Mike Schley）。劫掠巢穴就是《凡达林的失落矿坑》第一章的洞穴，和我们第 3、4 幕（现在用 Dyson 的 Deep Sepulchre）对应。
- `1 Maps PDF 11x17 Printable/` 30 个 PDF（哥布林伏击、凡达林镇广场日 / 夜、各店铺、巨人沉睡酒馆、特雷森达庄园、各种遭遇图…）：**只是分页打印版**，每个 8 页 / 4 张内嵌 JPEG 瓦片（3000×4810，每张 10×16 格，300 px/格），镇广场 48×40 格是 24 页 / 12 张。没有 PDF 库，我能用纯 Python 抠出内嵌 JPEG，但拼回整图要确定每张的位置和旋转，我只抠了哥布林伏击一个，没拼。
- 棋盘：引擎的 `BOARD` 是 32×24 格，28×19 的图要贴进去并把多出的边标成不可站；35×48 的回响洞窟放不进，需要另做（分区或改 BOARD）。

## 6i. 经验值、自动升级、3 级版角色卡（2026-10-19 中午）

用户 定的：**要经验值**——战斗结束按怪物 CR 发经验，到线自动升级；两人准备 3 级开卡，原来的 1 级 json 不能覆盖。

**3 级版角色卡**（另存，原文件没动）：`campaign-vault/characters/lv3/player_a.json`、`player_b.json`，`xp: 900`。
- 维斯坡伊：3 级生命领域牧师，HP 27，AC 18，速度 20（链甲力量不足的扣减还在），4 个 1 环 + 2 个 2 环法术位；准备法术在原来 4 个（healing_word、guiding_bolt、shield_of_faith、sanctuary）上加了 **aid、hold_person**（我替他选的，要换改 `build.spells.prepared`）；生命领域的领域法术自动准备。
- 萨珀特菲：3 级野蛮人，狂战士之路（显式写了），HP 38，AC 15，狂暴 3 次；鲁莽攻击、危机感应。**狂乱（狂暴中的附赠动作近战攻击）引擎里没有单独实现**，在特性表里是「GM 口头裁定」那类（`describeFeatures` 的 adjudicated），没实测。
- 怎么用：`config/table.yaml` 加了 `character_set`（现在是空 = 原来的 1 级卡）；改成 `character_set: "lv3"` 并用 `node dist/main.js --fresh` 重开（存档里的角色会盖过角色卡文件）。指定的套里缺哪个座位的文件就退回原来的。`readBuildSpec` / 升级也读同一套。**我没有切换**——现在存档是第二幕开头的 1 级队，《通往凡达林的路》是按 1 级写的（地精 / 狼 / 一只带伤的熊地精），3 级队会很轻松。

**经验值**（`src/rules/xp.ts`、`engine.awardCombatXp / awardXp`）：
- CR → XP、等级门槛都是 SRD / PHB 的公开数字，有单测对过。`Actor.xp`（没写 = 该等级的门槛值）、`Actor.xpAwarded`（怪物打标记，避免重复发）。
- 发给谁：HP 0 且还没发过的怪物，总数**平分**给没死的 PC（昏迷的分，死亡的不分，零头不发）。**逃跑的怪物（HP > 0）不算**——第一幕跑掉的那只哥布林没经验。全员死亡时不打标记，留着以后发。
- 什么时候发：GM 调 `end_combat`、引擎判断战斗结束（`finishCombat`）、换场景 / 结束游戏（`applySceneEnd` 先发一次）；可以重复调用不会重复发。剧情经验：GM 新工具 `award_xp(amount, reason)`（描述里写了战斗经验不用手发、一个小目标 50–200、大目标 300–500）。
- 结果文字（谁分到多少、谁升级、新特性）作为 `end_combat` / `award_xp` 的返回给 GM 去旁白；自动结束战斗时塞进给 GM 的下一条 note。事件：`xp`、`level_up`（overlay 专用，不走 link）。

**自动升级**（`src/table/progress.ts` 的 `levelUpActor`，`src/rules/sheet.ts` 的 `applyCharacterFile`）：
- 读角色卡里的 `build`，第一个职业等级 +1，重新构建，再覆盖到正在玩的 Actor：**保留**当前 HP（加上最大 HP 的增量，HP 0 时不加）、状态、效果、专注、死亡豁免、本回合行动、位置、已用的法术位和资源（超过新上限的截断）、生命骰已用数、人设 / 备注 / 别名 / 名字 / 经验。
- 没写进 build 的选择由构建器按默认偏好自动选（4 级属性提升 = 主属性 +2；法术按偏好表补满），选了什么写在 `warnings`、进日志（`logs/table.jsonl`）。一次经验够跳两级会连升。20 级不再升。角色卡没有 `build`（手写整张卡）→ 不能自动升，结果文字里会说。
- 升级之后 `syncActor` 同步 Atlas（最大 HP 变了）、`publishState` 刷新 overlay。
- 画面：分到经验时角色卡上浮出「+N 经验」，升级时浮出金色「升级！Lv N」，6 秒后消失（`overlay/app.js` 的 `showToast`；预览 `?demo=1&hold=1&toast=1`）；等级写在职业那一行（构建器的 `class` 字符串）。截图 `docs/shots/overlay/party_toasts_xp_levelup.png`。

**验证了**：`test/progress.test.ts`（15 个）：CR / 门槛表、平分 / 零头 / 逃跑 / 死亡 / 不重复、lv3 卡能读且数值对（HP 27 / 38、法术位、狂暴 3 次）、3→4 级各项保留（含倒下时升级、狂暴次数）、`TableLoop.grantCombatRewards` 端到端（事件、文字、连升两级）；`npm test` 399 个通过。
**没验证**：真实对局里 GM 实际调 `end_combat` / `award_xp` 的表现；升级后 Atlas 里 token 的 HP 条（没连 Atlas）；升级后角色在 AI 玩家提示词里的样子（职业行会变）；4 级以上自动选的法术合不合你意；overlay 提示在真实 Atlas 窗口里的位置。**没做**：经验条 UI（只在升级 / 得经验时弹提示）；GM 手动给单个角色发经验；等级上限设置（现在升到 20 为止）。
- **已经切到 3 级版**（`config/table.yaml` 的 `character_set: "lv3"`，`--fresh` 重开；旧的 1 级第二幕存档归档在 `state/_archive_lv1_scene2_20261019/`）。

**第一次真模型跑 3 级版第一幕（2026-10-19 11:18–11:24）**：6 分钟，42 次调用（GM 19、渲染 13、维斯坡伊 6、萨珀特菲 4），**$0.353**，0 次失败，守卫在换到第二幕时暂停桌面。
- 流程：两人查死马（察觉 / 生存检定），萨珀特菲闻到臊味，GM 开战（南侧哥布林先攻 21，没打中维斯坡伊）；萨珀特菲附赠动作开狂暴 + 鲁莽攻击，一斧 10 点放倒南侧哥布林；北侧弓手射偏后躲进灌木（隐匿 19 ≥ 13），萨珀特菲冲进灌木一斧 9 点放倒它；`finishCombat` 自动判战斗结束。两人全程没掉血（27/27、38/38）。
- **经验结算在真模型里跑通了**：日志里 `击败北侧哥布林、南侧哥布林：共 100 经验，每人 50 | 维斯坡伊 经验 950（下一级 2700） | 萨珀特菲 经验 950（下一级 2700）`。没有升级（还早）。
- 对账：桌面和 Atlas 一致（地图换到 `phandalin-camp`、两个 token、HP 对得上）。
- **没验证**：overlay 上「+50 经验」提示有没有真的弹出（没人看着画面；`xp` / `level_up` 是 overlay 专用事件，`/events` 接口里看不到）；`award_xp` 和升级这条路径在真模型里还没触发过（升级只在单测和 `TableLoop` 的假模型测试里跑过）。
- 桌面现在停在**第二幕开头**，暂停，pid 25336。`dist/` 是新代码。

## 6j. 配音：旁白 + 两个角色（阿里云百炼 qwen3-tts-flash，2026-10-19 午后）

**音色**（用户 定的，名字对着官方音色表核对过）：旁白（GM）= **Eldric Sage**（沧明子，沉稳老者）；维斯坡伊（`player_a`，鲸鱼牧师）= **Kai**（凯）；萨珀特菲（`player_b`，虎野蛮人）= **Marcus**（陕西-秦川，陕西话）。`config/table.yaml` 的 `tts:` 段，`voices.<角色>.voice / rate / volume`。

**接口**：`POST https://dashscope.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation`（北京地域），`Authorization: Bearer <key>`，body `{model:"qwen3-tts-flash", input:{text, voice, language_type:"Chinese"}}`，非流式：返回一个 24 小时有效的 wav 地址，再下载；24kHz 单声道 16 位。单次最多 600 字符，**汉字按 2 个字符算**（实测 29 个汉字计 58）。价格官方页写北京 **0.8 元 / 万字符**（我只看到价格，没找到免费额度）。不走代理（国内直连；系统代理下第一次请求曾失败过一次，重试就好——Node 这边用 undici 不读系统代理）。**密钥**：用户 的新格式 `sk-ws-…`，直接用就行；放在 `trpg-table/.env` 的 `DASHSCOPE_API_KEY`（`.env` 在 .gitignore 里；原文件 `alicloud.txt` 没动）。`scrub()` 现在会遮这种带点的密钥（之前认不出）。

**怎么接的**（`src/tts/`：`dashscope.ts` 客户端、`speech.ts` 服务、`wav.ts`、`index.ts` 的 `createSpeech`）：
- 谁说话：GM 的 `narrate`（`GameMaster.publishNarration`）→ narrator；玩家 `decision.say` → 各自音色。**不读**看点 / 心里话 / 移动骰点这类机械播报。
- 文字先清洗（去 markdown、引号书名号、表情，换行变句号），超过 `max_chars`（110）按句子切段，每段单独合成（最多 3 个并发），合成结果按内容哈希缓存在 `state/tts/<id>.wav`（同一句同一音色只合成一次、只计一次费）。
- wav 头：DashScope 给的是流式占位长度（0x7fffff9b），落盘前改成真实长度（浏览器才能读对时长）。
- 玩家台词：`runPlayer` 里台词一确定就 `prepare()`（开始合成），气泡 / `decision` 事件出来的同一刻 `release()` 放进播放队列——后面还有看点渲染和 `tThought`/`tBetween` 的等待，合成基本赶在气泡之前好了，**声音和气泡同时出**。旁白是文字一出就合成，声音比字幕晚 1–4 秒（实测 66 个字合成 4.2 秒，一句话 1.4 秒）。
- 节奏：`SpeechService.idle()` 等「已放出去的音频估计播完」（服务端按每段时长 / 倍速算一条时间线），用在三处：GM 回合结束（`afterGmTurn`，下一步是玩家说话或怪物行动）、玩家台词放出后等他说完再结算动作（和 `tDecision` 取大）、换场景前。**上限 `wait_cap_ms`（60 秒）**，合成失败或网络慢时桌面不会卡死；`wait_cap_ms: 0` 就是不等声音（开发时想快跑用）。
- overlay：收到 `tts` 事件（服务端 `/overlay/tts/<id>.wav`，支持 Range）排队按顺序播；播的时候说话气泡跟着多留到播完；倍速用 `playbackRate`（保持音高）；超过 2 分钟的旧事件不播（SSE 重连会重发）；`?audio=0` 关声音（同一页面开多个窗口时只让一个出声）；浏览器不让自动出声时顶上出「点一下页面开启声音」（Electron / OBS 一般不会）。`window.__overlayAudio.enqueue / status` 是自检入口。
- 失败：合成失败只丢这一段，记 `logs/usage.jsonl`（`provider:"dashscope"`, `purpose:"tts"`, `characters`, `ok`, 错误信息已遮密钥），trace 里只提醒一次。`scripts/cost-guard.mjs` 现在把 dashscope 的 `characters` 按 0.8 元 / 万字符、汇率 7.2 折成美元计入止损。
- 关掉：`tts.enabled: false`；没有 `DASHSCOPE_API_KEY` 或 `--fake` 自动不配音。

**倍速**（`rate`）：沧明子语速很慢——实测 66 个字念 20.4 秒（约 3.2 字/秒，Kai 约 4.8，Marcus 约 4.5），所以旁白默认 **1.25 倍**，Kai 1.05，Marcus 1.0。**这三个数是我按语速估的，没人听过**，用户 听了不顺耳直接改 `table.yaml`（改完重启）。一段 150 字的旁白大概要念 30 秒以上；觉得旁白太长拖节奏，是 GM 提示词里限制旁白长度的事，不是 TTS 的事。

**验证了**：对着真服务三个音色都合成成功（凯 / 秦川 / 沧明子，1.4–4.2 秒）；`createSpeech` → `say / prepare / release / idle` 的真实流程跑通（3 段，共 28 秒含等播完）；overlay 在真浏览器里按顺序播了三段（倍速、保持音高、时长读对）；音频路由 200 / 206 / 416 / 404 都对；`test/speech.test.ts`（17 个，含对本地假服务器的真 HTTP 路径）、`test/loop.test.ts` 加 2 个（旁白交给 narrator、玩家 prepare→release→idle 的顺序）；`npm test` 418 个通过。
**没验证**：**直播间能不能听到**——声音是 overlay 页面（Atlas 玩家窗口里的 iframe，Obsidian 的进程）在播，直播姬 / OBS 要采集这个窗口的声音或系统声音才有；这边我不知道 用户 的采集怎么设的。真实对局里 TTS 的整体节奏（旁白长度、等声音的停顿）没跑过；陕西话 / 凯的实际听感、1.25 倍速旁白是否清楚没人听过；两个角色的声音和 Helixus 自己的 TTS 同时说话时怎么混，没管。

## 6k. 直播合成：Helixus 的舞台窗口做成 720×780「跑团模式」，叠进右上主播区（2026-10-19）

用户 问：是把直播窗口（Unity 舞台）做小、叠到跑团窗口里，还是把跑团窗口做成直播窗口 UI 的一部分。**我定的是前者（A）**，不做后者（B）：
- 现在的直播本来就是直播姬「窗口捕捉」HelixusStage；跑团画面也是一个窗口（Obsidian 的 Player view，里面叠着 overlay iframe）。A 只是再加一路窗口捕捉，不动任何一边的架构。
- B 要让 Unity 把一个 Electron / 网页窗口画进自己的界面（等于再做一路窗口采集进 Unity 纹理，多一层延迟和 GPU 占用），而且 overlay 是 HTML、Atlas 在 Obsidian 里，Unity 的 UI Toolkit 吃不了；之前辛苦修好的「主窗口被遮住地图不冻结」这套也会被重新拉进来。
- overlay 的布局早就给 Helixus 留了正好这么大的空框：`config/overlay.yaml` 的 `layout.streamer = { x: 1200, y: 0, w: 720, h: 780 }`（画布 1920×1080），背景纯黑。**所以舞台只要变成 720×780 的竖版窗口，1:1 贴进去就行。**

**做了什么**
- `D:\unity\projects\HelixusStage\stage_config.table.json`：和 `stage_config.json` 一模一样，只有 `display` 改成 720×780（窗口模式）。舞台启动时按 `display` 设窗口大小，用 `--config <绝对路径>` 指定这份就行，**不用重新构建**；原来的 `stage_config.json` 一个字没动（它会被正在跑的舞台热加载）。
- 竖版下的构图我看了：中景 / 全身 / 近景 / 三分之四侧面 / 英雄机位都很好看（这个角色本来就是高个子，竖版比横版更合适）；侧面、俯视、背面（触手一团）不太好看，但它们本来只在待机 / 跳舞 / 唱歌状态里才出现，跑团里主要是说话状态。
- **舞台界面（UI）的竖版适配**（`Scripts/UI/StageUi.cs`）：界面所有数字是按 16:9 写的，面板跟着高度走，720×780 的逻辑宽度只有约 840，所以原来**字幕被两侧 300 的边距挤成一条 5 个字宽的窄柱**、问题卡片压在角标上。现在窗口宽高比低于 1.2 时（`ApplyAspectLayout`）：字幕左右边距 28、字号 ×0.78，问题卡片下移到角标下面并缩小字号和内边距，弹幕列表变窄并抬到字幕上面；歌单面板在竖版里不再给问题卡片让位（竖版没地方放两列）。**横版（1920×1080）完全不变**，我对着同一组消息拍了新旧对比，位置一致。
- 重新构建：批处理构建到 `Build_next`，然后 `tools\swap_build.ps1 -NoStart` 换成 `Build`（旧的在 `Build_prev`，要回滚就把两个目录换回来）。构建 0 错误 8 警告（和以前一样）；`ProjectSettings.asset` 被批处理构建改了，已 `git checkout` 还原。Unity 仓库里 `StageUi.cs` 和 `stage_config.table.json` **没有提交**（要提交说一声）。
- 启动：`<workspace>\start_live_window_unity_table.bat` = `start_live_window_unity.bat` 的副本，只是舞台那一行加了 `--config stage_config.table.json`（其它服务、AITuberKit、Chrome 页面完全一样）。如果 1920×1080 的舞台已经在跑（端口 19310 被占），它不会重启舞台、只会提示——先关掉旧的。
- 截图（在 scratchpad，没进仓库）：竖版各机位的拼图、竖版带弹幕 / 问题卡片 / 字幕的实拍、横版对照。

**直播姬里怎么摆**（画布 1920×1080；`overlay.yaml` 的坐标）：
1. 源 1：窗口捕捉 Obsidian 的「Player view」窗口，铺满整个画布（跑团画面：地图、字幕、两个主角面板、右上留空的黑框）。
2. 源 2：窗口捕捉 HelixusStage（720×780 的窗口，**只要客户区，不要标题栏**），位置 x=1200 y=0，大小 720×780，放在源 1 上面，正好盖住那个黑框。
3. 两个源都要勾「采集音频」：跑团的旁白 / 角色配音是 Player view 窗口（Obsidian）发出的，Helixus 的声音是舞台发出的。
4. OBS 的「自动」采集方式会给 HelixusStage 选 BitBlt 变黑屏，要手动选「Windows 10 (1903 及以上)」；直播姬是不是也这样我没确认（首播时用直播姬采集是正常的）。

**没验证**：**直播姬里的实际摆法和音频混合**（我没有直播姬，上面是按它的窗口捕捉能裁剪 / 缩放写的）；Helixus 的页面（AITuberKit，`?stage=unity`）连 trpg-table 的 link（8098）做追剧情锐评——页面这边的提示词在分支 `unity-stage`（`ec1e01ca`、`d78e1545`）里，只过了 jest，**从来没有和 trpg-table 一起真跑过**，页面状态是否 connected（`GET /api/v1/status/?clientId=helixus`）和锐评质量都没看；竖版窗口下口型、走动（`walk`，在 2.3 米圆内）会不会走出画面（竖版视野窄，横向走动可能出框）没有长时间看过。

**布局微调（同一天，用户 看了真实画面说「窗口可以拉大些，肯定还能再大」）**：地图框两边有大片黑边，把它还给右边的主播区。config/overlay.yaml：map / subtitle 1312→**1200** 宽，streamer / characters 从 x=1312 w=608 改成 **x=1200 w=720**（主播区 608→720，+18%；两个主角面板也变宽了）；舞台的 stage_config.table.json 同步成 720×780，我重拍了竖版的机位和界面，构图和字幕都正常（近似正方形，更不挤）。	est/servers.test.ts 的断言同步改了。**代价（我量过真实 Player view 截图）**：Atlas 在玩家窗口里给地图留的边是固定像素（约左右各 83、上下各 45，按画布 1920 算），所以地图实际显示宽度 = min(框宽 − 166, (框高 − 89) × 地图宽高比)——框 1312 时 4:3 的森林图显示 1081×811，框 1200 时变成 1034×775（**−4.4%**）；16:9 左右的两张洞穴图原来 1146 宽，现在 1034（**−9.8%**）。要平衡：框宽 1250（主播区 670）时森林图完全不缩、洞穴图 −5.4%；这几个数在 overlay.yaml 的 layout 里改完重启 trpg-table 就行（舞台窗口大小跟着 streamer 的 w×h 走）。真实 Player view 里是不是比预期更糊 / 洞穴图的格子是不是太小（约 26 像素）我没在洞穴图上看过。
**彩排时的舞台窗口大小（同一天，用户 说「主播的画面还是太小，再拉大」）**：彩排没有直播姬，用户 是把舞台窗口直接盖在 Player view 的主播区上看的。这台机器是 2560×1600、150% 缩放，Player view 最大化后画布 1920 对应 2562 物理像素（1.334 倍），所以主播区在屏幕上是 **960×1040 物理像素**、客户区原点 (1601, 43)；720×780 的舞台窗口填不满它。stage_config.table.json 的 display 改成了 **960×1040**（Unity 的窗口大小是物理像素），我把窗口对齐到了框上（窗口外框 982×1096，位置 (1590, −2)，边框左右 11 / 标题栏 45 / 下边 11）。真上直播姬时这一路采集会被缩到 720×780（×0.75），反而更清楚；界面按高度缩放，宽高比没变（0.923），字幕 / 弹幕的相对位置不变。**这个像素数只对这台机器 + 最大化的 Player view 有效**，换屏幕要重算（物理像素 = 画布像素 × Player view 宽 ÷ 1920）。
- 同时把跑团模式的镜头限制成半身以上：camera.rules 的 idle 只轮 medium / three_quarter_left / three_quarter_right / rise（原来会轮到 wide、hero、orbit、side、high、back，人在框里很小），speaking 去掉了 hero_left；medium / three_quarter / closeup 的 ill 提到 0.86–0.88（原来 0.74–0.8）。只改了 stage_config.table.json，原来的 stage_config.json 没动。启动脚本不变（--config 指这份），但窗口大小要靠手动对齐（Win32 SetWindowPos，脚本在 scratchpad 里，没进仓库）。
## 6l. GM 换 Haiku；Helixus 当「导演」、GM 写好执行后推导演稿（2026-10-19）

**GM 模型**：`config/models.yaml` 的 `gm` 座位从 `claude-sonnet-5-5` 换成 **`claude-haiku-5-5`**（用户：「你很贵的你知道吗」）。官方标价 Haiku 5.5 是 $0.10 / $0.50 每百万 token（prompt ≤ 100K），Sonnet 5.5 是 $2 / $10，贵 20 倍；`scripts/cost-guard.mjs` 已按模型名区分（`haiku-5` 用 Haiku 价）。Haiku 5.5 默认开自适应思考、思考也算 max_tokens、`budget_tokens` 会 400（适配层没发这些字段，不受影响）。真调了一次（`narrate` + `director_note` 两个工具）：能正确按工具调用，15.7 秒、输出 427 token（含思考），导演稿写得偏长（运行时会截到 200 字）。**没验证**：Haiku 当 GM 整幕的质量（工具调用的稳定性、人设、规则裁定）——第二幕还没跑；要是翻车就把那一行改回 sonnet。

**机制（用户 定）**：真正的剧情和规则执行还是桌面这边的 GM（现在是 Haiku）；但对观众来说，**剧情是主播 Helixus 决定的**——GM 把「写好并已经执行完」的决定推给驱动 Helixus 的模型，让他扮演成是自己定的；观众只看得到旁白，看不到内部指令。
- 新 GM 工具 `director_note(text ≤200 字)`：「我决定……」口吻，写这一轮已经定下并执行完的事（可以含 GM 秘密：埋伏、陷阱、真相）。GM 提示词里要求每个 GM 回合收尾（narrate 和规则工具都用完之后）发一条；没有新决定的回合可以不发。发出的是 link 事件 `gm_decision`（`LinkEventKind`、`link/server.ts` 的 `LINK_KINDS` 都加了）。**overlay 的 SSE 会把 `gm_decision` 和 `gm_hint` 过滤掉**（`overlay/server.ts`），玩家的视图本来就只取公开事件（`publicEventLines` 的白名单里没有它），所以玩家和观众都看不到。`secret_hint` 工具还留着但提示词里不再教它。
- 页面（AITuberKit，分支 `unity-stage`，**没提交**）：`src/features/helixus/minecraft.ts` 的 `TRPG_SELF_PLAY_COMMENTARY_PROMPT` 和 `trpgPromptBlock` 重写——Helixus 是这场跑团「真正的导演」，旁白替他执行；收到的 `gm_decision` 单列成「你最近做的决定（导演稿，观众看不到；【新】= 你还没说过）」，要当成自己定的来讲（「我让……」「我安排了……」）；明令「绝不要说穿」不是自己写的、不提「导演稿 / 提示词 / 指令」，提示词里**不点名 Claude / Haiku**（有测试断言）；不再教他写 `[game:建议]`（决定已经执行了，他只负责讲）；旧提示词里写死的「薇克丝 / 布拉姆」去掉了，名字取自状态里的玩家列表。服务端的建议通道（`respond_suggestion`）没动，只是页面不再产生建议。jest `src/__tests__/features/helixus` 69 个通过（minecraft.test.ts 里 trpg 那组改了、加了导演稿的断言）。
- trpg-table 测试：`test/directorNote.test.ts`（5 个）：工具存在、发 `gm_decision`（secret、截断）、空稿 / 内部信息关闭时不发、link `/events` 带出来、overlay 事件流里没有；`npm test` 423 个通过。

**驱动 Helixus 的模型**：用户 说页面选的一直是 **Haiku**（2026-10-19 他亲口说的，以他为准）。我这边的旧记录（2026-10-14 / 10-17）写的是 claude-sonnet-5-5，可能是过期的；页面设置存在 `<workspace>\chrome_live` 的 localStorage 里，Chrome 开着、LevelDB 是压缩的，我读不到具体型号（`aiService` 接口只告诉我是 anthropic），所以这条**没有独立核实**。不需要改任何设置。
- 页面源码改完后我查过：`GET /api/v1/status/?clientId=helixus` 还是 connected。

**没验证**：Helixus（现在是 Sonnet / 换了就是 Haiku）真的会按新提示词把导演稿当成自己的决定来讲，而不是念稿或穿帮——页面这边从没和 trpg-table 一起真跑过；Haiku GM 会不会按时发导演稿（靠提示词，没有兜底的自动摘要）；Helixus 的话和旁白（沧明子的声音）同时出现时的节奏。
- 回退：`models.yaml` 的 gm 改回 sonnet；页面提示词在 `minecraft.ts`（`git diff` 能看到我改的两段）。

## 7. 要 用户 定的事

- 开播前要不要停掉监督进程、用普通方式重启一次正式进程。
- 要不要现在用真模型跑一小段（要花 API 钱，估计 5–10 分钟约几毛到一美元）。
- ~~新角色的人选~~ 已定：维斯坡伊 / 萨珀特菲（§6d）。
- ~~现在的存档要不要 `--fresh`~~ 已经重开了，旧档在 `state/_archive_vex_bram_20261018/`。
- ~~剧本对不上~~ 已写《通往凡达林的路》并切过去（§6e），要不要这个版本、哪几幕想改，等 用户 看。
- 两个角色的英文名（`aliases`）。
- 维斯坡伊 20 尺步行速度（力量 12 穿链甲）要不要保留。
