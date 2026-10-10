/**
 * Golden images: each tool is run on a fixed, photo-like scene and the resulting
 * cutout is compared with a reference PNG in this folder. The PNGs double as a
 * visual record of what each tool produces — open them to see.
 *
 * After an intended change in output, regenerate with `npm run golden:update`
 * and look at the new images before committing them.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { decodePng, encodePng } from '../scripts/png.mjs';
import { cleanEdges } from '../src/export/edges';
import { applyMaskAlpha } from '../src/export/exportImage';
import { Mask, padRect } from '../src/mask/mask';
import { snapToEdges, type Plane } from '../src/mask/snap';
import { snapRadius, stampDab, stampSegment } from '../src/tools/brush/brush';
import { distanceMap, rgbToLab } from '../src/tools/color/lab';
import { refineEdges, selectContiguous, selectGlobal } from '../src/tools/color/select';

const W = 320;
const H = 240;
const BALL = { x: 150, y: 120, r: 70 };
const UPDATE = process.env.UPDATE_GOLDEN === '1';

/** Small seeded random generator, so the "photo noise" is identical on every run. */
function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A shaded ball on a background, with anti-aliased edges and a little sensor noise. */
function scene(background: (x: number, y: number) => [number, number, number], seed: number): Uint8ClampedArray {
  const rand = seeded(seed);
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      // 4×4 supersampling of the ball's outline gives a soft, realistic edge.
      let cover = 0;
      for (let sy = 0; sy < 4; sy++)
        for (let sx = 0; sx < 4; sx++)
          if ((x + (sx + 0.5) / 4 - BALL.x) ** 2 + (y + (sy + 0.5) / 4 - BALL.y) ** 2 <= BALL.r ** 2) cover++;
      cover /= 16;
      // Light from the top left.
      const d = Math.min(1, Math.hypot(x - (BALL.x - 25), y - (BALL.y - 25)) / (BALL.r * 1.6));
      const ball: [number, number, number] = [250 - 120 * d, 160 - 120 * d, 60 - 50 * d];
      const bg = background(x, y);
      const noise = (rand() - 0.5) * 8;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) rgba[i + c] = ball[c] * cover + bg[c] * (1 - cover) + noise;
      rgba[i + 3] = 255;
    }
  }
  return rgba;
}

const studio = scene((_, y) => {
  const t = y / H;
  return [201 + (232 - 201) * t, 214 + (226 - 214) * t, 223 + (214 - 223) * t];
}, 1);
const greenScreen = scene(() => [31, 178, 74], 2);

/** What the app would export: original pixels, edge colours cleaned, mask as transparency. */
function cutout(pixels: Uint8ClampedArray, mask: Mask): Uint8Array {
  const rgba = new Uint8ClampedArray(pixels);
  cleanEdges(rgba, mask.data, W, H);
  applyMaskAlpha(rgba, mask.data);
  return new Uint8Array(rgba.buffer);
}

function tap(pixels: Uint8ClampedArray, x: number, y: number) {
  const p = (y * W + x) * 4;
  return distanceMap(pixels, rgbToLab(pixels[p], pixels[p + 1], pixels[p + 2]));
}

/** Compare with (or, when updating, write) golden/<name>.png. Allows ±2 per channel for float differences between platforms. */
function matchGolden(name: string, rgba: Uint8Array) {
  const file = new URL(`./${name}.png`, import.meta.url);
  if (UPDATE) {
    writeFileSync(file, encodePng(W, H, rgba));
    return;
  }
  expect(existsSync(file), `golden/${name}.png is missing — run npm run golden:update`).toBe(true);
  const golden = decodePng(readFileSync(file));
  expect([golden.width, golden.height]).toEqual([W, H]);
  let worst = 0, differing = 0;
  for (let i = 0; i < rgba.length; i++) {
    const d = Math.abs(rgba[i] - golden.rgba[i]);
    if (d > worst) worst = d;
    if (d > 2) differing++;
  }
  expect(differing, `${name}: ${differing} channel values differ (worst ${worst})`).toBe(0);
}

/** Alpha at an image pixel of a cutout. */
const alpha = (rgba: Uint8Array, x: number, y: number) => rgba[(y * W + x) * 4 + 3];

describe('golden images', () => {
  it('Magic Wand: tap the studio background', () => {
    const mask = new Mask(W, H);
    const sel = refineEdges(selectContiguous(tap(studio, 5, 5), W, H, 5, 5, 20)!, studio, W, H);
    mask.apply(sel.data, sel.rect, 'remove');
    const out = cutout(studio, mask);
    expect(alpha(out, 5, 5)).toBe(0);
    expect(alpha(out, BALL.x, BALL.y)).toBe(255);
    matchGolden('wand-studio', out);
  });

  it('Color: tap a green screen (with edge colour cleanup)', () => {
    const mask = new Mask(W, H);
    const sel = refineEdges(selectGlobal(tap(greenScreen, 5, 5), W, H, 15)!, greenScreen, W, H);
    mask.apply(sel.data, sel.rect, 'remove');
    const out = cutout(greenScreen, mask);
    expect(alpha(out, 5, 5)).toBe(0);
    expect(alpha(out, BALL.x, BALL.y)).toBe(255);
    // No green fringe: no clearly visible pixel is more green than red.
    let fringe = 0;
    for (let i = 0; i < out.length; i += 4) if (out[i + 3] > 32 && out[i + 1] > out[i]) fringe++;
    expect(fringe).toBe(0);
    matchGolden('color-greenscreen', out);
  });

  it('Brush: a Remove stroke beside the ball snaps to its edge', () => {
    const mask = new Mask(W, H);
    const coverage: Plane = { data: new Uint8Array(W * H), width: W, height: H };
    // A vertical stroke whose soft rim overlaps the ball's right edge (x = 220).
    const radius = 40, x = BALL.x + BALL.r + 25;
    const r1 = stampDab(coverage, x, 40, radius)!;
    const r2 = stampSegment(coverage, x, 40, x, 200, radius)!;
    const dirty = { x: Math.min(r1.x, r2.x), y: Math.min(r1.y, r2.y), w: Math.max(r1.x + r1.w, r2.x + r2.w) - Math.min(r1.x, r2.x), h: Math.max(r1.y + r1.h, r2.y + r2.h) - Math.min(r1.y, r2.y) };
    const r = snapRadius(radius);
    const rect = mask.clip(padRect(dirty, r))!;
    snapToEdges(coverage, studio, rect, r);
    mask.combineFrom(mask.data.slice(), coverage.data, rect, 'remove');
    const out = cutout(studio, mask);
    expect(alpha(out, BALL.x + BALL.r - 4, BALL.y)).toBe(255); // ball's edge kept
    expect(alpha(out, BALL.x + BALL.r + 4, BALL.y)).toBe(0); // background beside it removed
    matchGolden('brush-snap-studio', out);
  });
});
