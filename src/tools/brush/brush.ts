import { boxMean } from '../../mask/filters';
import { unionRect, type Rect } from '../../mask/mask';

/** A full-size single-channel plane, e.g. a brush stroke's coverage. */
export interface Plane {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Fraction of the radius painted at full strength; the rest fades out. */
export const HARDNESS = 0.6;

/**
 * Add one round, soft-edged dab to a coverage plane. Coverage only ever grows
 * (max), so overlapping dabs in a stroke never build up beyond a single dab.
 */
export function stampDab(plane: Plane, cx: number, cy: number, radius: number, hardness = HARDNESS): Rect | null {
  const r = Math.max(radius, 0.5);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(plane.width, Math.ceil(cx + r));
  const y1 = Math.min(plane.height, Math.ceil(cy + r));
  if (x0 >= x1 || y0 >= y1) return null;

  const inner = r * hardness;
  const feather = r - inner;
  const { data, width } = plane;
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const s = d <= inner ? 255 : Math.round((255 * (r - d)) / feather);
      const i = y * width + x;
      if (s > data[i]) data[i] = s;
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Add dabs along a line, excluding the start point (it was painted by the previous call). */
export function stampSegment(
  plane: Plane,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
): Rect | null {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const spacing = Math.max(0.5, radius * 0.25);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  let dirty: Rect | null = null;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    dirty = unionRect(dirty, stampDab(plane, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius));
  }
  return dirty;
}

/** Neighbourhood size for edge snapping, in image pixels, for a given brush radius. */
export function snapRadius(brushRadius: number): number {
  return Math.round(Math.min(32, Math.max(2, brushRadius * 0.5)));
}

/** Colour difference (RGB distance) below which the inside and outside are "the same". */
const MIN_CONTRAST = 30;
const FULL_CONTRAST = 60;

/**
 * Snap the soft rim of a stroke to the image's real edge. For each partly
 * covered pixel, compare its colour with the average colour of the fully
 * covered pixels nearby (inside) and the uncovered ones (outside), and set its
 * coverage to where it falls between the two. Where inside and outside look
 * alike (a flat area), the stroke is left exactly as painted.
 * `rect` should include a margin of `radius` around the stroke. Updates `plane` in place.
 */
export function snapToEdges(plane: Plane, rgba: Uint8ClampedArray, rect: Rect, radius: number): void {
  const { width } = plane;
  const n = rect.w * rect.h;
  const inW = new Float32Array(n), inR = new Float32Array(n), inG = new Float32Array(n), inB = new Float32Array(n);
  const outW = new Float32Array(n), outR = new Float32Array(n), outG = new Float32Array(n), outB = new Float32Array(n);
  let hasRim = false;
  for (let row = 0; row < rect.h; row++) {
    for (let col = 0; col < rect.w; col++) {
      const i = row * rect.w + col;
      const src = (rect.y + row) * width + rect.x + col;
      const c = plane.data[src];
      const p = src * 4;
      if (c === 255) {
        inW[i] = 1; inR[i] = rgba[p]; inG[i] = rgba[p + 1]; inB[i] = rgba[p + 2];
      } else if (c === 0) {
        outW[i] = 1; outR[i] = rgba[p]; outG[i] = rgba[p + 1]; outB[i] = rgba[p + 2];
      } else {
        hasRim = true;
      }
    }
  }
  if (!hasRim) return;

  const box = (a: Float32Array) => boxMean(a, rect.w, rect.h, radius);
  const [mInW, mInR, mInG, mInB] = [inW, inR, inG, inB].map(box);
  const [mOutW, mOutR, mOutG, mOutB] = [outW, outR, outG, outB].map(box);

  for (let row = 0; row < rect.h; row++) {
    for (let col = 0; col < rect.w; col++) {
      const i = row * rect.w + col;
      const src = (rect.y + row) * width + rect.x + col;
      const c = plane.data[src];
      if (c === 0 || c === 255 || mInW[i] < 1e-3 || mOutW[i] < 1e-3) continue;

      const ir = mInR[i] / mInW[i], ig = mInG[i] / mInW[i], ib = mInB[i] / mInW[i];
      const or = mOutR[i] / mOutW[i], og = mOutG[i] / mOutW[i], ob = mOutB[i] / mOutW[i];
      const dr = ir - or, dg = ig - og, db = ib - ob;
      const contrast2 = dr * dr + dg * dg + db * db;
      if (contrast2 < MIN_CONTRAST * MIN_CONTRAST) continue;

      // Where does this pixel's colour fall on the line from outside to inside?
      const p = src * 4;
      const t = ((rgba[p] - or) * dr + (rgba[p + 1] - og) * dg + (rgba[p + 2] - ob) * db) / contrast2;
      // Near-certain pixels go all the way, so no faint haze is left behind.
      const snapped = t < 0.02 ? 0 : t > 0.98 ? 255 : t * 255;
      const confidence = Math.min(1, (Math.sqrt(contrast2) - MIN_CONTRAST) / (FULL_CONTRAST - MIN_CONTRAST));
      plane.data[src] = Math.round(confidence * snapped + (1 - confidence) * c);
    }
  }
}
