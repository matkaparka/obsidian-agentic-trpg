/**
 * Shared plumbing for the tool modules: argument schemas, cell/world resolution and the small
 * helpers every tool needs. Deliberately free of Atlas internals — the adapter owns those.
 */
import type { App } from 'obsidian';
import type { AtlasAdapter } from '../atlas/adapter';
import type { PlayerFrameController } from '../atlas/playerFrame';
import type { EventBus } from '../events';
import type { Settings } from '../settings';
import {
  cellToWorld, cellsBetween, snapToCellCenter, summariseGrid, worldToCell,
  type GridState, type Point,
} from '../atlas/grid';
import type { TokenEntity } from '../atlas/shapes';

export interface CallRecord {
  at: number;
  tool: string;
  ok: boolean;
  ms: number;
  error?: string;
  args?: unknown;
}

export interface ToolCtx {
  app: App;
  atlas: AtlasAdapter;
  bus: EventBus;
  settings: () => Settings;
  callLog: () => CallRecord[];
  /** Owns the stream frame injected into the player popout. */
  playerFrame: PlayerFrameController;
}

/** An MCP content result (image + text). The MCP server returns it verbatim. */
export interface McpContentResult {
  __mcpContent: Array<Record<string, unknown>>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  /** Writes to the scene: refused while writes are disabled. */
  write?: boolean;
  /** Needs a loaded scene; the MCP layer reports a clear error instead of a stack trace. */
  needsScene?: boolean;
  handler: (args: any) => Promise<unknown> | unknown;
}

// ── schemas ─────────────────────────────────────────────────────────────────
export const obj = (properties: Record<string, unknown>, required: string[] = []) =>
  ({ type: 'object', properties, required, additionalProperties: false });

export const str = (description: string) => ({ type: 'string', description });
export const num = (description: string) => ({ type: 'number', description });
export const bool = (description: string) => ({ type: 'boolean', description });
export const strArray = (description: string) => ({ type: 'array', items: { type: 'string' }, description });
export const anyObject = (description: string) => ({ type: 'object', description, additionalProperties: true });
export const enumOf = (values: readonly string[], description: string) => ({ type: 'string', enum: [...values], description });

export const CELL_SCHEMA = {
  type: 'object',
  description: 'Grid cell: {col,row} (square) or {q,r} axial (hex, same as col/row).',
  properties: { col: num('column / axial q'), row: num('row / axial r'), q: num('alias of col'), r: num('alias of row') },
  additionalProperties: false,
};

const readCell = (value: any): { col: number; row: number } | null => {
  if (!value || typeof value !== 'object') return null;
  const col = value.col ?? value.q;
  const row = value.row ?? value.r;
  return typeof col === 'number' && typeof row === 'number' ? { col, row } : null;
};

export interface SceneContext {
  state: any;
  grid: GridState;
}

/** The grid of the scene being written to; every coordinate tool goes through this. */
export function sceneGrid(ctx: ToolCtx): GridState {
  const { state } = ctx.atlas.readyStore();
  const grid = state.grid as GridState | null;
  if (!grid) throw new Error('This scene has no grid. Call atlas_set_grid (or atlas_add_token with explicit x/y) first.');
  return grid;
}

export function gridSummary(ctx: ToolCtx) {
  try {
    return summariseGrid(sceneGrid(ctx));
  } catch {
    return null;
  }
}

/**
 * Position from tool arguments: `x`/`y` are world pixels, `cell` is a grid cell. Anything else
 * is an error, so a typo cannot silently place a token at 0,0.
 */
export function pointFrom(args: any, grid: GridState, tokenSize?: number, opts: { snap?: boolean } = {}): Point & { cell?: { col: number; row: number }; snapped?: boolean } {
  const cell = readCell(args?.cell) ?? (typeof args?.col === 'number' && typeof args?.row === 'number' ? { col: args.col, row: args.row } : null);
  if (cell) {
    return { ...cellToWorld(cell, grid, tokenSize), cell, snapped: true };
  }
  if (typeof args?.x === 'number' && typeof args?.y === 'number') {
    const p = { x: args.x, y: args.y };
    if (opts.snap) {
      const snappedPoint = snapToCellCenter(p, grid, tokenSize);
      return { ...snappedPoint, cell: worldToCell(p, grid, tokenSize), snapped: true };
    }
    return p;
  }
  throw new Error('Give a position: either x/y in world pixels, or cell {col,row} (hex: {q,r} or col/row axial). atlas_cell_to_world converts a cell if you want to see the pixels.');
}

/** Position for something that is a point, not a footprint (walls, lights, fog). */
export function pointArg(args: any, grid: GridState | null, field = 'point'): Point {
  const raw = args?.[field] ?? args;
  const cell = readCell(raw?.cell) ?? readCell(raw);
  if (cell && grid) return cellToWorld(cell, grid, 1);
  const x = raw?.x;
  const y = raw?.y;
  if (typeof x === 'number' && typeof y === 'number') return { x, y };
  throw new Error(`${field} needs x/y world pixels or col/row cells.`);
}

export function tokenById(state: any, id: string): TokenEntity {
  const token = state?.objects?.tokens?.[id];
  if (!token) {
    const ids = Object.keys(state?.objects?.tokens ?? {});
    throw new Error(`No token with id "${id}" in the open scene. ${ids.length ? `Known ids: ${ids.slice(0, 12).join(', ')}${ids.length > 12 ? '…' : ''}` : 'The scene has no tokens yet.'}`);
  }
  return token as TokenEntity;
}

export function describeToken(token: TokenEntity, grid: GridState | null) {
  const summary: Record<string, unknown> = {
    id: token.id,
    kind: token.kind,
    name: token.name ?? token.statblockName ?? null,
    imagePath: token.imagePath,
    x: token.x,
    y: token.y,
    size: token.size ?? 1,
    layer: token.layer ?? 0,
    hidden: !!token.isHidden,
    conditions: token.conditions ?? [],
  };
  if (grid) {
    const cell = worldToCell(token, grid, token.size);
    summary.cell = grid.type && grid.type !== 'square' ? { q: cell.col, r: cell.row } : cell;
  }
  if (token.resources) summary.resources = token.resources;
  return summary;
}

/** Result of a placement, ready to hand back to the model. */
export function placementResult(point: Point, grid: GridState | null, tokenSize?: number) {
  const out: Record<string, unknown> = { x: point.x, y: point.y };
  if (grid) {
    const cell = worldToCell(point, grid, tokenSize);
    out.cell = grid.type && grid.type !== 'square' ? { q: cell.col, r: cell.row } : cell;
    out.grid = { type: grid.type ?? 'square', size: grid.size, offsetX: grid.offsetX, offsetY: grid.offsetY };
  }
  return out;
}

export function distanceInCells(a: Point, b: Point, grid: GridState): number {
  return cellsBetween(a, b, grid);
}

/** Wraps a screenshot into MCP image content (vision models) plus a short JSON summary. */
export function imageResult(shot: { base64: string; width: number; height: number; bytes: number; savedTo?: string; target: string }, extra: Record<string, unknown> = {}): McpContentResult {
  return {
    __mcpContent: [
      { type: 'image', data: shot.base64, mimeType: 'image/png' },
      { type: 'text', text: JSON.stringify({ target: shot.target, width: shot.width, height: shot.height, bytes: shot.bytes, savedTo: shot.savedTo, ...extra }, null, 1) },
    ],
  };
}

export function requireString(args: any, key: string): string {
  const v = args?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new Error(`"${key}" is required (a non-empty string).`);
  return v.trim();
}

export function requireIds(args: any, key = 'ids'): string[] {
  const v = args?.[key];
  if (!Array.isArray(v) || !v.length) throw new Error(`"${key}" must be a non-empty array of ids.`);
  return v.map(String);
}
