/** sRGB → CIELAB (D65), and perceptual colour distance maps for colour-based selection. */

const LINEAR = new Float32Array(256);
for (let i = 0; i < 256; i++) {
  const c = i / 255;
  LINEAR[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

export type Lab = [number, number, number];

export function rgbToLab(r: number, g: number, b: number): Lab {
  const lr = LINEAR[r], lg = LINEAR[g], lb = LINEAR[b];
  const x = (lr * 0.4124 + lg * 0.3576 + lb * 0.1805) / 0.95047;
  const y = lr * 0.2126 + lg * 0.7152 + lb * 0.0722;
  const z = (lr * 0.0193 + lg * 0.1192 + lb * 0.9505) / 1.08883;
  const fx = f(x), fy = f(y), fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** Distance values are stored as ΔE × DIST_SCALE in a Uint8Array (so ΔE up to 127.5). */
export const DIST_SCALE = 2;

/** Per-colour cache of distance + 1 (0 = not computed yet), indexed by 24-bit RGB. Reused between taps. */
let colorCache: Uint16Array | null = null;

/**
 * ΔE (CIE76) from every pixel to `seed`. Each distinct colour is converted only
 * once, which keeps this fast even on large photos.
 */
export function distanceMap(rgba: Uint8ClampedArray, seed: Lab): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n);
  colorCache ??= new Uint16Array(1 << 24);
  const cache = colorCache;
  cache.fill(0);
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const key = (rgba[p] << 16) | (rgba[p + 1] << 8) | rgba[p + 2];
    let d = cache[key];
    if (d === 0) {
      const [l, a, b] = rgbToLab(rgba[p], rgba[p + 1], rgba[p + 2]);
      const dl = l - seed[0], da = a - seed[1], db = b - seed[2];
      d = Math.min(255, Math.round(Math.sqrt(dl * dl + da * da + db * db) * DIST_SCALE)) + 1;
      cache[key] = d;
    }
    out[i] = d - 1;
  }
  return out;
}

/**
 * Selection strength (0–255) for a stored distance at a given tolerance (in ΔE).
 * Fully selected well inside the tolerance, fading to 0 across its last part,
 * so edges come out soft rather than jagged.
 */
export function softness(tolerance: number): Uint8Array {
  const lut = new Uint8Array(256);
  const t = tolerance * DIST_SCALE;
  const feather = Math.max(1, t * 0.25);
  for (let d = 0; d < 256; d++) {
    lut[d] = d <= t - feather ? 255 : d >= t ? 0 : Math.round((255 * (t - d)) / feather);
  }
  return lut;
}
