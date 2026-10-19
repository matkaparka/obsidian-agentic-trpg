/**
 * Player-window sync check: does a store-level write (an AI write) reach the player window?
 *
 * Opens the player window, makes the scene plainly visible, then screenshots the player window,
 * moves a token through the MCP endpoint and screenshots it again. A changed picture is the proof;
 * docs/shots/06-player-before.png vs 07-player-after.png.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = 'vault/.obsidian/plugins/atlas-agent-link/data.json';
const URL = 'http://127.0.0.1:27125/mcp';
const SHOTS = path.join(ROOT, 'docs', 'shots');
mkdirSync(SHOTS, { recursive: true });
const { token } = JSON.parse(readFileSync(DATA, 'utf8'));

async function call(name, args = {}) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: Date.now() % 1e6, method: 'tools/call', params: { name, arguments: args } }),
  });
  const json = await res.json();
  const content = json.result?.content ?? [];
  const text = content.find((c) => c.type === 'text')?.text;
  const image = content.find((c) => c.type === 'image')?.data;
  let payload;
  try { payload = JSON.parse(text); } catch { payload = text; }
  return { ok: !json.result?.isError, payload, image };
}

const save = (name, base64) => {
  if (!base64) return { file: null, sha: null };
  const buf = Buffer.from(base64, 'base64');
  writeFileSync(path.join(SHOTS, `${name}.png`), buf);
  return { file: `docs/shots/${name}.png`, sha: createHash('sha256').update(buf).digest('hex').slice(0, 16) };
};

const log = [];

// A plainly lit, unobstructed scene, so a moved token is obvious in the player picture.
await call('atlas_set_lighting', { enabled: false, ambient: 1 });
const fog = await call('atlas_fog', { action: 'list', limit: 200 });
for (const op of fog.payload?.operations ?? []) {
  await call('atlas_fog', { action: 'delete', ids: [op.id] });
}

await call('atlas_command', { id: 'atlas-vtt:show-map-in-player-window' });
await new Promise((r) => setTimeout(r, 3000));
log.push({ open: 'show-map-in-player-window' });

const summary0 = await call('atlas_scene_summary');
log.push({ presented: summary0.payload?.playerWindowPresenting });

const before = await call('atlas_screenshot', { target: 'player', maxWidth: 1000 });
const beforeShot = save('06-player-before', before.image);
log.push({ beforeShot, beforeOk: before.ok, beforeError: before.ok ? null : before.payload });

const tokens = await call('atlas_get_tokens');
const wolf = tokens.payload?.tokens?.find((t) => t.name === 'Dire Wolf') ?? tokens.payload?.tokens?.[1];
const moved = await call('atlas_move_token', { id: wolf.id, cell: { col: 2, row: 2 } });
log.push({ moved: moved.payload });

await new Promise((r) => setTimeout(r, 1800));
const after = await call('atlas_screenshot', { target: 'player', maxWidth: 1000 });
const afterShot = save('07-player-after', after.image);
log.push({ afterShot, afterOk: after.ok, afterError: after.ok ? null : after.payload });

const gm = await call('atlas_screenshot', { target: 'window', maxWidth: 1000 });
const gmShot = save('08-gm-after', gm.image);

const summary1 = await call('atlas_scene_summary');
const report = {
  ranAt: new Date().toISOString(),
  presented: summary1.payload?.playerWindowPresenting,
  movedToken: moved.payload,
  beforeShot,
  afterShot,
  picturesDiffer: beforeShot.sha !== afterShot.sha,
  gmShot,
  tokenCells: summary1.payload?.tokens?.map((t) => ({ id: t.id, name: t.name, cell: t.cell })),
  log,
};
writeFileSync(path.join(ROOT, 'docs', 'player-sync-raw.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify({ beforeShot, afterShot, picturesDiffer: report.picturesDiffer, presented: report.presented, movedToken: moved.payload, tokenCells: report.tokenCells }, null, 1));
