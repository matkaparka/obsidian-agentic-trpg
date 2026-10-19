/**
 * Tool-level tests: every tool is driven against a fake store whose shape and semantics mirror
 * live Atlas 0.8.0 (see docs/PROBE.md and test/fixtures/scene-snapshot.json). This is what keeps
 * the tools honest without opening Obsidian for every change.
 */
import { describe, expect, it } from 'vitest';
import { buildTools } from '../src/tools';
import type { ToolCtx, ToolDef } from '../src/tools';
import type { AtlasAdapter } from '../src/atlas/adapter';
import { EventBus } from '../src/events';
import { DEFAULT_SETTINGS, type Settings } from '../src/settings';

/** A store with the real Atlas action semantics the tools rely on. */
function fakeAtlas() {
  let counter = 0;
  const nextId = (prefix: string) => `${prefix}_${++counter}`;
  const state: any = {
    schema: 'atlas-vtt',
    version: 4,
    mapPath: 'scenes/test.atlasmap',
    mapLoaded: true,
    isMapLoading: false,
    name: 'Test',
    background: 'assets/battlemap.png',
    grid: { enabled: true, visible: true, snapToGrid: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5, unitType: 'feet', unitDistance: 5 },
    camera: { x: 0, y: 0, scale: 1 },
    lighting: { enabled: false, ambient: 0.1 },
    selectedIds: [],
    diceLog: [],
    initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
    initiativeTrackerOpen: false,
    objects: { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {} },
  };
  const undoStack: unknown[] = [];
  const redoStack: unknown[] = [];
  const calls: { action: string; args: unknown[] }[] = [];

  const actions: Record<string, (...args: any[]) => any> = {
    addToken: (data) => {
      const id = data.id ?? nextId('tok');
      state.objects.tokens[id] = { ...data, id, kind: data.kind ?? 'token' };
      return id;
    },
    addTokens: (list: any[]) => list.map((data) => actions.addToken(data)),
    moveToken: (id, x, y) => { const t = state.objects.tokens[id]; if (!t) throw new Error('no token'); t.x = x; t.y = y; },
    setTokenPositions: (positions: { id: string; x: number; y: number }[]) => { for (const p of positions) { const t = state.objects.tokens[p.id]; if (t) { t.x = p.x; t.y = p.y; } } },
    updateToken: (id, updates) => { const t = state.objects.tokens[id]; if (!t) throw new Error('no token'); Object.assign(t, updates); },
    updateTokens: (entries: { id: string; changes: any }[]) => { for (const e of entries) { const t = state.objects.tokens[e.id]; if (t) Object.assign(t, e.changes); } },
    deleteToken: (id) => { delete state.objects.tokens[id]; },
    deleteTokens: (ids: string[]) => { for (const id of ids) delete state.objects.tokens[id]; },
    setTokenRing: (id, color) => { const t = state.objects.tokens[id]; if (t) t.ringColor = color ?? undefined; },
    setTokensCondition: (ids: string[], conditionId: string, active: boolean) => {
      for (const id of ids) {
        const t = state.objects.tokens[id];
        if (!t) continue;
        const set = new Set<string>(t.conditions ?? []);
        active ? set.add(conditionId) : set.delete(conditionId);
        t.conditions = [...set];
      }
    },
    changeTokensConditionValue: (ids: string[], conditionId: string, delta: number) => {
      for (const id of ids) {
        const t = state.objects.tokens[id];
        if (!t) continue;
        t.conditionValues = { ...(t.conditionValues ?? {}), [conditionId]: ((t.conditionValues?.[conditionId] ?? 1) + delta) };
      }
    },
    clearTokenConditions: (id: string) => { const t = state.objects.tokens[id]; if (t) { t.conditions = []; t.conditionValues = {}; } },
    setSelection: (ids: string[]) => { state.selectedIds = ids; },
    clearSelection: () => { state.selectedIds = []; },
    addFogOperation: (op) => { const id = nextId('fog'); state.objects.fog[id] = { ...op, id, kind: 'fog', timestamp: 1 }; return id; },
    deleteFogOperations: (ids: string[]) => { for (const id of ids) delete state.objects.fog[id]; },
    addWall: (wall) => { const id = nextId('wall'); state.objects.walls[id] = { ...wall, id, kind: 'wall', closed: wall.closed ?? true }; return id; },
    updateWall: (id, changes) => { const w = state.objects.walls[id]; if (!w) throw new Error('no wall'); Object.assign(w, changes); },
    deleteWall: (id) => { delete state.objects.walls[id]; },
    deleteWalls: (ids: string[]) => { for (const id of ids) delete state.objects.walls[id]; },
    toggleDoor: (id) => { const w = state.objects.walls[id]; if (w) w.closed = w.closed === false; },
    setDoorLocked: (id, locked) => { const w = state.objects.walls[id]; if (w) w.locked = locked; },
    addLight: (light) => { const id = nextId('light'); state.objects.lights[id] = { ...light, id, kind: 'light' }; return id; },
    updateLight: (id, changes) => { const l = state.objects.lights[id]; if (!l) throw new Error('no light'); Object.assign(l, changes); },
    deleteLight: (id) => { delete state.objects.lights[id]; },
    addLightZone: (zone) => { const id = nextId('zone'); state.objects.lightZones = state.objects.lightZones ?? {}; state.objects.lightZones[id] = { ...zone, id, kind: 'light-zone' }; return id; },
    updateLightZone: (id, changes) => { Object.assign(state.objects.lightZones[id], changes); },
    deleteLightZone: (id) => { delete state.objects.lightZones[id]; },
    setSceneLighting: (changes) => { state.lighting = { ...state.lighting, ...changes }; },
    addText: (data) => { const id = nextId('text'); state.objects.texts[id] = { ...data, id, kind: 'text' }; return id; },
    updateText: (id, changes) => { Object.assign(state.objects.texts[id], changes); },
    deleteText: (id) => { delete state.objects.texts[id]; },
    addNotePin: (x, y, notePath, icon, options) => { const id = nextId('pin'); state.objects.pins[id] = { id, kind: 'pin', x, y, notePath, icon, ...options }; return id; },
    updateNotePin: (id, changes) => { Object.assign(state.objects.pins[id], changes); },
    deleteNotePin: (id) => { delete state.objects.pins[id]; },
    addToInitiative: (entry) => { const id = nextId('entry'); state.initiative.entries.push({ ...entry, id, order: state.initiative.entries.length, isActive: false }); return id; },
    removeFromInitiative: (id) => { state.initiative.entries = state.initiative.entries.filter((e: any) => e.id !== id); },
    updateInitiativeEntry: (id, changes) => { const e = state.initiative.entries.find((x: any) => x.id === id); if (e) Object.assign(e, changes); },
    rollAllInitiative: () => { for (const e of state.initiative.entries) e.initiative = 10 + (e.initiativeModifier ?? 0); },
    rollEntryInitiative: (id) => { const e = state.initiative.entries.find((x: any) => x.id === id); if (e) e.initiative = 15; },
    nextTurn: () => {
      const i = state.initiative;
      if (!i.entries.length) return;
      i.currentIndex += 1;
      if (i.currentIndex >= i.entries.length) { i.currentIndex = 0; i.round += 1; }
      i.entries.forEach((e: any, index: number) => { e.isActive = index === i.currentIndex; });
    },
    previousTurn: () => { state.initiative.currentIndex = Math.max(0, state.initiative.currentIndex - 1); },
    startCombat: () => { state.initiative.isActive = true; state.initiative.round = 1; },
    endCombat: () => { state.initiative.isActive = false; },
    resetInitiative: () => { state.initiative = { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } }; },
    setInitiativeConfig: (config) => { state.initiative.config = { ...state.initiative.config, ...config }; },
    setInitiativeSitsOut: (id, sitsOut) => { const e = state.initiative.entries.find((x: any) => x.id === id); if (e) e.sitsOut = sitsOut; },
    setInitiativeTrackerOpen: (open) => { state.initiativeTrackerOpen = open; },
    addDiceLogEntry: (entry) => { state.diceLog = [...state.diceLog, entry].slice(-20); },
    clearDiceLog: () => { state.diceLog = []; },
    setCamera: (patch) => { state.camera = { ...state.camera, ...patch }; },
    setGrid: (grid) => { state.grid = grid; },
    setBackground: (bg) => { state.background = bg; },
    setGridVisible: (visible) => { state.grid = { ...state.grid, visible }; },
    setSnapToGrid: (snap) => { state.grid = { ...state.grid, snapToGrid: snap }; },
    clearFog: () => { state.objects.fog = {}; },
    clearMapState: () => { state.objects = { tokens: {}, fog: {}, pins: {}, texts: {}, drawings: {}, walls: {}, lights: {} }; },
  };

  const handle = (name: string, args: unknown[]) => {
    calls.push({ action: name, args });
    const fn = actions[name];
    if (!fn) throw new Error(`fake atlas has no action ${name}`);
    return fn(...args);
  };

  const adapter = {
    readyStore: () => ({ view: { getViewType: () => 'atlas-vtt' }, store: {}, state }),
    state: () => state,
    actOn: (name: string, ...args: unknown[]) => handle(name, args),
    act: (name: string, ...args: unknown[]) => handle(name, args),
    has: (name: string) => !!actions[name],
    actionNames: () => Object.keys(actions).sort(),
    historyDepth: () => ({ undo: undoStack.length, redo: redoStack.length }),
    undo: () => ({ undone: false, remaining: 0 }),
    redo: () => ({ redone: false, remaining: 0 }),
    presented: () => null,
    listCommands: () => ['atlas-vtt:send-map-to-player-view'],
    listScenes: () => ['scenes/test.atlasmap'],
    capabilities: () => ({ installed: true, version: '0.8.0', tested: true, missingActions: [], actionCount: Object.keys(actions).length }),
    flush: async () => undefined,
  };

  return { adapter: adapter as unknown as AtlasAdapter, state, calls, actions };
}

function makeCtx(overrides: Partial<Settings> = {}) {
  const { adapter, state, calls } = fakeAtlas();
  const settings: Settings = { ...DEFAULT_SETTINGS, allowWrite: true, ...overrides };
  const bus = new EventBus();
  const ctx = {
    app: { vault: { getAbstractFileByPath: () => ({ path: 'x' }) } },
    atlas: adapter,
    bus,
    settings: () => settings,
    callLog: () => [],
  } as unknown as ToolCtx;
  const tools = buildTools(ctx);
  const tool = (name: string): ToolDef => {
    const found = tools.find((t) => t.name === name);
    if (!found) throw new Error(`no tool ${name}`);
    return found;
  };
  const call = (name: string, args: any = {}) => tool(name).handler(args);
  return { ctx, tools, tool, call, state, calls, settings, bus };
}

describe('tool registry', () => {
  it('exposes the documented tool set with unique names and mark tools that write', () => {
    const { tools } = makeCtx();
    const names = tools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
    for (const required of [
      'atlas_probe', 'atlas_list_scenes', 'atlas_get_scene', 'atlas_scene_summary', 'atlas_events', 'atlas_call_log',
      'atlas_screenshot', 'atlas_cell_to_world', 'atlas_world_to_cell',
      'atlas_open_scene', 'atlas_add_token', 'atlas_move_token', 'atlas_update_token', 'atlas_remove_token',
      'atlas_set_condition', 'atlas_fog', 'atlas_toggle_door', 'atlas_initiative', 'atlas_roll_dice',
      'atlas_set_camera', 'atlas_command', 'atlas_undo', 'atlas_apply',
      'atlas_add_wall', 'atlas_update_wall', 'atlas_remove_wall', 'atlas_add_light', 'atlas_update_light',
      'atlas_remove_light', 'atlas_set_lighting', 'atlas_stack_tokens', 'atlas_select_tokens',
    ]) {
      expect(names, `missing ${required}`).toContain(required);
    }
    expect(tools.find((t) => t.name === 'atlas_add_token')?.write).toBe(true);
    expect(tools.find((t) => t.name === 'atlas_probe')?.write).toBeUndefined();
    expect(tools.find((t) => t.name === 'atlas_roll_dice')?.write).toBe(true);
  });
});

describe('tokens', () => {
  it('adds a token on a cell using Atlas grid maths', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_add_token', { imagePath: 'assets/goblin.png', cell: { col: 2, row: 3 }, name: 'Goblin' });
    expect(result.id).toBeTruthy();
    expect(result.x).toBe(175);
    expect(result.y).toBe(245);
    expect(result.cell).toEqual({ col: 2, row: 3 });
    expect(state.objects.tokens[result.id].name).toBe('Goblin');
    expect(state.objects.tokens[result.id].size).toBe(1);
  });

  it('places a 2-cell token where cells meet', () => {
    const { call } = makeCtx();
    const result: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 2, row: 3 }, size: 1.5 });
    expect(result.x).toBe(210);
    expect(result.y).toBe(280);
    expect(result.cell).toEqual({ col: 2, row: 3 });
  });

  it('adds several tokens in one call', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_add_tokens', {
      tokens: [{ imagePath: 'a.png', cell: { col: 0, row: 0 } }, { imagePath: 'b.png', cell: { col: 1, row: 0 }, name: 'Two' }],
    });
    expect(result.ids).toHaveLength(2);
    expect(Object.keys(state.objects.tokens)).toHaveLength(2);
  });

  it('moves a token to a cell and reports the distance', () => {
    const { call } = makeCtx();
    const added: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 } });
    const moved: any = call('atlas_move_token', { id: added.id, cell: { col: 3, row: 4 } });
    expect(moved.to).toEqual({ x: 245, y: 315 });
    expect(moved.cells.to).toEqual({ col: 3, row: 4 });
    expect(moved.distanceCells).toBe(4);
  });

  it('refuses a position that was not given', () => {
    const { call } = makeCtx();
    const added: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 } });
    expect(() => call('atlas_move_token', { id: added.id })).toThrow(/position/i);
  });

  it('rejects unknown update fields instead of silently ignoring them', () => {
    const { call } = makeCtx();
    const added: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 } });
    expect(() => call('atlas_update_token', { id: added.id, updates: { hitPoints: 5 } })).toThrow(/Unknown token field/);
    const ok: any = call('atlas_update_token', { id: added.id, updates: { isHidden: true, size: 2 } });
    expect(ok.changed.sort()).toEqual(['isHidden', 'size']);
  });

  it('applies and clears conditions', () => {
    const { call, state } = makeCtx();
    const added: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 } });
    call('atlas_set_condition', { ids: [added.id], conditionId: 'prone', active: true });
    expect(state.objects.tokens[added.id].conditions).toEqual(['prone']);
    call('atlas_set_condition', { ids: [added.id], conditionId: 'prone', active: false });
    expect(state.objects.tokens[added.id].conditions).toEqual([]);
  });

  it('stacks tokens by layer', () => {
    const { call, state } = makeCtx();
    const a: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 } });
    const b: any = call('atlas_add_token', { imagePath: 'b.png', cell: { col: 0, row: 0 } });
    call('atlas_stack_tokens', { ids: [a.id], direction: 'top' });
    expect(state.objects.tokens[a.id].layer).toBeGreaterThan(state.objects.tokens[b.id].layer ?? 0);
  });
});

describe('fog', () => {
  it('reveals a block of cells as one fog operation', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_fog', { action: 'reveal', cell: { col: 1, row: 1 }, width: 2, height: 2 });
    expect(result.count).toEqual({ before: 0, after: 1 });
    const op = state.objects.fog[result.id];
    expect(op.type).toBe('rectangle');
    expect(op.isErasing).toBe(true);
    // cells (1,1)..(3,3) => x from 70 to 280, y from 70 to 280
    expect(op).toMatchObject({ x: 70, y: 70, width: 210, height: 210 });
  });

  it('hides by painting, and lists what exists', () => {
    const { call, state } = makeCtx();
    call('atlas_fog', { action: 'hide', x: 0, y: 0, width: 140, height: 140 });
    const list: any = call('atlas_fog', { action: 'list' });
    expect(list.count).toBe(1);
    expect(list.operations[0].erasing).toBe(false);
    const id = list.operations[0].id;
    call('atlas_fog', { action: 'delete', ids: [id] });
    expect(Object.keys(state.objects.fog)).toHaveLength(0);
  });
});

describe('walls and doors', () => {
  it('adds a door from cells, then toggles and locks it', () => {
    const { call, state } = makeCtx();
    const wall: any = call('atlas_add_wall', { type: 'door', p1: { col: 0, row: 0 }, p2: { col: 1, row: 0 } });
    expect(state.objects.walls[wall.id].p1).toEqual({ x: 35, y: 35 });
    const toggled: any = call('atlas_toggle_door', { id: wall.id });
    expect(toggled.closed).toBe(false);
    call('atlas_set_door_locked', { id: wall.id, locked: true });
    expect(state.objects.walls[wall.id].locked).toBe(true);
    expect(() => call('atlas_toggle_door', { id: wall.id })).toThrow(/locked/);
  });

  it('refuses to toggle a solid wall', () => {
    const { call } = makeCtx();
    const wall: any = call('atlas_add_wall', { type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } });
    expect(() => call('atlas_toggle_door', { id: wall.id })).toThrow(/not a door/);
  });

  it('builds a chain of walls', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_add_wall_chain', { points: [{ col: 0, row: 0 }, { col: 2, row: 0 }, { col: 2, row: 2 }], type: 'solid' });
    expect(result.segments).toBe(2);
    expect(Object.keys(state.objects.walls)).toHaveLength(2);
  });
});

describe('lights and lighting', () => {
  it('adds a light on a cell and updates it', () => {
    const { call, state } = makeCtx();
    const light: any = call('atlas_add_light', { cell: { col: 2, row: 2 }, emission: { bright: 20, dim: 40, animation: 'torch' } });
    expect(state.objects.lights[light.id].x).toBe(175);
    const updated: any = call('atlas_update_light', { id: light.id, emission: { bright: 30 } });
    expect(updated.light.emission.bright).toBe(30);
    expect(updated.light.emission.dim).toBe(40);
    expect(updated.light.emission.animation).toBe('torch');
  });

  it('rejects a light whose bright radius exceeds its dim radius', () => {
    const { call } = makeCtx();
    expect(() => call('atlas_add_light', { x: 0, y: 0, emission: { bright: 40, dim: 20 } })).toThrow(/bright/);
  });

  it('sets scene lighting and says it is not undoable', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_set_lighting', { enabled: true, ambient: 0.35 });
    expect(state.lighting).toMatchObject({ enabled: true, ambient: 0.35 });
    expect(result.undoable).toBe(false);
    expect(() => call('atlas_set_lighting', { ambient: 5 })).toThrow(/0\.\.1/);
  });
});

describe('initiative and dice', () => {
  it('adds entries for tokens, starts combat and advances turns', () => {
    const { call, state } = makeCtx();
    const a: any = call('atlas_add_token', { imagePath: 'a.png', cell: { col: 0, row: 0 }, name: 'Aria' });
    const b: any = call('atlas_add_token', { imagePath: 'b.png', cell: { col: 1, row: 0 }, name: 'Goblin' });
    const added: any = call('atlas_initiative', { action: 'add_tokens', ids: [a.id, b.id] });
    expect(added.ids).toHaveLength(2);
    call('atlas_initiative', { action: 'start' });
    expect(state.initiative.isActive).toBe(true);
    const next: any = call('atlas_initiative', { action: 'next' });
    expect(next.index).toBe(0);
    expect(next.active.name).toBe('Aria');
  });

  it('rolls dice in code and writes the real DiceRollResult shape into the log', () => {
    const { call, state } = makeCtx();
    const result: any = call('atlas_roll_dice', { formula: '2d20kh1+3', label: 'Scimitar' });
    expect(result.logged).toBe(true);
    expect(result.dice).toHaveLength(2);
    const entry = state.diceLog[0];
    expect(entry.formula).toBe('2d20kh1+3');
    expect(entry.total).toBe(result.total);
    expect(entry.rolls).toHaveLength(2);
    expect(typeof entry.id).toBe('string');
    expect(entry.timestamp).toBeGreaterThan(0);
    expect(entry.modifiers).toBe(3);
    expect(entry.source.abilityName).toBe('Scimitar');
  });

  it('never invents a roll for a bad formula', () => {
    const { call, state } = makeCtx();
    expect(() => call('atlas_roll_dice', { formula: 'roll a 20' })).toThrow();
    expect(state.diceLog).toHaveLength(0);
  });
});

describe('safety rails', () => {
  it('refuses destructive actions through atlas_apply even when allowlisted', () => {
    const { call, settings } = makeCtx();
    settings.applyAllowlist = [...settings.applyAllowlist, 'clearMapState', 'setTokens'];
    expect(() => call('atlas_apply', { action: 'clearMapState' })).toThrow(/blocked/);
    expect(() => call('atlas_apply', { action: 'setTokens' })).toThrow(/blocked/);
  });

  it('refuses actions outside the allowlist', () => {
    const { call, settings } = makeCtx();
    settings.applyAllowlist = ['setGridVisible'];
    expect(() => call('atlas_apply', { action: 'setBackground', args: [null] })).toThrow(/allowlist/i);
    const ok: any = call('atlas_apply', { action: 'setGridVisible', args: [false] });
    expect(ok.action).toBe('setGridVisible');
  });

  it('only runs atlas-vtt: commands', () => {
    const { call } = makeCtx();
    expect(() => call('atlas_command', { id: 'workspace:close' })).toThrow(/atlas-vtt:/);
  });

  it('reports writes as disabled in probe output', () => {
    const { call } = makeCtx({ allowWrite: false });
    const probe: any = call('atlas_probe');
    expect(probe.writes).toMatch(/read-only/);
  });
});

describe('scene read tools', () => {
  it('summarises the scene with tokens, cells and counters', () => {
    const { call } = makeCtx();
    call('atlas_add_token', { imagePath: 'a.png', cell: { col: 2, row: 3 }, name: 'Aria' });
    const summary: any = call('atlas_scene_summary', {});
    expect(summary.mapPath).toBe('scenes/test.atlasmap');
    expect(summary.tokenCount).toBe(1);
    expect(summary.tokens[0].cell).toEqual({ col: 2, row: 3 });
    expect(summary.grid.size).toBe(70);
    expect(summary.initiative.isActive).toBe(false);
  });

  it('converts cells to pixels and back', () => {
    const { call } = makeCtx();
    const world: any = call('atlas_cell_to_world', { col: 1, row: 1 });
    expect(world).toMatchObject({ x: 105, y: 105 });
    const cell: any = call('atlas_world_to_cell', { x: 109, y: 111 });
    expect(cell.cell).toEqual({ col: 1, row: 1 });
  });
});
