import { boxMean } from './filters';
import type { Rect } from './mask';

/** A full-size single-channel plane, e.g. a brush stroke's coverage. */
export interface Plane {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Colour difference (RGB distance) below which the inside and outside are "the same". */
const MIN_CONTRAST = 30;
const FULL_CONTRAST = 60;

/**
 * Core of edge snapping. Reads coverage from `src`, computes over `region`, and
 * writes results for `write` (inside `region`) into `dst`.
 */
function snapRegion(
  src: Uint8Array,
  dst: Uint8Array,
  width: number,
  rgba: Uint8ClampedArray,
  region: Rect,
  write: Rect,
  radius: number,
): void {
  const n = region.w * region.h;
  const inW = new Float32Array(n), inR = new Float32Array(n), inG = new Float32Array(n), inB = new Float32Array(n);
  const outW = new Float32Array(n), outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n);
  for (let row = 0; row < region.h; row++) {
    for (let col = 0; col < region.w; col++) {
      const i = row * region.w + col;
      const k = (region.y + row) * width + region.x + col;
      const c = src[k];
      const p = k * 4;
      if (c === 255) {
        inW[i] = 1; inR[i] = rgba[p]; inG[i] = rgba[p + 1]; inB[i] = rgba[p + 2];
      } else if (c === 0) {
        outW[i] = 1; outR[i] = rgba[p]; outG[i] = rgba[p + 1]; outB[i] = rgba[p + 2];
      }
    }
  }

  const box = (a: Float32Array) => boxMean(a, region.w, region.h, radius);
  const [mInW, mInR, mInG, mInB] = [inW, inR, inG, inB].map(box);
  const [mOutW, mOutR, mOutG, mOutB] = [outW, outR, outG, outB].map(box);

  for (let y = write.y; y < write.y + write.h; y++) {
    for (let x = write.x; x < write.x + write.w; x++) {
      const k = y * width + x;
      const c = src[k];
      const i = (y - region.y) * region.w + (x - region.x);
      if (c === 0 || c === 255 || mInW[i] < 1e-3 || mOutW[i] < 1e-3) continue;

      const ir = mInR[i] / mInW[i], ig = mInG[i] / mInW[i], ib = mInB[i] / mInW[i];
      const or = mOutR[i] / mOutW[i], og = mOutG[i] / mOutW[i], ob = mOutB[i] / mOutW[i];
      const dr = ir - or, dg = ig - og, db = ib - ob;
      const contrast2 = dr * dr + dg * dg + db * db;
      if (contrast2 < MIN_CONTRAST * MIN_CONTRAST) continue;

      // Where does this pixel's colour fall on the line from outside to inside?
      const p = k * 4;
      const t = ((rgba[p] - or) * dr + (rgba[p + 1] - og) * dg + (rgba[p + 2] - ob) * db) / contrast2;
      // Near-certain pixels go all the way, so no faint haze is left behind.
      const snapped = t < 0.02 ? 0 : t > 0.98 ? 255 : t * 255;
      const confidence = Math.min(1, (Math.sqrt(contrast2) - MIN_CONTRAST) / (FULL_CONTRAST - MIN_CONTRAST));
      dst[k] = Math.round(confidence * snapped + (1 - confidence) * c);
    }
  }
}

function hasRim(data: Uint8Array, width: number, rect: Rect): boolean {
  for (let y = rect.y; y < rect.y + rect.h; y++) {
    for (let k = y * width + rect.x, end = k + rect.w; k < end; k++) {
      if (data[k] !== 0 && data[k] !== 255) return true;
    }
  }
  return false;
}

/**
 * Snap the soft rim of a selection to the image's real edge. For each partly
 * covered pixel, compare its colour with the average colour of the fully
 * covered pixels nearby (inside) and the uncovered ones (outside), and set its
 * coverage to where it falls between the two. Where inside and outside look
 * alike (a flat area), the selection is left exactly as it was.
 * `rect` should include a margin of `radius` around the rim. Updates `plane` in place.
 */
export function snapToEdges(plane: Plane, rgba: Uint8ClampedArray, rect: Rect, radius: number): void {
  if (!hasRim(plane.data, plane.width, rect)) return;
  // Reading and writing the same plane is safe here: each pixel only writes itself after all reads.
  snapRegion(plane.data, plane.data, plane.width, rgba, rect, rect, radius);
}

const TILE = 256;

/**
 * The same as snapToEdges, for large areas such as a whole-image selection:
 * works tile by tile (skipping tiles with no rim) so memory stays small.
 */
export function snapToEdgesTiled(plane: Plane, rgba: Uint8ClampedArray, rect: Rect, radius: number): void {
  const src = plane.data.slice();
  const { width, height } = plane;
  for (let ty = rect.y; ty < rect.y + rect.h; ty += TILE) {
    for (let tx = rect.x; tx < rect.x + rect.w; tx += TILE) {
      const write = {
        x: tx,
        y: ty,
        w: Math.min(TILE, rect.x + rect.w - tx),
        h: Math.min(TILE, rect.y + rect.h - ty),
      };
      if (!hasRim(src, width, write)) continue;
      const x0 = Math.max(0, write.x - radius), y0 = Math.max(0, write.y - radius);
      const x1 = Math.min(width, write.x + write.w + radius), y1 = Math.min(height, write.y + write.h + radius);
      snapRegion(src, plane.data, width, rgba, { x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, write, radius);
    }
  }
}
