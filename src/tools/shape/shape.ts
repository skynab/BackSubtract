import type { Rect } from '../../mask/mask';

export type ShapeKind = 'rect' | 'ellipse';

export interface Point {
  x: number;
  y: number;
}

/**
 * The box spanned by a drag, in image coordinates. With `square`, it becomes a
 * square (or circle) the size of the drag's longer side.
 */
export function dragBox(a: Point, b: Point, square = false): { x0: number; y0: number; x1: number; y1: number } {
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (square) {
    const side = Math.max(Math.abs(dx), Math.abs(dy));
    dx = Math.sign(dx || 1) * side;
    dy = Math.sign(dy || 1) * side;
  }
  return { x0: Math.min(a.x, a.x + dx), y0: Math.min(a.y, a.y + dy), x1: Math.max(a.x, a.x + dx), y1: Math.max(a.y, a.y + dy) };
}

/** How much of the pixel span [p, p + 1) lies inside [lo, hi]. */
const overlap = (p: number, lo: number, hi: number) => Math.max(0, Math.min(p + 1, hi) - Math.max(p, lo));

/**
 * Draw a box or ellipse as a full-size selection plane (0–255), with smooth edges.
 * Returns null when it covers no pixel of the image.
 */
export function rasterizeShape(
  kind: ShapeKind,
  box: { x0: number; y0: number; x1: number; y1: number },
  width: number,
  height: number,
): { data: Uint8Array; rect: Rect } | null {
  const left = Math.max(0, Math.floor(box.x0));
  const top = Math.max(0, Math.floor(box.y0));
  const right = Math.min(width, Math.ceil(box.x1));
  const bottom = Math.min(height, Math.ceil(box.y1));
  if (right <= left || bottom <= top) return null;

  const data = new Uint8Array(width * height);
  const cx = (box.x0 + box.x1) / 2;
  const cy = (box.y0 + box.y1) / 2;
  const rx = (box.x1 - box.x0) / 2;
  const ry = (box.y1 - box.y0) / 2;

  for (let y = top; y < bottom; y++) {
    const cover = overlap(y, box.y0, box.y1);
    for (let x = left; x < right; x++) {
      let v: number;
      if (kind === 'rect') {
        // Exact share of the pixel inside the box.
        v = cover * overlap(x, box.x0, box.x1);
      } else {
        // Approximate distance to the ellipse edge, in pixels, from the pixel centre.
        const nx = (x + 0.5 - cx) / rx;
        const ny = (y + 0.5 - cy) / ry;
        const r = Math.hypot(nx, ny);
        const gradient = Math.hypot(nx / rx, ny / ry) / (r || 1);
        v = Math.min(1, Math.max(0, (1 - r) / (gradient || 1) + 0.5));
      }
      data[y * width + x] = Math.round(v * 255);
    }
  }
  return { data, rect: { x: left, y: top, w: right - left, h: bottom - top } };
}
