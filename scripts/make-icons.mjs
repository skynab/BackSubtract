// Draws the app icons (same design as public/favicon.svg) as PNGs, with no dependencies.
// Run: node scripts/make-icons.mjs
import { writeFileSync } from 'node:fs';
import { encodePng as png } from './png.mjs';

const BRAND = [0x4f, 0x46, 0xe5];

/** Coverage (0–1) of one pixel by a shape, using 4×4 supersampling for smooth edges. */
function coverage(x, y, inside) {
  let hits = 0;
  for (let sy = 0; sy < 4; sy++) for (let sx = 0; sx < 4; sx++) if (inside(x + (sx + 0.5) / 4, y + (sy + 0.5) / 4)) hits++;
  return hits / 16;
}

/** Draw the icon in a 32-unit design space scaled to `size`; maskable icons get a full-bleed background. */
function draw(size, maskable) {
  const s = size / 32;
  const k = maskable ? 0.72 : 1; // keep content within the maskable safe zone
  const o = (size - size * k) / 2;
  const toDesign = (v) => (v - o) / (s * k); // pixel → design units for the foreground
  const rgba = new Uint8Array(size * size * 4);

  const roundedSquare = (x, y) => {
    const r = 7 * s;
    const cx = Math.min(Math.max(x, r), size - r);
    const cy = Math.min(Math.max(y, r), size - r);
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  };
  const inBox = (x0, y0, w) => (x, y) => {
    const dx = toDesign(x), dy = toDesign(y);
    return dx >= x0 && dx < x0 + w && dy >= y0 && dy < y0 + w;
  };
  const squareA = inBox(7, 7, 9);
  const squareB = inBox(16, 16, 9);
  const circle = (x, y) => (toDesign(x) - 16) ** 2 + (toDesign(y) - 16) ** 2 <= 49;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const bg = maskable ? 1 : coverage(x, y, roundedSquare);
      let [r, g, b] = BRAND;
      // Translucent white squares, then the solid white circle on top.
      const sq = Math.max(coverage(x, y, squareA), coverage(x, y, squareB)) * 0.35;
      r += (255 - r) * sq; g += (255 - g) * sq; b += (255 - b) * sq;
      const c = coverage(x, y, circle);
      r += (255 - r) * c; g += (255 - g) * c; b += (255 - b) * c;
      const i = (y * size + x) * 4;
      rgba.set([Math.round(r), Math.round(g), Math.round(b), Math.round(bg * 255)], i);
    }
  }
  return png(size, size, rgba);
}

const out = new URL('../public/', import.meta.url);
writeFileSync(new URL('icon-192.png', out), draw(192, false));
writeFileSync(new URL('icon-512.png', out), draw(512, false));
writeFileSync(new URL('icon-maskable-512.png', out), draw(512, true));
writeFileSync(new URL('apple-touch-icon.png', out), draw(180, true));
console.log('Wrote icons to public/');
