/**
 * Mean over a (2r+1)² window, clamped at the borders (each output is the mean
 * of the pixels that exist). Separable running sums, so cost doesn't depend on r.
 */
export function boxMean(src: Float32Array, width: number, height: number, r: number): Float32Array {
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);

  for (let y = 0; y < height; y++) {
    const row = y * width;
    let sum = 0;
    for (let x = 0; x <= Math.min(r, width - 1); x++) sum += src[row + x];
    for (let x = 0; x < width; x++) {
      const lo = Math.max(0, x - r);
      const hi = Math.min(width - 1, x + r);
      tmp[row + x] = sum / (hi - lo + 1);
      if (x + r + 1 < width) sum += src[row + x + r + 1];
      if (x - r >= 0) sum -= src[row + x - r];
    }
  }

  for (let x = 0; x < width; x++) {
    let sum = 0;
    for (let y = 0; y <= Math.min(r, height - 1); y++) sum += tmp[y * width + x];
    for (let y = 0; y < height; y++) {
      const lo = Math.max(0, y - r);
      const hi = Math.min(height - 1, y + r);
      out[y * width + x] = sum / (hi - lo + 1);
      if (y + r + 1 < height) sum += tmp[(y + r + 1) * width + x];
      if (y - r >= 0) sum -= tmp[(y - r) * width + x];
    }
  }
  return out;
}
