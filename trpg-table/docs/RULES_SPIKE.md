# RULES_SPIKE — D&D 5e 规则层选型

调研日期：2026-10-17。本文只写**亲手在网页上核对过**的内容；没有跑过的东西标「未验证」。
选型结论先行：**自己写一个最小规则内核**（已实现，见 `src/rules/`），不嵌第三方引擎。

---

## 0. 结论

| 方案 | 许可证 | 能否嵌入 | 真实测试 | 与 Atlas 的冲突 | 结论 |
| --- | --- | --- | --- | --- | --- |
| `Mnehmos/rpg-mcp` | 元数据自相矛盾（见下） | ❌ 是独立 MCP 服务 + SQLite | 声称 2214 个测试，**未运行** | 它自己拥有一套世界/角色/战斗状态，和 Atlas 抢权威 | 不用 |
| `kimosahy/railroaded` | MIT | ❌ Bun 服务 + PostgreSQL/in-memory，等级上限 5 | 声称 61 个测试文件，**未运行** | 服务端拥有全部状态 | 不用 |
| 自己写最小内核 | 代码原创；SRD 数据 CC-BY-4.0 | ✅ 同进程、零原生依赖 | 见 `test/rules.test.ts`（本项目真跑） | 规则层是唯一权威，Atlas 只显示 | **采用** |

决定性理由不是许可证（两个候选都允许商用直播），而是**状态归属**和**运行形态**：

1. 本项目的硬约束是「trpg-table 是唯一写 Atlas 的程序；规则层是数据的权威，Atlas 只负责显示」。
   两个候选都是**自带数据库、自己当权威**的服务；把它们的 HP/先攻/法术位同步到 Atlas 需要
   双向对账，正是任务书要避免的。
2. 两者都要求另起进程（rpg-mcp 还依赖 `better-sqlite3` 原生模块，Windows 上要编译/下载预编译包；
   railroaded 要 Bun + PostgreSQL）。任务书说「不另起一个进程最好」。
3. 直播需要**每一次掷骰都进 Atlas 的骰子日志**。第三方引擎的掷骰是内部的，无法替换成
   `atlas_roll_dice`；自己写的引擎把 `RollSource` 做成接口，接上 Atlas 即可。
4. 我们需要的东西很窄：3 级、2 个玩家、1–2 小时 one-shot。第三方引擎覆盖的 worldgen/NPC
   记忆/经济系统都是负担。

---

## 1. Mnehmos/rpg-mcp（核实于 2026-10-17）

来源：

- README：https://github.com/Mnehmos/rpg-mcp
- package.json：https://raw.githubusercontent.com/Mnehmos/rpg-mcp/main/package.json
- LICENSE：https://raw.githubusercontent.com/Mnehmos/rpg-mcp/main/LICENSE

**核实到的事实：**

- 真实存在，TypeScript，npm 包名 `mnehmos.rpg.mcp`，v1.0.3，`main: dist/index.js`，
  `bin: mnehmos-rpg-mcp`；36 个 MCP 工具（31 个合并工具 + 5 个 meta）。
- 依赖 `@modelcontextprotocol/sdk`、`better-sqlite3`（原生）、`mathjs`、`zod` 等；
  是**独立 MCP server**，不是给别的程序 import 的库。
- 功能确实覆盖：先攻、AC、伤害、死亡豁免、抗性、专注、法术位、短休/长休、15+ SRD 法术、
  机会攻击、空间网格。README 还声称 1100+  creature presets、50+ encounter presets。
- **测试数字是它自己说的**：README 徽章写 2214，正文一处写 2252 passing / 7 skipped / 148 文件。
  我没有运行（需要 `npm install` 原生依赖，且不在本项目依赖范围内）。**未验证。**
- **许可证自相矛盾**：README 写 ISC，`LICENSE` 文件正文是 **MIT**，`package.json` 的
  `license` 也是 **MIT**。以文件与 package.json 的 MIT 为准；这个矛盾本身要记下来。
- 它的数据/规则是自己的一套（含程序化世界生成），和 SRD 的对应关系没有逐条核对。**未验证。**

**为什么不用**：运行形态与状态归属冲突（上面 §0），不是许可证问题。

---

## 2. kimosahy/railroaded（核实于 2026-10-17）

来源：

- README：https://github.com/kimosahy/railroaded
- LICENSE：https://raw.githubusercontent.com/kimosahy/railroaded/main/LICENSE
- glama 列表：https://glama.ai/mcp/servers/kimosahy/railroaded

**核实到的事实：**

- 真实存在；MIT License（Copyright 2026 Karim Elsahy）。
- 定位是**托管式多人跑团服务**：Bun + PostgreSQL（默认 in-memory），MCP/REST/WebSocket 三种传输，
  有注册/登录/队伍匹配/观众页。
- 规则：简化版 5e，**等级上限 5**，4 职业（Fighter/Rogue/Cleric/Wizard）、5 种族；
  先攻、区域化站位、死亡豁免、法术位。自带 3 个地城。
- 测试：README 说 61 个测试文件、12,800+ 行。**未运行。**
- 规则引擎是「确定性、零 LLM」的，这一点和我们的原则一致；但它是服务端的一部份，
  没有以库的形式导出（README 的 Project Structure 只有 `src/engine/`，没有 exports/库入口）。

**为什么不用**：需要 Bun + 服务进程；等级上限 5 够用，但状态全在它自己的库里；
同样是状态归属冲突。

---

## 3. 自己写：范围与现实

### 3.1 版本与许可证

- 本项目的数据取自 **SRD 5.1（2014）** 中可离线核对的那部分（武器、护甲、约 25 个法术、
  13 个怪物的数值）。机制实现的是 5e 两版共通的核心：d20 + 调整值、AC、优势/劣势、
  暴击/大失败、抗性/易伤/免疫、豁免、法术位、专注、先攻、短休、死亡豁免。
- **没有实现 2024（SRD 5.2.1）专有内容**：武器精通（Weapon Mastery）、2024 的背景专长、
  2024 版的怪物数值差异、药水附赠动作等。**不要把本引擎说成 2024 规则。**
- SRD 5.1 与 SRD 5.2 都是 CC-BY-4.0。本项目在 `docs/HANDOFF.md` 与
  `campaign-vault/LICENSES.md` 里署名：

  > This work includes material taken from the System Reference Document 5.1 ("SRD 5.1")
  > by Wizards of the Coast LLC, available at https://dnd.wizards.com/resources/systems-reference-document.
  > The SRD 5.1 is licensed under the Creative Commons Attribution 4.0 International License,
  > available at https://creativecommons.org/licenses/by/4.0/legalcode.

- 核实 Open5e：`https://api.open5e.com/v2/documents/srd-2024/` 返回
  `"name": "System Reference Document 5.2"`、`"licenses": [{"name": "Creative Commons Attribution 4.0"}]`、
  `"gamesystem": "5th Edition 2024"`。也就是说 Open5e v2 **确实有 2024 数据**（CC-BY-4.0）。
  本项目没有从它抓数据（避免把网络依赖带进构建），但以后要升级到 2024 时有正规来源。
- 5e-srd-api（`5e-bits/5e-srd-api`）本次**未核对**其服务的是哪一版。

### 3.2 已实现的接口（`src/rules/engine.ts`）

- `check(actor, ability|skill, dc, adv?)`
- `save(actor, ability, dc, adv?)`
- `attack(attacker, target, weapon|spell, opts)`
- `damage(target, amount, type)` / `heal(actor, amount)`
- `applyCondition(...)` / `removeCondition(...)`
- `castSpell(caster, spell, slotLevel, targets)`：校验法术位、专注冲突、动作经济
- `startCombat(ids)` / `nextTurn()` / `endCombat()`
- `legalActions(actor)`：攻击、法术（含法术位是否够）、移动、疾走、闪避、撤离、躲藏、协助、物品、说话、检定
- `shortRest(ids, dicePerActor)` / `longRest(ids)`
- `deathSave(actor)`
- `snapshot()` / `load()`：存档

### 3.3 明确的简化（不要在直播里当成完整 5e）

| 项 | 现状 |
| --- | --- |
| 距离/射程/掩蔽 | 没有格子坐标，射程与掩蔽不自动判定；由 GM 叙述/裁定 |
| 机会攻击 | 未自动触发（需要位置） |
| 法术材料成分 | 不检查材料包，只检查法术位/动作 |
| 准备法术 | 只检查 known 列表，不区分准备/已知 |
| 部分法术 | `spiritual_weapon`、`mirror_image`、`sleep` 之外的控制/召唤类有明确 note，标为「需 GM 手动结算」 |
| 死亡豁免 | 有；但「受伤时自动失败一次」等细节未接 |
| 2024 规则 | 未实现（见 §3.1） |
| 怪物特性 | 数值与攻击已录入；`不死坚韧`、`麻痹爪`、`群体战术` 等只作为 traits 文本，未自动结算 |

### 3.4 测试

`test/rules.test.ts`（真跑，不是声称）：

- 骰子分布：20000 次 d20 均值 ≈10.5；优势 ≈13.8、劣势 ≈7.2；暴击翻倍公式
- 检定/豁免：DC 比较、自然 20 不自动成功、专精、麻痹自动失败、中毒劣势
- 攻击：命中/未命中/自然 1/自然 20、偷袭 2d6、抗性减半、临时生命、护盾 AC
- 法术：法术位消耗与升环、无法术位拒绝、定身人类、专注替换、受伤专注豁免、治疗加成
- 战斗：先攻排序与同值比敏捷、回合轮转、legalActions、短休

---

## 4. 没验证 / 待办

- rpg-mcp 的 2214 个测试：**没跑**。
- railroaded 的 61 个测试文件：**没跑**。
- SRD 5.2.1 数据：没有抓取/比对；当前数据是 5.1。
- 5e-srd-api 的版本：没核对。
- 本引擎在真实 Atlas 桌上的表现：M3 才验证（骰子来源换成 `atlas_roll_dice`）。
