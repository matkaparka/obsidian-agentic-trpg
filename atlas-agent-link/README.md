# Atlas Agent Link

An Obsidian plugin that lets AI agents **read and control Atlas VTT scenes** — tokens, fog, walls and
doors, lights, initiative, dice, camera — over a local **MCP** endpoint, and **pushes a semantic event
stream** so an orchestrator can narrate what happens.

Verified against **Atlas VTT 0.8.0** in **Obsidian 1.14.4** on Windows: 62 tools, 77 unit tests
(including tests over a real captured store snapshot), 18 event types, screenshots in `docs/shots/`.
v0.3.0 adds `atlas_player_frame`: the player popout becomes a fixed 16:9 stream frame (Atlas map in the
middle, a transparent overlay iframe on top), restored exactly when disabled.

> Atlas has no published extension API. This plugin works one level down: it drives the same zustand
> store the Atlas UI drives (`AtlasView.getStore()`), so every AI write is a real Atlas edit — one
> undo step, saved by Atlas itself, visible in the player window. That also means it talks to
> internals: `src/atlas/adapter.ts` and `src/atlas/playerFrame.ts` are the only files that touch them,
> and an unknown Atlas version is reported loudly instead of failing silently.

## Install

1. Copy `main.js` and `manifest.json` into `<vault>/.obsidian/plugins/atlas-agent-link/`.
2. Enable "Atlas Agent Link" in Obsidian's community plugins (and Atlas VTT itself).
3. Open the plugin settings: the **bearer token** is generated on first load. Copy it.
4. AI writes are **off** by default (read-only). Turn on "Allow AI to modify the scene", or use the
   command "Toggle AI write access", when you want the agent to change the table.

The server starts with Obsidian (`127.0.0.1:27125` by default) and stops with the command
"Stop agent server (kill switch)".

## Connect

```bash
# MCP over HTTP
claude mcp add --transport http atlas http://127.0.0.1:27125/mcp \
  --header "Authorization: Bearer <token>"

# the event stream (SSE; Last-Event-ID replays, ?since=<seq> works too)
curl -N -H "Authorization: Bearer <token>" http://127.0.0.1:27125/events
```

`GET /health` returns `{ok, writes, atlasVersion, mapPath, events, oldestSeq}`.

## Tools (62)

| Area | Tools |
| --- | --- |
| read | `atlas_probe` `atlas_list_scenes` `atlas_get_scene` `atlas_scene_summary` `atlas_get_tokens` `atlas_cell_to_world` `atlas_world_to_cell` `atlas_events` `atlas_call_log` |
| scene | `atlas_open_scene` `atlas_new_scene` `atlas_set_grid` `atlas_set_background` `atlas_set_camera` `atlas_save` |
| tokens | `atlas_add_token` `atlas_add_tokens` `atlas_move_token` `atlas_move_tokens` `atlas_update_token` `atlas_update_tokens` `atlas_remove_token` `atlas_remove_tokens` `atlas_set_condition` `atlas_change_condition_value` `atlas_clear_conditions` `atlas_set_token_resources` `atlas_set_token_ring` `atlas_stack_tokens` `atlas_select_tokens` |
| fog | `atlas_fog` (reveal / hide / delete / list) |
| walls & doors | `atlas_add_wall` `atlas_add_wall_chain` `atlas_update_wall` `atlas_remove_wall` `atlas_remove_walls` `atlas_toggle_door` `atlas_set_door_locked` `atlas_list_walls` |
| lights | `atlas_add_light` `atlas_update_light` `atlas_remove_light` `atlas_set_lighting` `atlas_add_light_zone` `atlas_update_light_zone` `atlas_remove_light_zone` |
| notes & labels | `atlas_add_text` `atlas_update_text` `atlas_remove_text` `atlas_add_pin` `atlas_update_pin` `atlas_remove_pin` |
| combat | `atlas_initiative` (list/add/add_tokens/remove/update/roll_all/roll_one/next/prev/reorder/to_front/to_back/sits_out/start/end/reset/tracker/config) |
| dice | `atlas_roll_dice` `atlas_dice_log` `atlas_clear_dice_log` |
| vision | `atlas_screenshot` (window / map / player — returns image content for vision models) |
| stream frame | `atlas_player_frame` (player popout → fixed 16:9 map + transparent overlay iframe; hides Atlas' initiative rail, moves the dice toast, re-fits the camera; `enabled:false` restores everything) |
| system | `atlas_undo` `atlas_redo` `atlas_command` `atlas_apply` |

Notes that matter when prompting a model:

* `cell:{col,row}` (hex: `{q,r}`) or `x/y` world pixels — both accepted wherever a position is needed,
  and the grid maths is a 1:1 port of Atlas' own (odd footprints on cell centres, even ones where
  cells meet).
* Light radii are **game units**; fog `reveal` erases fog and `hide` paints it.
* `atlas_roll_dice` rolls **in code** and writes Atlas' dice log; a model cannot fudge a result.
* `atlas_apply` is a guarded escape hatch: an allowlist plus a hard block on scene-wiping actions.

## Events

`GET /events` streams `{seq, ts, type, …}` with semantic types — `token_added`, `token_moved`,
`token_updated`, `token_removed`, `fog_changed`, `door_toggled`, `wall_*`, `light_*`, `initiative_*`,
`turn_changed`, `combat_started/ended`, `dice_rolled`, `scene_loaded/closed`, `camera_changed`,
`state_changed` (fallback, so nothing changes silently) — see `docs/INTEGRATION.md` for the full
catalogue and a reconnecting TypeScript client.

## Safety

* Binds `127.0.0.1` only; every request needs the bearer token (constant-time compare).
* The `Host` header must be loopback (DNS rebinding) and any browser `Origin` is refused — there is no
  CORS path into it.
* Read-only by default; write tools fail with an explanation. "Stop agent server" is a kill switch.
* Body size cap, per-minute rate limit, JSON content type required, audit log (`atlas_call_log`) and a
  `tool_call` event per call.
* `atlas_apply` refuses destructive store actions even if an operator allowlists them.
* Nothing outside the vault's Atlas scenes is read or written.

## Docs

| File | What |
| --- | --- |
| `docs/HANDOFF.md` | **start here**: what is done, what is not, known traps, next steps |
| `docs/PROBE.md` | what Atlas 0.8.0 actually exposes: 133 actions, state shapes, quirks, verified vs not |
| `docs/E2E.md` | the whole flow run live, with screenshots and event samples |
| `docs/INTEGRATION.md` | wiring an orchestrator: client code, event reference, failure modes |

## Dev

```bash
npm install
npm test          # 72 tests, incl. a real Atlas store snapshot fixture
npm run build     # esbuild → main.js
npm run typecheck # tsc --noEmit
```

`scripts/` holds the tooling used to verify all this against a live Obsidian (`cdp.mjs` drives the
renderer over the DevTools protocol, `e2e.mjs` runs the MCP flow, `security-check.mjs` runs the 13
acceptance checks). `docs/PROBE.md` explains the setup.

## License

AGPL-3.0-only, like Atlas VTT itself (this plugin drives its internals; see `LICENSE`).

## Known limitations

* No 3D dice animation: rolls are computed in code and written to Atlas' dice log.
* Atlas internals can change: unknown versions are flagged, and `atlas_probe` lists missing actions.
* Desktop Obsidian only; one vault at a time; loopback only (no remote play).
