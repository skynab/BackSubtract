import { unionRect, type Rect } from '../../mask/mask';
import type { Plane } from '../../mask/snap';

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
