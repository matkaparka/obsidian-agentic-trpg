/**
 * Grid maths, ported 1:1 from Atlas VTT 0.8.0 so cells and pixels agree with what the map draws:
 *   src/app/grid/hexGeometry.ts       (axial coordinates, cube rounding, hex extents)
 *   src/app/grid/gridPlacement.ts     (tokenCenterShift, snapTokenCenter)
 *   src/app/pixi/token-renderer/tokenSizing.ts (tokenDiameterInCells)
 *
 * Conventions that matter:
 *  - `grid.size` is the flat-to-flat distance of a hex (same number as a square cell size).
 *  - Hex cells are axial `(q, r)`; `offsetX/offsetY` is the top-left corner of hex (0,0)'s box.
 *  - A token's `size` is a multiplier: footprint diameter in cells is `2*size - 1`.
 *  - Token `x,y` are the centre in world pixels. Odd footprints sit on a cell centre, even ones
 *    sit where cells meet (`tokenCenterShift`) — the same rule Atlas' drag and drop uses.
 */

export type GridType = 'square' | 'hex-horizontal' | 'hex-vertical';
export type HexOrientation = 'pointy' | 'flat';

export interface GridState {
  enabled: boolean;
  visible?: boolean;
  snapToGrid?: boolean;
  type?: GridType;
  size: number;
  offsetX: number;
  offsetY: number;
  color?: string;
  opacity: number;
  scale?: number;
  mapScale?: number;
  unitType?: 'feet' | 'yards' | 'meters' | 'units';
  unitDistance?: number;
  unitDistanceOverride?: number;
  lineType?: 'solid' | 'dashed' | 'dotted';
  lineWidth?: number;
  measurementType?: 'units' | 'abstract';
  autoDetect?: boolean;
  mapStretch?: { x?: number; y?: number; rotation?: number };
  cellNumbers?: string;
  cellNumberOpacity?: number;
}

export interface Point {
  x: number;
  y: number;
}

/** A cell: `col`/`row` on square grids, axial `q`/`r` on hex grids. */
export interface Cell {
  col: number;
  row: number;
}

const SQRT3 = Math.sqrt(3);

export function isHexGridType(type: string | undefined): type is 'hex-horizontal' | 'hex-vertical' {
  return type === 'hex-horizontal' || type === 'hex-vertical';
}

/** `hex-horizontal` is flat-top (columns), `hex-vertical` is pointy-top (rows). */
export function hexOrientationForGridType(type: GridType): HexOrientation {
  return type === 'hex-horizontal' ? 'flat' : 'pointy';
}

/** Distance from hex centre to any vertex. */
export function hexCircumradius(size: number): number {
  return size / SQRT3;
}

/** Bounding box of a single hex. */
export function hexCellExtent(type: GridType, size: number): { width: number; height: number } {
  const diameter = 2 * hexCircumradius(size);
  return hexOrientationForGridType(type) === 'pointy'
    ? { width: size, height: diameter }
    : { width: diameter, height: size };
}

/** Pixel centre of hex (0,0). */
export function hexOriginCenter(grid: Pick<GridState, 'type' | 'size' | 'offsetX' | 'offsetY'>): Point {
  const type = isHexGridType(grid.type) ? grid.type : 'hex-vertical';
  const { width, height } = hexCellExtent(type, grid.size);
  return { x: (grid.offsetX ?? 0) + width / 2, y: (grid.offsetY ?? 0) + height / 2 };
}

/** Centre of an axial hex in world pixels. */
export function axialToPixel(grid: GridState, q: number, r: number): Point {
  const type = isHexGridType(grid.type) ? grid.type : 'hex-vertical';
  const radius = hexCircumradius(grid.size);
  const origin = hexOriginCenter({ ...grid, type });
  if (hexOrientationForGridType(type) === 'pointy') {
    return { x: origin.x + grid.size * (q + r / 2), y: origin.y + 1.5 * radius * r };
  }
  return { x: origin.x + 1.5 * radius * q, y: origin.y + grid.size * (r + q / 2) };
}

export function pixelToFractionalAxial(grid: GridState, point: Point): { q: number; r: number } {
  const type = isHexGridType(grid.type) ? grid.type : 'hex-vertical';
  const radius = hexCircumradius(grid.size);
  const origin = hexOriginCenter({ ...grid, type });
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  if (hexOrientationForGridType(type) === 'pointy') {
    return { q: ((SQRT3 / 3) * dx - dy / 3) / radius, r: ((2 / 3) * dy) / radius };
  }
  return { q: ((2 / 3) * dx) / radius, r: (-dx / 3 + (SQRT3 / 3) * dy) / radius };
}

/** Cube rounding — q and r are never rounded on their own. */
export function axialRound(fractional: { q: number; r: number }): { q: number; r: number } {
  const fs = -fractional.q - fractional.r;
  let q = Math.round(fractional.q);
  let r = Math.round(fractional.r);
  const s = Math.round(fs);
  const qDiff = Math.abs(q - fractional.q);
  const rDiff = Math.abs(r - fractional.r);
  const sDiff = Math.abs(s - fs);
  if (qDiff > rDiff && qDiff > sDiff) q = -r - s;
  else if (rDiff > sDiff) r = -q - s;
  return { q: q + 0, r: r + 0 };
}

export function pixelToAxial(grid: GridState, point: Point): { q: number; r: number } {
  return axialRound(pixelToFractionalAxial(grid, point));
}

export function axialDistance(a: { q: number; r: number }, b: { q: number; r: number }): number {
  const dq = a.q - b.q;
  const dr = a.r - b.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

/** Footprint diameter in cells for a `size` multiplier (1 → 1 cell, 1.5 → 2, 2 → 3 …). */
export function tokenDiameterInCells(sizeInCells: number | undefined): number {
  return 2 * (sizeInCells ?? 1) - 1;
}

/** How far a token's centre lies from the centre of the cell its footprint starts from. */
export function tokenCenterShift(gridType: GridType | undefined, cellSize: number, tokenSize: number | undefined): Point {
  if (tokenDiameterInCells(tokenSize) % 2 !== 0) return { x: 0, y: 0 };
  if (!isHexGridType(gridType)) return { x: cellSize / 2, y: cellSize / 2 };
  const radius = hexCircumradius(cellSize);
  return hexOrientationForGridType(gridType) === 'pointy'
    ? { x: cellSize / 2, y: radius / 2 }
    : { x: radius / 2, y: cellSize / 2 };
}

/** World centre of the token whose footprint starts at `cell` — cell centre plus the footprint shift. */
export function cellToWorld(cell: Cell, grid: GridState, tokenSize?: number): Point {
  const shift = tokenCenterShift(grid.type, grid.size, tokenSize);
  if (isHexGridType(grid.type)) {
    const centre = axialToPixel(grid, cell.col, cell.row);
    return { x: centre.x + shift.x, y: centre.y + shift.y };
  }
  return {
    x: grid.offsetX + (cell.col + 0.5) * grid.size + shift.x,
    y: grid.offsetY + (cell.row + 0.5) * grid.size + shift.y,
  };
}

/** The cell a token of `tokenSize` starts from, given its centre in world pixels. */
export function worldToCell(point: Point, grid: GridState, tokenSize?: number): Cell {
  const shift = tokenCenterShift(grid.type, grid.size, tokenSize);
  const base = { x: point.x - shift.x, y: point.y - shift.y };
  if (isHexGridType(grid.type)) {
    const axial = pixelToAxial(grid, base);
    return { col: axial.q, row: axial.r };
  }
  return {
    col: Math.floor((base.x - grid.offsetX) / grid.size),
    row: Math.floor((base.y - grid.offsetY) / grid.size),
  };
}

/** Nearest cell centre for a point (what an unsnapped token snaps to on a drop). */
export function snapToCellCenter(point: Point, grid: GridState, tokenSize?: number): Point {
  return cellToWorld(worldToCell(point, grid, tokenSize), grid, tokenSize);
}

/** Cells between two world points, using Atlas' measurement for both grid kinds. */
export function cellsBetween(a: Point, b: Point, grid: GridState): number {
  if (isHexGridType(grid.type)) {
    return axialDistance(pixelToAxial(grid, a), pixelToAxial(grid, b));
  }
  const ca = worldToCell(a, grid);
  const cb = worldToCell(b, grid);
  return Math.max(Math.abs(ca.col - cb.col), Math.abs(ca.row - cb.row));
}

export interface GridSummary {
  type: GridType;
  size: number;
  offsetX: number;
  offsetY: number;
  enabled: boolean;
  visible: boolean;
  snapToGrid: boolean;
  unitType: string;
  unitDistance: number;
  cellAddressing: string;
}

export function summariseGrid(grid: GridState | null | undefined): GridSummary | null {
  if (!grid) return null;
  const type = grid.type ?? 'square';
  return {
    type,
    size: grid.size,
    offsetX: grid.offsetX,
    offsetY: grid.offsetY,
    enabled: grid.enabled,
    visible: grid.visible ?? true,
    snapToGrid: grid.snapToGrid ?? true,
    unitType: grid.unitType ?? 'units',
    unitDistance: grid.unitDistanceOverride ?? grid.unitDistance ?? 5,
    cellAddressing: isHexGridType(type)
      ? `col=q, row=r axial hex coordinates (flat-to-flat size ${grid.size}px)`
      : 'col/row are integer cells from the grid origin; cell (0,0)\'s top-left corner is offsetX/offsetY',
  };
}
