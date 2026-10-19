// 导演稿：GM 写好并执行完的决定交给 Helixus（他在直播里当成自己的决定来讲）；玩家和观众都看不到。
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AppConfig } from '../src/config.js';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import type { LLM } from '../src/llm/index.js';
import { LinkServer } from '../src/link/server.js';
import { OverlayServer } from '../src/overlay/server.js';
import { EventBus } from '../src/table/events.js';
import { GameMaster, buildGmTools, type GmWorld } from '../src/table/gm.js';
import type { TableLoop } from '../src/table/loop.js';
import { projectRoot } from '../src/util.js';

const gmWith = (bus: EventBus, knows = true) => {
  const world = { bus } as unknown as GmWorld;
  const config = { table: { helixusKnowsSecrets: knows } } as unknown as AppConfig;
  const gm = new GameMaster(null as unknown as LLM, config, world);
  return (name: string, args: Record<string, unknown>) =>
    (gm as unknown as { execTool: (n: string, a: Record<string, unknown>) => Promise<{ ok: boolean; text: string }> }).execTool(name, args);
};

describe('director_note 工具', () => {
  it('在 GM 的工具表里，参数是一段 ≤200 字的文字', () => {
    const tool = buildGmTools().find((t) => t.name === 'director_note');
    expect(tool).toBeTruthy();
    expect(JSON.stringify(tool!.inputSchema)).toContain('text');
    expect(tool!.description).toContain('我决定');
    expect(tool!.description).toContain('玩家和观众都看不到');
  });

  it('发出 gm_decision 事件（带 secret 标记），超过 200 字被截断', async () => {
    const bus = new EventBus();
    const events: { kind: string; text: string; data?: Record<string, unknown> }[] = [];
    bus.subscribe((e) => events.push(e));
    const run = gmWith(bus);
    const r = await run('director_note', { text: `我决定让北边灌木里再藏一个弓手。${'补充'.repeat(150)}` });
    expect(r.ok).toBe(true);
    expect(events).toHaveLength(1);
    expect(events[0].kind).toBe('gm_decision');
    expect(events[0].data).toMatchObject({ secret: true });
    expect([...events[0].text].length).toBeLessThanOrEqual(200);
    expect(events[0].text.startsWith('我决定让北边灌木里再藏一个弓手')).toBe(true);
  });

  it('空稿不发；Helixus 的内部信息关掉时不发', async () => {
    const bus = new EventBus();
    const kinds: string[] = [];
    bus.subscribe((e) => kinds.push(e.kind));
    expect((await gmWith(bus)('director_note', { text: '   ' })).ok).toBe(false);
    expect((await gmWith(bus, false)('director_note', { text: '我决定放过它们。' })).ok).toBe(false);
    expect(kinds).toEqual([]);
  });
});

describe('导演稿只给 Helixus，不上屏', () => {
  let stop: (() => Promise<void>) | null = null;
  afterEach(async () => {
    await stop?.();
    stop = null;
  });

  const loopWith = (bus: EventBus, events: { seq: number; kind: string; text: string; at: number; urgency: string }[]) =>
    ({
      status: () => ({ game: 'trpg', online: true, paused: false, planner: {}, lastCommand: null, latestEventSeq: 9, table: {}, control: {} }),
      eventsAfter: () => ({ events, latest: 9 }),
      addSuggestion: () => ({ status: 403, body: { ok: false } }),
      setPaused: () => undefined,
      forget: () => undefined,
      overlayState: () => ({ seq: 0, players: [], scene: '营地' }),
      bus,
    }) as unknown as TableLoop;

  it('helixus-link 的 /events 里有 gm_decision', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-dn-'));
    const events = [
      { seq: 5, at: Date.now(), kind: 'gm_narration', text: '林子很安静。', urgency: 'later' },
      { seq: 6, at: Date.now(), kind: 'gm_decision', text: '我决定让弓手先不动手。', urgency: 'soon' },
    ];
    const server = new LinkServer({ port: 0, loop: loopWith(new EventBus(), events), logs: createLogs(dir) });
    await server.start();
    stop = () => server.stop();
    const base = `http://127.0.0.1:${server.address()!}`;
    const json = (await (await fetch(`${base}/events?after=0`)).json()) as { events: { kind: string; text: string }[] };
    expect(json.events.map((e) => e.kind)).toEqual(['gm_narration', 'gm_decision']);
    expect(json.events[1].text).toBe('我决定让弓手先不动手。');
  });

  it('overlay 的事件流里没有 gm_decision / gm_hint，旁白照常有', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'trpg-dn-'));
    const bus = new EventBus();
    const config = loadConfig(projectRoot());
    const server = new OverlayServer({ port: 0, loop: loopWith(bus, []), config, logs: createLogs(dir), root: projectRoot() });
    await server.start();
    stop = () => server.stop();
    const port = server.address()!;
    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/overlay/events`, { signal: ctrl.signal });
    const reader = res.body!.getReader();
    let text = '';
    const pump = (async () => {
      const dec = new TextDecoder();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          text += dec.decode(value);
        }
      } catch {
        /* aborted */
      }
    })();
    await new Promise((r) => setTimeout(r, 150));
    bus.publish('gm_decision', '我决定埋一个陷阱（内部）', 'soon', { secret: true });
    bus.publish('gm_hint', '剧透暗示（内部）', 'later', { secret: true });
    bus.publish('gm_narration', '你们看见一棵歪脖子树。', 'later');
    await new Promise((r) => setTimeout(r, 200));
    ctrl.abort();
    await pump;
    expect(text).toContain('歪脖子树');
    expect(text).not.toContain('内部');
    expect(text).not.toContain('gm_decision');
    expect(text).not.toContain('gm_hint');
  });
});
