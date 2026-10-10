import { describe, expect, it } from 'vitest';
import { fitView, toImage, zoomAt } from './view';

describe('view', () => {
  it('fits and centres the image', () => {
    const v = fitView(1000, 500, 548, 548);
    expect(v.scale).toBeCloseTo(0.5);
    expect(v.x).toBeCloseTo(24);
    expect(v.y).toBeCloseTo(149);
  });

  it('zooming keeps the point under the cursor fixed', () => {
    const v = { scale: 1, x: 10, y: 20 };
    const p = { x: 110, y: 70 };
    const before = toImage(v, p);
    const after = toImage(zoomAt(v, p, 3), p);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });
});
