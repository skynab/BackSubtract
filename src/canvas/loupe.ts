import { clamp, type Point, type View } from './view';

/**
 * Touch loupe: a finger hides the exact spot it is working on, so while one finger
 * draws (brush, lasso, shape, a Select loop), a round magnifier shows that spot
 * above it, at twice the view's zoom.
 */

/** Diameter, in CSS px. */
export const LOUPE_SIZE = 120;
/** How much more it magnifies than the view. */
export const LOUPE_ZOOM = 2;
/** A press shows it after this long, or as soon as it moves, so quick taps don't flash it. */
export const LOUPE_DELAY_MS = 150;
/** Room kept clear at the top of the canvas, where the view switch sits over it. */
export const LOUPE_TOP = 60;
const EDGE = 8;
/** From the finger to the loupe's centre when it sits above: its bottom is 50 px above the finger. */
const ABOVE = { x: 70, y: 110 };
/** From the finger to the loupe's centre when it sits beside it (near the top). */
const BESIDE = LOUPE_SIZE / 2 + 44;

/**
 * Where the loupe's centre goes for a finger at `finger` (CSS px, in a canvas of
 * `w` × `h`): above the finger and to its left, clear of a right hand; to the right
 * near the left edge. Near the top there is no room above, so it goes beside the
 * finger instead. It always stays inside the canvas, below the view switch.
 */
export function placeLoupe(finger: Point, w: number, h: number): Point {
  const r = LOUPE_SIZE / 2;
  let x: number;
  let y: number;
  if (finger.y - ABOVE.y - r >= LOUPE_TOP) {
    y = finger.y - ABOVE.y;
    x = finger.x - ABOVE.x - r >= EDGE ? finger.x - ABOVE.x : finger.x + ABOVE.x;
  } else {
    y = finger.y;
    x = finger.x - BESIDE - r >= EDGE ? finger.x - BESIDE : finger.x + BESIDE;
  }
  return { x: clamp(x, r + EDGE, w - r - EDGE), y: clamp(y, LOUPE_TOP + r, h - r - EDGE) };
}

/** The view inside the loupe: LOUPE_ZOOM × the view's zoom, with the point under the finger at its centre. */
export function loupeView(view: View, finger: Point, centre: Point): View {
  const scale = view.scale * LOUPE_ZOOM;
  const ix = (finger.x - view.x) / view.scale;
  const iy = (finger.y - view.y) / view.scale;
  return { scale, x: centre.x - ix * scale, y: centre.y - iy * scale };
}

/** SVG transform that maps screen positions to the same spot inside the loupe, for the lines drawn over the image. */
export function loupeTransform(finger: Point, centre: Point): string {
  return `translate(${centre.x.toFixed(1)} ${centre.y.toFixed(1)}) scale(${LOUPE_ZOOM}) translate(${(-finger.x).toFixed(1)} ${(-finger.y).toFixed(1)})`;
}
