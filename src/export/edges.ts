/** Alpha below this is treated as this when un-mixing, so faint pixels don't blow up. */
const MIN_ALPHA = 0.15;

/**
 * Clean coloured fringes from soft edges, e.g. the green halo left by a green screen.
 *
 * A partly visible edge pixel is a mix of subject (F) and background (B):
 * C = αF + (1 − α)B. B is estimated as the average colour of the fully removed
 * pixels nearby (we still have them, since nothing is ever deleted), then
 * F = (C − (1 − α)B) / α. Only pixels with 0 < α < 255 change; their alpha is
 * left alone. Only fully removed pixels are read as background and they are never
 * written, so cleaning in place is safe. Work is proportional to the number of
 * edge pixels. Modifies `rgba` in place.
 */
export function cleanEdges(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  radius = 5,
): void {
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      const m = mask[i];
      if (m === 0 || m === 255) continue;

      let n = 0, br = 0, bg = 0, bb = 0;
      const y0 = Math.max(0, y - radius), y1 = Math.min(height - 1, y + radius);
      const x0 = Math.max(0, x - radius), x1 = Math.min(width - 1, x + radius);
      for (let yy = y0; yy <= y1; yy++) {
        let j = yy * width + x0;
        for (let xx = x0; xx <= x1; xx++, j++) {
          if (mask[j] !== 0) continue;
          const p = j * 4;
          br += rgba[p];
          bg += rgba[p + 1];
          bb += rgba[p + 2];
          n++;
        }
      }
      if (n === 0) continue;

      const alpha = Math.max(m / 255, MIN_ALPHA);
      const k = (1 - alpha) / n;
      const p = i * 4;
      rgba[p] = (rgba[p] - k * br) / alpha;
      rgba[p + 1] = (rgba[p + 1] - k * bg) / alpha;
      rgba[p + 2] = (rgba[p + 2] - k * bb) / alpha;
    }
  }
}
