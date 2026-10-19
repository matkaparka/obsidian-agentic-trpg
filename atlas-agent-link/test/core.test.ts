import { describe, expect, it } from 'vitest';
import { EventBus, deriveEvents, summariseToken } from '../src/events';
import { getPath, localId, rollFormula, sanitize } from '../src/util';
import { validateLight, validateWall } from '../src/atlas/shapes';

describe('sanitize', () => {
  it('drops functions, breaks cycles and bounds depth', () => {
    const cyclic: any = { a: 1, fn() { return 1; }, nested: { deep: { deeper: { deepest: 1 } } } };
    cyclic.self = cyclic;
    const out: any = sanitize(cyclic, 2, 10);
    expect(out.a).toBe(1);
    expect(out.fn).toBeUndefined();
    expect(out.self).toBe('[circular]');
    expect(out.nested.deep).toBe('[object]');
  });

  it('caps long arrays but says how much was cut', () => {
    const out: any = sanitize({ list: [1, 2, 3, 4, 5] }, 5, 2);
    expect(out.list).toEqual([1, 2, '[+3 more]']);
  });
});

describe('getPath', () => {
  it('walks dot paths and tolerates misses', () => {
    const state = { objects: { tokens: { t1: { id: 't1' } } } };
    expect(getPath(state, 'objects.tokens.t1.id')).toBe('t1');
    expect(getPath(state, 'objects.walls.nope')).toBeUndefined();
    expect(getPath(state, '')).toBe(state);
  });
});

describe('rollFormula', () => {
  it('rolls dice in code and keeps only what the formula keeps', () => {
    const outcome = rollFormula('2d20kh1+5', () => 0.5);
    // 0.5 on a d20 is 11 twice; keep the highest of two 11s.
    expect(outcome.dice.map((d) => d.value)).toEqual([11, 11]);
    expect(outcome.dice[1].dropped).toBe(true);
    expect(outcome.modifiers).toBe(5);
    expect(outcome.total).toBe(16);
  });

  it('subtracts negative terms', () => {
    const outcome = rollFormula('1d20-1d4', () => 0.5);
    expect(outcome.total).toBe(11 - 3);
    expect(outcome.dice.some((d) => d.negative)).toBe(true);
  });

  it('refuses nonsense instead of guessing', () => {
    expect(() => rollFormula('d20 adv')).toThrow();
    expect(() => rollFormula('2d6+')).toThrow();
    expect(() => rollFormula('0d6')).toThrow();
    expect(() => rollFormula('1d99999')).toThrow();
    expect(() => rollFormula('')).toThrow();
  });
});

describe('EventBus', () => {
  it('numbers events, replays since a seq and keeps the buffer bounded', () => {
    const bus = new EventBus(3);
    bus.emit('a');
    const second = bus.emit('b', { id: 'x' });
    expect(second.seq).toBe(2);
    expect(bus.since(1).map((e) => e.type)).toEqual(['b']);
    bus.emit('c');
    bus.emit('d');
    expect(bus.size()).toBe(3);
    expect(bus.since(0).map((e) => e.type)).toEqual(['b', 'c', 'd']);
  });
});

const baseState = (): any => ({
  mapPath: 'scenes/test.atlasmap',
  background: 'assets/map.png',
  grid: { enabled: true, type: 'square', size: 70, offsetX: 0, offsetY: 0, opacity: 0.5 },
  camera: { x: 0, y: 0, scale: 1 },
  lighting: { enabled: false, ambient: 0.1 },
  selectedIds: [],
  diceLog: [],
  initiative: { entries: [], currentIndex: -1, round: 0, isActive: false, config: { autoSort: true } },
  initiativeTrackerOpen: false,
  objects: {
    tokens: { t1: { id: 't1', kind: 'character', name: 'Goblin', imagePath: 'a.png', x: 35, y: 35, size: 1, conditions: [] } },
    fog: {},
    pins: {},
    texts: {},
    drawings: {},
    walls: { w1: { id: 'w1', kind: 'wall', type: 'door', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 }, closed: true } },
    lights: {},
  },
});

describe('deriveEvents', () => {
  it('reports a token move with before and after', () => {
    const prev = baseState();
    const next = baseState();
    next.objects.tokens.t1 = { ...next.objects.tokens.t1, x: 175, y: 245 };
    const events = deriveEvents(prev, next);
    expect(events).toContainEqual({ type: 'token_moved', id: 't1', name: 'Goblin', from: { x: 35, y: 35 }, to: { x: 175, y: 245 } });
  });

  it('reports token add/remove/update and conditions', () => {
    const prev = baseState();
    const next = baseState();
    (next.objects.tokens as any).t2 = { id: 't2', kind: 'token', imagePath: 'b.png', x: 105, y: 105, size: 1 };
    next.objects.tokens.t1 = { ...next.objects.tokens.t1, conditions: ['prone'] };
    const added = deriveEvents(prev, next);
    expect(added.some((e) => e.type === 'token_added' && (e as any).id === 't2')).toBe(true);
    const updated = added.find((e) => e.type === 'token_updated') as any;
    expect(updated.id).toBe('t1');
    expect(updated.changed).toEqual(['conditions']);
    expect(updated.conditions).toEqual({ before: [], after: ['prone'] });

    const removed = deriveEvents(next, prev);
    expect(removed.some((e) => e.type === 'token_removed' && (e as any).id === 't2')).toBe(true);
  });

  it('turns a door change into door_toggled, not wall_updated', () => {
    const prev = baseState();
    const next = baseState();
    next.objects.walls.w1 = { ...next.objects.walls.w1, closed: false };
    const events = deriveEvents(prev, next);
    expect(events).toContainEqual({ type: 'door_toggled', id: 'w1', doorType: 'door', closed: false, locked: false, wasClosed: true });
    expect(events.some((e) => e.type === 'wall_updated')).toBe(false);
  });

  it('summarises fog changes as one event', () => {
    const prev = baseState();
    const next = baseState();
    (next.objects.fog as any).f1 = { id: 'f1', kind: 'fog', type: 'rectangle', isErasing: true, timestamp: 1 };
    const events = deriveEvents(prev, next);
    const fog = events.find((e) => e.type === 'fog_changed') as any;
    expect(fog.added).toBe(1);
    expect(fog.erasing).toBe(true);
    expect(fog.totalAfter).toBe(1);
  });

  it('reports turns, combat state and dice rolls', () => {
    const prev = baseState();
    const next = baseState();
    const entry = { id: 'e1', tokenId: 't1', name: 'Goblin', initiative: 14, initiativeModifier: 2, imagePath: 'a.png', isActive: true, isNPC: true, order: 0 };
    next.initiative = { entries: [entry], currentIndex: 0, round: 1, isActive: true, config: { autoSort: true } };
    next.diceLog = [{ id: 'r1', timestamp: 1, formula: '1d20+2', rolls: [{ die: 'd20', value: 12, max: 20 }], modifiers: 2, total: 14 }];
    const events = deriveEvents(prev, next);
    expect(events.some((e) => e.type === 'combat_started')).toBe(true);
    expect(events.some((e) => e.type === 'initiative_entry_added')).toBe(true);
    const turn = events.find((e) => e.type === 'turn_changed') as any;
    expect(turn).toMatchObject({ round: 1, index: 0, name: 'Goblin', initiative: 14 });
    const dice = events.find((e) => e.type === 'dice_rolled') as any;
    expect(dice).toMatchObject({ formula: '1d20+2', total: 14 });
  });

  it('falls back to state_changed for anything it does not model', () => {
    const prev = baseState() as any;
    const next = baseState() as any;
    next.isDiceTrayOpen = true;
    const events = deriveEvents(prev, next);
    expect(events).toContainEqual({ type: 'state_changed', key: 'isDiceTrayOpen', value: true });
  });

  it('never throws on junk', () => {
    expect(deriveEvents(null, undefined)).toEqual([]);
    expect(deriveEvents({}, {})).toEqual([]);
  });
});

describe('summaries', () => {
  it('describes a token the way a narrator needs it', () => {
    expect(summariseToken({ id: 't1', kind: 'character', name: 'Goblin', imagePath: 'a.png', x: 35.456, y: 35, size: 1.5, isHidden: true }))
      .toEqual({ id: 't1', kind: 'character', name: 'Goblin', imagePath: 'a.png', x: 35.46, y: 35, size: 1.5, layer: 0, hidden: true, conditions: [] });
  });

  it('makes ids that do not collide within a session', () => {
    const ids = new Set(Array.from({ length: 500 }, () => localId('roll')));
    expect(ids.size).toBe(500);
  });
});

describe('shape validation', () => {
  it('accepts a wall in pixels or cells and refuses a zero-length one', () => {
    const ok = validateWall({ type: 'solid', p1: { x: 0, y: 0 }, p2: { x: 70, y: 0 } });
    expect(ok.ok).toBe(true);
    const same = validateWall({ type: 'door', p1: { x: 5, y: 5 }, p2: { x: 5, y: 5 } });
    expect(same.ok).toBe(false);
    const badType = validateWall({ type: 'wall', p1: { x: 0, y: 0 }, p2: { x: 1, y: 1 } });
    expect(badType.ok).toBe(false);
  });

  it('validates lights against Atlas emission rules', () => {
    const ok = validateLight({ x: 10, y: 10, emission: { bright: 20, dim: 40, color: '#ffcc88', intensity: 1, animation: 'torch' } });
    expect(ok.ok).toBe(true);
    const inverted = validateLight({ x: 10, y: 10, emission: { bright: 40, dim: 20 } });
    expect(inverted.ok).toBe(false);
    const badAnimation = validateLight({ x: 10, y: 10, emission: { bright: 10, dim: 20, animation: 'disco' } });
    expect(badAnimation.ok).toBe(false);
  });
});
