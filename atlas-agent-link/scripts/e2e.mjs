/**
 * End-to-end run against the live Obsidian + Atlas VTT 0.8.0.
 *
 * Drives the whole flow over the real MCP endpoint (no shortcuts through the plugin object):
 * probe → fog → tokens → move → condition → walls/door → light → initiative → dice → player
 * window → undo/redo, with a screenshot after each visual change. Writes docs/e2e-raw.json,
 * which docs/E2E.md narrates.
 */
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const DATA = 'vault/.obsidian/plugins/atlas-agent-link/data.json';
const URL = 'http://127.0.0.1:27125/mcp';
const SHOTS = path.join(ROOT, 'docs', 'shots');
const { token } = JSON.parse(readFileSync(DATA, 'utf8'));
mkdirSync(SHOTS, { recursive: true });

const transcript = [];
const failures = [];
let rpcId = 0;
let reportPlayerSync = null;

async function rpc(method, params) {
  const res = await fetch(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
  });
  const text = await res.text();
  return { status: res.status, json: text ? JSON.parse(text) : null };
}

/** Calls a tool; on tool error it records the failure and returns null instead of throwing. */
async function tool(name, args = {}, { optional = false } = {}) {
  const { status, json } = await rpc('tools/call', { name, arguments: args });
  const result = json?.result;
  const content = result?.content ?? [];
  const textBlock = content.find((c) => c.type === 'text');
  const imageBlock = content.find((c) => c.type === 'image');
  let payload = null;
  if (textBlock) {
    try { payload = JSON.parse(textBlock.text); } catch { payload = textBlock.text; }
  }
  const isError = !!result?.isError;
  transcript.push({ tool: name, args, status, isError, payload: imageBlock ? { ...payload, image: '[png]' } : payload });
  if (isError && !optional) failures.push({ tool: name, error: textBlock?.text ?? JSON.stringify(json) });
  return { payload, image: imageBlock?.data, isError };
}

function saveShot(name, base64) {
  writeFileSync(path.join(SHOTS, `${name}.png`), Buffer.from(base64, 'base64'));
  return `docs/shots/${name}.png`;
}

async function shot(label, name, target = 'window', maxWidth = 1100) {
  const result = await tool('atlas_screenshot', { target, maxWidth }, { optional: true });
  if (result.image) {
    const file = saveShot(name, result.image);
    console.log(`   · screenshot ${file} (${result.payload?.width}x${result.payload?.height})`);
    return file;
  }
  console.log(`   · screenshot ${label} FAILED: ${JSON.stringify(result.payload).slice(0, 200)}`);
  return null;
}

// ── SSE listener: the run also proves the push stream ────────────────────────
const sseEvents = [];
const controller = new AbortController();
let sseReady = Promise.resolve();
function startEventListener(sinceSeq) {
  sseReady = (async () => {
    try {
      const res = await fetch(`http://127.0.0.1:27125/events?since=${sinceSeq}`, { headers: { authorization: `Bearer ${token}` }, signal: controller.signal });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let split;
        while ((split = buffer.indexOf('\n\n')) >= 0) {
          const chunk = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          for (const line of chunk.split('\n')) {
            if (line.startsWith('data: ')) {
              try { sseEvents.push(JSON.parse(line.slice(6))); } catch { /* comment frame */ }
            }
          }
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') sseEvents.push({ type: 'listener_error', message: String(e.message) });
    }
  })();
}

console.log('── initialize');
const init = await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'atlas-agent-link-e2e', version: '1.0.0' } });
transcript.push({ method: 'initialize', status: init.status, payload: init.json?.result?.serverInfo });
if (!init.json?.result) throw new Error(`initialize failed: ${JSON.stringify(init.json)}`);

console.log('── attach to the event stream (from the current head)');
const head = await tool('atlas_events', { since: 0, limit: 1 });
const headSeq = head.payload?.events?.at(-1)?.seq ?? 0;
startEventListener(headSeq);
await new Promise((r) => setTimeout(r, 400));

console.log('── tools/list');
const list = await rpc('tools/list', {});
const toolNames = (list.json?.result?.tools ?? []).map((t) => t.name);
transcript.push({ method: 'tools/list', status: list.status, payload: { count: toolNames.length, names: toolNames } });

console.log('── fresh scene');
const scenePath = `scenes/e2e-${Date.now()}.atlasmap`;
await tool('atlas_new_scene', { path: scenePath, name: 'Agent Link E2E', background: 'assets/battlemap.png' });
const opened = await tool('atlas_open_scene', { path: scenePath });
let loadedNow = null;
for (let i = 0; i < 60; i++) {
  const summary = await tool('atlas_scene_summary', {}, { optional: true });
  if (summary.payload?.mapPath === scenePath) { loadedNow = summary.payload; break; }
  await new Promise((r) => setTimeout(r, 250));
}
if (!loadedNow) failures.push({ tool: 'atlas_open_scene', error: 'the new scene never reported as loaded' });
else if (loadedNow.initiative?.isActive) failures.push({ tool: 'atlas_new_scene', error: 'a brand new scene started in combat; the store kept the previous scene\'s initiative' });

console.log('── probe + scene before');
const probe = await tool('atlas_probe');
await tool('atlas_scene_summary');
await tool('atlas_get_scene', { path: 'objects', maxDepth: 2 });
const shots = {};

console.log('── fog the whole map (hide), then reveal a block');
await tool('atlas_fog', { action: 'hide', cell: { col: 0, row: 0 }, width: 20, height: 14 });
shots.fogged = await shot('fogged map', '00-fogged');

console.log('── add three tokens');
const added = await tool('atlas_add_tokens', {
  tokens: [
    { imagePath: 'assets/token-goblin.png', cell: { col: 2, row: 2 }, name: 'Grik the Goblin' },
    { imagePath: 'assets/token-wolf.png', cell: { col: 5, row: 3 }, name: 'Dire Wolf', size: 1.5 },
    { imagePath: 'assets/token-hero.png', cell: { col: 8, row: 6 }, name: 'Aria' },
  ],
});
const [goblinId, wolfId, heroId] = added.payload?.ids ?? [];

console.log('── reveal fog over 4x4 cells');
const fog = await tool('atlas_fog', { action: 'reveal', cell: { col: 1, row: 1 }, width: 5, height: 5 });
shots.tokens = await shot('tokens + revealed fog', '01-tokens-added');

console.log('── move the goblin, apply a condition');
const moved = await tool('atlas_move_token', { id: goblinId, cell: { col: 4, row: 4 } });
await tool('atlas_set_condition', { ids: [wolfId], conditionId: 'prone', active: true });
await tool('atlas_update_token', { id: heroId, updates: { ringColor: '#e1b12c', showNameplate: true } });

console.log('── wall run, door, light, lighting');
const wall = await tool('atlas_add_wall_chain', { points: [{ col: 0, row: 9 }, { col: 6, row: 9 }], type: 'solid' });
const door = await tool('atlas_add_wall', { type: 'door', p1: { col: 6, row: 9 }, p2: { col: 9, row: 9 }, closed: true });
const toggled = await tool('atlas_toggle_door', { id: door.payload?.id });
const light = await tool('atlas_add_light', { cell: { col: 5, row: 5 }, emission: { bright: 20, dim: 40, color: '#ffcc88', intensity: 1, animation: 'torch' } });
const lighting = await tool('atlas_set_lighting', { enabled: true, ambient: 0.2, tokenVision: true, exploredMemory: true });

console.log('── initiative');
const entries = await tool('atlas_initiative', { action: 'add_tokens', ids: [goblinId, wolfId, heroId] });
await tool('atlas_initiative', { action: 'start' });
const rolled = await tool('atlas_initiative', { action: 'roll_all', fromStatblocks: false });
const turn = await tool('atlas_initiative', { action: 'next' });
await tool('atlas_initiative', { action: 'tracker', open: true });

console.log('── dice');
const dice = await tool('atlas_roll_dice', { formula: '2d20kh1+5', label: 'Grik attacks Aria', tokenId: goblinId });

shots.scene = await shot('played scene', '02-scene-played');
shots.map = await shot('map only', '03-map-only', 'map', 900);

console.log('── player window + sync check');
await tool('atlas_command', { id: 'atlas-vtt:show-map-in-player-window' }, { optional: true });
await new Promise((r) => setTimeout(r, 3000));
shots.playerBefore = await shot('player window', '04-player-window', 'player');
// Move a token that is inside the area the players can see, so the player picture must change.
const playerSyncMove = await tool('atlas_move_token', { id: goblinId, cell: { col: 2, row: 3 } }, { optional: true });
await new Promise((r) => setTimeout(r, 1800));
shots.playerAfter = await shot('player window after a store write', '05-player-window-after-move', 'player');
if (shots.playerBefore && shots.playerAfter) {
  const before = readFileSync(path.join(ROOT, shots.playerBefore));
  const after = readFileSync(path.join(ROOT, shots.playerAfter));
  const same = before.equals(after);
  reportPlayerSync = { moved: playerSyncMove.payload?.to ?? null, pictureChanged: !same };
  if (same) failures.push({ tool: 'player window', error: 'the player window picture did not change after a token inside the players\' view moved (state sync not visible)' });
} else {
  reportPlayerSync = { moved: null, skipped: 'a player screenshot failed' };
}

console.log('── events');
const polled = await tool('atlas_events', { since: 0, limit: 300 });

console.log('── undo / redo');
const undo1 = await tool('atlas_undo', { steps: 2 });
const redo1 = await tool('atlas_redo', { steps: 1 });
const afterUndo = await tool('atlas_scene_summary');

console.log('── save');
const saved = await tool('atlas_save');
const finalSummary = await tool('atlas_scene_summary');

controller.abort();
await Promise.race([sseReady, new Promise((r) => setTimeout(r, 1500))]);

const eventTypes = {};
for (const e of sseEvents) eventTypes[e.type] = (eventTypes[e.type] ?? 0) + 1;

// The stream is the product here: if a write did not become a semantic event, that is a failure.
const expectedEventTypes = ['token_added', 'token_moved', 'token_updated', 'fog_changed', 'wall_added', 'door_toggled', 'light_added', 'initiative_entry_added', 'combat_started', 'turn_changed', 'dice_rolled', 'scene_loaded'];
for (const type of expectedEventTypes) {
  if (!eventTypes[type]) failures.push({ tool: 'event stream', error: `no "${type}" event was received` });
}

const report = {
  ranAt: new Date().toISOString(),
  endpoint: URL,
  protocolVersion: init.json?.result?.protocolVersion,
  serverInfo: init.json?.result?.serverInfo,
  toolCount: toolNames.length,
  toolNames,
  atlas: { version: probe.payload?.version, tested: probe.payload?.tested, missingActions: probe.payload?.missingActions, actionCount: probe.payload?.actionCount },
  ids: { goblinId, wolfId, heroId, doorId: door.payload?.id, wallIds: wall.payload?.ids, lightId: light.payload?.id, entryIds: entries.payload?.ids },
  results: {
    fog, moved: moved.payload, toggled: toggled.payload, lighting: lighting.payload,
    rolled: rolled.payload, turn: turn.payload, dice: dice.payload,
    playerSyncMove: playerSyncMove.payload,
    playerSync: reportPlayerSync,
    undo: undo1.payload, redo: redo1.payload, saved: saved.payload,
  },
  polledEvents: polled.payload?.events?.length ?? null,
  sse: { received: sseEvents.length, byType: eventTypes, sample: sseEvents.slice(0, 60) },
  finalSummary: finalSummary.payload,
  afterUndo: { tokenCount: afterUndo.payload?.tokenCount, history: afterUndo.payload?.history },
  failures,
  shots,
  transcript,
};

writeFileSync(path.join(ROOT, 'docs', 'e2e-raw.json'), JSON.stringify(report, null, 2));
console.log(`\nDONE: ${sseEvents.length} SSE events, ${transcript.length} calls, ${failures.length} failures`);
console.log('event types:', JSON.stringify(eventTypes));
console.log('undo:', JSON.stringify(undo1.payload), 'redo:', JSON.stringify(redo1.payload));
console.log('dice:', dice.payload?.formula, '=', dice.payload?.total, 'logged:', dice.payload?.logged);
if (failures.length) console.log('FAILURES:', JSON.stringify(failures, null, 1));
