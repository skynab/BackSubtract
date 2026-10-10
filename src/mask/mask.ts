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

  /** Combine a selection laid out over `rect` (rect.w × rect.h values) into the mask. */
  apply(selection: Uint8Array, rect: Rect, mode: Mode): void {
    for (let row = 0; row < rect.h; row++) {
      let i = (rect.y + row) * this.width + rect.x;
      let s = row * rect.w;
      for (let col = 0; col < rect.w; col++, i++, s++) {
        this.data[i] = combine(this.data[i], selection[s], mode);
      }
    }
  }
}
