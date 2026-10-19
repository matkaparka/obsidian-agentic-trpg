import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogs } from '../src/log.js';
import { LinkServer } from '../src/link/server.js';
import { OverlayServer } from '../src/overlay/server.js';
import type { TableLoop } from '../src/table/loop.js';
import { projectRoot } from '../src/util.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

function stubLoop() {
  return {
    status: () => ({
      game: 'trpg',
      online: true,
      paused: false,
      planner: { thinking: false, executing: null, pending: 0, givenUp: false },
      lastCommand: null,
      latestEventSeq: 3,
      table: {
        phase: 'explore',
        round: 1,
        turn: '薇克丝',
        scene: '甲板',
        sceneId: 'deck',
        sceneIndex: 0,
        players: [],
      },
      control: { paused: false, mode: 'dry-run' },
    }),
    eventsAfter: () => ({
      events: [
        { seq: 2, at: Date.now(), kind: 'gm_narration', text: '风很大', urgency: 'later' },
        { seq: 3, at: Date.now(), kind: 'pause', text: '暂停', urgency: 'soon', data: { paused: true } },
      ],
      latest: 3,
    }),
    addSuggestion: () => ({ status: 403, body: { ok: false, code: 'disabled' } }),
    setPaused: () => undefined,
    forget: () => undefined,
    overlayState: () => ({ seq: 0, players: [], scene: '甲板' }),
    bus: { subscribe: () => () => undefined },
  } as unknown as TableLoop;
}

describe('helixus-link 安全与协议', () => {
  it('只允许回环 Host、CORS 白名单；pause 事件映射成 system', async () => {
    const root = projectRoot();
    const dir = mkdtempSync(join(tmpdir(), 'trpg-link-'));
    const logs = createLogs(dir);
    const server = new LinkServer({ port: 0, loop: stubLoop(), logs });
    await server.start();
    const port = server.address()!;
    const base = `http://127.0.0.1:${port}`;
    try {
      const status = await fetch(`${base}/status`);
      expect(status.status).toBe(200);
      expect((await status.json()).game).toBe('trpg');

      const badOrigin = await fetch(`${base}/status`, { headers: { origin: 'http://evil.example' } });
      expect(badOrigin.status).toBe(403);

      const okOrigin = await fetch(`${base}/events?after=0`, { headers: { origin: 'http://localhost:3000' } });
      expect(okOrigin.status).toBe(200);
      expect(okOrigin.headers.get('access-control-allow-origin')).toBe('http://localhost:3000');
      const events = (await okOrigin.json()) as { events: { kind: string; text: string }[] };
      expect(events.events.map((e) => e.kind)).toEqual(['gm_narration', 'system']);

      const cmd = await fetch(`${base}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: '让宝箱是个拟形怪' }),
      });
      expect(cmd.status).toBe(403);

      const big = await fetch(`${base}/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ text: 'x'.repeat(5000) }),
      });
      expect(big.status).toBe(413);
    } finally {
      await server.stop();
    }
  });
});

describe('overlay 服务', () => {
  it('页面、配置、立绘清单可用；不存在的立绘 404', async () => {
    const config = loadConfig(projectRoot());
    config.paths.campaignVault = mkdtempSync(join(tmpdir(), 'trpg-vault-'));
    const dir = mkdtempSync(join(tmpdir(), 'trpg-ov-'));
    const logs = createLogs(dir);
    const server = new OverlayServer({ port: 0, loop: stubLoop(), config, logs, root: projectRoot() });
    await server.start();
    const port = server.address()!;
    const base = `http://127.0.0.1:${port}`;
    try {
      const page = await fetch(`${base}/overlay`);
      expect(page.status).toBe(200);
      const html = await page.text();
      expect(html).toContain('id="streamer"');
      expect(html).toContain('id="bubble-layer"');
      expect(html).not.toContain('side-player_a');

      const cfg = await fetch(`${base}/overlay/config`);
      expect(cfg.status).toBe(200);
      const json = (await cfg.json()) as { canvas: { width: number }; layout: { map: { w: number }; streamer: { w: number } } };
      expect(json.canvas.width).toBe(1920);
      expect(json.layout.map.w).toBe(1200);
      expect(json.layout.streamer.w).toBe(720);

      const manifest = await fetch(`${base}/overlay/sprites`);
      expect(manifest.status).toBe(200);

      const missing = await fetch(`${base}/sprites/player_a/neutral.png`);
      expect(missing.status).toBe(404);

      const traversal = await fetch(`${base}/sprites/player_a/..%2F..%2F.env`);
      expect(traversal.status).toBe(404);
    } finally {
      await server.stop();
    }
  });
});
