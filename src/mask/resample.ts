/**
 * Bilinear resize of a single-channel plane, e.g. a model's ~1024 px mask up to
 * the full image size. Pixel centres are aligned, so the result doesn't shift.
 */
export function resizePlane(src: Uint8Array, sw: number, sh: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh);
  const x0s = new Int32Array(dw);
  const x1s = new Int32Array(dw);
  const wxs = new Float32Array(dw);
  for (let x = 0; x < dw; x++) {
    const fx = Math.min(sw - 1, Math.max(0, ((x + 0.5) * sw) / dw - 0.5));
    x0s[x] = Math.floor(fx);
    x1s[x] = Math.min(sw - 1, x0s[x] + 1);
    wxs[x] = fx - x0s[x];
  }
  for (let y = 0; y < dh; y++) {
    const fy = Math.min(sh - 1, Math.max(0, ((y + 0.5) * sh) / dh - 0.5));
    const y0 = Math.floor(fy);
    const wy = fy - y0;
    const r0 = y0 * sw;
    const r1 = Math.min(sh - 1, y0 + 1) * sw;
    const row = y * dw;
    for (let x = 0; x < dw; x++) {
      const wx = wxs[x];
      const top = src[r0 + x0s[x]] * (1 - wx) + src[r0 + x1s[x]] * wx;
      const bottom = src[r1 + x0s[x]] * (1 - wx) + src[r1 + x1s[x]] * wx;
      out[row + x] = (top * (1 - wy) + bottom * wy + 0.5) | 0;
    }
  }
  return out;
}
