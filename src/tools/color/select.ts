import type { Rect } from '../../mask/mask';
import { snapToEdgesTiled } from '../../mask/snap';
import { softness } from './lab';

export interface Selection {
  /** Full-size plane of selection strength, 0–255. */
  data: Uint8Array;
  rect: Rect;
}

/** Color tool: every pixel within tolerance, anywhere in the image. */
export function selectGlobal(dist: Uint8Array, width: number, height: number, tolerance: number): Selection | null {
  const lut = softness(tolerance);
  const data = new Uint8Array(dist.length);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0, i = 0; y < height; y++) {
    let rowMin = -1, rowMax = -1;
    for (let x = 0; x < width; x++, i++) {
      const v = lut[dist[i]];
      if (v) {
        data[i] = v;
        if (rowMin < 0) rowMin = x;
        rowMax = x;
      }
    }
    if (rowMin >= 0) {
      if (rowMin < x0) x0 = rowMin;
      if (rowMax > x1) x1 = rowMax;
      if (y < y0) y0 = y;
      y1 = y;
    }
  }
  return x1 < 0 ? null : { data, rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** Magic Wand: the connected region (4-way) of pixels within tolerance of the tapped point. */
export function selectContiguous(
  dist: Uint8Array,
  width: number,
  height: number,
  seedX: number,
  seedY: number,
  tolerance: number,
): Selection | null {
  if (seedX < 0 || seedY < 0 || seedX >= width || seedY >= height) return null;
  const lut = softness(tolerance);
  const data = new Uint8Array(dist.length);
  const inside = (i: number) => data[i] === 0 && lut[dist[i]] > 0;

  const seed = seedY * width + seedX;
  // Always include the tapped pixel, even at the lowest tolerance.
  data[seed] = Math.max(1, lut[dist[seed]]);
  let x0 = seedX, x1 = seedX, y0 = seedY, y1 = seedY;

  // Scanline fill: fill a whole horizontal run, then queue the runs above and below.
  const stack: number[] = [seedX, seedY];
  while (stack.length) {
    const y = stack.pop()!;
    const x = stack.pop()!;
    const row = y * width;
    let left = x;
    while (left > 0 && inside(row + left - 1)) left--;
    let right = x;
    while (right < width - 1 && inside(row + right + 1)) right++;
    for (let i = left; i <= right; i++) {
      if (data[row + i] === 0) data[row + i] = lut[dist[row + i]];
    }
    if (left < x0) x0 = left;
    if (right > x1) x1 = right;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;

    for (const ny of [y - 1, y + 1]) {
      if (ny < 0 || ny >= height) continue;
      const nrow = ny * width;
      let inRun = false;
      for (let i = left; i <= right; i++) {
        if (inside(nrow + i)) {
          if (!inRun) {
            stack.push(i, ny);
            inRun = true;
          }
        } else {
          inRun = false;
        }
      }
    }
  }
  return { data, rect: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

/** Neighbourhood for deciding how much of each edge pixel belongs to the selection. */
const EDGE_RADIUS = 3;

/**
 * Anti-alias a colour selection against the image. Edge pixels in a photo are a
 * blend of subject and background, and are often too far from the tapped colour
 * to be selected at all, leaving a fringe. Mark a 1-pixel band on each side of
 * the selection's boundary as uncertain, then let edge snapping estimate how much
 * of each of those pixels is the selected colour. Mixed pixels become partly
 * selected, so edge colour cleanup can later remove the fringe. Updates `sel`.
 */
export function refineEdges(sel: Selection, rgba: Uint8ClampedArray, width: number, height: number): Selection {
  const { data } = sel;
  const pad = 1 + EDGE_RADIUS;
  const x0 = Math.max(0, sel.rect.x - pad), y0 = Math.max(0, sel.rect.y - pad);
  const x1 = Math.min(width, sel.rect.x + sel.rect.w + pad), y1 = Math.min(height, sel.rect.y + sel.rect.h + pad);

  // Find boundary pixels first, then mark them, so marking doesn't spread.
  const band: number[] = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = y * width + x;
      const v = data[i];
      if (v !== 0 && v !== 255) continue;
      const opposite = 255 - v;
      if (
        (x > 0 && data[i - 1] === opposite) ||
        (x < width - 1 && data[i + 1] === opposite) ||
        (y > 0 && data[i - width] === opposite) ||
        (y < height - 1 && data[i + width] === opposite)
      ) {
        band.push(i);
      }
    }
  }
  for (const i of band) data[i] = 128;

  const rect = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
  snapToEdgesTiled({ data, width, height }, rgba, rect, EDGE_RADIUS);
  sel.rect = rect;
  return sel;
}
