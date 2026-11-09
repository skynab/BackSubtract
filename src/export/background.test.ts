import { describe, expect, it } from 'vitest';
import { blurRadius, blurredBackground, coverRect, type RgbaImage } from './background';

const W = 200;
const H = 120;

/** An image painted by `color`, and a mask that keeps what `kept` says (255) and removes the rest (0). */
function scene(
  color: (x: number, y: number) => [number, number, number],
  kept: (x: number, y: number) => number,
): { rgba: Uint8ClampedArray; mask: Uint8Array } {
  const rgba = new Uint8ClampedArray(W * H * 4);
  const mask = new Uint8Array(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      rgba.set([...color(x, y), 255], (y * W + x) * 4);
      mask[y * W + x] = kept(x, y);
    }
  }
  return { rgba, mask };
}

/** The colour of the blurred background at an image pixel (the result covers the whole image). */
function at(img: RgbaImage, x: number, y: number): number[] {
  const i = Math.floor((y / H) * img.height) * img.width + Math.floor((x / W) * img.width);
  return [...img.data.slice(i * 4, i * 4 + 3)];
}

const RED: [number, number, number] = [220, 40, 40];
const BLUE: [number, number, number] = [30, 60, 200];
const GREEN: [number, number, number] = [40, 180, 60];
const inDisk = (x: number, y: number) => (x - 100) ** 2 + (y - 60) ** 2 <= 40 ** 2;

describe('coverRect', () => {
  it('fills the frame and cuts off the overflow evenly', () => {
    // A 2:1 picture over a square frame: as tall as the frame, spilling over left and right.
    expect(coverRect(200, 100, { x: 10, y: 20, w: 50, h: 50 })).toEqual({ x: -15, y: 20, w: 100, h: 50 });
    // A tall picture over a wide frame: as wide as the frame, spilling over top and bottom.
    expect(coverRect(100, 400, { x: 0, y: 0, w: 100, h: 50 })).toEqual({ x: 0, y: -175, w: 100, h: 400 });
  });
});

describe('blurRadius', () => {
  it('scales with the longer side, up to 5% of it', () => {
    expect(blurRadius(100, 4000, 3000)).toBe(200);
    expect(blurRadius(40, 3000, 4000)).toBe(80);
    expect(blurRadius(1, 100, 50)).toBe(1);
  });
});

describe('blurredBackground', () => {
  it("doesn't smear the subject's colour into the background", () => {
    const { rgba, mask } = scene((x, y) => (inDisk(x, y) ? RED : BLUE), (x, y) => (inDisk(x, y) ? 255 : 0));
    const bg = blurredBackground(rgba, mask, W, H, 100);
    // Right behind the subject, and just outside its edge: blue, with no red halo.
    for (const [x, y] of [[100, 60], [100 + 42, 60], [100, 60 - 42]]) {
      const [r, , b] = at(bg, x, y);
      expect(Math.abs(r - BLUE[0]), `red at ${x},${y}`).toBeLessThan(3);
      expect(Math.abs(b - BLUE[2]), `blue at ${x},${y}`).toBeLessThan(3);
    }
  });

  it('fills in behind the subject from the background on each side', () => {
    // Green on the left, blue on the right, and a wide subject covering the middle.
    const { rgba, mask } = scene(
      (x) => (x < 100 ? GREEN : BLUE),
      (x, y) => (x > 20 && x < 180 && y > 10 && y < 110 ? 255 : 0),
    );
    const bg = blurredBackground(rgba, mask, W, H, 10);
    const [lr, lg, lb] = at(bg, 40, 60);
    const [rr, rg, rb] = at(bg, 160, 60);
    expect(lg).toBeGreaterThan(lb);
    expect(rb).toBeGreaterThan(rg);
    expect(lr).toBeLessThan(120);
    expect(rr).toBeLessThan(120);
  });

  it('leaves out soft edge pixels, which hold some of the subject', () => {
    // A ring of half-kept red pixels around the disk.
    const ring = (x: number, y: number) => !inDisk(x, y) && (x - 100) ** 2 + (y - 60) ** 2 <= 46 ** 2;
    const { rgba, mask } = scene(
      (x, y) => (inDisk(x, y) || ring(x, y) ? RED : BLUE),
      (x, y) => (inDisk(x, y) ? 255 : ring(x, y) ? 128 : 0),
    );
    const [r] = at(blurredBackground(rgba, mask, W, H, 100), 100, 60);
    expect(r).toBeLessThan(BLUE[0] + 3);
  });

  it('blurs the whole photo when nothing has been removed', () => {
    const { rgba, mask } = scene((x) => (x < 100 ? RED : BLUE), () => 255);
    const bg = blurredBackground(rgba, mask, W, H, 50);
    const [r, , b] = at(bg, 100, 60);
    // Across the line between the two colours, a mix of both.
    expect(r).toBeGreaterThan(70);
    expect(r).toBeLessThan(180);
    expect(b).toBeGreaterThan(70);
    expect(b).toBeLessThan(180);
    // Far from it, the colour itself.
    expect(at(bg, 2, 60)[0]).toBeGreaterThan(200);
  });

  it('covers a frame reaching past the image, extending the edge colours', () => {
    const { rgba, mask } = scene((x) => (x < 100 ? GREEN : BLUE), (x, y) => (inDisk(x, y) ? 255 : 0));
    const frame = { x: -100, y: -20, w: 400, h: 160 };
    const bg = blurredBackground(rgba, mask, W, H, 5, frame);
    expect(bg.width / bg.height).toBeCloseTo(400 / 160, 1);
    const first = [...bg.data.slice(0, 3)];
    const last = (bg.width * bg.height - 1) * 4;
    expect(first[1]).toBeGreaterThan(first[2]); // top left, past the image: green
    expect(bg.data[last + 2]).toBeGreaterThan(bg.data[last + 1]); // bottom right: blue
    // Opaque everywhere.
    for (let i = 3; i < bg.data.length; i += 4) expect(bg.data[i]).toBe(255);
  });

  it('works on cells of several pixels, so large photos stay quick', () => {
    const big = 2000;
    const rgba = new Uint8ClampedArray(big * big * 4).fill(128);
    const mask = new Uint8Array(big * big);
    const bg = blurredBackground(rgba, mask, big, big, 100);
    // A 100 px radius on cells of 12 px.
    expect(bg.width).toBe(Math.ceil(big / 12));
  });
});
