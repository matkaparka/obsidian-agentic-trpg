/**
 * Read tools plus scene/grid/camera/undo/escape-hatch tools.
 *
 * Tool descriptions are written for an LLM: they say what the numbers mean (world pixels vs
 * grid cells), what comes back, and what usually goes wrong.
 */
import { sanitize, getPath } from '../util';
import { describeToken, gridSummary, num, obj, str, bool, anyObject, enumOf, ToolCtx, ToolDef, imageResult, requireString, placementResult, CELL_SCHEMA } from './shared';
import { cellToWorld, worldToCell, summariseGrid, snapToCellCenter, type GridState } from '../atlas/grid';
import { BLOCKED_ACTIONS } from '../atlas/adapter';
import { captureScreenshot } from '../atlas/screenshot';

/** Scene schema this plugin writes for new scenes (Atlas 0.8.0 writes version 4). */
const SCENE_SCHEMA_VERSION = 4;
const APPLY_DENY = /(clear|reset|wipe|import|storage|persist|hydrate|destroy|dispose|uninstall|delete-?all)/i;

function tokenList(state: any, grid: GridState | null, ids?: string[]) {
  const all: any[] = Object.values(state?.objects?.tokens ?? {});
  const filtered = ids?.length ? all.filter((t) => ids.includes(t.id)) : all;
  return filtered.map((t) => describeToken(t, grid));
}

export function sceneTools(ctx: ToolCtx): ToolDef[] {
  const { atlas, bus, settings } = ctx;

  return [
    {
      name: 'atlas_probe',
      description: 'Call this first. Reports the Atlas version, whether this plugin was verified against it, which store actions exist (and which required ones are missing), how many scenes are open and loaded, the atlas-vtt: commands, and whether writes are enabled. Everything else assumes what this returns.',
      inputSchema: obj({}),
      handler: () => {
        const caps = atlas.capabilities();
        const s = settings();
        return {
          ...caps,
          writes: s.allowWrite ? 'enabled' : 'read-only (an operator must enable writes in the plugin settings)',
          commands: atlas.listCommands(),
          scenes: atlas.listScenes(),
          applyAllowlist: s.applyAllowlist,
          endpoints: { mcp: `http://127.0.0.1:${s.port}/mcp`, events: `http://127.0.0.1:${s.port}/events` },
          historyDepth: (() => { try { return atlas.historyDepth(); } catch { return null; } })(),
          eventBuffer: { size: bus.size(), oldestSeq: bus.oldest() },
        };
      },
    },
    {
      name: 'atlas_list_scenes',
      description: 'List .atlasmap scene files in the vault (paths to pass to atlas_open_scene).',
      inputSchema: obj({}),
      handler: () => ({ scenes: atlas.listScenes() }),
    },
    {
      name: 'atlas_open_scene',
      description: 'Open a .atlasmap scene in a new Obsidian tab. Wait ~1s before writing to it: the scene loads asynchronously and writes are refused until mapLoaded is true.',
      write: true,
      inputSchema: obj({ path: str('vault path of the .atlasmap file, e.g. "scenes/tavern.atlasmap"') }, ['path']),
      handler: (a) => atlas.openScene(requireString(a, 'path')),
    },
    {
      name: 'atlas_new_scene',
      description: 'Create a new .atlasmap scene file (a map needs only this file; Atlas opens it on demand). `background` is a vault image path such as "assets/battlemap.png" — without it the scene is a blank 20x20-cell world. Refuses to overwrite unless overwrite is true.',
      write: true,
      inputSchema: obj({
        path: str('vault path to create, e.g. "scenes/new-fight.atlasmap"'),
        name: str('display name'),
        background: str('vault image path, or omit for an empty scene'),
        gridSize: num('cell size in pixels (default 70)'),
        gridType: enumOf(['square', 'hex-horizontal', 'hex-vertical'], 'grid type (default square)'),
        offsetX: num('grid origin x in pixels (default 0)'),
        offsetY: num('grid origin y in pixels (default 0)'),
        overwrite: bool('replace an existing file (default false)'),
      }, ['path']),
      handler: async (a) => {
        const grid = {
          enabled: true, visible: true, snapToGrid: true,
          type: a.gridType ?? 'square',
          size: typeof a.gridSize === 'number' ? a.gridSize : 70,
          offsetX: typeof a.offsetX === 'number' ? a.offsetX : 0,
          offsetY: typeof a.offsetY === 'number' ? a.offsetY : 0,
          opacity: 0.5, lineType: 'solid' as const, lineWidth: 1, unitType: 'feet' as const, unitDistance: 5,
        };
        const envelope = {
          version: SCENE_SCHEMA_VERSION,
          state: {
            schema: 'atlas-vtt' as const,
            version: SCENE_SCHEMA_VERSION,
            name: a.name ?? String(a.path).split('/').pop()?.replace('.atlasmap', '') ?? 'Scene',
            background: a.background ?? null,
            grid,
            objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {} },
            camera: { x: 0, y: 0, scale: 1 },
            // Atlas' store keeps whatever a scene file does not carry, so a new scene has to say
            // these outright — otherwise it would inherit the previous scene's combat and dice log.
            initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
            initiativeTrackerOpen: false,
            diceLog: [],
            selectedIds: [],
            tokenSettings: { showNameplates: false, hiddenResources: [], showInstanceBadges: true, tokenRingSize: 1 },
            lighting: { enabled: false, ambient: 0.1 },
          },
        };
        const path = await atlas.writeSceneFile(String(a.path), envelope, a.overwrite === true);
        return { created: path, grid, background: envelope.state.background, note: 'Open it with atlas_open_scene; Atlas keeps initiative, dice log and lighting from this file, not from the previously open scene.' };
      },
    },
    {
      name: 'atlas_get_scene',
      description: 'Read the open scene state as JSON (functions stripped). Use `path` (dot notation: "objects.tokens", "initiative", "objects.walls") and maxDepth/maxItems to keep the answer small. For a human-sized overview use atlas_scene_summary instead.',
      inputSchema: obj({ path: str('dot path, empty for the whole state'), maxDepth: num('depth limit, default 5'), maxItems: num('item limit, default 200') }),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const value = sanitize(getPath(state, a.path ?? ''), a.maxDepth ?? 5, a.maxItems ?? 200);
        return { mapPath: state.mapPath, grid: summariseGrid(state.grid), value };
      },
    },
    {
      name: 'atlas_scene_summary',
      description: 'One-call overview of the open scene for planning: name, background, grid, camera, every token (with its cell), wall/light/fog counts, initiative state, the last dice rolls, and what the player window is showing. Prefer this over atlas_get_scene when you need to know what is going on.',
      inputSchema: obj({ maxTokens: num('how many tokens to list (default 100)') }),
      handler: (a) => {
        const { state, view } = atlas.readyStore();
        const grid = (state.grid as GridState | null) ?? null;
        const tokens = tokenList(state, grid).slice(0, a.maxTokens ?? 100);
        const walls = Object.values(state?.objects?.walls ?? {}) as any[];
        const lights = Object.values(state?.objects?.lights ?? {}) as any[];
        const doors = walls.filter((w) => w.type === 'door' || w.type === 'secret-door');
        const initiative = state.initiative ?? {};
        return {
          mapPath: state.mapPath,
          name: state.name ?? null,
          background: state.background ?? null,
          grid: summariseGrid(grid),
          camera: state.camera,
          tokens,
          tokenCount: Object.keys(state?.objects?.tokens ?? {}).length,
          walls: { total: walls.length, doors: doors.length, closedDoors: doors.filter((d) => d.closed !== false).length },
          lights: { total: lights.length, hidden: lights.filter((l) => l.hidden).length },
          fogOperations: Object.keys(state?.objects?.fog ?? {}).length,
          lighting: state.lighting,
          selection: state.selectedIds ?? [],
          initiative: {
            isActive: !!initiative.isActive,
            round: initiative.round ?? 0,
            currentIndex: initiative.currentIndex ?? -1,
            entries: (initiative.entries ?? []).map((e: any) => ({ id: e.id, name: e.name, initiative: e.initiative, active: !!e.isActive, isNPC: !!e.isNPC })),
            trackerOpen: !!state.initiativeTrackerOpen,
          },
          diceLog: (state.diceLog ?? []).slice(-5),
          playerWindowPresenting: atlas.presented(),
          history: atlas.historyDepth(),
          viewType: view.getViewType(),
        };
      },
    },
    {
      name: 'atlas_get_tokens',
      description: 'List tokens with their world centre (x,y) and grid cell. Pass ids to filter. This is the cheap way to resolve names to ids before moving or updating.',
      inputSchema: obj({ ids: { type: 'array', items: { type: 'string' }, description: 'optional token ids' } }),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const grid = (state.grid as GridState | null) ?? null;
        return { tokens: tokenList(state, grid, a.ids), grid: summariseGrid(grid) };
      },
    },
    {
      name: 'atlas_cell_to_world',
      description: 'Convert a grid cell to the world-pixel centre a token placed there gets. Handles square and hex grids exactly as Atlas does (odd-footprint tokens sit on the cell centre, even ones where cells meet). Returns the cell back too, for confirmation.',
      inputSchema: obj({ col: num('column (hex: axial q)'), row: num('row (hex: axial r)'), size: num('token size multiplier: 1=1 cell, 1.5=2, 2=3 (default 1)') }, ['col', 'row']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const grid = state.grid as GridState | null;
        if (!grid) throw new Error('This scene has no grid yet.');
        const point = cellToWorld({ col: a.col, row: a.row }, grid, a.size);
        return { ...placementResult(point, grid, a.size), grid: summariseGrid(grid) };
      },
    },
    {
      name: 'atlas_world_to_cell',
      description: 'Convert world pixels to the grid cell that contains them (for "which cell is that token on?"). Also returns the distance to the nearest cell centre.',
      inputSchema: obj({ x: num('world x'), y: num('world y'), size: num('token size multiplier (default 1)') }, ['x', 'y']),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const grid = state.grid as GridState | null;
        if (!grid) throw new Error('This scene has no grid yet.');
        const cell = worldToCell({ x: a.x, y: a.y }, grid, a.size);
        const centre = cellToWorld(cell, grid, a.size);
        return { cell: grid.type && grid.type !== 'square' ? { q: cell.col, r: cell.row } : cell, cellCentre: centre, grid: summariseGrid(grid) };
      },
    },
    {
      name: 'atlas_set_camera',
      description: 'Move/zoom the GM camera. x/y are world pixels of the view centre; `scale` is the zoom (1 = 100%). Only the fields you pass change.',
      write: true,
      needsScene: true,
      inputSchema: obj({ x: num('world x of the camera centre'), y: num('world y'), scale: num('zoom factor, 1 = 100%'), zoom: num('alias of scale') }),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const patch: Record<string, number> = {};
        for (const key of ['x', 'y'] as const) if (typeof a[key] === 'number') patch[key] = a[key];
        const scale = typeof a.scale === 'number' ? a.scale : a.zoom;
        if (typeof scale === 'number') {
          if (!(scale > 0.05 && scale < 20)) throw new Error('scale must be between 0.05 and 20');
          patch.scale = scale;
        }
        if (!Object.keys(patch).length) throw new Error('Pass at least one of x, y, scale.');
        atlas.actOn('setCamera', patch);
        const next = atlas.readyStore().state.camera;
        return { camera: next, before: state.camera };
      },
    },
    {
      name: 'atlas_set_grid',
      description: 'Patch the scene grid (size/offsetX/offsetY/type/visibility/units/lines). Omitted fields keep their value. Changing size or offsets moves nothing by itself — resnap tokens afterwards with atlas_move_token.',
      write: true,
      needsScene: true,
      inputSchema: obj({
        size: num('cell size in pixels (hex: flat-to-flat)'),
        offsetX: num('grid origin x in pixels'),
        offsetY: num('grid origin y in pixels'),
        type: enumOf(['square', 'hex-horizontal', 'hex-vertical'], 'grid type'),
        visible: bool('draw the grid'),
        snapToGrid: bool('snap tokens to cells on drop'),
        enabled: bool('grid enabled at all'),
        unitType: enumOf(['feet', 'yards', 'meters', 'units'], 'measurement unit'),
        unitDistance: num('game units per cell'),
        opacity: num('line opacity 0..1'),
        lineType: enumOf(['solid', 'dashed', 'dotted'], 'line style'),
        lineWidth: num('line width in pixels'),
      }),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const current = state.grid as GridState | null;
        if (!current) throw new Error('This scene has no grid to patch; create one with atlas_new_scene or Atlas itself.');
        const patch: Record<string, unknown> = {};
        for (const key of ['size', 'offsetX', 'offsetY', 'type', 'visible', 'snapToGrid', 'enabled', 'unitType', 'unitDistance', 'opacity', 'lineType', 'lineWidth'] as const) {
          if (a[key] !== undefined) patch[key] = a[key];
        }
        if (!Object.keys(patch).length) throw new Error('Pass at least one grid field to change.');
        if (typeof patch.size === 'number' && !(patch.size >= 5 && patch.size <= 5000)) throw new Error('size must be 5..5000 pixels');
        atlas.actOn('setGrid', { ...current, ...patch });
        return { before: summariseGrid(current), after: summariseGrid(atlas.readyStore().state.grid) };
      },
    },
    {
      name: 'atlas_set_background',
      description: 'Set (or clear with null) the scene background image. `path` is a vault image path; the file must already exist in the vault.',
      write: true,
      needsScene: true,
      inputSchema: obj({ path: str('vault image path, or null/empty to clear') }),
      handler: (a) => {
        const { state } = atlas.readyStore();
        const raw = a.path === null || a.path === '' ? null : String(a.path);
        if (raw && !ctx.app.vault.getAbstractFileByPath(raw)) throw new Error(`Image not found in the vault: ${raw}`);
        atlas.actOn('setBackground', raw);
        return { before: state.background ?? null, after: raw };
      },
    },
    {
      name: 'atlas_undo',
      description: 'Undo the last scene change. Every AI write is exactly one undo step, like a manual edit. Pass steps>1 to undo several. Returns whether anything was undone and how many steps remain.',
      write: true,
      needsScene: true,
      inputSchema: obj({ steps: num('how many steps to undo (default 1)') }),
      handler: (a) => {
        const steps = Math.max(1, Math.min(50, a.steps ?? 1));
        const results = [];
        for (let i = 0; i < steps; i++) results.push(atlas.undo());
        return { results, history: atlas.historyDepth() };
      },
    },
    {
      name: 'atlas_redo',
      description: 'Redo the last undone change (steps>1 for several).',
      write: true,
      needsScene: true,
      inputSchema: obj({ steps: num('how many steps to redo (default 1)') }),
      handler: (a) => {
        const steps = Math.max(1, Math.min(50, a.steps ?? 1));
        const results = [];
        for (let i = 0; i < steps; i++) results.push(atlas.redo());
        return { results, history: atlas.historyDepth() };
      },
    },
    {
      name: 'atlas_save',
      description: 'Force Atlas to write the scene to disk now instead of waiting for its debounce. Useful before a stream cut or after a burst of writes.',
      write: true,
      needsScene: true,
      inputSchema: obj({}),
      handler: async () => {
        const { state } = atlas.readyStore();
        await atlas.flush();
        return { saved: state.mapPath };
      },
    },
    {
      name: 'atlas_command',
      description: 'Run an Atlas Obsidian command by id (only atlas-vtt: ids). Useful ones: atlas-vtt:send-map-to-player-view, atlas-vtt:show-map-in-player-window, atlas-vtt:open-player-window, atlas-vtt:toggle-initiative-tracker, atlas-vtt:toggle-dice-log, atlas-vtt:make-selected-player-tokens, atlas-vtt:make-selected-gm-tokens. See atlas_probe.commands for the full list.',
      write: true,
      inputSchema: obj({ id: str('command id, must start with "atlas-vtt:"') }, ['id']),
      handler: (a) => {
        const id = requireString(a, 'id');
        if (!id.startsWith('atlas-vtt:')) throw new Error('Only atlas-vtt: commands are allowed.');
        return atlas.runCommand(id);
      },
    },
    {
      name: 'atlas_screenshot',
      description: 'Capture what is on screen, for a vision model or the stream overlay. target=window (whole Obsidian window), map (just the Atlas canvas), or player (the player window, if one is open). The PNG is returned as image content and, by default, also written into the vault (see savedTo). This is how you verify a change actually looks right.',
      write: true,
      inputSchema: obj({
        target: enumOf(['window', 'map', 'player'], 'what to capture (default window)'),
        maxWidth: num('longest side in pixels (default 1280)'),
        save: bool('also write a PNG into the vault (default true)'),
        savePath: str('explicit vault path for the PNG'),
      }),
      handler: async (a) => {
        const s = settings();
        const target = (a.target ?? 'window') as 'window' | 'map' | 'player';
        const save = a.save !== false;
        const path = a.savePath ?? (save ? `${s.screenshotDir}/${target}-${new Date().toISOString().replace(/[:.]/g, '-')}.png` : undefined);
        const shot = await captureScreenshot(ctx.app, { target, maxWidth: a.maxWidth ?? s.screenshotMaxWidth, savePath: path });
        return imageResult(shot, { showing: atlas.presented(), mapPath: (() => { try { return atlas.readyStore().state.mapPath; } catch { return null; } })() });
      },
    },
    {
      name: 'atlas_events',
      description: 'Poll recent semantic events (token_added/moved/removed/updated, fog_changed, door_toggled, initiative_changed, turn_changed, dice_rolled, scene_changed, camera_changed …). Pass the last seq you saw. For a push stream use GET /events (SSE) instead.',
      inputSchema: obj({ since: num('last seq seen (default 0)'), limit: num('max events (default 50)') }),
      handler: (a) => ({ events: bus.since(a.since ?? 0, Math.max(1, Math.min(500, a.limit ?? 50))), oldestSeq: bus.oldest() }),
    },
    {
      name: 'atlas_call_log',
      description: 'Audit trail: the most recent tool calls this bridge served (tool, ok, duration, error).',
      inputSchema: obj({ limit: num('how many (default 25)') }),
      handler: (a) => ({ calls: ctx.callLog().slice(-Math.max(1, Math.min(200, a.limit ?? 25))) }),
    },
    {
      name: 'atlas_apply',
      description: 'Escape hatch: call one allowlisted Atlas store action by name with positional arguments, for something no typed tool covers yet. Refused for actions that wipe a scene. Call atlas_probe.applyAllowlist first — and prefer a typed tool, since those validate input.',
      write: true,
      needsScene: true,
      inputSchema: obj({ action: str('store action name, e.g. "setGridVisible"'), args: { type: 'array', description: 'positional arguments for the action' } }, ['action']),
      handler: (a) => {
        const action = requireString(a, 'action');
        const allow = settings().applyAllowlist ?? [];
        if (BLOCKED_ACTIONS.has(action)) throw new Error(`"${action}" is blocked: it rewrites or wipes the scene in one call.`);
        if (!allow.includes(action)) throw new Error(`Action not allowlisted: ${action}. The operator can add it in the plugin settings.`);
        if (APPLY_DENY.test(action)) throw new Error(`Action name looks destructive and is refused: ${action}`);
        if (!atlas.has(action)) throw new Error(`Atlas has no action "${action}" (see atlas_probe.actions).`);
        return { action, result: sanitize(atlas.actOn(action, ...(Array.isArray(a.args) ? a.args : []))) };
      },
    },
  ];
}
