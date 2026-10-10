import { boundingBox, type Rect } from '../mask/mask';
import { resizePlane } from '../mask/resample';
import { snapToEdgesTiled } from '../mask/snap';
import { cleanEdges } from './edges';

/** 'mask' is the visibility mask itself as a black-and-white PNG, for finishing in another editor. */
export type ExportFormat = 'png' | 'webp' | 'jpg' | 'mask';

/** The shape of the picture when cropping to the subject: 'free' fits the subject, the others are width:height. */
export type Aspect = 'free' | '1:1' | '4:5' | '16:9';

export const ASPECTS: readonly Aspect[] = ['free', '1:1', '4:5', '16:9'];

const RATIO: Record<Exclude<Aspect, 'free'>, number> = { '1:1': 1, '4:5': 4 / 5, '16:9': 16 / 9 };

export interface ExportOptions {
  format: ExportFormat;
  /** Background colour for JPG, which has no transparency. */
  background: string;
  /** Crop to the visible part of the image. */
  trim: boolean;
  /** When trimming: space around the subject, as a percentage of its longer side. */
  margin: number;
  /** When trimming: the shape of the picture, centred on the subject. */
  aspect: Aspect;
  /** Encode as PNG whatever the format (the clipboard only takes PNG). JPG keeps its background colour. */
  asPng?: boolean;
}

export const MIME: Record<ExportFormat, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', mask: 'image/png' };

export const extensionFor = (format: ExportFormat) => (format === 'mask' ? 'png' : format);

/** Multiply each pixel's alpha by the mask, in place. The mask is only applied here, at export. */
export function applyMaskAlpha(rgba: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
    rgba[a] = ((rgba[a] * mask[i] + 127) / 255) | 0;
  }
}

/** The mask as an opaque grey image: white = kept, black = removed. */
export function maskToRgba(mask: Uint8Array): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(mask.length * 4);
  for (let i = 0, p = 0; i < mask.length; i++, p += 4) {
    rgba[p] = rgba[p + 1] = rgba[p + 2] = mask[i];
    rgba[p + 3] = 255;
  }
  return rgba;
}

/** "holiday photo.jpg" → "holiday photo-no-bg.png" (or "holiday photo-mask.png" for the mask). */
export function exportName(fileName: string, ext: string, suffix = 'no-bg'): string {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}-${suffix}.${ext}`;
}

/**
 * The area to export when cropping to the subject: its bounding box, grown by a
 * margin and then widened or heightened to the aspect ratio, staying centred.
 * It can reach past the image's edges; that part comes out transparent (or the background colour).
 */
export function frameRect(subject: Rect, margin: number, aspect: Aspect): Rect {
  const pad = Math.round((Math.max(subject.w, subject.h) * margin) / 100);
  let w = subject.w + pad * 2;
  let h = subject.h + pad * 2;
  if (aspect !== 'free') {
    const ratio = RATIO[aspect];
    if (w / h > ratio) h = Math.round(w / ratio);
    else w = Math.round(h * ratio);
  }
  return {
    x: Math.round(subject.x + subject.w / 2 - w / 2),
    y: Math.round(subject.y + subject.h / 2 - h / 2),
    w,
    h,
  };
}

let webpSupport: boolean | undefined;

/** Some browsers (older Safari) can't encode WebP and silently fall back to PNG. */
export function canEncodeWebp(): boolean {
  if (webpSupport === undefined) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    webpSupport = c.toDataURL('image/webp').startsWith('data:image/webp');
  }
  return webpSupport;
}

/**
 * Build the final image: the original pixels with the mask applied as transparency
 * (and edge colours cleaned). Uses OffscreenCanvas, so it runs in the image worker.
 * With `owned`, `pixels` is a private copy that may be changed in place.
 */
export async function exportImage(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  options: ExportOptions,
  owned = false,
): Promise<Blob> {
  const full: Rect = { x: 0, y: 0, w: width, h: height };
  const subject = options.trim ? boundingBox(mask, width, height) : null;
  const crop = subject ? frameRect(subject, options.margin, options.aspect) : full;

  let rgba: Uint8ClampedArray;
  if (options.format === 'mask') {
    rgba = maskToRgba(mask);
  } else {
    // The original is never modified (and ImageData can't use shared memory), so work on a copy.
    rgba = owned ? pixels : new Uint8ClampedArray(pixels);
    cleanEdges(rgba, mask, width, height);
    applyMaskAlpha(rgba, mask);
  }

  const canvas = new OffscreenCanvas(crop.w, crop.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');

  const image = new ImageData(rgba as Uint8ClampedArray<ArrayBuffer>, width, height);
  const fill = options.format === 'jpg' ? options.background : options.format === 'mask' ? '#000000' : null;
  if (fill) {
    // putImageData ignores compositing, so go through a second canvas to draw over the colour.
    const layer = new OffscreenCanvas(width, height);
    layer.getContext('2d')!.putImageData(image, 0, 0);
    ctx.fillStyle = fill;
    ctx.fillRect(0, 0, crop.w, crop.h);
    ctx.drawImage(layer, -crop.x, -crop.y);
  } else {
    ctx.putImageData(image, -crop.x, -crop.y);
  }

  const type = options.asPng ? 'image/png' : MIME[options.format];
  return canvas.convertToBlob({ type, quality: type === 'image/png' ? undefined : 0.92 });
}

/**
 * Export at the size of the original file, when it was scaled down on opening.
 * The mask is scaled up and its hard edges are snapped to the full-size photo;
 * soft edges (e.g. from a soft brush) are wider than the snap radius and stay as they are.
 */
export async function exportFullSize(
  source: Blob,
  mask: Uint8Array,
  width: number,
  height: number,
  options: ExportOptions,
): Promise<Blob> {
  const bitmap = await createImageBitmap(source, { imageOrientation: 'from-image', premultiplyAlpha: 'none' });
  const W = bitmap.width;
  const H = bitmap.height;
  const canvas = new OffscreenCanvas(W, H);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();
  const pixels = ctx.getImageData(0, 0, W, H).data;
  canvas.width = canvas.height = 1;

  const big = resizePlane(mask, width, height, W, H);
  const radius = Math.max(2, Math.ceil((W / width) * 1.5));
  snapToEdgesTiled({ data: big, width: W, height: H }, pixels, { x: 0, y: 0, w: W, h: H }, radius);
  return exportImage(pixels, big, W, H, options, true);
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
