import { describe, expect, it } from 'vitest';
import { cleanEdges } from './edges';

describe('cleanEdges', () => {
  it('removes the background colour mixed into soft edge pixels', () => {
    // A row: green background | 50% mix of red subject and green | red subject.
    const width = 9, height = 1;
    const rgba = new Uint8ClampedArray(width * 4);
    const mask = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      if (x < 4) rgba.set([0, 255, 0, 255], x * 4);
      else if (x === 4) rgba.set([128, 128, 0, 255], x * 4);
      else rgba.set([255, 0, 0, 255], x * 4);
      mask[x] = x < 4 ? 0 : x === 4 ? 128 : 255;
    }
    cleanEdges(rgba, mask, width, height, 3);
    const [r, g, b] = rgba.slice(16, 19);
    expect(r).toBeGreaterThan(240);
    expect(g).toBeLessThan(15);
    expect(b).toBe(0);
  });

  it('leaves fully visible and fully removed pixels alone', () => {
    const rgba = new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]);
    const before = rgba.slice();
    cleanEdges(rgba, new Uint8Array([0, 255]), 2, 1);
    expect(rgba).toEqual(before);
  });
});
