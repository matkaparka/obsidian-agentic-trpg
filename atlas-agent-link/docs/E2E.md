# E2E — the whole flow, run against live Obsidian 1.14.4 + Atlas VTT 0.8.0

Reproduce with `node scripts/e2e.mjs` (server running, writes enabled). The run writes
`docs/e2e-raw.json` (every request, response and event) and the screenshots in `docs/shots/`.
The numbers below are from one full run; ids differ per run.

**Result (2026-10-18, plugin 0.3.0): 40 MCP calls, 0 failures, 68 SSE events, 18 distinct event types.**

> A first run in the same session had two failures: `atlas_open_scene` reported "the new scene never
> reported as loaded" and the `combat_started` event never arrived. A rerun was clean; the raw files
> here are from the clean run. Not root-caused — watch it on long sessions.

## Setup

```
vault:      vault          (throwaway)
plugins:    atlas-vtt 0.8.0, atlas-agent-link 0.3.0
Obsidian:   1.14.4 portable, started with --user-data-dir=obsidian-data
            --remote-debugging-port=9222
endpoint:   http://127.0.0.1:27125/mcp      (Bearer token from the plugin settings)
stream:     http://127.0.0.1:27125/events   (SSE, Last-Event-ID replay)
scene:      scenes/e2e-<timestamp>.atlasmap, 1400×980 battlemap, square grid 70 px, 0/0 offset
```

## The run

Every request is `POST /mcp` with `Authorization: Bearer <token>`; every working call answered
`HTTP 200` with `{result:{content:[{type:"text",text:"<json>"}]}}`. `await`-style paraphrases below,
the raws are in `docs/e2e-raw.json`.

| # | Call | Result |
| --- | --- | --- |
| 1 | `initialize` | `protocolVersion 2025-03-26`, serverInfo `atlas-agent-link 0.2.0` |
| 2 | `tools/list` | 61 tools |
| 3 | `atlas_new_scene {path:"scenes/e2e-….atlasmap", background:"assets/battlemap.png"}` | scene file written; **no** inherited combat/dice state |
| 4 | `atlas_open_scene` | opened, `mapLoaded` after ~0.5 s (the script polls until the scene is the summary's `mapPath`) |
| 5 | `atlas_probe` | Atlas `0.8.0`, `tested:true`, `actionCount:133`, `missingActions:[]`, writes `enabled` |
| 6 | `atlas_scene_summary` | 0 tokens, grid 70, initiative inactive |
| 7 | `atlas_fog {action:"hide", cell:{col:0,row:0}, width:20, height:14}` | fog painted over the whole map (`count 0→1`) |
| 8 | `atlas_screenshot {target:"window"}` | `docs/shots/00-fogged.png` — map covered by fog |
| 9 | `atlas_add_tokens` (3 tokens, cells (2,2) (5,3) size 1.5 (8,6)) | `ids: [tok_…kcti, tok_…p4cp, tok_…yavo]` |
| 10 | `atlas_fog {action:"reveal", cell:{col:1,row:1}, width:5, height:5}` | `count 1→2`, `isErasing:true` |
| 11 | `atlas_screenshot` | `docs/shots/01-tokens-added.png` — a lit 5×5 window in the fog, goblin visible inside |
| 12 | `atlas_move_token {id:goblin, cell:{col:4,row:4}}` | `to {x:315,y:315}`, `from {col:2,row:2} → {col:4,row:4}`, `distanceCells:2` |
| 13 | `atlas_set_condition {ids:[wolf], conditionId:"prone", active:true}` | token conditions `["prone"]` |
| 14 | `atlas_update_token {id:hero, updates:{ringColor:"#e1b12c", showNameplate:true}}` | changed `["ringColor","showNameplate"]` |
| 15 | `atlas_add_wall_chain {points:[(0,9),(6,9)], type:"solid"}` | 1 segment, ids returned |
| 16 | `atlas_add_wall {type:"door", p1:(6,9), p2:(9,9), closed:true}` | `wall_…` |
| 17 | `atlas_toggle_door {id:door}` | `{closed:false}` (the door opens) |
| 18 | `atlas_add_light {cell:(5,5), emission:{bright:20,dim:40,color:"#ffcc88",animation:"torch"}}` | `light_…` |
| 19 | `atlas_set_lighting {enabled:true, ambient:0.2, tokenVision:true, exploredMemory:true}` | `after` reflects all four; returns `undoable:false` (Atlas does not track lighting) |
| 20 | `atlas_initiative {action:"add_tokens", ids:[goblin,wolf,hero]}` | 3 entry ids |
| 21 | `atlas_initiative {action:"start"}` | `isActive:true, round:1` |
| 22 | `atlas_initiative {action:"roll_all"}` | entries rolled to 16 / 15 / 10 |
| 23 | `atlas_initiative {action:"next"}` | `round 1`, `index 1`, active = Aria (initiative 15) |
| 24 | `atlas_initiative {action:"tracker", open:true}` | `trackerOpen:true` |
| 25 | `atlas_roll_dice {formula:"2d20kh1+5", label:"Grik attacks Aria", tokenId:goblin}` | `total 15`, two d20 (10 kept, 1 dropped), `logged:true` |
| 26 | `atlas_screenshot {target:"window"}` | `docs/shots/02-scene-played.png` |
| 27 | `atlas_screenshot {target:"map"}` | `docs/shots/03-map-only.png` — canvas only |
| 28 | `atlas_command {id:"atlas-vtt:show-map-in-player-window"}` | player popout opens |
| 29 | `atlas_screenshot {target:"player"}` | `docs/shots/04-player-window.png` — fog-correct player view + initiative order |
| 30 | `atlas_move_token {id:goblin, cell:{col:2,row:3}}` (a token **inside** the area players can see) | `to {x:175,y:245}` |
| 31 | `atlas_screenshot {target:"player"}` | `docs/shots/05-player-window-after-move.png` — **pixels changed**, so store writes reach the player window |
| 32 | `atlas_events {since:0, limit:300}` | 63 events were polled back out of the in-memory buffer |
| 33 | `atlas_undo {steps:2}` | `[{undone:true, remaining:11}, {undone:true, remaining:10}]` |
| 34 | `atlas_redo {steps:1}` | `{redone:true, remaining:2}`, history `{undo:10, redo:1}` |
| 35 | `atlas_save` | flushed to disk |

### UI confirmation

The screenshots are the confirmation — same window, same moment, taken through Electron
`webContents.capturePage`:

| File | Shows |
| --- | --- |
| `docs/shots/00-fogged.png` | the whole map painted over with fog by one MCP call |
| `docs/shots/01-tokens-added.png` | three tokens placed through MCP, a 5×5 fog reveal punched into the fog |
| `docs/shots/02-scene-played.png` | tokens moved, wall run + open door, torch light, dynamic lighting, initiative tracker |
| `docs/shots/03-map-only.png` | the map canvas cropped out of the window |
| `docs/shots/04-player-window.png` | the player window: fog-correct picture, initiative cards 17/14/5, current turn highlighted |
| `docs/shots/05-player-window-after-move.png` | the same window after an MCP token move — picture changed |
| `docs/shots/10-hex-grid.png` | hex scene: tokens placed by axial cell sit on hex centres |

### Undo really is per AI action

`atlas_undo {steps:2}` walked the history back two steps (`remaining 11 → 9`) and the redo restored
one; the scene summary afterwards still lists the 3 tokens. Because every tool maps to exactly one
store action (and the bulk tools use `addTokens` / `updateTokens` / `setTokenPositions` / `deleteTokens`),
one AI action is one Ctrl-Z in Atlas.

## The event stream (same run)

An SSE client attached to `GET /events?since=<head>` received **70 events** while the 40 calls ran:

```json
{"tool_call":37,"scene_loaded":2,"scene_closed":1,"fog_changed":2,"token_added":3,"token_moved":3,
 "token_updated":2,"wall_added":2,"door_toggled":1,"light_added":2,"lighting_changed":1,
 "initiative_entry_added":3,"combat_started":1,"turn_changed":2,"initiative_entry_updated":5,
 "state_changed":1,"dice_rolled":1,"light_removed":1}
```

Examples exactly as received (trimmed to the interesting fields):

```
event: fog_changed    {"seq":12,"type":"fog_changed","added":1,"removed":0,"erasing":false,
                       "kinds":["rectangle"],"addedIds":["fog_…"],"totalBefore":0,"totalAfter":1}
event: token_moved    {"seq":22,"type":"token_moved","id":"tok_…","name":"Grik the Goblin",
                       "from":{"x":175,"y":175},"to":{"x":315,"y":315}}
event: door_toggled   {"seq":32,"type":"door_toggled","id":"wall_…","doorType":"door",
                       "closed":false,"locked":false,"wasClosed":true}
event: turn_changed   {"seq":43,"type":"turn_changed","round":1,"index":0,"id":"init_…",
                       "name":"Grik the Goblin","initiative":0,"previous":-1}
event: dice_rolled    {"seq":55,"type":"dice_rolled","formula":"2d20kh1+5","total":15,
                       "rolls":[{"die":"d20","value":10},{"die":"d20","value":1,"dropped":true}],
                       "crit":null,"label":"Grik attacks Aria"}
```

`state_changed` is the fallback; it fired once (`initiativeTrackerOpen`), which is the intended
behaviour: nothing can change silently. `initiative_entry_updated` follows every initiative roll
(Atlas rewrites the entries), `light_removed` came from the undo at the end.

## Security checks (same server, `node scripts/security-check.mjs`)

```
PASS  no bearer token is refused            HTTP 401
PASS  wrong token is refused                HTTP 401
PASS  foreign Host header is refused        HTTP 403      (DNS rebinding)
PASS  browser Origin is refused             HTTP 403
PASS  non-JSON content type is refused      HTTP 415
PASS  authenticated tools/list works        HTTP 200, 61 tools
PASS  atlas_apply refuses a scene-wiping action
PASS  atlas_command only allows atlas-vtt: ids
PASS  atlas_roll_dice refuses a made-up formula
PASS  unknown tool is an error, not a crash
PASS  event stream needs the token          HTTP 401
PASS  SSE replays after Last-Event-ID
PASS  rate limit kicks in on a burst        26 of 620 answered 429
13/13 checks passed
```

Read-only mode and the kill switch were verified separately, because flipping them is an operator
action inside Obsidian (settings toggle / "Stop agent server" command):

* With `allowWrite` off, every write tool answers
  `Write access is disabled (read-only mode or kill switch)…` and the scene is untouched
  (verified by calling `atlas_add_token` in read-only mode: error, and `atlas_get_tokens` unchanged).
* "Stop agent server" closes the listener: `curl http://127.0.0.1:27125/health` then fails with a
  connection error and no MCP call can reach Atlas until "Start agent server" runs again.

## Things this run does not prove

* No 3D dice animation: the roll is computed in code and written to Atlas' dice log (which renders and
  persists), but Atlas' animated dice tray is not triggered — see PROBE.md.
* Hex grids were checked with axial cells, negative `q` and an even footprint on one pointy-top scene
  (`03`/`10` screenshots). It is a 1:1 port of Atlas' own maths, but it has not been compared against
  Atlas' interactive drag at every zoom level.
* Only one Atlas version (0.8.0) and one Obsidian version (1.14.4) were exercised.
