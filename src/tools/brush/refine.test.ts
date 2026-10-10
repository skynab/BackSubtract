import { describe, expect, it } from 'vitest';
import { refineAlpha } from './refine';

const W = 40;
const H = 20;
const F = [220, 60, 40];
const B = [40, 80, 220];

/**
 * Subject colour F on the left, background B on the right, and in between
 * (x = 18..21) "hair": pixels mixed from F and B in known amounts.
 */
const MIX = [0.8, 0.55, 0.3, 0.1];

function scene(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const a = x < 18 ? 1 : x > 21 ? 0 : MIX[x - 18];
      const p = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) rgba[p + c] = Math.round(a * F[c] + (1 - a) * B[c]);
      rgba[p + 3] = 255;
    }
  }
  return rgba;
}

/** A hard mask that cuts straight through the hair at x = 20, as a model might. */
function hardMask(): Uint8Array {
  const m = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) m[y * W + x] = x < 20 ? 255 : 0;
  return m;
}

describe('refineAlpha', () => {
  it('recovers how much of each mixed pixel is subject', () => {
    const base = hardMask();
    const coverage = new Uint8Array(W * H);
    // A stroke over the hair, columns 15..24.
    for (let y = 0; y < H; y++) for (let x = 15; x < 25; x++) coverage[y * W + x] = 255;
    const out = base.slice();
    refineAlpha(scene(), base, coverage, out, W, { x: 0, y: 0, w: W, h: H }, 12);
    for (let i = 0; i < MIX.length; i++) {
      expect(Math.abs(out[10 * W + 18 + i] - MIX[i] * 255)).toBeLessThanOrEqual(3);
    }
    // Solid subject and background under the stroke stay as they are.
    expect(out[10 * W + 16]).toBe(255);
    expect(out[10 * W + 23]).toBe(0);
    // Outside the stroke nothing changes.
    expect(out[10 * W + 5]).toBe(255);
  });

  it('leaves the mask alone where subject and background look alike', () => {
    const rgba = new Uint8ClampedArray(W * H * 4).fill(128);
    const base = hardMask();
    const coverage = new Uint8Array(W * H).fill(255, 10 * W, 11 * W);
    const out = base.slice();
    refineAlpha(rgba, base, coverage, out, W, { x: 0, y: 0, w: W, h: H }, 12);
    expect(out).toEqual(base);
  });

  it('blends in at the stroke soft rim', () => {
    const base = hardMask();
    const coverage = new Uint8Array(W * H);
    for (let y = 0; y < H; y++) for (let x = 15; x < 25; x++) coverage[y * W + x] = 128;
    const out = base.slice();
    refineAlpha(scene(), base, coverage, out, W, { x: 0, y: 0, w: W, h: H }, 12);
    // Half way between the hard mask (255) and the recovered 0.55 × 255.
    expect(Math.abs(out[10 * W + 19] - (255 + 0.55 * 255) / 2)).toBeLessThanOrEqual(3);
  });
});
