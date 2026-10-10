import { describe, expect, it } from 'vitest';
import { Mask } from '../../mask/mask';
import { snapToEdges, snapToEdgesTiled, type Plane } from '../../mask/snap';
import { stampDab, stampSegment } from './brush';

const plane = (width: number, height: number): Plane => ({ data: new Uint8Array(width * height), width, height });

describe('stamping', () => {
  it('covers the centre fully and leaves far pixels alone', () => {
    const p = plane(20, 20);
    const rect = stampDab(p, 10, 10, 4);
    expect(rect).toEqual({ x: 6, y: 6, w: 8, h: 8 });
    expect(p.data[10 * 20 + 10]).toBe(255);
    expect(p.data[0]).toBe(0);
  });

  it('has a soft edge', () => {
    const p = plane(40, 1);
    stampDab(p, 20, 0.5, 10);
    const edge = p.data[28]; // 8.5px from the centre, inside the feather band
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('hardness sets how far from the centre the fade starts', () => {
    const at = (hardness: number) => {
      const p = plane(40, 1);
      stampDab(p, 20, 0.5, 10, hardness);
      return p.data[25]; // 5.5px from the centre
    };
    expect(at(1)).toBe(255);
    expect(at(0.6)).toBe(255);
    expect(at(0)).toBeLessThan(at(0.3));
    expect(at(0)).toBeGreaterThan(0);
  });

  it('a fully hard brush still fades over its last pixel', () => {
    const p = plane(40, 1);
    stampDab(p, 20, 0.5, 10, 1);
    expect(p.data[29]).toBeGreaterThan(0); // 9.5px out
    expect(p.data[29]).toBeLessThan(255);
    expect(p.data[27]).toBe(255);
  });

  it('overlapping dabs do not build up', () => {
    const once = plane(20, 20);
    stampDab(once, 10, 10, 6);
    const twice = plane(20, 20);
    stampDab(twice, 10, 10, 6);
    stampDab(twice, 10, 10, 6);
    expect(twice.data).toEqual(once.data);
  });

  it('clips dabs at the image edge', () => {
    const p = plane(10, 10);
    expect(stampDab(p, 0, 0, 3)).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(stampDab(p, -20, -20, 3)).toBeNull();
  });

  it('a Keep stroke restores what a Remove stroke hid', () => {
    const mask = new Mask(30, 30);
    const full = { x: 0, y: 0, w: 30, h: 30 };
    const removeStroke = plane(30, 30);
    stampDab(removeStroke, 5, 15, 4);
    stampSegment(removeStroke, 5, 15, 25, 15, 4);
    mask.apply(removeStroke.data, full, 'remove');
    expect(mask.data[15 * 30 + 15]).toBe(0);

    const keepStroke = plane(30, 30);
    stampDab(keepStroke, 5, 15, 8);
    stampSegment(keepStroke, 5, 15, 25, 15, 8);
    mask.apply(keepStroke.data, full, 'keep');
    expect(mask.data.every((v) => v === 255)).toBe(true);
  });
});

describe('snapToEdges', () => {
  /** RGBA image: dark grey left of x = 20, light grey from x = 20. */
  function stepImage(w: number, h: number) {
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = x < 20 ? 30 : 220;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    return rgba;
  }

  it("moves a stroke's soft rim onto the image edge", () => {
    const w = 40, h = 10;
    // Full coverage left of x = 16, then a soft rim fading out across x = 16..25,
    // which straddles the real edge at x = 20.
    const p = plane(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) p.data[y * w + x] = x < 16 ? 255 : x < 26 ? Math.round(255 * (26 - x) / 10) : 0;

    snapToEdges(p, stepImage(w, h), { x: 0, y: 0, w, h }, 8);
    const row = 5 * w;
    expect(p.data[row + 10]).toBe(255); // inside: unchanged
    expect(p.data[row + 19]).toBe(255); // rim on the stroke's side of the edge: firmed up
    expect(p.data[row + 21]).toBe(0); // rim past the edge: pulled back
    expect(p.data[row + 35]).toBe(0); // outside: unchanged
  });

  it('the tiled version gives the same result as the single-region one', () => {
    const w = 600, h = 300;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const v = (x - 300) ** 2 + (y - 150) ** 2 < 100 ** 2 ? 220 : 30;
        rgba.set([v, v, v, 255], (y * w + x) * 4);
      }
    const a = plane(w, h);
    stampDab(a, 300, 150, 108, 0.85);
    const b = { ...a, data: a.data.slice() };
    const all = { x: 0, y: 0, w, h };
    snapToEdges(a, rgba, all, 16);
    snapToEdgesTiled(b, rgba, all, 16);
    expect(b.data).toEqual(a.data);
    expect(a.data[150 * w + 395]).toBe(255); // just inside the circle
    expect(a.data[150 * w + 405]).toBe(0); // just outside
  });

  it('leaves a stroke on a flat area exactly as painted', () => {
    const w = 30, h = 30;
    const rgba = new Uint8ClampedArray(w * h * 4).fill(128);
    const p = plane(w, h);
    stampDab(p, 15, 15, 6);
    const before = p.data.slice();
    snapToEdges(p, rgba, { x: 0, y: 0, w, h }, 3);
    expect(p.data).toEqual(before);
  });
});
