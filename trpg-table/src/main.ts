import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AtlasClient } from './atlas/client.js';
import { AtlasRollSource } from './atlas/rollSource.js';
import { loadConfig, type AppConfig } from './config.js';
import { LLM } from './llm/index.js';
import { FakeLLM } from './llm/fake.js';
import { LocalRollSource } from './rules/dice.js';
import type { RollSource } from './rules/types.js';
import { LinkServer } from './link/server.js';
import { OverlayServer } from './overlay/server.js';
import { createLogs } from './log.js';
import { loadAdventure } from './table/content.js';
import { loadParty } from './table/characters.js';
import { createSpeech, ttsCacheDir } from './tts/index.js';
import { TableLoop } from './table/loop.js';
import { projectRoot } from './util.js';

interface Cli {
  dry: boolean;
  fake: boolean;
  noLink: boolean;
  noOverlay: boolean;
  fresh: boolean;
  linkPort: number;
  overlayPort: number;
  adventure?: string;
  campaign?: string;
  help: boolean;
}

function parseArgs(argv: string[]): Cli {
  const has = (flag: string) => argv.includes(flag);
  const value = (name: string): string | undefined => {
    const hit = argv.find((a) => a.startsWith(`--${name}=`));
    return hit ? hit.slice(name.length + 3) : undefined;
  };
  return {
    dry: has('--dry'),
    fake: has('--fake') || process.env.TRPG_FAKE === '1',
    noLink: has('--nolink') || has('--no-link'),
    noOverlay: has('--no-overlay'),
    fresh: has('--fresh'),
    linkPort: Number(value('link-port') ?? 8098),
    overlayPort: Number(value('overlay-port') ?? 8099),
    adventure: value('adventure'),
    campaign: value('campaign'),
    help: has('--help') || has('-h'),
  };
}

function usage(): string {
  return `trpg-table — AI 跑团桌

  npm start -- [options]

  --dry            不连 Atlas，用内存假桌面（模型仍然是真的）
  --fake           不调真模型（演示/测试用，明确标假）
  --nolink         不起 helixus-link（8098）
  --no-overlay     不起 overlay（8099）
  --fresh          忽略 state/table.json，从头开始
  --link-port=N    link 端口（默认 8098）
  --overlay-port=N overlay 端口（默认 8099）
  --adventure=ID   覆盖 config/table.yaml 里的剧本 id
  --campaign=PATH  覆盖正式 vault 路径

  npm run models:smoke   每个座位调一次真模型
`;
}

/** 正式 vault 里 atlas-agent-link 的 data.json 有 token；只取 token，不打印、不写日志。 */
function readAtlasTokenFromVault(vault: string): string | undefined {
  const p = join(vault, '.obsidian', 'plugins', 'atlas-agent-link', 'data.json');
  if (!existsSync(p)) return undefined;
  try {
    const j = JSON.parse(readFileSync(p, 'utf8')) as { token?: unknown };
    return typeof j.token === 'string' && j.token.trim() ? j.token.trim() : undefined;
  } catch {
    return undefined;
  }
}

async function connectAtlas(config: AppConfig, dry: boolean, logs: ReturnType<typeof createLogs>) {
  if (dry) return { atlas: undefined, dryRun: true, note: '--dry' };
  const token = process.env.ATLAS_TOKEN?.trim() || readAtlasTokenFromVault(config.paths.campaignVault);
  if (!token) {
    logs.trace('没有 ATLAS_TOKEN，正式 vault 里也没有 atlas-agent-link 的 data.json：按 dry-run 启动（不写 Atlas）。');
    return { atlas: undefined, dryRun: true, note: '缺少 ATLAS_TOKEN' };
  }
  const url = (process.env.ATLAS_URL || 'http://127.0.0.1:27125').replace(/\/+$/, '');
  const client = new AtlasClient({ url, token });
  try {
    const health = await client.health();
    logs.trace(
      `Atlas 已连接：${url}，版本 ${health.atlasVersion ?? '?'}，写入 ${health.writes ? '已开' : '只读（GM 的写操作会失败，需要在插件里开写入）'}`
    );
    if (health.writes === false) {
      logs.trace('警告：Atlas 当前是只读模式，地图 token/HP/先攻写不进去。');
    }
    return { atlas: client, dryRun: false, note: '' };
  } catch (e) {
    const msg = (e as Error).message;
    if (!config.table.fallbackToDryRun) {
      throw new Error(`Atlas 27125 不通（${msg}），fallback_to_dry_run=false，按配置退出。不会自己去启动 Obsidian。`);
    }
    logs.trace(`Atlas 27125 不通：${msg}。按配置退回 dry-run（不写 Atlas）。`);
    return { atlas: undefined, dryRun: true, note: `Atlas 不通：${msg}` };
  }
}

function makeRollSource(dryRun: boolean, atlas?: AtlasClient, logs?: ReturnType<typeof createLogs>): RollSource {
  const local = new LocalRollSource();
  if (dryRun || !atlas) return local;
  const atlasRoll = new AtlasRollSource(atlas);
  const strict = process.env.ATLAS_DICE === 'strict';
  return {
    name: 'atlas',
    async roll(req) {
      try {
        return await atlasRoll.roll(req);
      } catch (e) {
        const msg = (e as Error).message;
        if (strict) throw new Error(`atlas_roll_dice 失败（ATLAS_DICE=strict）：${msg}`);
        logs?.trace(`atlas_roll_dice 失败，退回本地骰（这次不会进 Atlas 骰子日志）：${msg}`);
        return local.roll(req);
      }
    },
  };
}

async function main(): Promise<void> {
  const cli = parseArgs(process.argv.slice(2));
  if (cli.help) {
    console.log(usage());
    return;
  }
  const root = projectRoot();
  const logs = createLogs(root);
  const config = loadConfig(root);
  if (cli.campaign) config.paths.campaignVault = cli.campaign;
  if (cli.adventure) config.table.adventure = cli.adventure;

  // 模型
  const llm = cli.fake ? new FakeLLM(config, logs) : new LLM(config, logs);
  if (cli.fake) logs.trace('*** --fake：模型输出是固定剧本，不是真模型。演示/测试用，不要直播。 ***');

  if (!cli.fake && config.env.missingKeys.length) {
    console.error(
      `缺少 API 密钥：${config.env.missingKeys.join('、')}\n` +
        `把 trpg-table/.env.example 复制成 .env，填好后再启动。\n` +
        `只想先看桌面流程可以用：npm start -- --fake --dry（假模型，不要直播）。`
    );
    process.exit(2);
  }

  // Atlas
  const atlasState = await connectAtlas(config, cli.dry || cli.fake, logs);
  if (atlasState.note) logs.trace(`Atlas：${atlasState.note}`);
  const rollSource = makeRollSource(atlasState.dryRun, atlasState.atlas, logs);

  // 内容
  const adventure = loadAdventure(config.paths.campaignVault, config.table.adventure);
  logs.trace(
    `剧本：${adventure.title}（${adventure.source === 'vault' ? '正式 vault' : '内置兜底'}，${adventure.scenes.length} 个场景）`
  );
  const party = loadParty(config.paths.campaignVault, config.table.characterSet);
  logs.trace(
    `角色卡：${party.source === 'vault' ? `正式 vault${config.table.characterSet ? `（${config.table.characterSet} 那一套）` : ''}` : '内置草稿（需要用户定稿）'}`
  );
  for (const w of party.warnings) logs.trace(`角色卡警告：${w}`);

  const loop = new TableLoop({
    config,
    llm,
    logs,
    adventure,
    characters: { player_a: party.a, player_b: party.b },
    rollSource,
    atlas: atlasState.atlas,
    dryRun: atlasState.dryRun,
    resume: !cli.fresh,
    frameUrl: cli.noOverlay ? undefined : `http://127.0.0.1:${cli.overlayPort}/overlay?bg=transparent`,
  });
  // 配音：旁白 + 两个角色（没开 / 没密钥 / --fake 就没有声音，桌面照常）
  const speech = createSpeech(config, logs, loop.bus, { fake: cli.fake });
  if (speech) loop.attachSpeech(speech);
  await loop.init();

  // renderer 有 3 秒预算：启动时先预热一次，避免第一次调用冷启动超时（费用极小）
  if (!cli.fake) {
    void llm
      .complete('renderer', { messages: [{ role: 'user', content: '只回 {}' }], maxTokens: 8, timeoutMs: 8000 }, 'warmup')
      .then(() => logs.trace('renderer 已预热'))
      .catch((e) => logs.trace(`renderer 预热失败：${(e as Error).message.slice(0, 80)}`));
  }

  const link = cli.noLink
    ? null
    : new LinkServer({ port: cli.linkPort, loop, logs });
  const overlay = cli.noOverlay
    ? null
    : new OverlayServer({ port: cli.overlayPort, loop, config, logs, root, ttsDir: ttsCacheDir(config) });

  if (link) await link.start();
  if (overlay) await overlay.start();
  // overlay 起来之后再刷一次演出框：init() 时 8099 还没监听，iframe 会先加载失败
  await loop.refreshFrame().catch(() => undefined);

  loop.start();

  console.log('');
  console.log('  trpg-table 已启动');
  console.log(`  GM      ${config.models.seats.gm.model}`);
  console.log(`  玩家 A  ${config.models.seats.player_a.model}`);
  console.log(`  玩家 B  ${config.models.seats.player_b.model}`);
  console.log(`  渲染    ${config.models.seats.renderer.model}`);
  console.log(`  Atlas   ${atlasState.dryRun ? 'dry-run（不写地图）' : '已连接 27125'}`);
  console.log(`  link    ${link ? `http://127.0.0.1:${cli.linkPort}` : '未启动'}`);
  console.log(`  overlay ${overlay ? `http://127.0.0.1:${cli.overlayPort}/overlay` : '未启动'}`);
  console.log(`  存档    ${join(config.paths.state, 'table.json')}`);
  console.log(`  日志    ${join(config.paths.logs, 'table.jsonl')} / usage.jsonl`);
  console.log(`  节奏    看点 ${config.table.pacing.tThought}s / 决定 ${config.table.pacing.tDecision}s / 间隔 ${config.table.pacing.tBetween}s / 锐评 ${config.table.pacing.tReact}s`);
  console.log('');
  console.log(`  ${loop.isPaused() ? '启动时暂停中：等页面按 Ctrl+Alt+K（或 POST /pause {"paused":false}）开始' : '运行中'}`);
  console.log('');

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    logs.trace(`收到 ${signal}，收尾…`);
    await loop.stop().catch(() => undefined);
    await link?.stop().catch(() => undefined);
    await overlay?.stop().catch(() => undefined);
    await logs.table.flush();
    await logs.usage.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (e) => {
    logs.trace(`未处理的 Promise 拒绝：${(e as Error)?.message ?? String(e)}`);
  });

  // 保持进程活着（loop 自己是异步的）
  await new Promise<void>(() => undefined);
}

main().catch((e) => {
  console.error(`启动失败：${(e as Error).message}`);
  process.exit(1);
});
