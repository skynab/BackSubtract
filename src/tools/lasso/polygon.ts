import type { Point } from '../../canvas/view';

/** The Lasso's two ways of drawing: along edges as you drag, or corner by corner with straight sides. */
export type LassoKind = 'magnetic' | 'polygon';

/** `to` moved onto the nearest 45° line through `from`, at its distance along that line (Shift). */
export function snapAngle(from: Point, to: Point): Point {
  const dx = to.x - from.x, dy = to.y - from.y;
  const a = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  const along = dx * Math.cos(a) + dy * Math.sin(a);
  return { x: from.x + along * Math.cos(a), y: from.y + along * Math.sin(a) };
}

/**
 * A polygon lasso outline in progress: each tap adds a corner, with a straight
 * side from the one before. Tapping the first corner again, or the last one
 * twice (a double-click), closes it. All coordinates are image coordinates.
 */
export class PolygonTrace {
  readonly corners: Point[] = [];

  /** Three corners make the smallest outline that encloses anything. */
  get canClose(): boolean {
    return this.corners.length >= 3;
  }

  /**
   * Where a tap at `p` would land: on the first corner when it is within `reach`
   * (which closes the outline), otherwise at `p`, or with `straight` on the
   * nearest 45° line from the last corner.
   */
  target(p: Point, straight: boolean, reach: number): { point: Point; closes: boolean } {
    const first = this.corners[0];
    if (this.canClose && Math.hypot(p.x - first.x, p.y - first.y) <= reach) return { point: first, closes: true };
    const last = this.corners[this.corners.length - 1];
    return { point: straight && last ? snapAngle(last, p) : p, closes: false };
  }

  /** Add a corner where a tap at `p` lands. Returns true when the tap closes the outline instead. */
  tap(p: Point, straight: boolean, reach: number): boolean {
    const { point, closes } = this.target(p, straight, reach);
    if (closes) return true;
    const last = this.corners[this.corners.length - 1];
    // A second tap on the last corner adds nothing; with enough corners, it closes.
    if (last && Math.hypot(point.x - last.x, point.y - last.y) <= reach) return this.canClose;
    this.corners.push(point);
    return false;
  }

  /** Take back the last corner. */
  pop(): void {
    this.corners.pop();
  }
}
