import { combine, unionRect, type Mask, type Mode, type Rect } from '../../mask/mask';

/** Fraction of the radius painted at full strength; the rest fades out. */
export const HARDNESS = 0.6;

/**
 * Paint one round, soft-edged dab into the mask. Because Keep uses max() and
 * Remove uses min(), overlapping dabs never build up beyond a single dab.
 */
export function stampDab(
  mask: Mask,
  cx: number,
  cy: number,
  radius: number,
  mode: Mode,
  hardness = HARDNESS,
): Rect | null {
  const r = Math.max(radius, 0.5);
  const x0 = Math.max(0, Math.floor(cx - r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const x1 = Math.min(mask.width, Math.ceil(cx + r));
  const y1 = Math.min(mask.height, Math.ceil(cy + r));
  if (x0 >= x1 || y0 >= y1) return null;

  const inner = r * hardness;
  const feather = r - inner;
  const { data, width } = mask;
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d >= r) continue;
      const s = d <= inner ? 255 : Math.round((255 * (r - d)) / feather);
      const i = y * width + x;
      data[i] = combine(data[i], s, mode);
    }
  }
  return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

/** Paint dabs along a line, excluding the start point (it was painted by the previous call). */
export function stampSegment(
  mask: Mask,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  radius: number,
  mode: Mode,
): Rect | null {
  const dist = Math.hypot(toX - fromX, toY - fromY);
  const spacing = Math.max(0.5, radius * 0.25);
  const steps = Math.max(1, Math.ceil(dist / spacing));
  let dirty: Rect | null = null;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    dirty = unionRect(
      dirty,
      stampDab(mask, fromX + (toX - fromX) * t, fromY + (toY - fromY) * t, radius, mode),
    );
  }
  return dirty;
}
