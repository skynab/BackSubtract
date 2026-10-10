import type { Rect } from '../../mask/mask';
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
