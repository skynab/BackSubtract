import type { RGB } from './renderer';

/** The contrast the theme's own checker colours stand for; the slider starts here. */
export const DEFAULT_CONTRAST = 15;
export const CONTRAST_MAX = 100;
/** How fast the checkerboard slides when it moves, in CSS px per second (diagonally). */
export const CHECKER_SPEED = 24;

const mix = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/**
 * The two checkerboard colours for a contrast setting (0–100). At the default
 * they are the theme's own colours; lower flattens them towards one colour
 * (so faint leftovers show against an even background); higher pushes them
 * apart, up to white and black at 100.
 */
export function checkerColors(a: RGB, b: RGB, contrast: number): [RGB, RGB] {
  const c = Math.min(CONTRAST_MAX, Math.max(0, contrast));
  if (c <= DEFAULT_CONTRAST) {
    const t = c / DEFAULT_CONTRAST;
    const mid = mix(a, b, 0.5);
    return [mix(mid, a, t), mix(mid, b, t)];
  }
  const t = (c - DEFAULT_CONTRAST) / (CONTRAST_MAX - DEFAULT_CONTRAST);
  // Whichever of the two is lighter goes towards white, the other towards black.
  const light = a[0] + a[1] + a[2] >= b[0] + b[1] + b[2];
  const white: RGB = [1, 1, 1], black: RGB = [0, 0, 0];
  return [mix(a, light ? white : black, t), mix(b, light ? black : white, t)];
}
