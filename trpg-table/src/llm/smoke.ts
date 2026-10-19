/**
 * 冒烟：每个座位调一次真模型，打印延迟、有没有思维链、token 数。
 * 不打印模型输出内容，不打印密钥。
 *
 *   npm run models:smoke
 *   npm run models:smoke -- --write-doc   # 同时把结构观察写进 docs/PROBE_MODELS.md
 */
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { APIKEY_HINT, SEAT_IDS, loadConfig, type AppConfig, type SeatId } from '../config.js';
import { createLogs } from '../log.js';
import { LLM, LLMError } from './index.js';
import { projectRoot } from '../util.js';

interface Row {
  seat: SeatId;
  provider: string;
  model: string;
  ok: boolean;
  ms: number;
  reasoningKind: string | null;
  reasoningChars: number;
  inputTokens: number;
  outputTokens: number;
  attempts: number;
  note: string;
}

const PROMPT = '只回两个字：收到。';

async function runSeat(config: AppConfig, llm: LLM, seat: SeatId): Promise<Row> {
  const cfg = config.models.seats[seat];
  const row: Row = {
    seat,
    provider: cfg.provider,
    model: cfg.model,
    ok: false,
    ms: 0,
    reasoningKind: null,
    reasoningChars: 0,
    inputTokens: 0,
    outputTokens: 0,
    attempts: 0,
    note: '',
  };
  const t0 = Date.now();
  try {
    const result = await llm.complete(
      seat,
      {
        system: '你是一个连通性测试。只回答用户要求的内容，不要解释。',
        messages: [{ role: 'user', content: PROMPT }],
        maxTokens: 64,
        stream: false,
      },
      'smoke'
    );
    row.ok = true;
    row.ms = result.latencyMs;
    row.reasoningKind = result.reasoningKind;
    row.reasoningChars = result.reasoning ? [...result.reasoning].length : 0;
    row.inputTokens = result.usage.inputTokens;
    row.outputTokens = result.usage.outputTokens;
    row.attempts = result.attempts;
    row.note = result.text.trim() ? '有文本' : '无文本';
  } catch (e) {
    row.ms = Date.now() - t0;
    row.note = e instanceof LLMError ? `${e.kind}: ${e.userHint()}` : String(e);
  }
  return row;
}

function table(rows: Row[]): string {
  const head = ['座位', 'provider', 'model', '结果', '延迟ms', '思维链', 'in', 'out', '重试', '备注'];
  const lines = [head.join('\t')];
  for (const r of rows) {
    lines.push(
      [
        r.seat,
        r.provider,
        r.model,
        r.ok ? 'OK' : 'FAIL',
        String(r.ms),
        r.reasoningKind ? `${r.reasoningKind}/${r.reasoningChars}字` : '无',
        String(r.inputTokens),
        String(r.outputTokens),
        String(r.attempts),
        r.note,
      ].join('\t')
    );
  }
  return lines.join('\n');
}

async function writeProbeDoc(root: string, rows: Row[], config: AppConfig): Promise<string> {
  const now = new Date().toISOString();
  const okCount = rows.filter((r) => r.ok).length;
  const body = `# PROBE_MODELS — 模型接口实测记录

最后运行：${now}
结果：${okCount}/${rows.length} 个座位通过。

> 本文件由 \`npm run models:smoke -- --write-doc\` 生成结构观察。**不包含模型输出内容，也不包含密钥。**
> 若某个座位失败，先看下面的「失败原因」，再去核对 \`config/models.yaml\` 里的模型 ID。

## 座位结果

| 座位 | provider | model | 结果 | 延迟 ms | 思维链字段 | 思维链字数 | input tokens | output tokens | 重试 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
${rows
  .map(
    (r) =>
      `| ${r.seat} | ${r.provider} | ${r.model} | ${r.ok ? '✅' : '❌'} | ${r.ms} | ${
        r.reasoningKind ?? '无'
      } | ${r.reasoningChars} | ${r.inputTokens} | ${r.outputTokens} | ${r.attempts} |`
  )
  .join('\n')}

## 字段与语义（本项目实现）

| provider | 思维链字段 | 语义 | 说明 |
| --- | --- | --- | --- |
| anthropic | 流式 \`content_block_delta\` 的 \`thinking_delta\` / 非流式 \`content[].type === "thinking"\` | 原文（本项目默认不给 GM/ renderer 开 thinking） | 只有显式开 extended thinking 才有；GM 的思考不上屏 |
| deepseek | \`message.reasoning_content\` / 流式 \`delta.reasoning_content\` | **原文** | DeepSeek 推理模型 |
| gemini | \`parts[].thought === true\` 的 text | **思考摘要，不是原文** | 请求里 \`thinkingConfig.includeThoughts = true\`；界面与文档照实写「思考摘要」 |

## 失败原因

${
  rows
    .filter((r) => !r.ok)
    .map((r) => `- **${r.seat}**（${r.provider} / ${r.model}）：${r.note}`)
    .join('\n') || '- 无。'
}

## 待用户确认

- 四个座位的真实模型 ID（\`config/models.yaml\` 里标了 TODO）：GM / 玩家 A / 玩家 B / renderer。
- 代理节点地区：Gemini 经代理若报 \`User location is not supported\`，是节点地区问题，需要换节点；本项目不会绕过。

## 环境

- 密钥变量：${Object.values(config.models.providers)
    .map((p) => p.keyEnv)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join('、')}
- 缺密钥的变量：${config.env.missingKeys.length ? config.env.missingKeys.join('、') : '无'}
`;
  const path = join(root, 'docs', 'PROBE_MODELS.md');
  await writeFile(path, body, 'utf8');
  return path;
}

async function main(): Promise<number> {
  const root = projectRoot();
  const writeDoc = process.argv.includes('--write-doc');
  const seatArg = process.argv.find((a) => a.startsWith('--seat='))?.split('=')[1] as SeatId | undefined;
  if (seatArg && !SEAT_IDS.includes(seatArg)) {
    console.error(`未知座位：${seatArg}（可选：${SEAT_IDS.join(', ')}）`);
    return 2;
  }

  let config: AppConfig;
  try {
    config = loadConfig(root);
  } catch (e) {
    console.error((e as Error).message);
    return 2;
  }
  const logs = createLogs(root);
  const llm = new LLM(config, logs);

  if (config.env.missingKeys.length) {
    console.error(
      `缺少密钥：${config.env.missingKeys.join('、')}\n` +
        `把 trpg-table/.env.example 复制成 .env，填好后再跑。${APIKEY_HINT}`
    );
    return 2;
  }

  const seats = seatArg ? [seatArg] : [...SEAT_IDS];
  const rows: Row[] = [];
  for (const seat of seats) {
    process.stderr.write(`调用 ${seat}（${config.models.seats[seat].model}）…\n`);
    rows.push(await runSeat(config, llm, seat));
  }
  console.log('\n' + table(rows) + '\n');
  const failed = rows.filter((r) => !r.ok).length;
  console.log(
    `模型：${config.models.seats.gm.model}（GM） / ${config.models.seats.player_a.model}（A） / ` +
      `${config.models.seats.player_b.model}（B） / ${config.models.seats.renderer.model}（renderer）`
  );
  if (writeDoc) {
    const path = await writeProbeDoc(root, rows, config);
    console.log(`已写入 ${path}`);
  }
  await logs.usage.flush();
  return failed ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(e);
    process.exit(1);
  }
);
