import { boxMean } from '../../mask/filters';
import type { Rect } from '../../mask/mask';

/** Mask values counted as certainly kept / certainly removed when sampling colours. */
const SURE_KEPT = 250;
const SURE_REMOVED = 5;
/** Colour difference (RGB distance) below which kept and removed colours are too alike to tell apart. */
const MIN_CONTRAST = 25;
const FULL_CONTRAST = 60;
/** Colours are gathered on a grid this many times finer than the reach: they change slowly, so that's plenty. */
const GRID_PER_REACH = 12;

/**
 * How far around a stroke's pixels colours are sampled, in image px. A pixel
 * near one side of the stroke is up to a full brush width from the other side,
 * and both sides must be in reach.
 */
export const refineReach = (brushRadius: number) => Math.ceil(2 * brushRadius) + 8;

/**
 * The refine brush, for hair and fur: inside the stroke, work out how much of
 * each pixel is subject and how much is background, from the colours around it.
 *
 * A pixel's colour is a mix C = αF + (1 − α)B of the subject colour F and the
 * background colour B. F is estimated as the average colour of the certainly
 * kept pixels nearby, and B of the certainly removed ones, both sampled outside
 * the stroke (the stroke marks where the mask is unsure). α is where C falls on
 * the line from B to F. Where F and B look alike there is nothing to go on, and
 * the mask is left as it was.
 *
 * The averages are gathered on a coarse grid and interpolated, so memory and
 * time stay small for wide strokes on large photos.
 *
 * `base` is the mask before the stroke, `coverage` the stroke (0–255), `rect`
 * the area to work on: the stroke's bounds grown by `reach`. The new mask
 * values for the covered pixels are written into `out` (full-size planes).
 */
export function refineAlpha(
  rgba: Uint8ClampedArray,
  base: Uint8Array,
  coverage: Uint8Array,
  out: Uint8Array,
  width: number,
  rect: Rect,
  reach: number,
): void {
  const step = Math.max(1, Math.floor(reach / GRID_PER_REACH));
  const gw = Math.ceil(rect.w / step), gh = Math.ceil(rect.h / step);
  const n = gw * gh;
  // Per grid cell: how many sure kept / removed pixels it has, and their summed colours.
  const sums = Array.from({ length: 8 }, () => new Float32Array(n));
  const [fW, fR, fG, fB, bW, bR, bG, bB] = sums;
  for (let row = 0; row < rect.h; row++) {
    const cellRow = ((row / step) | 0) * gw;
    for (let col = 0; col < rect.w; col++) {
      const k = (rect.y + row) * width + rect.x + col;
      if (coverage[k]) continue;
      const m = base[k];
      if (m > SURE_REMOVED && m < SURE_KEPT) continue;
      const c = cellRow + ((col / step) | 0), p = k * 4;
      if (m >= SURE_KEPT) {
        fW[c]++; fR[c] += rgba[p]; fG[c] += rgba[p + 1]; fB[c] += rgba[p + 2];
      } else {
        bW[c]++; bR[c] += rgba[p]; bG[c] += rgba[p + 1]; bB[c] += rgba[p + 2];
      }
    }
  }
  // Averages over the reach: ratios of window means are ratios of window sums.
  const radius = Math.max(1, Math.round(reach / step));
  const [mfW, mfR, mfG, mfB, mbW, mbR, mbG, mbB] = sums.map((a) => boxMean(a, gw, gh, radius));

  const f = [0, 0, 0, 0], b = [0, 0, 0, 0];
  for (let row = 0; row < rect.h; row++) {
    // Grid cell centres sit at (i + 0.5) × step; interpolate between the four around this pixel.
    const gy = Math.min(gh - 1, Math.max(0, (row + 0.5) / step - 0.5));
    const y0 = Math.floor(gy), y1 = Math.min(gh - 1, y0 + 1), wy = gy - y0;
    for (let col = 0; col < rect.w; col++) {
      const k = (rect.y + row) * width + rect.x + col;
      const cov = coverage[k];
      if (!cov) continue;
      const m = base[k];
      out[k] = m;

      const gx = Math.min(gw - 1, Math.max(0, (col + 0.5) / step - 0.5));
      const x0 = Math.floor(gx), x1 = Math.min(gw - 1, x0 + 1), wx = gx - x0;
      const i00 = y0 * gw + x0, i01 = y0 * gw + x1, i10 = y1 * gw + x0, i11 = y1 * gw + x1;
      const w00 = (1 - wx) * (1 - wy), w01 = wx * (1 - wy), w10 = (1 - wx) * wy, w11 = wx * wy;
      const lerp = (a: Float32Array) => a[i00] * w00 + a[i01] * w01 + a[i10] * w10 + a[i11] * w11;
      f[0] = lerp(mfW); f[1] = lerp(mfR); f[2] = lerp(mfG); f[3] = lerp(mfB);
      b[0] = lerp(mbW); b[1] = lerp(mbR); b[2] = lerp(mbG); b[3] = lerp(mbB);
      if (f[0] < 1e-6 || b[0] < 1e-6) continue;

      const fr = f[1] / f[0], fg = f[2] / f[0], fb = f[3] / f[0];
      const br = b[1] / b[0], bg = b[2] / b[0], bb = b[3] / b[0];
      const dr = fr - br, dg = fg - bg, db = fb - bb;
      const contrast2 = dr * dr + dg * dg + db * db;
      if (contrast2 < MIN_CONTRAST * MIN_CONTRAST) continue;

      const p = k * 4;
      const t = ((rgba[p] - br) * dr + (rgba[p + 1] - bg) * dg + (rgba[p + 2] - bb) * db) / contrast2;
      // Near-certain pixels go all the way, so no faint haze is left behind.
      const alpha = t < 0.05 ? 0 : t > 0.95 ? 255 : t * 255;
      const confidence = Math.min(1, (Math.sqrt(contrast2) - MIN_CONTRAST) / (FULL_CONTRAST - MIN_CONTRAST));
      // The stroke's soft rim blends into what was there.
      const w = (cov / 255) * confidence;
      out[k] = Math.round(m + (alpha - m) * w);
    }
  }
}
