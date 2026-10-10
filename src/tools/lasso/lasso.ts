import { editor } from '../../editor/editor';
import type { Rect } from '../../mask/mask';
import { snapToEdgesTiled } from '../../mask/snap';
import { useUI } from '../../state/store';
import { applyObject } from '../cutout';
import type { Pixel } from './livewire';

/** How far the filled outline's edge may move to snap onto the image's edge, in px. */
const SNAP_RADIUS = 3;

/**
 * Fill a closed outline of pixel positions into a full-size plane with
 * anti-aliased edges. Returns null when it encloses nothing.
 */
export function fillOutline(points: Pixel[], width: number, height: number): { data: Uint8Array; rect: Rect } | null {
  if (points.length < 3) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of points) {
    x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
  }
  const rect = {
    x: Math.max(0, x0 - 1), y: Math.max(0, y0 - 1),
    w: Math.min(width, x1 + 2) - Math.max(0, x0 - 1), h: Math.min(height, y1 + 2) - Math.max(0, y0 - 1),
  };
  if (rect.w < 2 || rect.h < 2) return null;

  const canvas = new OffscreenCanvas(rect.w, rect.h);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.beginPath();
  // Through pixel centres, so a line along an edge pixel covers about half of it.
  points.forEach((p, i) => (i ? ctx.lineTo : ctx.moveTo).call(ctx, p.x + 0.5 - rect.x, p.y + 0.5 - rect.y));
  ctx.closePath();
  ctx.fill('nonzero');
  const rgba = ctx.getImageData(0, 0, rect.w, rect.h).data;

  const data = new Uint8Array(width * height);
  let any = false;
  for (let row = 0; row < rect.h; row++) {
    for (let col = 0; col < rect.w; col++) {
      const a = rgba[(row * rect.w + col) * 4 + 3];
      if (a) any = true;
      data[(rect.y + row) * width + rect.x + col] = a;
    }
  }
  return any ? { data, rect } : null;
}

/** Fill a finished lasso outline, snap its rim to the image, and apply it with the Lasso's mode. */
export function applyLasso(outline: Pixel[]): void {
  const mask = editor.mask;
  if (!mask) return;
  const W = mask.width, H = mask.height;
  const shape = fillOutline(outline, W, H);
  if (!shape) return;
  const r = shape.rect;
  const padded = mask.clip({ x: r.x - SNAP_RADIUS, y: r.y - SNAP_RADIUS, w: r.w + 2 * SNAP_RADIUS, h: r.h + 2 * SNAP_RADIUS })!;
  snapToEdgesTiled({ data: shape.data, width: W, height: H }, editor.pixels, padded, SNAP_RADIUS);
  applyObject(shape.data, padded, useUI.getState().modes.lasso, 'lasso');
}
