import { describe, expect, it } from 'vitest';
import { combine, extract, Mask, unionRect } from './mask';

describe('combine', () => {
  it('Keep only ever reveals and Remove only ever hides', () => {
    expect(combine(100, 200, 'keep')).toBe(200);
    expect(combine(100, 50, 'keep')).toBe(100);
    expect(combine(200, 255, 'remove')).toBe(0);
    expect(combine(40, 100, 'remove')).toBe(40);
  });
});

describe('Mask', () => {
  it('starts fully visible', () => {
    expect(new Mask(3, 2).data.every((v) => v === 255)).toBe(true);
  });

  it('can fully recover an area hidden by Remove using Keep', () => {
    const mask = new Mask(4, 4);
    const rect = { x: 1, y: 1, w: 2, h: 2 };
    const sel = new Uint8Array(4).fill(255);
    mask.apply(sel, rect, 'remove');
    expect([...mask.read(rect)]).toEqual([0, 0, 0, 0]);
    mask.apply(sel, rect, 'keep');
    expect(mask.data.every((v) => v === 255)).toBe(true);
  });

  it('reads and writes rectangles', () => {
    const mask = new Mask(4, 3);
    const rect = { x: 1, y: 1, w: 2, h: 2 };
    mask.write(rect, new Uint8Array([1, 2, 3, 4]));
    expect([...mask.read(rect)]).toEqual([1, 2, 3, 4]);
    expect(mask.data[0]).toBe(255);
    expect(mask.data[1 * 4 + 1]).toBe(1);
    expect(mask.data[2 * 4 + 2]).toBe(4);
  });

  it('clips rectangles to its bounds', () => {
    const mask = new Mask(10, 10);
    expect(mask.clip({ x: -5, y: 8, w: 10, h: 10 })).toEqual({ x: 0, y: 8, w: 5, h: 2 });
    expect(mask.clip({ x: 20, y: 0, w: 5, h: 5 })).toBeNull();
  });

  it('rejects data of the wrong size', () => {
    expect(() => new Mask(2, 2, new Uint8Array(3))).toThrow();
  });
});

describe('helpers', () => {
  it('unionRect covers both rects', () => {
    expect(unionRect({ x: 0, y: 0, w: 2, h: 2 }, { x: 5, y: 1, w: 1, h: 4 })).toEqual({ x: 0, y: 0, w: 6, h: 5 });
    expect(unionRect(null, { x: 1, y: 1, w: 1, h: 1 })).toEqual({ x: 1, y: 1, w: 1, h: 1 });
  });

  it('extract copies a sub-rectangle', () => {
    const data = new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect([...extract(data, 3, { x: 1, y: 1, w: 2, h: 2 })]).toEqual([4, 5, 7, 8]);
  });
});
