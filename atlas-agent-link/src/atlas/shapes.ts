/**
 * Runtime shapes of the Atlas VTT 0.8.0 store, taken from its source (`src/app/types/*`,
 * `src/app/types.ts`, `src/app/services/MapPersistence.ts`) and confirmed against a live
 * store (docs/PROBE.md). Only fields this plugin writes are modelled; everything else is
 * passed through untouched.
 */
import type { GridState } from './grid';

export interface TokenEntity {
  id: string;
  kind: 'token' | 'character';
  x: number;
  y: number;
  imagePath: string;
  size?: number;
  layer?: number;
  rotation?: number;
  ringColor?: string;
  conditions?: string[];
  conditionValues?: Record<string, number>;
  isHidden?: boolean;
  showNameplate?: boolean;
  showRing?: boolean;
  instanceNumber?: number;
  resources?: Record<string, { current: number; max: number }>;
  overriddenMax?: string[];
  tags?: string[];
  side?: string;
  vision?: Record<string, unknown>;
  light?: Record<string, unknown>;
  assetId?: string;
  name?: string;
  notePath?: string;
  statblockPath?: string;
  statblockName?: string | null;
  difficulty?: string;
}

/** `addToken` input: Atlas assigns id/kind (an explicit id is honoured too). */
export type TokenInput = Partial<Omit<TokenEntity, 'kind'>> & { imagePath: string; x: number; y: number };

/** Fields `updateToken` accepts. */
export const TOKEN_UPDATE_FIELDS = [
  'x', 'y', 'imagePath', 'size', 'layer', 'rotation', 'ringColor', 'conditions', 'conditionValues',
  'isHidden', 'showNameplate', 'showRing', 'resources', 'overriddenMax', 'tags', 'side', 'vision',
  'light', 'name', 'notePath', 'statblockPath', 'statblockName', 'difficulty', 'assetId',
] as const;

/** Fields `updateWall` accepts (Atlas patches a wall with `Partial<WallSegment>`). */
export const WALL_UPDATE_FIELDS = ['type', 'p1', 'p2', 'direction', 'closed', 'locked', 'blocks', 'limited', 'chainId'] as const;

export type FogOperation =
  | { id: string; kind: 'fog'; timestamp: number; isErasing: boolean; type: 'brush'; points: { x: number; y: number }[]; brushRadius: number; offsetX?: number; offsetY?: number }
  | { id: string; kind: 'fog'; timestamp: number; isErasing: boolean; type: 'lasso'; points: { x: number; y: number }[]; offsetX?: number; offsetY?: number }
  | { id: string; kind: 'fog'; timestamp: number; isErasing: boolean; type: 'rectangle'; x: number; y: number; width: number; height: number; offsetX?: number; offsetY?: number };

export type FogOperationInput =
  | { isErasing?: boolean; type: 'brush'; points: { x: number; y: number }[]; brushRadius: number; offsetX?: number; offsetY?: number }
  | { isErasing?: boolean; type: 'lasso'; points: { x: number; y: number }[]; offsetX?: number; offsetY?: number }
  | { isErasing?: boolean; type: 'rectangle'; x: number; y: number; width: number; height: number; offsetX?: number; offsetY?: number };

export interface WallSegment {
  id: string;
  kind: 'wall';
  type: 'solid' | 'door' | 'secret-door';
  p1: { x: number; y: number };
  p2: { x: number; y: number };
  direction?: 'left' | 'right';
  closed?: boolean;
  locked?: boolean;
  blocks?: 'sight' | 'light';
  limited?: boolean;
  chainId?: string;
}

export type WallInput = Omit<WallSegment, 'id' | 'kind'>;

export interface LightEmission {
  bright: number;
  dim: number;
  color: string;
  intensity: number;
  animation: 'none' | 'torch' | 'candle' | 'pulse' | 'magic';
  sourceRadius?: number;
  kind?: 'candle' | 'torch' | 'lantern' | 'magical' | 'darkness' | 'custom';
  darkness?: boolean;
  priority?: number;
  angle?: number;
  preset?: string;
}

export interface LightSource {
  id: string;
  kind: 'light';
  x: number;
  y: number;
  emission: LightEmission;
  hidden?: boolean;
  rotation?: number;
  activeBelowAmbient?: number;
}

export type LightInput = Omit<LightSource, 'id' | 'kind'>;

export interface LightZone {
  id: string;
  kind: 'light-zone';
  name?: string;
  polygon: { x: number; y: number }[];
  ambient: number;
  ambientColor?: string;
}

export type LightZoneInput = Omit<LightZone, 'id' | 'kind'>;

export interface SceneLighting {
  enabled: boolean;
  ambient: number;
  ambientColor?: string;
  tokenVision?: boolean;
  exploredMemory?: boolean;
  exploredColor?: string;
  unexploredColor?: string;
  litThreshold?: number;
  sightOnDrop?: boolean;
  brightThreshold?: number;
  darkSightLook?: 'system' | 'grey' | 'colour';
  darkSightTint?: string;
}

export interface InitiativeEntry {
  id: string;
  tokenId: string;
  name: string;
  initiative: number;
  initiativeModifier: number;
  modifierByHand?: true;
  imagePath: string;
  statblockPath?: string;
  isActive: boolean;
  isNPC: boolean;
  order: number;
  sitsOut?: boolean;
}

export interface InitiativeState {
  entries: InitiativeEntry[];
  currentIndex: number;
  round: number;
  isActive: boolean;
  config: { autoSort: boolean };
  sides?: { first: string; active: string };
}

export interface RolledDie {
  die: string;
  value: number;
  max: number;
  min?: number;
  negative?: true;
  exploded?: true;
  rerolled?: true;
  dropped?: true;
  success?: true;
  failure?: true;
  label?: string;
  name?: string;
  colour?: string;
  advantage?: true;
  sharedUnits?: true;
}

/** The persisted dice-log entry Atlas renders (`addDiceLogEntry`). */
export interface DiceRollResult {
  id: string;
  timestamp: number;
  formula: string;
  rolls: RolledDie[];
  modifiers: number;
  total: number;
  linear?: false;
  crit?: string;
  advantage?: string;
  player?: string;
  source?: {
    type: 'toolbar' | 'statblock';
    tokenId?: string;
    statblockPath?: string;
    tokenName?: string;
    tokenImagePath?: string;
    abilityName?: string;
  };
}

export interface CameraState {
  x: number;
  y: number;
  scale: number;
}

/** The scene envelope Atlas writes: `{ version, state }`. */
export interface MapFileEnvelope {
  version?: number;
  state: {
    schema: 'atlas-vtt';
    version: number;
    name?: string;
    background: string | null;
    grid: GridState | null;
    objects: Record<string, Record<string, unknown>>;
    camera: CameraState;
    [k: string]: unknown;
  };
}

/** Picks only known keys, dropping `undefined`, so a patch never erases what it did not name. */
export function pickFields<T extends object>(source: Record<string, unknown> | undefined, fields: readonly string[]): Partial<T> {
  const out: Record<string, unknown> = {};
  if (!source) return out as Partial<T>;
  for (const key of fields) {
    if (key in source && source[key] !== undefined) out[key] = source[key];
  }
  return out as Partial<T>;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

const NUM = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const STR = (v: unknown): v is string => typeof v === 'string' && v.length > 0;

export interface Point {
  x: number;
  y: number;
}

/** Reads `{x,y}` world pixels, or `{col,row}` through `viaCell`. */
export function readPoint(value: unknown, viaCell?: (cell: { col: number; row: number }) => Point): Point | null {
  if (!isPlainObject(value)) return null;
  if (NUM(value.x) && NUM(value.y)) return { x: value.x, y: value.y };
  if (viaCell && NUM(value.col) && NUM(value.row)) return viaCell({ col: value.col, row: value.row });
  return null;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

export function validateWall(input: Record<string, unknown>, resolvePoint?: (p: unknown) => Point | null): Validated<WallInput> {
  const type = input.type;
  if (type !== 'solid' && type !== 'door' && type !== 'secret-door') return { ok: false, error: 'type must be solid | door | secret-door' };
  const p1 = resolvePoint ? resolvePoint(input.p1) : readPoint(input.p1);
  const p2 = resolvePoint ? resolvePoint(input.p2) : readPoint(input.p2);
  if (!p1 || !p2) return { ok: false, error: 'p1 and p2 must be {x,y} world pixels or {col,row} cells' };
  if (p1.x === p2.x && p1.y === p2.y) return { ok: false, error: 'p1 and p2 must differ (a wall needs length)' };
  if (input.blocks !== undefined && input.blocks !== 'sight' && input.blocks !== 'light') return { ok: false, error: 'blocks must be sight | light' };
  if (input.direction !== undefined && input.direction !== 'left' && input.direction !== 'right') return { ok: false, error: 'direction must be left | right' };
  return {
    ok: true,
    value: {
      type,
      p1,
      p2,
      ...(STR(input.chainId) ? { chainId: input.chainId } : {}),
      ...(input.direction ? { direction: input.direction as 'left' | 'right' } : {}),
      ...(typeof input.closed === 'boolean' ? { closed: input.closed } : {}),
      ...(typeof input.locked === 'boolean' ? { locked: input.locked } : {}),
      ...(input.blocks ? { blocks: input.blocks as 'sight' | 'light' } : {}),
      ...(typeof input.limited === 'boolean' ? { limited: input.limited } : {}),
    },
  };
}

export function validateLight(input: Record<string, unknown>, resolvePoint?: (p: unknown) => Point | null): Validated<LightInput> {
  const emission = input.emission;
  if (!isPlainObject(emission)) return { ok: false, error: 'emission is required: { bright, dim, color?, intensity?, animation? } (radii in game units)' };
  const bright = emission.bright ?? 0;
  const dim = emission.dim ?? bright;
  if (!NUM(bright) || !NUM(dim)) return { ok: false, error: 'emission.bright and emission.dim must be numbers' };
  if (bright < 0 || dim < bright) return { ok: false, error: 'emission needs 0 <= bright <= dim' };
  const animation = emission.animation ?? 'none';
  const allowed = ['none', 'torch', 'candle', 'pulse', 'magic'];
  if (!allowed.includes(String(animation))) return { ok: false, error: `emission.animation must be one of ${allowed.join('|')}` };
  const p = resolvePoint ? resolvePoint(input) : readPoint(input);
  if (!p) return { ok: false, error: 'x/y (world pixels) or col/row (cells) are required' };
  return {
    ok: true,
    value: {
      x: p.x,
      y: p.y,
      emission: {
        bright,
        dim,
        color: STR(emission.color) ? emission.color : '#ffcc88',
        intensity: NUM(emission.intensity) ? emission.intensity : 1,
        animation: animation as LightEmission['animation'],
        ...(NUM(emission.sourceRadius) ? { sourceRadius: emission.sourceRadius } : {}),
        ...(STR(emission.kind) ? { kind: emission.kind as LightEmission['kind'] } : {}),
        ...(typeof emission.darkness === 'boolean' ? { darkness: emission.darkness } : {}),
        ...(NUM(emission.priority) ? { priority: emission.priority } : {}),
        ...(NUM(emission.angle) ? { angle: emission.angle } : {}),
      },
      ...(typeof input.hidden === 'boolean' ? { hidden: input.hidden } : {}),
      ...(NUM(input.rotation) ? { rotation: input.rotation } : {}),
      ...(NUM(input.activeBelowAmbient) ? { activeBelowAmbient: input.activeBelowAmbient } : {}),
    },
  };
}
