import type { Rect } from '../../mask/mask';

/**
 * The magnetic lasso's path finding ("intelligent scissors"): the cheapest path
 * between two pixels, where walking along a strong edge in the image is cheap
 * and crossing flat areas is expensive, so the path hugs the object's outline.
 */

export interface Pixel {
  x: number;
  y: number;
}

/** Edge strength (Sobel, 0–1+) at which a pixel counts as a full edge. */
const STRONG_EDGE = 0.2;
/** Below this edge strength, there is no edge near the pointer to snap to. */
const WEAK_EDGE = 0.04;
/** The cheapest a step can be, so that among equally strong edges the shorter path wins. */
const MIN_COST = 0.05;

/**
 * Edge strength for every pixel of `win`: the largest Sobel gradient of the
 * three colour channels, scaled so a full black-to-white step is 1.
 */
export function edgeStrength(rgba: Uint8ClampedArray, width: number, height: number, win: Rect): Float32Array {
  const out = new Float32Array(win.w * win.h);
  const at = (x: number, y: number, c: number) =>
    rgba[((Math.min(height - 1, Math.max(0, y)) * width + Math.min(width - 1, Math.max(0, x))) << 2) + c];
  for (let row = 0; row < win.h; row++) {
    const y = win.y + row;
    for (let col = 0; col < win.w; col++) {
      const x = win.x + col;
      let best = 0;
      for (let c = 0; c < 3; c++) {
        const tl = at(x - 1, y - 1, c), t = at(x, y - 1, c), tr = at(x + 1, y - 1, c);
        const l = at(x - 1, y, c), r = at(x + 1, y, c);
        const bl = at(x - 1, y + 1, c), b = at(x, y + 1, c), br = at(x + 1, y + 1, c);
        const gx = tr + 2 * r + br - tl - 2 * l - bl;
        const gy = bl + 2 * b + br - tl - 2 * t - tr;
        const g = gx * gx + gy * gy;
        if (g > best) best = g;
      }
      out[row * win.w + col] = Math.sqrt(best) / 1020;
    }
  }
  return out;
}

const clampRect = (r: Rect, width: number, height: number): Rect => {
  const x0 = Math.max(0, Math.floor(r.x)), y0 = Math.max(0, Math.floor(r.y));
  const x1 = Math.min(width, Math.ceil(r.x + r.w)), y1 = Math.min(height, Math.ceil(r.y + r.h));
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
};

/**
 * The strongest edge pixel within `radius` of `p` (closer ones win ties), or `p`
 * itself when nothing nearby looks like an edge. This is the lasso's "width":
 * the pointer only has to be near the edge, not on it.
 */
export function snapToEdge(rgba: Uint8ClampedArray, width: number, height: number, p: Pixel, radius: number): Pixel {
  const px = Math.min(width - 1, Math.max(0, Math.round(p.x)));
  const py = Math.min(height - 1, Math.max(0, Math.round(p.y)));
  const r = Math.max(1, Math.round(radius));
  const win = clampRect({ x: px - r, y: py - r, w: 2 * r + 1, h: 2 * r + 1 }, width, height);
  const g = edgeStrength(rgba, width, height, win);
  let best = { x: px, y: py };
  let bestScore = WEAK_EDGE;
  for (let row = 0; row < win.h; row++) {
    for (let col = 0; col < win.w; col++) {
      const x = win.x + col, y = win.y + row;
      const d = Math.hypot(x - px, y - py);
      if (d > r) continue;
      // Strength capped at a full edge, so a slightly stronger edge further away doesn't beat a clear one close by.
      const score = Math.min(g[row * win.w + col], STRONG_EDGE) - (d / r) * 0.02;
      if (score > bestScore) {
        bestScore = score;
        best = { x, y };
      }
    }
  }
  return best;
}

/** A binary min-heap of pixel indices keyed by path cost (duplicates allowed; stale entries are skipped). */
class Heap {
  private keys = new Float64Array(1024);
  private vals = new Int32Array(1024);
  size = 0;

  push(key: number, val: number): void {
    if (this.size === this.keys.length) {
      const keys = new Float64Array(this.size * 2), vals = new Int32Array(this.size * 2);
      keys.set(this.keys);
      vals.set(this.vals);
      this.keys = keys;
      this.vals = vals;
    }
    let i = this.size++;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= key) break;
      this.keys[i] = this.keys[parent];
      this.vals[i] = this.vals[parent];
      i = parent;
    }
    this.keys[i] = key;
    this.vals[i] = val;
  }

  /** Remove the smallest entry and return its value. */
  pop(): number {
    const top = this.vals[0];
    const key = this.keys[--this.size];
    const val = this.vals[this.size];
    let i = 0;
    for (;;) {
      let child = 2 * i + 1;
      if (child >= this.size) break;
      if (child + 1 < this.size && this.keys[child + 1] < this.keys[child]) child++;
      if (this.keys[child] >= key) break;
      this.keys[i] = this.keys[child];
      this.vals[i] = this.vals[child];
      i = child;
    }
    this.keys[i] = key;
    this.vals[i] = val;
    return top;
  }
}

const STEPS = [
  [1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1],
  [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2],
] as const;

/**
 * The cheapest 8-connected path of pixels from `from` to `to`, searched within
 * their bounding box grown by `pad` (so the path can bend out to follow an edge
 * but not wander off). Both ends are included.
 */
export function liveWire(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
  from: Pixel,
  to: Pixel,
  pad: number,
): Pixel[] {
  if (from.x === to.x && from.y === to.y) return [from];
  const win = clampRect(
    {
      x: Math.min(from.x, to.x) - pad,
      y: Math.min(from.y, to.y) - pad,
      w: Math.abs(from.x - to.x) + 2 * pad + 1,
      h: Math.abs(from.y - to.y) + 2 * pad + 1,
    },
    width,
    height,
  );
  const g = edgeStrength(rgba, width, height, win);
  const n = win.w * win.h;
  const cost = new Float32Array(n);
  for (let i = 0; i < n; i++) cost[i] = MIN_COST + (1 - MIN_COST) * (1 - Math.min(1, g[i] / STRONG_EDGE));

  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const index = (p: Pixel) => (p.y - win.y) * win.w + (p.x - win.x);
  const start = index(from), goal = index(to);
  const heap = new Heap();
  dist[start] = 0;
  heap.push(0, start);

  while (heap.size) {
    const i = heap.pop();
    if (done[i]) continue;
    done[i] = 1;
    if (i === goal) break;
    const x = i % win.w, y = (i / win.w) | 0;
    for (const [dx, dy, len] of STEPS) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= win.w || ny >= win.h) continue;
      const j = ny * win.w + nx;
      if (done[j]) continue;
      const d = dist[i] + cost[j] * len;
      if (d < dist[j]) {
        dist[j] = d;
        prev[j] = i;
        heap.push(d, j);
      }
    }
  }

  const path: Pixel[] = [];
  for (let i = goal; i !== -1; i = prev[i]) path.push({ x: win.x + (i % win.w), y: win.y + ((i / win.w) | 0) });
  return path.reverse();
}

/** Longest straight-line closing gap (in px) still traced along edges; longer gaps close with a straight line. */
const MAX_CLOSE = 600;

/**
 * A magnetic lasso line in progress. The pointer drags roughly along an edge:
 * the line from the last fixed point to the pointer follows the edge, and once
 * it is long enough it is fixed in place and a new segment starts from its end.
 * All coordinates are image pixels.
 */
export class MagneticTrace {
  /** The fixed part of the line. Its last point is where the live segment starts. */
  readonly fixed: Pixel[];
  /** From the end of the fixed part to (near) the pointer; it changes as the pointer moves. */
  live: Pixel[] = [];

  constructor(
    private readonly rgba: Uint8ClampedArray,
    private readonly width: number,
    private readonly height: number,
    start: Pixel,
    radius: number,
  ) {
    this.fixed = [snapToEdge(rgba, width, height, start, radius)];
  }

  private get anchor(): Pixel {
    return this.fixed[this.fixed.length - 1];
  }

  /**
   * Follow the pointer. `radius` is how far from the pointer an edge is looked
   * for, and `spacing` how long the live segment gets before it is fixed (both in image px).
   */
  moveTo(p: Pixel, radius: number, spacing: number): void {
    const target = snapToEdge(this.rgba, this.width, this.height, p, radius);
    this.live = liveWire(this.rgba, this.width, this.height, this.anchor, target, Math.ceil(radius));
    if (this.live.length > spacing) {
      this.fixed.push(...this.live.slice(1));
      this.live = [];
    }
  }

  /** Every point of the line so far, fixed and live. */
  get points(): Pixel[] {
    return this.live.length ? [...this.fixed, ...this.live.slice(1)] : this.fixed;
  }

  /** The finished outline: the line plus a segment back to the start (along edges when it isn't too far). */
  close(radius: number): Pixel[] {
    const points = this.points;
    const first = points[0], last = points[points.length - 1];
    if (Math.hypot(first.x - last.x, first.y - last.y) > MAX_CLOSE) return points;
    const back = liveWire(this.rgba, this.width, this.height, last, first, Math.ceil(radius));
    return [...points, ...back.slice(1, -1)];
  }
}
