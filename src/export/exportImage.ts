import { boundingBox, type Rect } from '../mask/mask';
import { cleanEdges } from './edges';

export type ExportFormat = 'png' | 'webp' | 'jpg';

export interface ExportOptions {
  format: ExportFormat;
  /** Background colour for JPG, which has no transparency. */
  background: string;
  /** Crop to the visible part of the image. */
  trim: boolean;
}

const MIME: Record<ExportFormat, string> = { png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg' };

/** Multiply each pixel's alpha by the mask, in place. The mask is only applied here, at export. */
export function applyMaskAlpha(rgba: Uint8ClampedArray, mask: Uint8Array): void {
  for (let i = 0, a = 3; i < mask.length; i++, a += 4) {
    rgba[a] = ((rgba[a] * mask[i] + 127) / 255) | 0;
  }
}

/** "holiday photo.jpg" → "holiday photo-no-bg.png" */
export function exportName(fileName: string, ext: string): string {
  const base = fileName.replace(/\.[^./\\]+$/, '') || 'image';
  return `${base}-no-bg.${ext}`;
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
 */
export async function exportImage(
  pixels: Uint8ClampedArray,
  mask: Uint8Array,
  width: number,
  height: number,
  options: ExportOptions,
): Promise<Blob> {
  // A private copy: the original is never modified (and ImageData can't use shared memory).
  const rgba = new Uint8ClampedArray(pixels);
  cleanEdges(rgba, mask, width, height);
  applyMaskAlpha(rgba, mask);

  const full: Rect = { x: 0, y: 0, w: width, h: height };
  const crop = (options.trim && boundingBox(mask, width, height)) || full;

  const canvas = new OffscreenCanvas(crop.w, crop.h);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D is unavailable');

  const image = new ImageData(rgba, width, height);
  if (options.format === 'jpg') {
    // putImageData ignores compositing, so go through a second canvas to draw over the colour.
    const layer = new OffscreenCanvas(width, height);
    layer.getContext('2d')!.putImageData(image, 0, 0);
    ctx.fillStyle = options.background;
    ctx.fillRect(0, 0, crop.w, crop.h);
    ctx.drawImage(layer, -crop.x, -crop.y);
  } else {
    ctx.putImageData(image, -crop.x, -crop.y);
  }

  return canvas.convertToBlob({
    type: MIME[options.format],
    quality: options.format === 'png' ? undefined : 0.92,
  });
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
