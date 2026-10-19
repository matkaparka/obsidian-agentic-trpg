import { describe, expect, it } from 'vitest';
import {
  axialDistance, axialToPixel, cellToWorld, cellsBetween, hexCircumradius, pixelToAxial,
  snapToCellCenter, tokenCenterShift, tokenDiameterInCells, worldToCell, type GridState,
} from '../src/atlas/grid';

const square: GridState = {
  enabled: true, visible: true, snapToGrid: true, type: 'square', size: 70,
  offsetX: 0, offsetY: 0, opacity: 0.5, unitType: 'feet', unitDistance: 5,
};

const hexPointy: GridState = { ...square, type: 'hex-vertical' };
const hexFlat: GridState = { ...square, type: 'hex-horizontal' };

const close = (a: number, b: number, eps = 1e-6) => expect(Math.abs(a - b)).toBeLessThan(eps);

describe('token footprints', () => {
  it('maps the size multiplier to a diameter in cells like Atlas', () => {
    expect(tokenDiameterInCells(1)).toBe(1);
    expect(tokenDiameterInCells(1.5)).toBe(2);
    expect(tokenDiameterInCells(2)).toBe(3);
    expect(tokenDiameterInCells(undefined)).toBe(1);
  });

  it('shifts even footprints by half a cell and leaves odd ones centred', () => {
    expect(tokenCenterShift('square', 70, 1)).toEqual({ x: 0, y: 0 });
    expect(tokenCenterShift('square', 70, 1.5)).toEqual({ x: 35, y: 35 });
    expect(tokenCenterShift('square', 70, 2)).toEqual({ x: 0, y: 0 });
    // hex pointy: shift is (size/2, circumradius/2)
    close(tokenCenterShift('hex-vertical', 70, 1.5).x, 35);
    close(tokenCenterShift('hex-vertical', 70, 1.5).y, hexCircumradius(70) / 2);
  });
});

describe('square grid', () => {
  it('puts a 1-cell token on the cell centre', () => {
    expect(cellToWorld({ col: 2, row: 3 }, square, 1)).toEqual({ x: 175, y: 245 });
  });

  it('puts a 2-cell token where cells meet', () => {
    expect(cellToWorld({ col: 2, row: 3 }, square, 1.5)).toEqual({ x: 210, y: 280 });
  });

  it('round-trips cells and pixels', () => {
    for (const cell of [{ col: 0, row: 0 }, { col: 5, row: 1 }, { col: 12, row: 9 }]) {
      expect(worldToCell(cellToWorld(cell, square, 1), square, 1)).toEqual(cell);
      expect(worldToCell(cellToWorld(cell, square, 1.5), square, 1.5)).toEqual(cell);
    }
  });

  it('respects grid offsets', () => {
    const shifted = { ...square, offsetX: 10, offsetY: 20 };
    expect(cellToWorld({ col: 0, row: 0 }, shifted, 1)).toEqual({ x: 45, y: 55 });
  });

  it('snaps a stray point to the nearest cell centre', () => {
    expect(snapToCellCenter({ x: 181, y: 249 }, square, 1)).toEqual({ x: 175, y: 245 });
  });

  it('measures distance in cells (Chebyshev)', () => {
    expect(cellsBetween({ x: 35, y: 35 }, { x: 245, y: 105 }, square)).toBe(3);
  });
});

describe('hex grid', () => {
  it('places hex (0,0) at the centre of its bounding box', () => {
    const centre = axialToPixel(hexPointy, 0, 0);
    close(centre.x, 35);
    close(centre.y, hexCircumradius(70));
  });

  it('steps right and down as Atlas does (pointy)', () => {
    const right = axialToPixel(hexPointy, 1, 0);
    close(right.x, 105);
    close(right.y, hexCircumradius(70));
    const downRight = axialToPixel(hexPointy, 0, 1);
    close(downRight.x, 70);
    close(downRight.y, hexCircumradius(70) * 2.5);
  });

  it('steps as columns and rows on a flat-top grid', () => {
    const down = axialToPixel(hexFlat, 0, 1);
    close(down.x, hexCircumradius(70));
    close(down.y, 105);
  });

  it('round-trips axial cells through pixels (cube rounding)', () => {
    for (const cell of [{ col: 0, row: 0 }, { col: 3, row: -2 }, { col: -1, row: 4 }, { col: 6, row: 2 }]) {
      const pixel = cellToWorld(cell, hexPointy, 1);
      expect(worldToCell(pixel, hexPointy, 1)).toEqual(cell);
    }
    for (const cell of [{ col: 0, row: 0 }, { col: 2, row: 3 }, { col: -3, row: 1 }]) {
      expect(worldToCell(cellToWorld(cell, hexFlat, 1), hexFlat, 1)).toEqual(cell);
    }
  });

  it('counts hex steps, not pixels', () => {
    expect(axialDistance({ q: 0, r: 0 }, { q: 2, r: -1 })).toBe(2);
    expect(cellsBetween(axialToPixel(hexPointy, 0, 0), axialToPixel(hexPointy, 2, 1), hexPointy)).toBe(3);
  });

  it('pixelToAxial picks the hex actually containing the point', () => {
    const centre = axialToPixel(hexPointy, 4, 2);
    // 20px to the right of a hex centre is still that hex for a 70px hex.
    expect(pixelToAxial(hexPointy, { x: centre.x + 20, y: centre.y })).toEqual({ q: 4, r: 2 });
  });
});
