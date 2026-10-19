/**
 * Event stream for the orchestrator: a ring buffer of numbered events plus the
 * translation of raw Atlas store diffs into events a streamer can narrate.
 *
 * Everything here is pure and testable: `deriveEvents(prev, next)` takes two store states and
 * returns what changed, with ids and before/after summaries. The generic `state_changed`
 * fallback stays, so nothing can change silently.
 */

export type AtlasEvent = { seq: number; ts: number; type: string; [k: string]: unknown };
type Listener = (e: AtlasEvent) => void;

export class EventBus {
  private seq = 0;
  private listeners = new Set<Listener>();
  private ring: AtlasEvent[] = [];
  constructor(private cap = 1000) {}

  emit(type: string, data: Record<string, unknown> = {}): AtlasEvent {
    const e: AtlasEvent = { seq: ++this.seq, ts: Date.now(), type, ...data };
    this.ring.push(e);
    if (this.ring.length > this.cap) this.ring.shift();
    for (const l of this.listeners) {
      try { l(e); } catch { /* a broken listener must not break the stream */ }
    }
    return e;
  }

  on(l: Listener): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  /** In-memory events newer than `seq` (for `atlas_events` polling). */
  since(seq: number, limit = 100): AtlasEvent[] {
    return this.ring.filter((e) => e.seq > seq).slice(-limit);
  }

  /** Oldest kept seq — a Last-Event-ID older than this has been dropped. */
  oldest(): number {
    return this.ring.length ? this.ring[0].seq : this.seq;
  }

  size(): number {
    return this.ring.length;
  }
}

export interface StateEvent {
  type: string;
  [k: string]: unknown;
}

const isObj = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const isArray = (v: unknown): v is any[] => Array.isArray(v);

/** A token described the way a narrator needs it. */
export function summariseToken(token: any) {
  if (!isObj(token)) return null;
  return {
    id: token.id,
    kind: token.kind,
    name: token.name ?? token.statblockName ?? null,
    imagePath: token.imagePath,
    x: round(token.x),
    y: round(token.y),
    size: token.size ?? 1,
    layer: token.layer ?? 0,
    hidden: !!token.isHidden,
    conditions: Array.isArray(token.conditions) ? token.conditions : [],
  };
}

function round(n: unknown): number | null {
  return typeof n === 'number' && Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** Which ids were added / removed / changed between two id-keyed collections. */
function diffCollection<T>(prev: Record<string, T> | undefined, next: Record<string, T> | undefined) {
  const a: Record<string, any> = prev ?? {};
  const b: Record<string, any> = next ?? {};
  const added: string[] = [];
  const removed: string[] = [];
  const changed: string[] = [];
  for (const id of Object.keys(b)) {
    if (!(id in a)) added.push(id);
    else if (a[id] !== b[id]) changed.push(id);
  }
  for (const id of Object.keys(a)) if (!(id in b)) removed.push(id);
  return { added, removed, changed, before: a, after: b };
}

/** Fields that changed on one entity, comparing by value for arrays/objects. */
function changedFields(before: any, after: any): string[] {
  if (!isObj(before) || !isObj(after)) return [];
  const fields: string[] = [];
  for (const key of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) fields.push(key);
  }
  return fields;
}

const COLLECTIONS: { key: string; noun: string }[] = [
  { key: 'tokens', noun: 'token' },
  { key: 'pins', noun: 'pin' },
  { key: 'texts', noun: 'text' },
  { key: 'drawings', noun: 'drawing' },
  { key: 'walls', noun: 'wall' },
  { key: 'lights', noun: 'light' },
  { key: 'lightZones', noun: 'light_zone' },
  { key: 'audios', noun: 'audio' },
];

/**
 * Turns one store write into semantic events. Never throws: a shape it does not know falls
 * back to `state_changed`, so a future Atlas cannot silence the stream.
 */
export function deriveEvents(prev: any, next: any): StateEvent[] {
  if (!isObj(prev) || !isObj(next)) return [];
  const events: StateEvent[] = [];
  const p = prev.objects ?? {};
  const n = next.objects ?? {};

  // ── tokens ───────────────────────────────────────────────────────────────
  const tokens = diffCollection(isObj(p.tokens) ? p.tokens : {}, isObj(n.tokens) ? n.tokens : {});
  for (const id of tokens.added) events.push({ type: 'token_added', ...summariseToken(tokens.after[id]) });
  for (const id of tokens.removed) events.push({ type: 'token_removed', id, ...(summariseToken(tokens.before[id]) ?? {}) });
  for (const id of tokens.changed) {
    const before = tokens.before[id];
    const after = tokens.after[id];
    const fields = changedFields(before, after);
    if (fields.length === 1 && fields[0] === 'layer') {
      events.push({ type: 'token_layer_changed', id, from: before.layer ?? 0, to: after.layer ?? 0 });
    } else if (fields.every((f) => f === 'x' || f === 'y')) {
      events.push({
        type: 'token_moved',
        id,
        name: after.name ?? after.statblockName ?? null,
        from: { x: round(before.x), y: round(before.y) },
        to: { x: round(after.x), y: round(after.y) },
      });
    } else {
      const detail: StateEvent = { type: 'token_updated', id, name: after.name ?? after.statblockName ?? null, changed: fields };
      if (fields.includes('conditions')) detail.conditions = { before: before.conditions ?? [], after: after.conditions ?? [] };
      if (fields.includes('isHidden')) detail.hidden = { before: !!before.isHidden, after: !!after.isHidden };
      if (fields.includes('size')) detail.size = { before: before.size ?? 1, after: after.size ?? 1 };
      if (fields.includes('resources')) detail.resources = { before: before.resources ?? {}, after: after.resources ?? {} };
      if (fields.includes('ringColor')) detail.ringColor = { before: before.ringColor ?? null, after: after.ringColor ?? null };
      events.push(detail);
    }
  }

  // ── fog ──────────────────────────────────────────────────────────────────
  const fog = diffCollection(isObj(p.fog) ? p.fog : {}, isObj(n.fog) ? n.fog : {});
  if (fog.added.length || fog.removed.length) {
    const addedOps = fog.added.map((id) => fog.after[id]).filter(isObj);
    events.push({
      type: 'fog_changed',
      added: fog.added.length,
      removed: fog.removed.length,
      erasing: addedOps.some((op) => !!op.isErasing),
      kinds: [...new Set(addedOps.map((op) => String(op.type)))],
      ...(fog.added.length <= 5 ? { addedIds: fog.added } : {}),
      totalBefore: Object.keys(fog.before).length,
      totalAfter: Object.keys(fog.after).length,
    });
  }

  // ── walls, lights, pins, texts, drawings, zones, audio ───────────────────
  for (const { key, noun } of COLLECTIONS) {
    if (key === 'tokens') continue;
    const c = diffCollection(isObj(p[key]) ? p[key] : {}, isObj(n[key]) ? n[key] : {});
    for (const id of c.added) events.push({ type: `${noun}_added`, id, ...summariseObject(c.after[id]) });
    for (const id of c.removed) events.push({ type: `${noun}_removed`, id, ...summariseObject(c.before[id]) });
    for (const id of c.changed) {
      const before = c.before[id];
      const after = c.after[id];
      const fields = changedFields(before, after);
      const doorLike = (after.type === 'door' || after.type === 'secret-door') && fields.some((f) => f === 'closed' || f === 'locked');
      if (doorLike) {
        events.push({
          type: 'door_toggled',
          id,
          doorType: after.type,
          closed: after.closed !== false,
          locked: !!after.locked,
          wasClosed: before.closed !== false,
        });
      } else {
        events.push({ type: `${noun}_updated`, id, changed: fields, ...summariseObject(after) });
      }
    }
  }

  // ── initiative ───────────────────────────────────────────────────────────
  const iBefore = isObj(prev.initiative) ? prev.initiative : {};
  const iAfter = isObj(next.initiative) ? next.initiative : {};
  const eBefore: any[] = isArray(iBefore.entries) ? iBefore.entries : [];
  const eAfter: any[] = isArray(iAfter.entries) ? iAfter.entries : [];
  const byId = (list: any[]) => new Map(list.map((e) => [String(e?.id), e]));
  const mBefore = byId(eBefore);
  const mAfter = byId(eAfter);
  for (const [id, entry] of mAfter) if (!mBefore.has(id)) events.push({ type: 'initiative_entry_added', ...summariseEntry(entry) });
  for (const [id, entry] of mBefore) if (!mAfter.has(id)) events.push({ type: 'initiative_entry_removed', ...summariseEntry(entry) });
  for (const [id, entry] of mAfter) {
    const before = mBefore.get(id);
    if (!before) continue;
    const fields = changedFields(before, entry);
    if (fields.length) events.push({ type: 'initiative_entry_updated', ...summariseEntry(entry), changed: fields });
  }
  if (!iBefore.isActive && iAfter.isActive) {
    events.push({ type: 'combat_started', round: iAfter.round ?? 0, entries: eAfter.length });
  } else if (iBefore.isActive && !iAfter.isActive) {
    events.push({ type: 'combat_ended', round: iBefore.round ?? 0 });
  }
  if (iAfter.isActive && (iBefore.round !== iAfter.round || iBefore.currentIndex !== iAfter.currentIndex)) {
    const active = eAfter[iAfter.currentIndex] ?? null;
    events.push({
      type: 'turn_changed',
      round: iAfter.round ?? 0,
      index: iAfter.currentIndex ?? -1,
      ...(active ? { id: active.id, tokenId: active.tokenId, name: active.name, initiative: active.initiative } : { name: null }),
      previous: iBefore.currentIndex ?? -1,
    });
  }
  if (iBefore.initiativeTrackerOpen !== iAfter.initiativeTrackerOpen) {
    events.push({ type: 'initiative_tracker_toggled', open: !!iAfter.initiativeTrackerOpen });
  }

  // ── dice log (session-visible, persisted per scene) ──────────────────────
  const dBefore: any[] = isArray(prev.diceLog) ? prev.diceLog : [];
  const dAfter: any[] = isArray(next.diceLog) ? next.diceLog : [];
  if (dAfter.length !== dBefore.length) {
    const known = new Set(dBefore.map((r) => String(r?.id)));
    for (const roll of dAfter) {
      if (known.has(String(roll?.id))) continue;
      events.push({
        type: 'dice_rolled',
        id: roll.id,
        formula: roll.formula,
        total: roll.total,
        rolls: isArray(roll.rolls) ? roll.rolls.map((d: any) => ({ die: d?.die, value: d?.value, dropped: !!d?.dropped })) : [],
        crit: roll.crit ?? null,
        player: roll.player ?? null,
        label: roll.source?.abilityName ?? roll.source?.tokenName ?? null,
      });
    }
  }

  // ── scene-level state ────────────────────────────────────────────────────
  if (prev.mapPath !== next.mapPath) events.push({ type: 'scene_changed', from: prev.mapPath ?? null, to: next.mapPath ?? null });
  if (prev.background !== next.background) events.push({ type: 'background_changed', from: prev.background ?? null, to: next.background ?? null });
  if (JSON.stringify(prev.grid) !== JSON.stringify(next.grid)) {
    events.push({ type: 'grid_changed', before: gridSummary(prev.grid), after: gridSummary(next.grid) });
  }
  if (JSON.stringify(prev.camera) !== JSON.stringify(next.camera)) {
    events.push({ type: 'camera_changed', x: round(next.camera?.x), y: round(next.camera?.y), scale: round(next.camera?.scale) });
  }
  if (JSON.stringify(prev.lighting) !== JSON.stringify(next.lighting)) {
    events.push({ type: 'lighting_changed', enabled: !!next.lighting?.enabled, ambient: next.lighting?.ambient });
  }
  if (JSON.stringify(prev.selectedIds) !== JSON.stringify(next.selectedIds)) {
    events.push({ type: 'selection_changed', ids: isArray(next.selectedIds) ? next.selectedIds : [] });
  }

  // ── fallback: any other top-level key that changed ───────────────────────
  const modelled = new Set(['objects', 'initiative', 'diceLog', 'mapPath', 'background', 'grid', 'camera', 'lighting', 'selectedIds']);
  for (const key of Object.keys(next)) {
    if (modelled.has(key) || typeof next[key] === 'function') continue;
    if (prev[key] === next[key]) continue;
    events.push({ type: 'state_changed', key, value: preview(next[key]) });
  }
  return events;
}

function preview(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string') return value;
  if (isArray(value)) return `[array(${value.length})]`;
  return isObj(value) ? `{${Object.keys(value).slice(0, 8).join(',')}}` : typeof value;
}

function gridSummary(grid: any) {
  if (!isObj(grid)) return null;
  return { type: grid.type ?? 'square', size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY, visible: grid.visible ?? true };
}

function summariseObject(obj: any) {
  if (!isObj(obj)) return {};
  if (obj.kind === 'wall') return { wallType: obj.type, p1: obj.p1, p2: obj.p2, closed: obj.closed !== false, locked: !!obj.locked };
  if (obj.kind === 'light') return { x: round(obj.x), y: round(obj.y), emission: obj.emission, hidden: !!obj.hidden };
  if (obj.kind === 'light-zone') return { ambient: obj.ambient, points: isArray(obj.polygon) ? obj.polygon.length : 0 };
  if (obj.kind === 'fog') return { fogType: obj.type, erasing: !!obj.isErasing };
  if (obj.kind === 'pin') return { notePath: obj.notePath, icon: obj.icon, x: round(obj.x), y: round(obj.y) };
  if (obj.kind === 'text') return { text: typeof obj.text === 'string' ? obj.text.slice(0, 120) : '', x: round(obj.x), y: round(obj.y) };
  if (obj.kind === 'drawing') return { drawingType: obj.type, points: isArray(obj.points) ? obj.points.length : 0 };
  if (obj.kind === 'audio') return { src: obj.src ?? obj.path ?? null };
  return { x: round(obj.x), y: round(obj.y) };
}

export function summariseEntry(entry: any) {
  if (!isObj(entry)) return {};
  return {
    id: entry.id,
    tokenId: entry.tokenId,
    name: entry.name,
    initiative: entry.initiative,
    modifier: entry.initiativeModifier,
    isNPC: !!entry.isNPC,
    active: !!entry.isActive,
    order: entry.order,
    sitsOut: !!entry.sitsOut,
  };
}
