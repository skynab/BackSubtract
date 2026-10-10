import { describe, expect, it } from 'vitest';
import { dragBox, rasterizeShape } from './shape';

describe('dragBox', () => {
  it('works whichever way you drag', () => {
    expect(dragBox({ x: 10, y: 8 }, { x: 2, y: 4 })).toEqual({ x0: 2, y0: 4, x1: 10, y1: 8 });
  });

  it('makes a square from the longer side when asked', () => {
    expect(dragBox({ x: 10, y: 10 }, { x: 4, y: 12 }, true)).toEqual({ x0: 4, y0: 10, x1: 10, y1: 16 });
  });
});

describe('rasterizeShape', () => {
  it('fills a box fully inside and partly on its fractional edges', () => {
    const shape = rasterizeShape('rect', { x0: 1, y0: 1, x1: 3.5, y1: 3 }, 5, 4)!;
    expect(shape.rect).toEqual({ x: 1, y: 1, w: 3, h: 2 });
    const row = (y: number) => [...shape.data.subarray(y * 5, y * 5 + 5)];
    expect(row(0)).toEqual([0, 0, 0, 0, 0]);
    expect(row(1)).toEqual([0, 255, 255, 128, 0]);
    expect(row(3)).toEqual([0, 0, 0, 0, 0]);
  });

  it('fills an ellipse in the middle but not its bounding-box corners', () => {
    const shape = rasterizeShape('ellipse', { x0: 0, y0: 0, x1: 20, y1: 10 }, 20, 10)!;
    expect(shape.data[5 * 20 + 10]).toBe(255);
    expect(shape.data[0]).toBe(0);
    expect(shape.data[19]).toBe(0);
    // The edge is soft, not stair-stepped.
    expect([...shape.data].some((v) => v > 0 && v < 255)).toBe(true);
  });

  it('clips to the image and ignores shapes outside it', () => {
    expect(rasterizeShape('rect', { x0: -5, y0: -5, x1: 2, y1: 2 }, 4, 4)!.rect).toEqual({ x: 0, y: 0, w: 2, h: 2 });
    expect(rasterizeShape('rect', { x0: 10, y0: 10, x1: 12, y1: 12 }, 4, 4)).toBeNull();
  });
});
