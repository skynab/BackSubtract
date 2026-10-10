import { describe, expect, it } from 'vitest';
import { edgeStrength, liveWire, MagneticTrace, snapToEdge } from './livewire';

const W = 80;
const H = 60;

/** Dark on the left of x = 40, light on the right: one vertical edge. */
function stepImage(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x < 40 ? 30 : 220;
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}

/** A light square (20..59 × 15..44) on a dark background. */
function squareImage(): Uint8ClampedArray {
  const rgba = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const v = x >= 20 && x < 60 && y >= 15 && y < 45 ? 220 : 30;
      rgba.set([v, v, v, 255], (y * W + x) * 4);
    }
  }
  return rgba;
}

describe('edgeStrength', () => {
  it('is high on the edge and zero on flat areas', () => {
    const g = edgeStrength(stepImage(), W, H, { x: 0, y: 0, w: W, h: H });
    expect(g[30 * W + 10]).toBe(0);
    expect(g[30 * W + 39]).toBeGreaterThan(0.5);
    expect(g[30 * W + 40]).toBeGreaterThan(0.5);
  });
});

describe('snapToEdge', () => {
  it('moves a point near an edge onto it', () => {
    const p = snapToEdge(stepImage(), W, H, { x: 34, y: 30 }, 8);
    expect(p.x === 39 || p.x === 40).toBe(true);
    expect(p.y).toBe(30);
  });

  it('leaves the point alone when no edge is within reach', () => {
    expect(snapToEdge(stepImage(), W, H, { x: 10, y: 30 }, 5)).toEqual({ x: 10, y: 30 });
  });
});

describe('liveWire', () => {
  it('follows the edge instead of cutting straight across', () => {
    // Both ends are off the edge; a straight line would run through x = 33..37.
    const path = liveWire(stepImage(), W, H, { x: 35, y: 5 }, { x: 35, y: 55 }, 8);
    expect(path[0]).toEqual({ x: 35, y: 5 });
    expect(path[path.length - 1]).toEqual({ x: 35, y: 55 });
    const middle = path.filter((p) => p.y > 15 && p.y < 45);
    expect(middle.every((p) => p.x === 39 || p.x === 40)).toBe(true);
  });

  it('is an unbroken chain of neighbouring pixels', () => {
    const path = liveWire(stepImage(), W, H, { x: 10, y: 10 }, { x: 70, y: 50 }, 6);
    for (let i = 1; i < path.length; i++) {
      expect(Math.max(Math.abs(path[i].x - path[i - 1].x), Math.abs(path[i].y - path[i - 1].y))).toBe(1);
    }
  });
});

describe('MagneticTrace', () => {
  it('traces around a square from rough pointer positions and closes on its outline', () => {
    const rgba = squareImage();
    // Start a little outside the top-left corner and drag roughly around, a few px off the edge.
    const trace = new MagneticTrace(rgba, W, H, { x: 17, y: 12 }, 5);
    const rough = [
      [40, 12], [62, 12], [63, 30], [63, 47], [40, 48], [17, 47], [16, 30],
    ];
    for (const [x, y] of rough) trace.moveTo({ x, y }, 5, 12);
    const outline = trace.close(5);
    // Every point of the outline lies on the square's border (within the 2 px Sobel ridge).
    const onBorder = (x: number, y: number) =>
      x >= 19 && x <= 60 && y >= 14 && y <= 45 && (x <= 20 || x >= 59 || y <= 15 || y >= 44);
    const off = outline.filter((p) => !onBorder(p.x, p.y));
    expect(off.length).toBeLessThanOrEqual(2);
    expect(outline.length).toBeGreaterThan(100);
  });
});
