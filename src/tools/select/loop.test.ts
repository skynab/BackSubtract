import { describe, expect, it } from 'vitest';
import { resizePlane } from '../../mask/resample';
import { bestFit, dilate, distanceInside, loopPrompts, mostConfident } from './loop';

/** A filled rectangle in a w × h plane. */
function rect(w: number, h: number, x0: number, y0: number, x1: number, y1: number) {
  const p = new Uint8Array(w * h);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) p[y * w + x] = 255;
  return p;
}

describe('loop prompts', () => {
  it('measures distance to the edge of the loop', () => {
    const d = distanceInside(rect(21, 21, 0, 0, 21, 21), 21, 21);
    expect(d[10 * 21 + 10]).toBeCloseTo(11, 0); // centre: 11 px to the outside
    expect(d[0]).toBeCloseTo(1, 0);
  });

  it('puts object points deep inside and background points outside', () => {
    const w = 100, h = 80;
    const inside = rect(w, h, 20, 20, 80, 60);
    const prompts = loopPrompts(inside, w, h)!;
    const at = ([x, y]: [number, number]) => inside[y * w + x];
    const pos = prompts.candidates;
    const neg = prompts.negatives;
    expect(pos.length).toBeGreaterThanOrEqual(1);
    expect(neg.length).toBeGreaterThanOrEqual(4);
    expect(pos.every((p) => at(p) === 255)).toBe(true);
    expect(neg.every((p) => at(p) === 0)).toBe(true);
    // The first point is the deepest one: near the middle of the loop.
    expect(Math.abs(pos[0][0] - 50)).toBeLessThan(25);
    expect(Math.abs(pos[0][1] - 40)).toBeLessThan(5);
  });

  it('a tap takes the proposal SAM is most confident about', () => {
    expect(mostConfident([0.7, 0.95, 0.8])).toEqual({ index: 1, score: 0.95 });
  });

  it('a loop takes the proposal that fills it without spilling out', () => {
    const w = 20, h = 10, size = w * h;
    const loop = rect(w, h, 5, 2, 15, 8); // 10 x 6 = 60 px
    const object = rect(w, h, 6, 3, 14, 7); // inside the loop
    const background = rect(w, h, 0, 0, 20, 10); // the whole image
    const tiny = rect(w, h, 9, 4, 10, 5);
    const masks = new Uint8Array(size * 3);
    masks.set(background, 0);
    masks.set(object, size);
    masks.set(tiny, size * 2);
    // SAM is most confident about the background, but it spills far outside the loop.
    expect(bestFit(masks, [0.99, 0.9, 0.95], loop, 60).index).toBe(1);
  });

  it('returns null for an empty loop', () => {
    expect(loopPrompts(new Uint8Array(100), 10, 10)).toBeNull();
  });

  it('dilate grows a region by r pixels', () => {
    const grown = dilate(rect(10, 10, 4, 4, 6, 6), 10, 10, 2);
    expect(grown[2 * 10 + 2]).toBe(255);
    expect(grown[1 * 10 + 1]).toBe(0);
    expect(grown[7 * 10 + 7]).toBe(255);
  });
});

describe('resizePlane', () => {
  it('scales up with a soft ramp at edges and keeps flat areas flat', () => {
    const src = new Uint8Array([0, 0, 255, 255]);
    const out = resizePlane(src, 4, 1, 16, 1);
    expect(out[0]).toBe(0);
    expect(out[15]).toBe(255);
    const mid = out[7];
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(255);
    for (let i = 1; i < 16; i++) expect(out[i]).toBeGreaterThanOrEqual(out[i - 1]);
  });

  it('keeps the same size unchanged', () => {
    const src = Uint8Array.from({ length: 12 }, (_, i) => i * 20);
    expect(resizePlane(src, 4, 3, 4, 3)).toEqual(src);
  });
});
