import { applyMaskAlpha } from '../export/exportImage';
import { resizePlane } from '../mask/resample';

/** Longest side of a batch thumbnail, in pixels: sharp on a ~110–160 px tile at up to 2–3× pixel density. */
export const THUMB_SIDE = 320;

export function thumbSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, THUMB_SIDE / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * A thumbnail of `source` (any size) as a PNG: the image as it is, or with `mask`
 * (at any size) applied as transparency, so it shows the result on the tile's checkerboard.
 */
export async function makeThumb(
  source: ImageBitmap,
  mask?: { data: Uint8Array; width: number; height: number },
): Promise<Blob> {
  const { width, height } = thumbSize(source.width, source.height);
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext('2d', { willReadFrequently: !!mask });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(source, 0, 0, width, height);
  if (mask) {
    const image = ctx.getImageData(0, 0, width, height);
    applyMaskAlpha(image.data, resizePlane(mask.data, mask.width, mask.height, width, height));
    ctx.putImageData(image, 0, 0);
  }
  return canvas.convertToBlob({ type: 'image/png' });
}
