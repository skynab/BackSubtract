/**
 * The hidden visibility mask. The original image is never modified; every tool
 * only changes this mask. 255 = visible, 0 = removed, values between are soft edges.
 */

export type Mode = 'keep' | 'remove';

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export const VISIBLE = 255;

/**
 * Combine a selection value (0–255) into a mask value.
 * Keep can only reveal, Remove can only hide, so either one can undo the other.
 */
export function combine(current: number, selection: number, mode: Mode): number {
  return mode === 'keep' ? Math.max(current, selection) : Math.min(current, VISIBLE - selection);
}

export function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    w: Math.max(a.x + a.w, b.x + b.w) - x,
    h: Math.max(a.y + a.h, b.y + b.h) - y,
  };
}

/** Copy a rectangle out of a row-major single-channel buffer. */
export function extract(data: Uint8Array, width: number, rect: Rect): Uint8Array {
  const out = new Uint8Array(rect.w * rect.h);
  for (let row = 0; row < rect.h; row++) {
    const start = (rect.y + row) * width + rect.x;
    out.set(data.subarray(start, start + rect.w), row * rect.w);
  }
  return out;
}

export class Mask {
  readonly data: Uint8Array;

  constructor(
    readonly width: number,
    readonly height: number,
    data?: Uint8Array,
  ) {
    this.data = data ?? new Uint8Array(width * height).fill(VISIBLE);
    if (this.data.length !== width * height) {
      throw new Error('Mask data does not match its dimensions');
    }
  }

  /** Whether anything is hidden, even partly. */
  get hasHidden(): boolean {
    return this.data.some((v) => v !== VISIBLE);
  }

  /** Clip a rect to the mask bounds, or null if nothing is left. */
  clip(rect: Rect): Rect | null {
    const x0 = Math.max(0, rect.x);
    const y0 = Math.max(0, rect.y);
    const x1 = Math.min(this.width, rect.x + rect.w);
    const y1 = Math.min(this.height, rect.y + rect.h);
    return x1 > x0 && y1 > y0 ? { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } : null;
  }

  read(rect: Rect): Uint8Array {
    return extract(this.data, this.width, rect);
  }

  write(rect: Rect, values: Uint8Array): void {
    for (let row = 0; row < rect.h; row++) {
      this.data.set(
        values.subarray(row * rect.w, (row + 1) * rect.w),
        (rect.y + row) * this.width + rect.x,
      );
    }
  }

  /** Combine a full-size selection plane into the mask, within `rect`. */
  apply(selection: Uint8Array, rect: Rect, mode: Mode): void {
    this.combineFrom(this.data, selection, rect, mode);
  }

  /** Within `rect`, set mask = combine(base, selection). Both are full-size planes. */
  combineFrom(base: Uint8Array, selection: Uint8Array, rect: Rect, mode: Mode): void {
    // Same as combine(), unrolled per mode: this runs over millions of pixels per tap.
    const out = this.data;
    for (let row = 0; row < rect.h; row++) {
      const start = (rect.y + row) * this.width + rect.x;
      const end = start + rect.w;
      if (mode === 'keep') {
        for (let i = start; i < end; i++) {
          const b = base[i], s = selection[i];
          out[i] = s > b ? s : b;
        }
      } else {
        for (let i = start; i < end; i++) {
          const b = base[i], s = 255 - selection[i];
          out[i] = s < b ? s : b;
        }
      }
    }
  }
}

/** Bounding box of all values above `threshold`, or null if there are none. */
export function boundingBox(data: Uint8Array, width: number, height: number, threshold = 0): Rect | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (data[row + x] > threshold) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

export function padRect(rect: Rect, pad: number): Rect {
  return { x: rect.x - pad, y: rect.y - pad, w: rect.w + pad * 2, h: rect.h + pad * 2 };
}
