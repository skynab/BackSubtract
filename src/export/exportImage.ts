import type { Mask } from '../mask/mask';

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

export async function exportPng(image: ImageBitmap, mask: Mask): Promise<Blob> {
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas 2D is unavailable');
  ctx.drawImage(image, 0, 0);
  const pixels = ctx.getImageData(0, 0, image.width, image.height);
  applyMaskAlpha(pixels.data, mask.data);
  ctx.putImageData(pixels, 0, 0);
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('PNG encoding failed'))), 'image/png'),
  );
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
