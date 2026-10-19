# PROBE_MODELS — 模型接口实测记录

最后运行：2026-10-17T14:07:51.075Z
结果：4/4 个座位通过。

> 本文件由 `npm run models:smoke -- --write-doc` 生成结构观察。**不包含模型输出内容，也不包含密钥。**
> 若某个座位失败，先看下面的「失败原因」，再去核对 `config/models.yaml` 里的模型 ID。

## 座位结果

| 座位 | provider | model | 结果 | 延迟 ms | 思维链字段 | 思维链字数 | input tokens | output tokens | 重试 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gm | anthropic | claude-sonnet-5-5 | ✅ | 3462 | 无 | 0 | 44 | 4 | 1 |
| player_a | deepseek | deepseek-reasoner | ✅ | 1717 | raw | 30 | 51 | 19 | 1 |
| player_b | gemini | gemini-3.5-flash | ✅ | 3720 | summary | 883 | 24 | 1 | 1 |
| renderer | deepseek | deepseek-chat | ✅ | 654 | 无 | 0 | 26 | 1 | 1 |

## 字段与语义（本项目实现）

| provider | 思维链字段 | 语义 | 说明 |
| --- | --- | --- | --- |
| anthropic | 流式 `content_block_delta` 的 `thinking_delta` / 非流式 `content[].type === "thinking"` | 原文（本项目默认不给 GM/ renderer 开 thinking） | 只有显式开 extended thinking 才有；GM 的思考不上屏 |
| deepseek | `message.reasoning_content` / 流式 `delta.reasoning_content` | **原文** | DeepSeek 推理模型 |
| gemini | `parts[].thought === true` 的 text | **思考摘要，不是原文** | 请求里 `thinkingConfig.includeThoughts = true`；界面与文档照实写「思考摘要」 |

## 失败原因

- 无（当前 4 个座位）。

### 历史：renderer 用 Claude Haiku 时 27 次调用失败 24 次

`logs/usage.jsonl` 里 `claude-haiku-5-5` 共 27 次，失败 24 次：

| 失败类型 | 次数 | 原因 |
| --- | --- | --- |
| `bad_request` | 15 | HTTP 400：`` `temperature` is deprecated for this model. ``。当时的 renderer 配置带了 `temperature`，Haiku 这个模型拒收。不是超时，也不是网络。 |
| `cancelled` | 4 | 3 秒 renderer 预算到点，AbortController 取消请求。 |
| `network` | 4 | 经本地代理（127.0.0.1:7897）的连接失败/重置。 |
| `bad_response` | 1 | 返回空内容。 |

后续把 `temperature` 去掉（改成 `null`）后，Haiku 的 probe 能过（1.1–2.8s），但它经代理仍会顶到 3 秒预算，
而且 3 秒硬超时会把整条看点吞掉。最终 renderer 换成 `deepseek-chat`（654ms–2.7s，中文 JSON 稳定）。
现在 renderer 预算放宽到 7 秒，超时也会在画面上留一行「（思考摘要没来得及整理）」。

## 待用户确认

- 四个座位的真实模型 ID（`config/models.yaml` 里标了 TODO）：GM / 玩家 A / 玩家 B / renderer。
- 代理节点地区：Gemini 经代理若报 `User location is not supported`，是节点地区问题，需要换节点；本项目不会绕过。

## 环境

- 密钥变量：ANTHROPIC_API_KEY、GEMINI_API_KEY、DEEPSEEK_API_KEY
- 缺密钥的变量：无
