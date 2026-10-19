/**
 * Hex-grid check: does atlas_cell_to_world / atlas_add_token place a token on the centre of the
 * hex Atlas draws? Creates a hex scene, places three tokens by axial cell and screenshots the map.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
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
  if (!base64) return null;
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(base64, 'base64'));
  return `docs/shots/${name}.png`;
};

const scenePath = `scenes/hex-${Date.now()}.atlasmap`;
const created = await call('atlas_new_scene', { path: scenePath, name: 'Hex grid check', background: 'assets/battlemap.png', gridType: 'hex-vertical', gridSize: 70 });
await call('atlas_open_scene', { path: scenePath });
for (let i = 0; i < 60; i++) {
  const s = await call('atlas_scene_summary');
  if (s.payload?.mapPath === scenePath) break;
  await new Promise((r) => setTimeout(r, 250));
}

// Axial cells, including a negative one and a 2-cell (even footprint) token.
const cells = [
  { q: 0, r: 0, imagePath: 'assets/token-goblin.png', name: 'Hex 0,0' },
  { q: 2, r: 1, imagePath: 'assets/token-hero.png', name: 'Hex 2,1' },
  { q: -1, r: 2, imagePath: 'assets/token-wolf.png', name: 'Hex -1,2' },
];
const conversions = [];
for (const c of cells) {
  const conv = await call('atlas_cell_to_world', { col: c.q, row: c.r });
  conversions.push({ cell: { q: c.q, r: c.r }, ...conv.payload });
}
const added = await call('atlas_add_tokens', { tokens: cells.map((c) => ({ imagePath: c.imagePath, cell: { q: c.q, r: c.r }, name: c.name })) });
const withFootprint = await call('atlas_add_token', { imagePath: 'assets/token-wolf.png', cell: { q: 3, r: 0 }, size: 1.5, name: 'Hex 3,0 large' });
const back = await call('atlas_get_tokens');
const grid = await call('atlas_get_scene', { path: 'grid' });

// Zoom the camera out a little so the hexes are clearly visible in the shot.
await call('atlas_set_camera', { scale: 1.6, x: 210, y: 160 });
await new Promise((r) => setTimeout(r, 700));
const shot = await call('atlas_screenshot', { target: 'map', maxWidth: 900 });
const file = save('10-hex-grid', shot.image);

const report = {
  scenePath,
  created: created.payload,
  grid: grid.payload?.value,
  conversions,
  tokens: back.payload?.tokens?.map((t) => ({ name: t.name, x: t.x, y: t.y, cell: t.cell, size: t.size })),
  shot: file,
};
writeFileSync(path.join(ROOT, 'docs', 'hex-raw.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 1));
