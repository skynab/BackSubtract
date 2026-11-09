import type { Rect } from '../mask/mask';

/** What goes behind the subject in the download. */
export type BackgroundKind = 'none' | 'color' | 'blur' | 'image';

export const BACKGROUND_KINDS: readonly BackgroundKind[] = ['none', 'color', 'blur', 'image'];

export type Background =
  | { kind: 'none' }
  | { kind: 'color'; color: string }
  /** The photo's own background, blurred: strength BLUR_MIN–BLUR_MAX. */
  | { kind: 'blur'; strength: number }
  /** A photo picked from the device, scaled to cover the frame. */
  | { kind: 'image'; image: Blob };

export const BLUR_MIN = 1;
export const BLUR_MAX = 100;
export const BLUR_DEFAULT = 40;

/** An image as plain RGBA bytes. */
export interface RgbaImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** Blur radius in image px for a strength: up to 5% of the image's longer side. */
export function blurRadius(strength: number, width: number, height: number): number {
  return Math.max(1, (Math.max(width, height) * strength) / 2000);
}

/**
 * Where a picture of `w` × `h` goes to cover `frame` completely, centred and
 * keeping its shape (CSS object-fit: cover). Whatever spills over is cut off.
 */
export function coverRect(w: number, h: number, frame: Rect): Rect {
  const s = Math.max(frame.w / w, frame.h / h);
  return { x: frame.x + (frame.w - w * s) / 2, y: frame.y + (frame.h - h * s) / 2, w: w * s, h: h * s };
}

/**
 * Mask values below this feed the blur, fading out towards it. Soft edge pixels
 * above it hold too much of the subject's colour.
 */
const BG_BELOW = 32;
/** Below this share of background in the blur window, the colour comes partly from the coarser level. */
const FILL = 0.05;

interface Planes {
  w: number;
  h: number;
  /** Colour premultiplied by weight, and the weight: each the average over the cell. */
  r: Float32Array;
  g: Float32Array;
  b: Float32Array;
  wt: Float32Array;
}

const planes = (w: number, h: number): Planes => {
  const n = w * h;
  return { w, h, r: new Float32Array(n), g: new Float32Array(n), b: new Float32Array(n), wt: new Float32Array(n) };
};

/**
 * Average the image into cells of f × f pixels, each pixel weighted by how much
 * it is background (and by its own alpha). With `all`, every pixel counts, for
 * an image where nothing has been removed.
 */
function accumulate(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  f: number,
  all: boolean,
): { p: Planes; any: boolean } {
  const lw = Math.ceil(width / f);
  const lh = Math.ceil(height / f);
  const p = planes(lw, lh);
  const col = new Int32Array(width);
  for (let x = 0; x < width; x++) col[x] = (x / f) | 0;
  let any = false;
  for (let y = 0; y < height; y++) {
    const row = ((y / f) | 0) * lw;
    for (let x = 0, i = y * width; x < width; x++, i++) {
      const m = mask[i];
      if (!all && m >= BG_BELOW) continue;
      const q = i * 4;
      const w = (all ? 1 : (BG_BELOW - m) / BG_BELOW) * (rgba[q + 3] / 255);
      if (w === 0) continue;
      const c = row + col[x];
      p.r[c] += rgba[q] * w;
      p.g[c] += rgba[q + 1] * w;
      p.b[c] += rgba[q + 2] * w;
      p.wt[c] += w;
      any = true;
    }
  }
  // Sums to averages (the last row and column of cells may be partly outside the image).
  for (let j = 0; j < lh; j++) {
    const ch = Math.min(f, height - j * f);
    for (let i = 0; i < lw; i++) {
      const k = 1 / (Math.min(f, width - i * f) * ch);
      const c = j * lw + i;
      p.r[c] *= k;
      p.g[c] *= k;
      p.b[c] *= k;
      p.wt[c] *= k;
    }
  }
  return { p, any };
}

/** One box-blur pass along each line, with the edge pixels repeated beyond the ends. */
function blurLines(
  src: Float32Array,
  dst: Float32Array,
  lines: number,
  len: number,
  step: number,
  lineStep: number,
  r: number,
): void {
  const scale = 1 / (2 * r + 1);
  const last = len - 1;
  for (let l = 0; l < lines; l++) {
    const base = l * lineStep;
    let sum = 0;
    for (let k = -r; k <= r; k++) sum += src[base + Math.min(last, Math.max(0, k)) * step];
    for (let k = 0; k < len; k++) {
      dst[base + k * step] = sum * scale;
      sum += src[base + Math.min(last, k + r + 1) * step] - src[base + Math.max(0, k - r) * step];
    }
  }
}

/** Three box-blur passes each way: close to a Gaussian with σ ≈ r. */
function blurPlane(plane: Float32Array, w: number, h: number, r: number, tmp: Float32Array): void {
  for (let pass = 0; pass < 3; pass++) {
    blurLines(plane, tmp, h, w, 1, w, r);
    plane.set(tmp);
  }
  for (let pass = 0; pass < 3; pass++) {
    blurLines(plane, tmp, w, h, w, 1, r);
    plane.set(tmp);
  }
}

/** Half the size, each cell the average of the (up to four) cells under it. */
function halve(p: Planes): Planes {
  const nw = Math.ceil(p.w / 2);
  const nh = Math.ceil(p.h / 2);
  const out = planes(nw, nh);
  for (let y = 0; y < nh; y++) {
    for (let x = 0; x < nw; x++) {
      let n = 0, r = 0, g = 0, b = 0, wt = 0;
      for (let yy = y * 2; yy < Math.min(p.h, y * 2 + 2); yy++) {
        for (let xx = x * 2; xx < Math.min(p.w, x * 2 + 2); xx++) {
          const c = yy * p.w + xx;
          r += p.r[c];
          g += p.g[c];
          b += p.b[c];
          wt += p.wt[c];
          n++;
        }
      }
      const c = y * nw + x;
      out.r[c] = r / n;
      out.g[c] = g / n;
      out.b[c] = b / n;
      out.wt[c] = wt / n;
    }
  }
  return out;
}

/** Bilinear sample of an RGB float image (3 values per pixel) at (u, v), clamped to its edges. */
function sample(rgb: Float32Array, w: number, h: number, u: number, v: number, out: Float32Array, o: number): void {
  u = Math.min(w - 1, Math.max(0, u));
  v = Math.min(h - 1, Math.max(0, v));
  const x0 = Math.floor(u), y0 = Math.floor(v);
  const x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(h - 1, y0 + 1);
  const fx = u - x0, fy = v - y0;
  const a = (y0 * w + x0) * 3, b = (y0 * w + x1) * 3, c = (y1 * w + x0) * 3, d = (y1 * w + x1) * 3;
  for (let k = 0; k < 3; k++) {
    const top = rgb[a + k] + (rgb[b + k] - rgb[a + k]) * fx;
    const bottom = rgb[c + k] + (rgb[d + k] - rgb[c + k]) * fx;
    out[o + k] = top + (bottom - top) * fy;
  }
}

/**
 * Turn weighted averages into colours. Where the blur saw enough background,
 * that is the average background colour nearby; where it saw little or none
 * (behind a large subject), the colour comes from ever coarser levels of a
 * pyramid, so it fills in from the background around it ("push-pull").
 */
function fillGaps(base: Planes): Float32Array {
  const levels = [base];
  while (levels[levels.length - 1].w > 1 || levels[levels.length - 1].h > 1) levels.push(halve(levels[levels.length - 1]));

  let rgb = new Float32Array(0);
  for (let l = levels.length - 1; l >= 0; l--) {
    const p = levels[l];
    const next = new Float32Array(p.w * p.h * 3);
    const coarser = levels[l + 1];
    for (let y = 0; y < p.h; y++) {
      for (let x = 0; x < p.w; x++) {
        const c = y * p.w + x;
        const o = c * 3;
        const wt = p.wt[c];
        const t = coarser ? Math.min(1, wt / FILL) : wt > 0 ? 1 : 0;
        if (t < 1 && coarser) sample(rgb, coarser.w, coarser.h, (x + 0.5) / 2 - 0.5, (y + 0.5) / 2 - 0.5, next, o);
        if (t > 0) {
          const k = 1 / wt;
          next[o] = t * p.r[c] * k + (1 - t) * next[o];
          next[o + 1] = t * p.g[c] * k + (1 - t) * next[o + 1];
          next[o + 2] = t * p.b[c] * k + (1 - t) * next[o + 2];
        }
      }
    }
    rgb = next;
  }
  return rgb;
}

/**
 * The photo's own background, blurred, to put behind the subject, like a phone's
 * portrait mode. Blurring the whole photo would smear the subject's colours into
 * a halo around it, so only removed pixels feed the blur (it is weighted by the
 * mask: blur of image × removed, divided by blur of removed). The area behind
 * the subject fills in from the background around it. This works because nothing
 * is ever deleted: the original background is still there.
 *
 * A blur has no fine detail, so the work is done on cells of several pixels and
 * the result is a small image covering `frame` (image px), to be scaled up to
 * it. Where the frame reaches past the image, its edge pixels extend outward.
 * If nothing has been removed, the whole photo is blurred.
 */
export function blurredBackground(
  rgba: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  strength: number,
  frame: Rect = { x: 0, y: 0, w: width, h: height },
): RgbaImage {
  const radius = blurRadius(strength, width, height);
  // About 8 cells per radius is plenty for a smooth blur, and keeps it quick at any size.
  const f = Math.max(1, Math.floor(radius / 8));
  let { p, any } = accumulate(rgba, mask, width, height, f, false);
  if (!any) p = accumulate(rgba, mask, width, height, f, true).p;

  const r = Math.max(1, Math.round(radius / f));
  const tmp = new Float32Array(p.w * p.h);
  for (const plane of [p.r, p.g, p.b, p.wt]) blurPlane(plane, p.w, p.h, r, tmp);
  const rgb = fillGaps(p);

  const ow = Math.max(1, Math.ceil(frame.w / f));
  const oh = Math.max(1, Math.ceil(frame.h / f));
  const data = new Uint8ClampedArray(ow * oh * 4);
  const px = new Float32Array(3);
  for (let j = 0; j < oh; j++) {
    const v = (frame.y + ((j + 0.5) * frame.h) / oh) / f - 0.5;
    for (let i = 0; i < ow; i++) {
      const u = (frame.x + ((i + 0.5) * frame.w) / ow) / f - 0.5;
      sample(rgb, p.w, p.h, u, v, px, 0);
      const o = (j * ow + i) * 4;
      data[o] = px[0];
      data[o + 1] = px[1];
      data[o + 2] = px[2];
      data[o + 3] = 255;
    }
  }
  return { data, width: ow, height: oh };
}
