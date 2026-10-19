# M2 RUN — 20 分钟真模型 + 真 Atlas 连跑

日期：2026-10-17 22:23:44 – 22:44:15（Asia/Shanghai），中间因修 bug 重启过一次。
环境：真 Claude GM + 真 DeepSeek 玩家 A + 真 Gemini 玩家 B + 真 DeepSeek renderer；
正式 vault、真 Obsidian 1.14.4、Atlas 0.8.0（27125，写入已开）。

## 结果

| 指标 | 值 |
| --- | --- |
| 连续时长 | **21.25 分钟** |
| 玩家回合 | **46** |
| GM 回合 | 33 |
| 场景 | 第一幕甲板 → 第二幕货舱（切场景 1 次，`end_scene` 1 次） |
| 战斗 | 2 场：沙华鱼人 ×2（甲板）、活化盔甲（货舱）；`start_combat` 4 次、`end_combat` 3 次 |
| 检定 | `request_check` 7 次（真 d20 结果进 Atlas 骰子日志） |
| 建议 | Helixus 建议 1 条，GM 用 `respond_suggestion` 明确拒绝并给理由 |
| 崩溃/卡死 | 0 次；因修 bug 主动重启 1 次，从 `state/table.json` 接着跑 |

玩家 A/B 的决策、检定、攻击、施法都由真模型产出；骰子、HP、法术位、先攻由规则层算，
写入 Atlas 后再回读。

## renderer 指标

### 修复前（前 21 分钟，46 个玩家回合）

| 项 | 值 |
| --- | --- |
| 有 grounded beats | 18 / 46（39%） |
| 超时（3 秒） | 10 / 46（22%） |
| 没有 reasoning 字段 | A 8 次、B 3 次 |
| renderer 延迟 p50 / p90 | 1921ms / 3052ms |

原因：B 的 Gemini 思考摘要 1200–1900 字，renderer 输入太长；A 有时不返回 `reasoning_content`。

### 修复后（23:02–23:17，8 个玩家回合的复测）

| 项 | 值 |
| --- | --- |
| 有 grounded beats | 7 / 8（88%） |
| 超时 | 1 / 8（12.5%） |
| renderer 延迟 | 1207 / 1447 / 1602 / 1796 / 2047 / 2061 / 3003 / 4002 ms |
| 最大 | 4002ms（仍产出了 2 条 beats；3 秒硬超时对 B 偶发不够） |

修复内容：Gemini 摘要截前 400 字、局面截 450 字、maxTokens 400、prompt 要求最多 2 条 beat；
无 reasoning 时补一次「内心独白」（标记 `reasoningElicited`，overlay 标签「内心独白」）。
这是小样本，不是 20 回合统计；完整 20 回合指标仍待跑。

## Atlas 一致性

在甲板、货舱各抽查：

```
OK   薇克丝: table 24/24 | atlas 24/24
OK   布拉姆: table 24/24 | atlas 24/24
OK   薇克丝: table 20/24 | atlas 20/24
OK   薇克丝: table 5/24  | atlas 5/24
OK   布拉姆: table 7/24  | atlas 7/24
```

- 骰子日志：真实攻击/伤害/暴击/怪物攻击都进了 Atlas（`atlas_dice_log` 有记录）。
- 先攻：真 Atlas 里 `isActive:true`、round 递增、条目与规则层一致。
- 条件：`atlas_set_condition` / `atlas_clear_conditions` 单独验证过。

**发现并修掉的 bug**：切场景后 `AtlasSync` 还留着上一场的 token id，导致往旧 token 写 HP
（`No token with id ... in the open scene`）。修复：`openScene()` 清空 token 映射后按名字重新找/补 token。
重启后货舱里 4 个 token（2 PC + 盔甲 + 食尸鬼）HP 全部一致。

## token / 费用（本次 21 分钟）

| 模型 | 调用 | 非缓存 input | 缓存读 input | output |
| --- | --- | --- | --- | --- |
| claude-sonnet-5-5（GM） | 93 | 44,748 | 1,404,900 | 20,100 |
| deepseek-reasoner（A） | 32 | 51,250 | — | 7,451 |
| gemini-3.5-flash（B） | 25 | 53,141 | — | 1,987 |
| deepseek-chat（renderer） | 38 | 44,401 | 4,096 | 6,194 |

开启 Anthropic prompt caching 后，GM 的 140 万缓存 token 按 0.1x 计；非缓存输入只有 4.5 万。
具体人民币金额取决于用户所用模型的当前价格，没有在代码里写死。

## 没做到的

- 只跑了两幕，没跑到第三幕/结局。
- 不是完整 one-shot；战斗打得很久（活化盔甲 AC 18，两名 3 级角色输出低）。
- renderer 的 3 秒硬超时对 Gemini 摘要偶发不够（一次 4002ms 仍成功，边界行为需要再查）。
- 真页面（AITuberKit）仍未接；本次只有 helixus-link 端。
- 没有录音/录屏，只有日志和截图。
