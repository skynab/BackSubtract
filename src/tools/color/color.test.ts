import { describe, expect, it } from 'vitest';
import { DIST_SCALE, distanceMap, rgbToLab, softness } from './lab';
import { selectContiguous, selectGlobal } from './select';

/** Build RGBA pixels from a grid of single-character colour codes. */
function image(rows: string[], palette: Record<string, [number, number, number]>) {
  const width = rows[0].length;
  const height = rows.length;
  const rgba = new Uint8ClampedArray(width * height * 4);
  rows.forEach((row, y) =>
    [...row].forEach((ch, x) => {
      rgba.set([...palette[ch], 255], (y * width + x) * 4);
    }),
  );
  return { rgba, width, height };
}

const palette: Record<string, [number, number, number]> = {
  g: [0, 200, 0],
  G: [10, 205, 8], // a nearly identical green
  r: [220, 30, 30],
};

describe('lab', () => {
  it('converts known colours', () => {
    const [l, a, b] = rgbToLab(255, 255, 255);
    expect(l).toBeCloseTo(100, 0);
    expect(a).toBeCloseTo(0, 0);
    expect(b).toBeCloseTo(0, 0);
    expect(rgbToLab(0, 0, 0)[0]).toBeCloseTo(0, 5);
  });

  it('measures perceptual distance', () => {
    const { rgba } = image(['gGr'], palette);
    const dist = distanceMap(rgba, rgbToLab(0, 200, 0));
    expect(dist[0]).toBe(0);
    expect(dist[1] / DIST_SCALE).toBeLessThan(5);
    expect(dist[2] / DIST_SCALE).toBeGreaterThan(50);
  });

  it('softness is full inside the tolerance and fades at its edge', () => {
    const lut = softness(10);
    expect(lut[0]).toBe(255);
    expect(lut[10 * DIST_SCALE]).toBe(0);
    expect(lut[10 * DIST_SCALE - 1]).toBeGreaterThan(0);
    expect(lut[10 * DIST_SCALE - 1]).toBeLessThan(255);
  });
});

describe('selection', () => {
  const pic = image(
    [
      'ggrgg',
      'ggrGg',
      'rrrgg',
      'ggrgg',
    ],
    palette,
  );
  const dist = distanceMap(pic.rgba, rgbToLab(0, 200, 0));
  const at = (data: Uint8Array, x: number, y: number) => data[y * pic.width + x];

  it('Magic Wand selects only the connected region', () => {
    const sel = selectContiguous(dist, pic.width, pic.height, 0, 0, 10)!;
    expect(at(sel.data, 0, 0)).toBe(255);
    expect(at(sel.data, 1, 1)).toBe(255);
    expect(at(sel.data, 2, 0)).toBe(0); // red wall
    expect(at(sel.data, 3, 0)).toBe(0); // green, but on the other side of the wall
    expect(at(sel.data, 0, 3)).toBe(0); // green, but cut off by the red row
    expect(sel.rect).toEqual({ x: 0, y: 0, w: 2, h: 2 });
  });

  it('Magic Wand flows through near-identical colours', () => {
    const sel = selectContiguous(dist, pic.width, pic.height, 4, 0, 10)!;
    expect(at(sel.data, 3, 1)).toBeGreaterThan(0); // the "G" pixel
    expect(at(sel.data, 4, 3)).toBe(255);
    expect(at(sel.data, 0, 0)).toBe(0);
  });

  it('Color selects every matching pixel, connected or not', () => {
    const sel = selectGlobal(dist, pic.width, pic.height, 10)!;
    expect(at(sel.data, 0, 0)).toBe(255);
    expect(at(sel.data, 3, 0)).toBe(255);
    expect(at(sel.data, 0, 3)).toBe(255);
    expect(at(sel.data, 2, 2)).toBe(0);
    expect(sel.rect).toEqual({ x: 0, y: 0, w: 5, h: 4 });
  });

  it('always includes the tapped pixel', () => {
    const sel = selectContiguous(dist, pic.width, pic.height, 2, 0, 1)!;
    expect(at(sel.data, 2, 0)).toBeGreaterThan(0);
  });

  it('ignores taps outside the image', () => {
    expect(selectContiguous(dist, pic.width, pic.height, -1, 0, 10)).toBeNull();
  });
});
