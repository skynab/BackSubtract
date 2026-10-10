/** Screen position = image position × scale + (x, y), in CSS pixels. */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

const PADDING = 24;
export const MAX_SCALE = 32;

export function fitView(imageW: number, imageH: number, viewW: number, viewH: number): View {
  const availW = Math.max(1, viewW - PADDING * 2);
  const availH = Math.max(1, viewH - PADDING * 2);
  const scale = Math.min(availW / imageW, availH / imageH);
  return { scale, x: (viewW - imageW * scale) / 2, y: (viewH - imageH * scale) / 2 };
}

export function minScale(imageW: number, imageH: number, viewW: number, viewH: number): number {
  return Math.min(fitView(imageW, imageH, viewW, viewH).scale * 0.5, 1);
}

/** Zoom to `scale` while keeping the image point under `p` fixed on screen. */
export function zoomAt(view: View, p: Point, scale: number): View {
  const ix = (p.x - view.x) / view.scale;
  const iy = (p.y - view.y) / view.scale;
  return { scale, x: p.x - ix * scale, y: p.y - iy * scale };
}

export function toImage(view: View, p: Point): Point {
  return { x: (p.x - view.x) / view.scale, y: (p.y - view.y) / view.scale };
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
