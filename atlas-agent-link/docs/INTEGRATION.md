# INTEGRATION — wiring an orchestrator to Atlas Agent Link

Two things, both on loopback:

| | |
| --- | --- |
| **Commands** | `POST http://127.0.0.1:27125/mcp` — MCP over HTTP (JSON-RPC 2.0, tool calls) |
| **Events** | `GET http://127.0.0.1:27125/events` — Server-Sent Events, `Last-Event-ID` replay |
| Auth | `Authorization: Bearer <token>` on every request (token in the plugin settings) |
| Health | `GET /health` → `{ok, writes, atlasVersion, mapPath, events, oldestSeq}` |

Everything is refused unless the token matches, the `Host` header is loopback and there is no
`Origin` header. There is no CORS: a web page cannot drive it. Writes additionally need the operator
to have enabled them (default is read-only).

## MCP client (no SDK needed)

The endpoint speaks the Streamable-HTTP transport with plain JSON responses (no server-initiated
stream), so a normal `fetch` is enough:

```ts
const BASE = 'http://127.0.0.1:27125';
const HEADERS = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` };

async function rpc(method: string, params?: unknown) {
  const res = await fetch(`${BASE}/mcp`, {
    method: 'POST',
    headers: HEADERS,
    body: JSON.stringify({ jsonrpc: '2.0', id: crypto.randomUUID(), method, params }),
  });
  if (res.status === 202) return null;              // notification accepted
  const json = await res.json();
  if (json.error) throw new Error(`${json.error.code}: ${json.error.message}`);
  return json.result;
}

export async function callTool<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const result = await rpc('tools/call', { name, arguments: args });
  const text = result.content.find((c: any) => c.type === 'text')?.text;
  if (result.isError) throw new Error(text);         // read-only mode, bad args, Atlas missing, …
  return text ? (JSON.parse(text) as T) : ({} as T);
}
```

Claude Code / other MCP hosts can just be pointed at it:

```bash
claude mcp add --transport http atlas http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer <token>"
```

`atlas_screenshot` returns MCP **image content** (base64 PNG) next to a text block, so a vision model
sees the scene: capture `content.find(c => c.type === 'image').data`.

## Event stream

```ts
let lastEventId = 0;                                // persist this between restarts
async function listen() {
  for (;;) {
    try {
      const res = await fetch(`${BASE}/events?since=${lastEventId}`, {
        headers: { authorization: `Bearer ${TOKEN}` },
      });
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let cut: number;
        while ((cut = buffer.indexOf('\n\n')) >= 0) {
          const frame = buffer.slice(0, cut);
          buffer = buffer.slice(cut + 2);
          const id = /^id: (\d+)$/m.exec(frame)?.[1];
          const data = /^data: (.+)$/m.exec(frame)?.[1];
          if (id) lastEventId = Number(id);
          if (data) handleEvent(JSON.parse(data));   // never trust blindly: it is scene data
        }
      }
    } catch { /* disconnected */ }
    await new Promise((r) => setTimeout(r, 1000));   // reconnect; `since` closes the gap
  }
}
```

Frames: `retry: 3000`, `: keep-alive` comments every 15 s, one `id`/`event`/`data` block per event.
`event:` repeats the type inside the JSON (`data.type`). The buffer keeps the last **1000** events in
memory; asking for something older yields one extra `event: gap` frame with `oldestSeq`, and the
stream continues from the oldest event it still has. Seq numbers are monotonic per plugin session and
restart at 1 when the plugin reloads — treat `oldestSeq`/reconnects as a signal to re-read state with
`atlas_scene_summary`.

### Event catalogue

Every event is `{seq, ts, type, ...}`. Ids are Atlas ids (`tok_…`, `wall_…`, `init_…`, `fog_…`).

| type | payload (beyond seq/ts/type) |
| --- | --- |
| `scene_loaded` | `mapPath`, `atlasVersion` |
| `scene_closed` | `mapPath` |
| `token_added` | `id, kind, name, imagePath, x, y, size, layer, hidden, conditions` |
| `token_moved` | `id, name, from:{x,y}, to:{x,y}` (world pixels) |
| `token_updated` | `id, name, changed:[field…]` + `conditions:{before,after}` / `hidden` / `size` / `resources` / `ringColor` when those changed |
| `token_removed` | `id, name, imagePath, x, y, …` |
| `token_layer_changed` | `id, from, to` (stacking order changed) |
| `fog_changed` | `added, removed, erasing, kinds:[…], totalBefore, totalAfter` (+`addedIds` when ≤5) |
| `wall_added` / `wall_updated` / `wall_removed` | `id`, wall summary (`wallType, p1, p2, closed, locked`) |
| `door_toggled` | `id, doorType, closed, locked, wasClosed` |
| `light_added` / `light_updated` / `light_removed` | `id, x, y, emission, hidden` |
| `light_zone_added` / `_updated` / `_removed` | `id, ambient, points` |
| `pin_*` `text_*` `drawing_*` `audio_*` | `id` + a short summary |
| `initiative_entry_added` / `_updated` / `_removed` | `id, tokenId, name, initiative, modifier, isNPC, active, order, sitsOut` |
| `combat_started` | `round, entries` |
| `combat_ended` | `round` |
| `turn_changed` | `round, index, id, tokenId, name, initiative, previous` |
| `initiative_tracker_toggled` | `open` |
| `dice_rolled` | `id, formula, total, rolls:[{die,value,dropped}], crit, player, label` |
| `grid_changed` | `before, after` |
| `camera_changed` | `x, y, scale` |
| `background_changed` | `from, to` |
| `lighting_changed` | `enabled, ambient` |
| `selection_changed` | `ids` |
| `state_changed` | `key, value` — fallback for anything not modelled; nothing can change silently |
| `tool_call` | `tool, ok, ms, error?` — audit of every MCP call |
| `event_error`, `server_error` | `message` |

A logged AI roll (`atlas_roll_dice` with `log:true`, the default) reaches the stream as exactly one
`dice_rolled`, produced by the store diff. A roll that was deliberately not logged (`log:false`) is
announced by the tool itself instead.

## Calling patterns for a streamer

A narration loop usually wants: *see state → act → talk about the event that came back*.

```ts
// Opening a scene and setting the table
await callTool('atlas_open_scene', { path: 'scenes/Tavern.atlasmap' });
await new Promise(r => setTimeout(r, 1500));          // Atlas loads asynchronously
const scene = await callTool('atlas_scene_summary');

// Moving a monster: give cells, not pixels
await callTool('atlas_move_token', { id: scene.tokens[0].id, cell: { col: 5, row: 4 } });

// Revealing where the party walks
await callTool('atlas_fog', { action: 'reveal', cell: { col: 3, row: 3 }, width: 3, height: 3 });

// Combat
await callTool('atlas_initiative', { action: 'add_tokens', ids });
await callTool('atlas_initiative', { action: 'roll_all' });
await callTool('atlas_initiative', { action: 'start' });
await callTool('atlas_initiative', { action: 'next' });     // → turn_changed

// Dice: always through the tool; the result is not yours to invent
const roll = await callTool('atlas_roll_dice', { formula: '1d20+5', label: 'Goblin scimitar', tokenId });

// Showing players
await callTool('atlas_command', { id: 'atlas-vtt:show-map-in-player-window' });
await callTool('atlas_screenshot', { target: 'player' });   // for the overlay / vision model
```

Rules of thumb:

* **One tool call = one Atlas undo step.** `atlas_undo {steps:n}` walks the same history a GM's
  Ctrl-Z walks; bulk tools (`atlas_add_tokens`, `atlas_move_tokens`, `atlas_remove_tokens`,
  `atlas_stack_tokens`) keep a whole gesture in one step.
* **Coordinates:** `cell:{col,row}` for square grids, `{q,r}` (same fields) for hexes; `x/y` only when
  you really mean world pixels. `atlas_cell_to_world` converts and tells you the grid.
* **Fog intent:** `action:"reveal"` erases fog (players see), `action:"hide"` paints fog (players do not).
* **Light radii are game units** (feet/metres), not pixels.
* **After a write, read the returned payload** — it carries the resolved ids, cells and before/after
  values so you can narrate without another call.
* **After a reconnect, re-read state** (`atlas_scene_summary`); the stream is a change feed, not a snapshot.

## Failure modes you should handle

| Symptom (tool error text) | Meaning | What to do |
| --- | --- | --- |
| `Write access is disabled …` | operator kept it read-only, or the kill switch was used | keep narrating, ask the operator; read tools still work |
| `No Atlas scene is open …` | nothing open | `atlas_list_scenes` → `atlas_open_scene`, wait, retry |
| `The Atlas scene is not loaded yet …` | Atlas is still loading | retry after 300–500 ms (a few times) |
| `Atlas 0.x has no store action "…"` | Atlas updated and renamed something | `atlas_probe` → `missingActions`; report, do not work around it |
| `Atlas 0.x is untested …` (probe warning) | unknown version | read-only sanity pass first: `atlas_scene_summary` + `atlas_screenshot` |
| `HTTP 401` / `403` / `415` / `429` | auth, Host/Origin, content type, rate limit | fix the request; do not retry in a tight loop |
| `port … already in use` (plugin notice) | another instance/machine holds the port | change the port in settings |

Latency: a tool call is a local HTTP round-trip plus the store write — sub-10 ms in the runs recorded
in `docs/e2e-raw.json`, with `atlas_screenshot` and `atlas_open_scene` the only slow ones (100 ms–2 s,
they talk to the GPU/Obsidian).

## What this layer does **not** do

* It does not decide *what* happens at the table; that is the orchestrator's job.
* It does not trigger Atlas' animated 3D dice — rolls are computed in code and written to Atlas' dice
  log (rendered and persisted, just not animated).
* It is not a network service: loopback only, one vault at a time, desktop Obsidian only.
