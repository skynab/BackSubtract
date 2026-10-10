import type { Point } from '../../canvas/view';

/** Fill a closed path into a 0/255 plane (even-odd ignored: a loop is treated as a simple outline). */
export function rasterizeLoop(points: Point[], width: number, height: number): Uint8Array {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  points.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
  ctx.closePath();
  ctx.fill('nonzero');
  const rgba = ctx.getImageData(0, 0, width, height).data;
  const out = new Uint8Array(width * height);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4 + 3] >= 128 ? 255 : 0;
  return out;
}

/** Approximate distance (in px) from each inside pixel to the nearest outside pixel (3-4 chamfer). */
export function distanceInside(inside: Uint8Array, width: number, height: number): Float32Array {
  const d = new Float32Array(width * height);
  const BIG = 1e9;
  for (let i = 0; i < d.length; i++) d[i] = inside[i] ? BIG : 0;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : d[y * width + x]);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 3, at(x, y - 1) + 3, at(x - 1, y - 1) + 4, at(x + 1, y - 1) + 4);
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 3, at(x, y + 1) + 3, at(x + 1, y + 1) + 4, at(x - 1, y + 1) + 4);
    }
  }
  for (let i = 0; i < d.length; i++) d[i] /= 3;
  return d;
}

export interface LoopPrompts {
  /** Candidate object points, deepest inside the loop first. Each is tried on its own. */
  candidates: [number, number][];
  /** Background points just outside the loop's bounding box, used with every candidate. */
  negatives: [number, number][];
}

/**
 * Pick prompt points for Segment Anything from a loop: a few points well inside
 * the loop that might be on the object, and a few just outside it that are background.
 */
export function loopPrompts(inside: Uint8Array, width: number, height: number, maxCandidates = 4): LoopPrompts | null {
  const dist = distanceInside(inside, width, height);
  let best = -1;
  for (let i = 0; i < dist.length; i++) if (best < 0 || dist[i] > dist[best]) best = i;
  if (best < 0 || dist[best] < 1) return null;

  const max = dist[best];
  const candidates: [number, number][] = [[best % width, Math.floor(best / width)]];
  // Further candidates: still well inside, and spread apart from the ones already chosen.
  const step = Math.max(2, Math.floor(max / 2));
  for (let y = 0; y < height && candidates.length < maxCandidates; y += step) {
    for (let x = 0; x < width && candidates.length < maxCandidates; x += step) {
      if (dist[y * width + x] < max * 0.5) continue;
      if (candidates.every(([cx, cy]) => Math.hypot(cx - x, cy - y) > max)) candidates.push([x, y]);
    }
  }

  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!inside[y * width + x]) continue;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
    }
  }
  const margin = Math.max(4, Math.round(Math.max(x1 - x0, y1 - y0) * 0.05));
  const negatives: [number, number][] = [];
  const left = x0 - margin, right = x1 + margin, top = y0 - margin, bottom = y1 + margin;
  const midX = (x0 + x1) / 2, midY = (y0 + y1) / 2;
  for (const [x, y] of [[left, top], [right, top], [left, bottom], [right, bottom], [midX, top], [midX, bottom], [left, midY], [right, midY]]) {
    const px = Math.round(x), py = Math.round(y);
    if (px >= 0 && py >= 0 && px < width && py < height && !inside[py * width + px]) negatives.push([px, py]);
  }
  return { candidates, negatives };
}

/** One of Segment Anything's proposals: mask index `index` in a Proposals block. */
export interface Choice {
  index: number;
  score: number;
}

/** For a tap: the proposal SAM itself is most confident about. */
export function mostConfident(scores: number[]): Choice {
  let index = 0;
  for (let i = 1; i < scores.length; i++) if (scores[i] > scores[index]) index = i;
  return { index, score: scores[index] };
}

/**
 * For a loop: the proposal that best matches what was drawn around. It should
 * fill as much of the loop as possible while spilling outside it as little as
 * possible; background masks spill out a lot, so they lose.
 * `area` is the plane (loop with slack) the object should stay within; `loopArea` is the loop's own size.
 */
export function bestFit(masks: Uint8Array, scores: number[], area: Uint8Array, loopArea: number): Choice {
  const size = area.length;
  let best: Choice = { index: 0, score: -Infinity };
  for (let m = 0; m < scores.length; m++) {
    let inside = 0, outside = 0;
    for (let i = 0, j = m * size; i < size; i++, j++) {
      if (!masks[j]) continue;
      if (area[i]) inside++;
      else outside++;
    }
    const score = (inside - 2 * outside) / loopArea + 0.1 * scores[m];
    if (score > best.score) best = { index: m, score };
  }
  return best;
}

/** Grow a 0/255 plane outward by `r` pixels (square neighbourhood), so a loop that clips the object still keeps it. */
export function dilate(plane: Uint8Array, width: number, height: number, r: number): Uint8Array {
  const tmp = new Uint8Array(plane.length);
  const out = new Uint8Array(plane.length);
  for (let y = 0; y < height; y++) {
    let last = -Infinity;
    for (let x = 0; x < width; x++) if (plane[y * width + x]) last = x; else if (x - last <= r) tmp[y * width + x] = 255;
    last = Infinity;
    for (let x = width - 1; x >= 0; x--) {
      const i = y * width + x;
      if (plane[i]) { last = x; tmp[i] = 255; } else if (last - x <= r) tmp[i] = 255;
    }
  }
  for (let x = 0; x < width; x++) {
    let last = -Infinity;
    for (let y = 0; y < height; y++) if (tmp[y * width + x]) last = y; else if (y - last <= r) out[y * width + x] = 255;
    last = Infinity;
    for (let y = height - 1; y >= 0; y--) {
      const i = y * width + x;
      if (tmp[i]) { last = y; out[i] = 255; } else if (last - y <= r) out[i] = 255;
    }
  }
  return out;
}
