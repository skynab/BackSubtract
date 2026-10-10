import { describe, expect, it } from 'vitest';
import { adjustEdges, cleanSpecks, cleanupArea, NO_ADJUST, shiftEdges, softenEdges } from './adjust';

const W = 60;
const H = 60;

/** A hard-edged disk of radius r in the middle. */
function disk(r: number): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = Math.hypot(x - 30, y - 30) <= r ? 255 : 0;
  return m;
}

const count = (m: Uint8Array, min = 128) => m.reduce((n, v) => n + (v >= min ? 1 : 0), 0);
/** How far the kept area reaches along a row from the centre. */
const reach = (m: Uint8Array) => {
  let x = 30;
  while (x < W && m[30 * W + x] >= 128) x++;
  return x - 30;
};

describe('shiftEdges', () => {
  it('moves the edge out or in by the given number of pixels', () => {
    const m = disk(15);
    expect(reach(m)).toBe(16);
    expect(reach(shiftEdges(m, W, H, 4))).toBe(20);
    // Shrinking a curved edge with a near-round shape takes it in by 4 or 5 px.
    expect(reach(shiftEdges(m, W, H, -4))).toBeGreaterThanOrEqual(11);
    expect(reach(shiftEdges(m, W, H, -4))).toBeLessThanOrEqual(12);
  });

  it('grows a near-round shape, not a square', () => {
    const grown = shiftEdges(disk(10), W, H, 8);
    // Straight out, the edge moved 8 px; along the diagonal it moved about as far, not 8√2.
    expect(grown[30 * W + 30 + 18]).toBe(255);
    const d = Math.round(18 / Math.SQRT2) + 2;
    expect(grown[(30 + d) * W + 30 + d]).toBe(0);
  });

  it('keeps a soft edge soft', () => {
    const m = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = Math.max(0, Math.min(255, (x - 20) * 25));
    const grown = shiftEdges(m, W, H, 3);
    // The ramp from 0 to 255 is the same width, just 3 px further left.
    for (let x = 17; x < 28; x++) expect(grown[30 * W + x]).toBe(m[30 * W + x + 3]);
  });

  it('working tile by tile gives exactly the same result as the whole image at once', () => {
    // A plain reference: n alternating square / plus steps over the whole image.
    const reference = (m: Uint8Array, w: number, h: number, n: number) => {
      let a = m.slice();
      for (let i = 0; i < n; i++) {
        const b = new Uint8Array(a.length);
        for (let y = 0; y < h; y++) {
          for (let x = 0; x < w; x++) {
            let v = 0;
            for (let dy = -1; dy <= 1; dy++) {
              for (let dx = -1; dx <= 1; dx++) {
                if (i % 2 === 1 && dx && dy) continue;
                const xx = x + dx, yy = y + dy;
                if (xx >= 0 && yy >= 0 && xx < w && yy < h) v = Math.max(v, a[yy * w + xx]);
              }
            }
            b[y * w + x] = v;
          }
        }
        a = b;
      }
      return a;
    };
    // Scattered soft blobs over several 64 px tiles, some right on tile seams.
    const w = 150, h = 140;
    const m = new Uint8Array(w * h);
    let seed = 3;
    const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
    for (let k = 0; k < 12; k++) {
      const cx = rnd() * w, cy = rnd() * h, r = 2 + rnd() * 10;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const v = Math.round(Math.max(0, Math.min(1, r - Math.hypot(x - cx, y - cy))) * 255);
        if (v > m[y * w + x]) m[y * w + x] = v;
      }
    }
    for (const n of [1, 4, 8]) {
      expect(shiftEdges(m, w, h, n)).toEqual(reference(m, w, h, n));
      const inv = m.map((v) => 255 - v);
      expect(shiftEdges(m, w, h, -n)).toEqual(reference(inv, w, h, n).map((v) => 255 - v));
    }
  });

  it('does nothing at zero', () => {
    const m = disk(10);
    expect(shiftEdges(m, W, H, 0)).toEqual(m);
  });
});

describe('softenEdges', () => {
  it('softening blurs the edge and leaves flat areas alone', () => {
    const m = disk(15);
    softenEdges(m, W, H, 4);
    expect(m[30 * W + 30]).toBe(255);
    expect(m[0]).toBe(0);
    const edge = m[30 * W + 45];
    expect(edge).toBeGreaterThan(40);
    expect(edge).toBeLessThan(215);
  });

  it('matches a plain box blur (clamped at the borders), twice over', () => {
    const blur = (m: Uint8Array, w: number, h: number, r: number) => {
      const at = (x: number, y: number) => m[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
      const across = new Uint8Array(m.length);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += at(x + d, y);
        across[y * w + x] = (s / (2 * r + 1) + 0.5) | 0;
      }
      const out = new Uint8Array(m.length);
      const at2 = (x: number, y: number) => across[Math.min(h - 1, Math.max(0, y)) * w + x];
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        let s = 0;
        for (let d = -r; d <= r; d++) s += at2(x, y + d);
        out[y * w + x] = (s / (2 * r + 1) + 0.5) | 0;
      }
      return out;
    };
    const w = 23, h = 17;
    const m = new Uint8Array(w * h).map((_, i) => ((i * 37) % 11) * 23);
    const ours = m.slice();
    softenEdges(ours, w, h, 5);
    expect(ours).toEqual(blur(blur(m, w, h, 3), w, h, 2));

    // Across tile seams, with flat tiles (skipped) next to busy ones.
    const W2 = 200, H2 = 150;
    const big = new Uint8Array(W2 * H2);
    for (let y = 0; y < H2; y++) for (let x = 0; x < W2; x++) big[y * W2 + x] = x > 60 && x < 140 && y > 62 && y < 100 ? 255 : 0;
    big[10 * W2 + 190] = 200;
    const oursBig = big.slice();
    softenEdges(oursBig, W2, H2, 8);
    expect(oursBig).toEqual(blur(blur(big, W2, H2, 4), W2, H2, 4));
  });

  it('crisping steepens a fade around its middle', () => {
    const m = new Uint8Array([0, 64, 100, 128, 160, 200, 255]);
    softenEdges(m, 7, 1, -4);
    expect([...m]).toEqual([0, 0, 34, 129, 238, 255, 255]);
  });
});

describe('cleanSpecks', () => {
  it('removes small islands and fills small holes, but keeps big areas and the background', () => {
    const m = disk(15);
    // A 3×3 speck outside the disk, a 3×3 hole inside it.
    for (let y = 5; y < 8; y++) for (let x = 5; x < 8; x++) m[y * W + x] = 255;
    for (let y = 29; y < 32; y++) for (let x = 29; x < 32; x++) m[y * W + x] = 0;
    // The speck's soft rim.
    m[4 * W + 6] = 90;
    cleanSpecks(m, W, H, 20);
    expect(m[6 * W + 6]).toBe(0);
    expect(m[4 * W + 6]).toBe(0);
    expect(m[30 * W + 30]).toBe(255);
    expect(count(m)).toBe(count(disk(15)));
  });

  it('leaves a hole that touches the image border (that is background)', () => {
    const m = new Uint8Array(W * H).fill(255);
    for (let x = 0; x < 3; x++) m[30 * W + x] = 0;
    cleanSpecks(m, W, H, 20);
    expect(m[30 * W]).toBe(0);
  });

  it('strength 0 is off, and the size grows with strength', () => {
    expect(cleanupArea(0, 1000, 1000)).toBe(0);
    expect(cleanupArea(5, 1000, 1000)).toBeLessThan(cleanupArea(10, 1000, 1000));
  });
});

describe('adjustEdges', () => {
  it('returns an unchanged copy with no adjustment', () => {
    const m = disk(10);
    const out = adjustEdges(m, W, H, NO_ADJUST);
    expect(out).toEqual(m);
    expect(out).not.toBe(m);
  });
});
