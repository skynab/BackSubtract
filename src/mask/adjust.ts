/**
 * Whole-mask edge adjustments, applied together as one step: clean up specks,
 * then move the edge in or out, then make it crisper or softer. Each works on
 * the soft mask directly, so fine detail such as hair keeps its shape.
 */

export interface EdgeAdjust {
  /** Move the edge out (+) or in (−), in pixels. */
  shift: number;
  /** Soften (+, blur radius in pixels) or crisp up (−) the edge's fade. */
  soften: number;
  /** Clean-up strength, 0 (off) to CLEANUP_MAX: removes islands and fills holes up to a size that grows with it. */
  cleanup: number;
}

export const SHIFT_MAX = 8;
export const SOFTEN_MAX = 8;
export const CLEANUP_MAX = 10;

export const NO_ADJUST: EdgeAdjust = { shift: 0, soften: 0, cleanup: 0 };

export const isNoAdjust = (a: EdgeAdjust) => !a.shift && !a.soften && !a.cleanup;

/** Largest island or hole that clean-up removes, as a share of the image, at full strength. */
const CLEANUP_MAX_SHARE = 0.004;

/** The largest area (pixels) clean-up removes at `strength`. Grows with the square, so low settings stay gentle. */
export function cleanupArea(strength: number, width: number, height: number): number {
  const s = Math.min(CLEANUP_MAX, Math.max(0, strength)) / CLEANUP_MAX;
  return Math.round(s * s * CLEANUP_MAX_SHARE * width * height);
}

// ── Moving the edge ────────────────────────────────────────────────────────

/** One step of greyscale dilation (max) within a w×h buffer: a 3×3 square, or a plus shape. */
function dilateOnce(src: Uint8Array, dst: Uint8Array, tmp: Uint8Array, w: number, h: number, square: boolean): void {
  if (square) {
    // Separable: max across each row, then down each column.
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = src[row + x];
        if (x > 0 && src[row + x - 1] > v) v = src[row + x - 1];
        if (x < w - 1 && src[row + x + 1] > v) v = src[row + x + 1];
        tmp[row + x] = v;
      }
    }
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = tmp[row + x];
        if (y > 0 && tmp[row - w + x] > v) v = tmp[row - w + x];
        if (y < h - 1 && tmp[row + w + x] > v) v = tmp[row + w + x];
        dst[row + x] = v;
      }
    }
  } else {
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        const i = row + x;
        let v = src[i];
        if (x > 0 && src[i - 1] > v) v = src[i - 1];
        if (x < w - 1 && src[i + 1] > v) v = src[i + 1];
        if (y > 0 && src[i - w] > v) v = src[i - w];
        if (y < h - 1 && src[i + w] > v) v = src[i + w];
        dst[i] = v;
      }
    }
  }
}

const TILE = 64;

/**
 * Run a neighbourhood operation (one whose result at a pixel depends only on
 * pixels within `margin` of it) over the mask, tile by tile, skipping tiles
 * that can't change: a flat tile surrounded by tiles of the same value.
 * `work` gets each tile plus its margin as a w×h buffer and changes it in
 * place; its results near the buffer's cut-off edges are thrown away.
 * Returns a new plane.
 */
function byTiles(
  mask: Uint8Array,
  width: number,
  height: number,
  margin: number,
  work: (region: Uint8Array, w: number, h: number) => Uint8Array,
): Uint8Array {
  const out = mask.slice();
  // How many tiles around each tile the margin reaches into.
  const reach = Math.ceil(margin / TILE);

  // Each tile's value if the whole tile has it, else -1.
  const tw = Math.ceil(width / TILE), th = Math.ceil(height / TILE);
  const flat = new Int16Array(tw * th);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const v0 = mask[ty * TILE * width + tx * TILE];
      let v: number = v0;
      for (let y = ty * TILE; y < Math.min(height, (ty + 1) * TILE) && v >= 0; y++) {
        for (let k = y * width + tx * TILE, end = y * width + Math.min(width, (tx + 1) * TILE); k < end; k++) {
          if (mask[k] !== v0) {
            v = -1;
            break;
          }
        }
      }
      flat[ty * tw + tx] = v;
    }
  }

  const side = TILE + 2 * margin;
  const region = new Uint8Array(side * side);
  for (let ty = 0; ty < th; ty++) {
    for (let tx = 0; tx < tw; tx++) {
      const v = flat[ty * tw + tx];
      let same = v >= 0;
      for (let dy = -reach; dy <= reach && same; dy++) {
        for (let dx = -reach; dx <= reach && same; dx++) {
          const nx = tx + dx, ny = ty + dy;
          if (nx >= 0 && ny >= 0 && nx < tw && ny < th && flat[ny * tw + nx] !== v) same = false;
        }
      }
      if (same) continue;

      const x0 = Math.max(0, tx * TILE - margin), y0 = Math.max(0, ty * TILE - margin);
      const x1 = Math.min(width, (tx + 1) * TILE + margin), y1 = Math.min(height, (ty + 1) * TILE + margin);
      const w = x1 - x0, h = y1 - y0;
      for (let y = 0; y < h; y++) region.set(mask.subarray((y0 + y) * width + x0, (y0 + y) * width + x1), y * w);
      const result = work(region, w, h);
      const cx0 = tx * TILE, cy0 = ty * TILE;
      const cx1 = Math.min(width, cx0 + TILE), cy1 = Math.min(height, cy0 + TILE);
      for (let y = cy0; y < cy1; y++) {
        const row = (y - y0) * w - x0;
        out.set(result.subarray(row + cx0, row + cx1), y * width + cx0);
      }
    }
  }
  return out;
}

/**
 * Move the edge out by `px` pixels (grey dilation) or in by −`px` (grey erosion).
 * Alternating square and plus steps grows a near-round shape, and soft edges
 * keep their profile and just move. Returns a new plane.
 */
export function shiftEdges(mask: Uint8Array, width: number, height: number, px: number): Uint8Array {
  const n = Math.round(Math.abs(px));
  if (n === 0) return mask.slice();
  const shrink = px < 0;
  const side = TILE + 2 * n;
  const spare = new Uint8Array(side * side);
  const tmp = new Uint8Array(side * side);
  return byTiles(mask, width, height, n, (region, w, h) => {
    let a: Uint8Array = region, b: Uint8Array = spare;
    const size = w * h;
    // Erosion is dilation of the inverse.
    if (shrink) for (let i = 0; i < size; i++) a[i] = 255 - a[i];
    for (let i = 0; i < n; i++) {
      dilateOnce(a, b, tmp, w, h, i % 2 === 0);
      [a, b] = [b, a];
    }
    if (shrink) for (let i = 0; i < size; i++) a[i] = 255 - a[i];
    // The result may be in either buffer; it is copied out before the next tile.
    return a;
  });
}

// ── Softening ──────────────────────────────────────────────────────────────

/** Box blur of radius r, one pass across and one down, in place. */
function boxBlur(data: Uint8Array, width: number, height: number, r: number): void {
  const inv = 1 / (2 * r + 1);
  const line = new Uint8Array(width);
  for (let y = 0; y < height; y++) {
    const row = y * width;
    const at = (x: number) => data[row + Math.min(width - 1, Math.max(0, x))];
    let sum = 0;
    for (let x = -r; x <= r; x++) sum += at(x);
    // Clamping is only needed near the ends of the row.
    const lo = Math.min(width, r), hi = Math.max(lo, width - r - 1);
    let x = 0;
    for (; x < lo; x++) {
      line[x] = (sum * inv + 0.5) | 0;
      sum += at(x + r + 1) - at(x - r);
    }
    for (; x < hi; x++) {
      line[x] = (sum * inv + 0.5) | 0;
      sum += data[row + x + r + 1] - data[row + x - r];
    }
    for (; x < width; x++) {
      line[x] = (sum * inv + 0.5) | 0;
      sum += at(x + r + 1) - at(x - r);
    }
    data.set(line, row);
  }
  // Down the columns, but row by row with a running sum per column (much kinder to the cache),
  // into a separate buffer so the rows still to be read stay intact.
  const out = new Uint8Array(data.length);
  const sums = new Uint32Array(width);
  const rowAt = (y: number) => Math.min(height - 1, Math.max(0, y)) * width;
  for (let y = -r; y <= r; y++) {
    const row = rowAt(y);
    for (let x = 0; x < width; x++) sums[x] += data[row + x];
  }
  for (let y = 0; y < height; y++) {
    const row = y * width, add = rowAt(y + r + 1), sub = rowAt(y - r);
    for (let x = 0; x < width; x++) {
      out[row + x] = (sums[x] * inv + 0.5) | 0;
      sums[x] += data[add + x] - data[sub + x];
    }
  }
  data.set(out);
}

/**
 * Soften (amount > 0: blur the mask, twice for a smooth fall-off) or crisp up
 * (amount < 0: steepen the fade around the halfway point). Changes `mask` in place.
 */
export function softenEdges(mask: Uint8Array, width: number, height: number, amount: number): void {
  if (amount > 0) {
    const r1 = Math.max(1, Math.round(amount / 2));
    const r2 = Math.max(1, Math.round(amount) - r1);
    // Only tiles near an edge can change, so blur those alone.
    mask.set(byTiles(mask, width, height, r1 + r2, (region, w, h) => {
      boxBlur(region, w, h, r1);
      boxBlur(region, w, h, r2);
      return region;
    }));
  } else if (amount < 0) {
    const k = 1 + -amount * 0.6;
    const lut = new Uint8Array(256);
    for (let v = 0; v < 256; v++) lut[v] = Math.min(255, Math.max(0, Math.round(127.5 + (v - 127.5) * k)));
    for (let i = 0; i < mask.length; i++) mask[i] = lut[mask[i]];
  }
}

// ── Cleaning up specks ─────────────────────────────────────────────────────

/** A small island (kept) or hole (removed), as horizontal runs of pixels. */
export interface Speck {
  kept: boolean;
  area: number;
  /** Runs as [row, start, end) triples. */
  runs: number[];
  /** For a hole: one pixel of the area around it, so the hole is only filled while that area is still kept. */
  around: number;
}

/**
 * Find every island (8-connected area of mostly kept pixels, ≥ 50%) and hole
 * (mostly removed, not touching the image's border) of at most `maxArea`
 * pixels. Works on runs of pixels rather than single pixels, so it's quick.
 */
export function findSpecks(mask: Uint8Array, width: number, height: number, maxArea: number): Speck[] {
  if (maxArea < 1) return [];
  // Runs of same-class pixels, row by row.
  let cap = 1024;
  let rRow = new Int32Array(cap), rStart = new Int32Array(cap), rEnd = new Int32Array(cap), rKept = new Uint8Array(cap);
  let count = 0;
  const rowFirst = new Int32Array(height + 1);
  for (let y = 0; y < height; y++) {
    rowFirst[y] = count;
    const row = y * width;
    let x = 0;
    while (x < width) {
      const kept = mask[row + x] >= 128;
      const start = x;
      while (x < width && mask[row + x] >= 128 === kept) x++;
      if (count === cap) {
        cap *= 2;
        const grow = <T extends Int32Array | Uint8Array>(a: T): T => {
          const b = new (a.constructor as new (n: number) => T)(cap);
          b.set(a);
          return b;
        };
        rRow = grow(rRow); rStart = grow(rStart); rEnd = grow(rEnd); rKept = grow(rKept);
      }
      rRow[count] = y; rStart[count] = start; rEnd[count] = x; rKept[count] = kept ? 1 : 0;
      count++;
    }
  }
  rowFirst[height] = count;

  // Union runs that touch a run of the same class on the row above. Kept areas connect diagonally too
  // (8-connected), removed ones only through edges (4-connected), so a thin diagonal outline still closes a hole.
  const parent = new Int32Array(count);
  for (let i = 0; i < count; i++) parent[i] = i;
  const find = (i: number): number => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  for (let y = 1; y < height; y++) {
    let j = rowFirst[y - 1];
    const jEnd = rowFirst[y];
    for (let i = rowFirst[y]; i < rowFirst[y + 1]; i++) {
      // Skip runs above that end before this one could touch them.
      while (j < jEnd && rEnd[j] < rStart[i]) j++;
      for (let k = j; k < jEnd && rStart[k] <= rEnd[i]; k++) {
        if (rKept[k] !== rKept[i]) continue;
        if (!rKept[i] && (rEnd[k] <= rStart[i] || rStart[k] >= rEnd[i])) continue;
        const a = find(i), b = find(k);
        if (a !== b) parent[a] = b;
      }
    }
  }

  // Area and border contact of each component.
  const area = new Float64Array(count);
  const border = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    const r = find(i);
    area[r] += rEnd[i] - rStart[i];
    if (rRow[i] === 0 || rRow[i] === height - 1 || rStart[i] === 0 || rEnd[i] === width) border[r] = 1;
  }

  const specks = new Map<number, Speck>();
  for (let i = 0; i < count; i++) {
    const r = find(i);
    const kept = rKept[i] === 1;
    if (area[r] > maxArea || (!kept && border[r])) continue;
    let s = specks.get(r);
    if (!s) {
      s = { kept, area: area[r], runs: [], around: -1 };
      specks.set(r, s);
    }
    s.runs.push(rRow[i], rStart[i], rEnd[i]);
    // A hole run is bordered by kept pixels on both sides (it doesn't touch the image edge).
    if (!kept && s.around < 0) s.around = rRow[i] * width + rStart[i] - 1;
  }
  return [...specks.values()];
}

/** How far around a removed speck (or filled hole) its soft rim is tidied too, in pixels. */
const RIM = 2;

/**
 * Remove the islands and fill the holes of at most `maxArea` pixels, with their
 * soft rims, so no faint ring is left behind. Islands go first; a hole inside
 * an island that was removed stays removed. Changes `mask` in place.
 */
export function applySpecks(mask: Uint8Array, width: number, height: number, specks: Speck[], maxArea: number): void {
  for (const kept of [true, false]) {
    for (const s of specks) {
      if (s.kept !== kept || s.area > maxArea) continue;
      if (!kept && mask[s.around] < 128) continue;
      const value = kept ? 0 : 255;
      for (let q = 0; q < s.runs.length; q += 3) {
        const y = s.runs[q], start = s.runs[q + 1], end = s.runs[q + 2];
        mask.fill(value, y * width + start, y * width + end);
        // Only the rim's fade on this side of halfway; the neighbouring area itself is left alone.
        for (let yy = Math.max(0, y - RIM); yy <= Math.min(height - 1, y + RIM); yy++) {
          for (let x = Math.max(0, start - RIM), x1 = Math.min(width, end + RIM); x < x1; x++) {
            const j = yy * width + x;
            if (kept ? mask[j] < 128 : mask[j] >= 128) mask[j] = value;
          }
        }
      }
    }
  }
}

/** Remove small islands and fill small holes of at most `maxArea` pixels. Changes `mask` in place. */
export function cleanSpecks(mask: Uint8Array, width: number, height: number, maxArea: number): void {
  applySpecks(mask, width, height, findSpecks(mask, width, height, maxArea), maxArea);
}

/**
 * Apply all three adjustments to `base`, returning a new plane. `specks` can be
 * passed in when already found on `base` for at least this clean-up size,
 * since finding them is the slow part.
 */
export function adjustEdges(base: Uint8Array, width: number, height: number, a: EdgeAdjust, specks?: Speck[]): Uint8Array {
  let out: Uint8Array = base.slice();
  if (a.cleanup > 0) {
    const maxArea = cleanupArea(a.cleanup, width, height);
    applySpecks(out, width, height, specks ?? findSpecks(base, width, height, maxArea), maxArea);
  }
  if (a.shift) out = shiftEdges(out, width, height, a.shift);
  if (a.soften) softenEdges(out, width, height, a.soften);
  return out;
}
