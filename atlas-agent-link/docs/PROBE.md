# PROBE — what Atlas VTT 0.8.0 actually exposes

Everything here was read off a **live** installation, not inferred. Nothing in this file is a
guess unless it says "not verified".

## Environment probed

| Thing | Value |
| --- | --- |
| Obsidian | 1.14.4 (portable build, Windows, Electron with `--remote-debugging-port`) |
| Atlas VTT | 0.8.0, installed from the GitHub release (`atlas-vtt/atlas-vtt`, tag `0.8.0`, commit `3d68221`) |
| Release artefacts | `main.js` 7 384 733 B sha256 `1faabb78…2d37ee`, `styles.css` 1 166 042 B sha256 `baa02a0d…d81801`, `manifest.json` sha256 `5e52740d…ee5fa` |
| Source read | the same tag (`atlas-vtt-0.8.0` tarball), files named below |
| Vault used | `vault` (throwaway test vault, never a user's real notes) |

**How it was probed.** Obsidian was started with `--remote-debugging-port=9222` and driven over the
Chrome DevTools Protocol (`scripts/cdp.mjs` in this project). The probe evaluated expressions in the
renderer, e.g.

```js
app.plugins.plugins['atlas-vtt'].manifest.version
app.workspace.getLeavesOfType('atlas-vtt')[0].view.getStore().getState()
Object.keys(store.getState()).filter(k => typeof store.getState()[k] === 'function')  // → 133 actions
```

`atlas_probe` returns the same inventory at runtime, so a future Atlas can be re-checked without this
document being trusted.

## Store anatomy

An Atlas scene is an Obsidian `FileView` of type `atlas-vtt` (`AtlasView`). Useful members, all
confirmed present:

```
view.getStore()            → zustand store (vanilla, with subscribeWithSelector + persist + immer + history)
view.atlasStore()          → the same store
view.tabMetaStore          → per-view tab list { tabs: [{id, filePath, displayName}], activeTabId }
view.switchToTab(tabId)    → switch the scene tab inside one view
view.saveMap()             → save now
view.reloadActiveScene(fn) → reload with a rewrite callback (note: NOT a boolean)
view.performSceneLoad(f)   → internal load
view.setPlayerMode(...)    → player/GM presentation switches
view.clearAllFog()         → clears fog (bypasses the store action)
```

Store object keys: `setState, getState, getInitialState, subscribe, temporal, persist, flushStorage, rehydrateFromFile`.

* `temporal.getState()` → `{ pastStates, futureStates, isTracking, undo, redo, clear, pause, resume, beginTransaction, endTransaction, abandonTransaction, transaction, untracked, isTravelling }`.
  Undo/redo work through this, which is what `atlas_undo` / `atlas_redo` call.
* `flushStorage()` forces the debounced save to disk (`atlas_save`).
* Undo history tracks `objects`, `grid`, `background`, `widgetValues` and `exploredEdits`.
  **Not** tracked: `lighting`, `exploredMask`, `camera`, `initiative`, `diceLog`, `initiativeTrackerOpen`.
  Those still persist with the scene, they just do not participate in undo.

## Actions present in 0.8.0 (133)

Grouped; every name below was observed as a function on `store.getState()`. `atlas_probe` lists them
all and diffs them against what this plugin needs.

```
tokens      addToken addTokens addTokenWithId addCharacter moveToken moveTokensBulk updateToken
            updateTokens setTokenPositions setTokens setTokenRing setTokensCondition
            changeTokensConditionValue clearTokenConditions deleteToken deleteTokens deleteSelected
            dropTokens killTokens resetTokens retargetRenamedFile
fog         addFogOperation deleteFogOperation deleteFogOperations duplicateFogOperations
            setFogOperations clearFog
walls       addWall updateWall deleteWall deleteWalls toggleDoor setDoorLocked
lights      addLight updateLight deleteLight addLightZone updateLightZone deleteLightZone
            setSceneLighting
notes       addNotePin updateNotePin moveNotePin deleteNotePin
texts       addText updateText moveText deleteText setTexts
drawings    addDrawing moveDrawings updateDrawings deleteDrawing clearDrawings setDrawings
audio       addAudio updateAudio deleteAudio markAudioDirty consumeAudioDirty
scene       setBackground setGrid alignGrid setGridUnits setGridVisible setSnapToGrid setCamera
            setMapPath setMapLoaded setMapLoading setPersistenceEnabled clearMapState
            setExploredMask setExploredEdits setGMView setDMNotePath setTokenSettings
initiative  addToInitiative removeFromInitiative updateInitiativeEntry rollAllInitiative
            rollEntryInitiative nextTurn previousTurn reorderInitiative moveToFront moveToBack
            startCombat endCombat resetInitiative setInitiativeConfig setInitiativeSitsOut
            setInitiativeTrackerOpen
dice        addDiceLogEntry clearDiceLog
selection   setSelection clearSelection setSelectionMode setActiveTool setIsDragging setHeldTokens
clipboard   insertMapObjects duplicateMapObjects removeMapObjects deleteMapObject
ui          openAssetManager closeAssetManager openLightPopover closeLightPopover
            openLightZonePopover closeLightZonePopover setSceneLightingPanelOpen setGridSettingsOpen
            setGridAlignmentOpen setDMScreenOpen setDiceLogOpen setDiceTrayOpen
            setCommandPaletteOpen setToolbarEditing setLootRollerOpen updateLootRoller showLootRoll
widgets     addWidget removeWidget updateWidget setWidgetSettings setWidgetOn setWidgetValue
            setTimerState reorderWidgets
notes-ui    savePinnedNotePreview removePinnedNotePreview
```

Signatures worth knowing (from `src/app/storeFactory.ts`, confirmed by calling them):

| Action | Signature |
| --- | --- |
| `addToken` | `(data: TokenInput) => string` (the new id) |
| `addTokens` | `(data: TokenInput[]) => string[]` |
| `moveToken` | `(id, x, y) => void` |
| `updateToken` | `(id, updates: TokenUpdates) => void` |
| `updateTokens` | `(entries: {id, changes}[]) => void` (one undo step) |
| `setTokenPositions` | `(positions: {id,x,y}[]) => void` |
| `deleteToken` / `deleteTokens` | `(id)` / `(ids[]) => void` |
| `setTokensCondition` | `(tokenIds[], conditionId, active: boolean)` |
| `addFogOperation` | `(input: FogOperationInput) => string` |
| `addWall` | `(input: WallInput) => string`; `toggleDoor(id)`; `setDoorLocked(id, locked)` |
| `addLight` | `(input: LightInput) => string`; `updateLight(id, LightChanges)` |
| `setSceneLighting` | `(changes: SceneLightingChanges)` |
| `setCamera` | `(partial: {x?, y?, scale?})` — **`scale` is the zoom**, there is no `zoom` |
| `setGrid` | `(grid: GridState)` — replaces the whole grid object, so read-modify-write |
| `addToInitiative` | `(entry: Omit<InitiativeEntry,'id'|'order'|'isActive'>) => string` |
| `rollAllInitiative` | `(roll?: string, fromStatblocks?: Map<string, number>)` |
| `startCombat` / `endCombat` / `nextTurn` / `previousTurn` | `() => void` |
| `addDiceLogEntry` | `(entry: DiceRollResult)` — the full result, not a summary |
| `setInitiativeTrackerOpen` | `(open: boolean)` |

## State shape

Non-function keys on the store state:

```
objects  {tokens, fog, pins, texts, drawings, walls, lights, lightZones?, audios?}   ← all id-keyed records
grid     {enabled, visible, snapToGrid, type, size, offsetX, offsetY, opacity, lineType, lineWidth,
          unitType, unitDistance, unitDistanceOverride?, color?, mapStretch?, cellNumbers?, …}
camera   {x, y, scale}
initiative {entries: InitiativeEntry[], currentIndex, round, isActive, config:{autoSort}, sides?}
diceLog  DiceRollResult[]            ← capped at 20 by Atlas
lighting {enabled, ambient, ambientColor?, tokenVision?, exploredMemory?, litThreshold?, …}
objects.tokens[id] = TokenEntity | Character
objects.fog[id]    = FogOperation (brush | lasso | rectangle)
objects.walls[id]  = WallSegment
objects.lights[id] = LightSource
objects.lightZones[id] = LightZone              ← the key is absent until a zone exists
objects.audios[id] = AudioSource                ← the key is absent until audio exists
mapPath  string | null               · mapLoaded boolean · isMapLoading boolean
persistenceEnabled boolean           · schema 'atlas-vtt' · version 4
selectedIds string[]                 · activeTool · selectionMode · isDragging
tokenSettings, widgetSettings, widgetValues, dmNotePath, partyValues, exploredMask, exploredEdits
plugin (Atlas' own plugin object — never touch it) · name (see quirks)
```

Object shapes (from `src/app/types.ts`, `types/{fogTypes,wallTypes,lightingTypes,initiativeTypes,diceTypes}.ts`):

```ts
TokenInput = Partial<{…}> & { imagePath: string; x: number; y: number }   // size, layer, rotation,
  // ringColor, conditions[], conditionValues{}, isHidden, showNameplate, showRing, resources{},
  // overriddenMax[], tags[], side, vision{}, light{}, assetId, name?, notePath?, statblockPath?, kind?
FogOperationInput = { type:'rectangle', x, y, width, height, isErasing? }
                  | { type:'lasso', points:{x,y}[], isErasing? }
                  | { type:'brush', points:{x,y}[], brushRadius, isErasing? }
WallInput = { type:'solid'|'door'|'secret-door', p1:{x,y}, p2:{x,y}, closed?, locked?,
              blocks?:'sight'|'light', limited?, direction?:'left'|'right', chainId? }
LightInput = { x, y, emission:{ bright, dim, color, intensity, animation }, hidden?, rotation?,
               activeBelowAmbient? }               // radii are GAME UNITS, not pixels
LightZoneInput = { polygon:{x,y}[], ambient: 0..1, ambientColor?, name? }
DiceRollResult = { id, timestamp, formula, rolls: RolledDie[], modifiers, total, crit?, player?, source? }
```

## Grid, camera and token geometry

Ported 1:1 into `src/atlas/grid.ts` from `grid/hexGeometry.ts`, `grid/gridPlacement.ts` and
`pixi/token-renderer/tokenSizing.ts`:

* `grid.size` = square cell size, and for hexes the **flat-to-flat** distance. Circumradius `= size/√3`.
* `type` is `'square' | 'hex-vertical' | 'hex-horizontal'`; `hex-vertical` = pointy-top (rows),
  `hex-horizontal` = flat-top (columns). Cells are axial `(q,r)`; pixel→cell uses cube rounding.
* `offsetX/offsetY` = top-left corner of cell (0,0) (for hexes: of hex (0,0)'s bounding box).
* A token's `size` is a multiplier and the **diameter in cells is `2·size − 1`** (1→1, 1.5→2, 2→3).
* Token `x,y` are the **centre in world pixels**. Odd footprints sit on a cell centre; even ones sit
  where cells meet: on a square grid that is `+size/2, +size/2`, on a hex grid the hex's lower-right
  vertex. That is `tokenCenterShift`, and `atlas_cell_to_world` applies it, so a token placed through
  this plugin lands exactly where Atlas' own drag-and-drop would put it.
* Square cell centre: `(offsetX + (col+0.5)·size, offsetY + (row+0.5)·size)` + the footprint shift.
* Hex centre: `origin + size·(q + r/2), origin.y + 1.5·radius·r` (pointy) or the transposed form (flat),
  where `origin` is the centre of hex (0,0).
* `camera.scale` is the zoom factor (1 = 100%). There is no separate zoom field.

## Commands (`app.commands` ids prefixed `atlas-vtt:`)

28 were registered. The ones this plugin's `atlas_command` tool is meant for:

```
atlas-vtt:send-map-to-player-view        present the active scene to players (no window)
atlas-vtt:show-map-in-player-window      present it and open the player window
atlas-vtt:open-player-window             open the player window on the presented scene
atlas-vtt:display-image-on-player-view   / atlas-vtt:dismiss-image-from-player-view
atlas-vtt:toggle-initiative-tracker      atlas-vtt:toggle-dice-log      atlas-vtt:toggle-loot-roller
atlas-vtt:make-selected-player-tokens    atlas-vtt:make-selected-gm-tokens
atlas-vtt:open-dashboard                 atlas-vtt:open-scene-browser
atlas-vtt:insert-atlas-link              atlas-vtt:clean-up-missing-assets
```

`atlas-vtt:show-map-in-player-window` and `open-player-window` were executed from the plugin and do
open a popout; `send-map-to-player-view` only works while an **Atlas** view is the active one (with
the player window focused it answers "No active map to send to the player view").

## Atlas plugin surface (not an API, but reachable)

`app.plugins.plugins['atlas-vtt']` has: `manifest`, `settingsService`, `widgetSyncService`,
`globalAssetManager`, `imageDisplayService`, `changelogService`, `onlinePlay`, and the getter
`presentedScene` (a store whose `scene` is `{tabId, filePath}` while something is presented).

There is **no published extension API** in 0.8.0. `atlas-physical-dice` / `atlas-vtt-connect` only
mention one as coming. So this plugin stays on the store, and `src/atlas/adapter.ts` is the single
place that would need rewriting if Atlas changes.

## Where the brief's assumptions were wrong

| Brief says (§4) | Reality in 0.8.0 |
| --- | --- |
| `removeToken(id)` / `removeTokens` | `deleteToken(id)` / `deleteTokens(ids)` |
| `endCombat()` exists, `atlas_initiative end` guessed | exists; but initiative is **not** in the scene file, see quirks |
| `addDiceLogEntry(entry)` guessed shape | needs a full `DiceRollResult` (`id`, `timestamp`, `rolls[]`, `modifiers`, `total`), not `{formula,total,label}` |
| grid in `state.grid/gridConfig/gridSettings` | only `state.grid` exists (`gridConfig`/`gridSettings` are not state) |
| camera partial `{x,y,zoom}` | `{x,y,scale}` |
| `setTokensCondition(tokenIds, conditionId, active)` | correct |
| walls `addWall/updateWall/deleteWall` | correct, plus `deleteWalls`, `toggleDoor`, `setDoorLocked` |
| fog ops | `addFogOperation/deleteFogOperation/deleteFogOperations/duplicateFogOperations/setFogOperations/clearFog`; **paint hides, erase reveals** |
| lights | `addLight/updateLight/deleteLight` plus `addLightZone/updateLightZone/deleteLightZone` and `setSceneLighting` |
| token grouping/stacking | the field is `token.layer` (z-order); `raiseTokens` is internal, so stacking is `updateTokens([{id, changes:{layer}}])` |
| "auth API 未发布" | still true, no beta extension point found |

## Quirks and traps found the hard way

1. **A scene file that omits fields does not reset them.** Atlas' store keeps whatever the loaded file
   does not carry. A brand-new `.atlasmap` with only `objects/grid/camera` inherits the *previous*
   scene's `initiative`, `diceLog`, `name`, `tokenSettings`. `atlas_new_scene` therefore writes those
   explicitly with defaults.
2. **Writing a scene file from outside while Atlas has it open is lost.** Atlas' debounced save writes
   its store over the file. `atlas_new_scene` refuses to overwrite a scene that is currently open.
3. **The player window does not repaint while it is covered.** It is presented as a mirrored frame and
   Chromium does not composite hidden windows, so a `capturePage` of it comes back blank or stale.
   `atlas_screenshot {target:"player"}` raises the window, waits ~650 ms, throws the first frame away
   and captures again. Live state sync itself is not affected (verified: a token moved through MCP
   changed the player picture, `docs/shots/04` → `docs/shots/05`).
4. **`state.name` can be stale** after switching scene tabs in one view: Atlas does not persist `name`
   for every scene, so the store keeps the previous value. Use `mapPath` as the identity.
5. **Lighting and the dice log are outside undo.** `atlas_set_lighting` says so in its result; that is
   Atlas' behaviour, not this plugin's choice.
6. **`.atlasmap` is a `{version, state}` envelope.** `version > 4` is refused by Atlas ("newer"), so a
   scene written by this plugin uses the same version the disk shows.
7. `objects.audios` and `objects.lightZones` are absent until the first object of that kind exists —
   code must not assume the keys.

## Verified vs not verified

| Claim | Status |
| --- | --- |
| 133 actions, names and signatures | verified live |
| Token add/move/update/delete, conditions, ring, resources | verified live (E2E + screenshots) |
| Fog reveal/hide/delete/list | verified live (screenshot: whole map fogged, block revealed) |
| Walls, doors (toggle, lock), chains | verified live |
| Lights, light zones, scene lighting | verified live (light added; lighting toggled and event emitted) |
| Initiative add/roll/next/start/tracker | verified live |
| Dice roll written to Atlas' dice log | verified live (log entry persisted in the scene file) |
| Undo/redo through `store.temporal` | verified live (one write = one step) |
| Player window receives store-level writes | verified live (picture changed after an MCP move) |
| Square grid cell↔pixel | verified live (tokens land on cells; screenshot) |
| Hex grid cell↔pixel (pointy, flat, negative q, even footprint) | verified live (tokens land on hex centres; `docs/shots/10-hex-grid.png`), but not exhaustively against Atlas' own drag for every zoom |
| `atlas_screenshot` window/map/player | verified live |
| 3D dice animation trigger | **not found**: Atlas' dice animation lives in its `DiceTool`/`dice3d` modules with no reachable entry point. Rolls are computed in code and written to the dice log instead (the log renders and persists; the 3D animation does not play) |
| Official extension API | **does not exist** in 0.8.0 |
| Anything on Atlas > 0.8.0 | **not verified**; the plugin flags the version and lists missing actions instead of guessing |
