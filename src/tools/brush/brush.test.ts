import { describe, expect, it } from 'vitest';
import { Mask } from '../../mask/mask';
import { stampDab, stampSegment } from './brush';

describe('brush', () => {
  it('hides the centre fully and leaves far pixels alone', () => {
    const mask = new Mask(20, 20);
    const rect = stampDab(mask, 10, 10, 4, 'remove');
    expect(rect).toEqual({ x: 6, y: 6, w: 8, h: 8 });
    expect(mask.data[10 * 20 + 10]).toBe(0);
    expect(mask.data[0]).toBe(255);
  });

  it('has a soft edge', () => {
    const mask = new Mask(40, 1);
    stampDab(mask, 20, 0.5, 10, 'remove');
    const edge = mask.data[28]; // 8.5px from the centre, inside the feather band
    expect(edge).toBeGreaterThan(0);
    expect(edge).toBeLessThan(255);
  });

  it('overlapping dabs do not build up', () => {
    const once = new Mask(20, 20);
    stampDab(once, 10, 10, 6, 'remove');
    const twice = new Mask(20, 20);
    stampDab(twice, 10, 10, 6, 'remove');
    stampDab(twice, 10, 10, 6, 'remove');
    expect(twice.data).toEqual(once.data);
  });

  it('a slightly larger Keep stroke fully restores what Remove hid, soft edges included', () => {
    const mask = new Mask(30, 30);
    stampDab(mask, 5, 15, 4, 'remove');
    stampSegment(mask, 5, 15, 25, 15, 4, 'remove');
    expect(mask.data[15 * 30 + 15]).toBe(0);
    stampDab(mask, 5, 15, 8, 'keep');
    stampSegment(mask, 5, 15, 25, 15, 8, 'keep');
    expect(mask.data.every((v) => v === 255)).toBe(true);
  });

  it('clips dabs at the image edge', () => {
    const mask = new Mask(10, 10);
    expect(stampDab(mask, 0, 0, 3, 'remove')).toEqual({ x: 0, y: 0, w: 3, h: 3 });
    expect(stampDab(mask, -20, -20, 3, 'remove')).toBeNull();
  });
});
