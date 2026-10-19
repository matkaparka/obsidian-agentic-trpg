/**
 * Fixture test: the snapshot in test/fixtures/scene-snapshot.json was captured from a live
 * Atlas VTT 0.8.0 store (3 tokens, a wall run and a door, a torch, initiative and a dice roll).
 * Everything here asserts against that real data, not against made-up shapes.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { cellToWorld, cellsBetween, summariseGrid, worldToCell, type GridState } from '../src/atlas/grid';
import { deriveEvents, summariseToken } from '../src/events';

const fixture = JSON.parse(readFileSync(fileURLToPath(new URL('./fixtures/scene-snapshot.json', import.meta.url)), 'utf8'));
const state = fixture.state;
const grid = state.grid as GridState;
const tokens: any[] = Object.values(state.objects.tokens);
const walls: any[] = Object.values(state.objects.walls);

describe('the captured snapshot is a real Atlas scene', () => {
  it('was taken from Atlas 0.8.0 with schema version 4', () => {
    expect(fixture.atlasVersion).toBe('0.8.0');
    expect(state.schema).toBe('atlas-vtt');
    expect(state.version).toBe(4);
    expect(state.mapPath).toBe('scenes/e2e.atlasmap');
  });

  it('holds the objects the end-to-end run created', () => {
    expect(tokens).toHaveLength(3);
    expect(walls).toHaveLength(2);
    expect(Object.values(state.objects.lights)).toHaveLength(1);
    expect(state.initiative.entries).toHaveLength(3);
    expect(state.diceLog).toHaveLength(1);
  });

  it('has the grid shape Atlas writes for a new scene', () => {
    expect(summariseGrid(grid)).toMatchObject({
      type: 'square', size: 70, offsetX: 0, offsetY: 0, enabled: true, visible: true, snapToGrid: true,
    });
  });
});

describe('grid maths against real token positions', () => {
  it('round-trips every token between pixels and its cell', () => {
    for (const token of tokens) {
      const cell = worldToCell(token, grid, token.size);
      const back = cellToWorld(cell, grid, token.size);
      expect(back.x, `${token.name} x`).toBeCloseTo(token.x, 6);
      expect(back.y, `${token.name} y`).toBeCloseTo(token.y, 6);
    }
  });

  it('reads the cells the run actually placed tokens on', () => {
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(worldToCell(byName['Grik the Goblin'], grid, 1)).toEqual({ col: 12, row: 10 });
    expect(worldToCell(byName['Dire Wolf'], grid, 1.5)).toEqual({ col: 4, row: 4 });
    expect(worldToCell(byName['Aria'], grid, 1)).toEqual({ col: 8, row: 6 });
  });

  it('measures the distance between the real tokens', () => {
    const byName = Object.fromEntries(tokens.map((t) => [t.name, t]));
    expect(cellsBetween(byName['Grik the Goblin'], byName['Aria'], grid)).toBe(4);
    // Measured as points, the 2-cell wolf's centre lies on a cell corner (row 5), not on its
    // footprint's first cell — Atlas measures ruler paths from the footprint's cells.
    expect(cellsBetween(byName['Aria'], byName['Dire Wolf'], grid)).toBe(3);
    const ariaCell = worldToCell(byName['Aria'], grid, 1);
    const wolfCell = worldToCell(byName['Dire Wolf'], grid, byName['Dire Wolf'].size);
    expect(Math.max(Math.abs(ariaCell.col - wolfCell.col), Math.abs(ariaCell.row - wolfCell.row))).toBe(4);
  });

  it('knows the 2-cell wolf sits where cells meet, not on a cell centre', () => {
    const wolf = tokens.find((t) => t.size === 1.5)!;
    // footprint 2 cells => centre is offset by half a cell from the cell centre
    expect(wolf.x % 70).toBe(0);
    expect(cellToWorld({ col: 4, row: 4 }, grid, 1.5)).toEqual({ x: wolf.x, y: wolf.y });
  });
});

describe('events derived from the real snapshot', () => {
  /**
   * A clone that keeps every entity by reference, the way an immer write does: only the entities
   * a write replaces get a new object, which is exactly what the event diff relies on.
   */
  const clone = () => ({
    ...state,
    grid: { ...state.grid },
    camera: { ...state.camera },
    lighting: { ...state.lighting },
    selectedIds: [...state.selectedIds],
    diceLog: [...state.diceLog],
    initiative: { ...state.initiative, entries: [...state.initiative.entries] },
    objects: {
      ...state.objects,
      tokens: { ...state.objects.tokens },
      walls: { ...state.objects.walls },
      lights: { ...state.objects.lights },
      fog: { ...state.objects.fog },
      pins: { ...state.objects.pins },
      texts: { ...state.objects.texts },
      drawings: { ...state.objects.drawings },
    },
  });

  it('sees nothing when nothing changed', () => {
    expect(deriveEvents(state, clone())).toEqual([]);
  });

  it('reports the real door opening', () => {
    const next = clone();
    const door = walls.find((w) => w.type === 'door');
    next.objects.walls[door.id] = { ...next.objects.walls[door.id], closed: true };
    const events = deriveEvents(state, next);
    const toggle = events.find((e) => e.type === 'door_toggled') as any;
    expect(toggle).toMatchObject({ id: door.id, doorType: 'door', closed: true });
    expect(toggle.wasClosed).toBe(false);
  });

  it('reports a real token moving, with the cells implied by the pixels', () => {
    const next = clone();
    const goblin = tokens.find((t) => t.name === 'Grik the Goblin')!;
    next.objects.tokens[goblin.id] = { ...next.objects.tokens[goblin.id], x: 175, y: 245 };
    const events = deriveEvents(state, next);
    const moved = events.find((e) => e.type === 'token_moved') as any;
    expect(moved).toMatchObject({ id: goblin.id, from: { x: goblin.x, y: goblin.y }, to: { x: 175, y: 245 } });
    expect(worldToCell({ x: moved.to.x, y: moved.to.y }, grid, 1)).toEqual({ col: 2, row: 3 });
  });

  it('reports the condition the run applied to the wolf', () => {
    const wolf = tokens.find((t) => t.name === 'Dire Wolf')!;
    expect(wolf.conditions).toContain('prone');
    const next = clone();
    next.objects.tokens[wolf.id] = { ...next.objects.tokens[wolf.id], conditions: [] };
    const events = deriveEvents(state, next);
    const updated = events.find((e) => e.type === 'token_updated') as any;
    expect(updated).toMatchObject({ id: wolf.id, changed: ['conditions'] });
    expect(updated.conditions.after).toEqual([]);
  });

  it('describes the real dice log entry consistently', () => {
    const entry = state.diceLog[0];
    const kept = entry.rolls.filter((d: any) => !d.dropped).reduce((sum: number, d: any) => sum + d.value, 0);
    expect(kept + entry.modifiers).toBe(entry.total);
    expect(entry.formula).toBe('2d20kh1+5');
    expect(entry.source.abilityName).toBe('Grik attacks Aria');
    expect(entry.rolls.filter((d: any) => d.dropped)).toHaveLength(1);
  });

  it('reads the real initiative order', () => {
    const values = state.initiative.entries.map((e: any) => e.initiative);
    expect(values).toEqual([...values].sort((a: number, b: number) => b - a));
    expect(state.initiative.round).toBeGreaterThanOrEqual(1);
  });

  it('summarises the real tokens for a narrator', () => {
    const wolf = tokens.find((t) => t.name === 'Dire Wolf')!;
    expect(summariseToken(wolf)).toMatchObject({ name: 'Dire Wolf', size: 1.5, conditions: ['prone'], hidden: false });
  });
});
