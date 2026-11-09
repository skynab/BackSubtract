import { describe, expect, it } from 'vitest';
import { LOUPE_SIZE, LOUPE_TOP, loupeTransform, loupeView, placeLoupe } from './loupe';
import { toImage, type Point } from './view';

const R = LOUPE_SIZE / 2;
const W = 400;
const H = 700;
const overlaps = (centre: Point, finger: Point) => Math.hypot(centre.x - finger.x, centre.y - finger.y) < R + 20;

describe('placeLoupe', () => {
  it('sits above the finger and to its left', () => {
    const finger = { x: 250, y: 400 };
    const c = placeLoupe(finger, W, H);
    expect(c.x).toBeLessThan(finger.x);
    expect(c.y + R).toBeLessThan(finger.y);
    expect(overlaps(c, finger)).toBe(false);
  });

  it('moves to the right of the finger near the left edge', () => {
    const finger = { x: 40, y: 400 };
    const c = placeLoupe(finger, W, H);
    expect(c.x).toBeGreaterThan(finger.x);
    expect(c.y + R).toBeLessThan(finger.y);
  });

  it('goes beside the finger near the top, staying below the view switch', () => {
    for (const finger of [{ x: 300, y: 150 }, { x: 30, y: 150 }, { x: 200, y: 20 }]) {
      const c = placeLoupe(finger, W, H);
      expect(c.y - R, `${finger.x},${finger.y}`).toBeGreaterThanOrEqual(LOUPE_TOP);
      expect(overlaps(c, finger), `${finger.x},${finger.y}`).toBe(false);
    }
  });

  it('stays inside the canvas', () => {
    for (const finger of [{ x: 0, y: 0 }, { x: W, y: H }, { x: W, y: 0 }, { x: 0, y: H }, { x: W / 2, y: H / 2 }]) {
      const c = placeLoupe(finger, W, H);
      expect(c.x - R).toBeGreaterThanOrEqual(0);
      expect(c.x + R).toBeLessThanOrEqual(W);
      expect(c.y + R).toBeLessThanOrEqual(H);
    }
  });
});

describe('loupeView', () => {
  const view = { scale: 0.5, x: 20, y: 30 };
  const finger = { x: 120, y: 230 };
  const centre = { x: 60, y: 160 };
  const lv = loupeView(view, finger, centre);

  it('shows the point under the finger at its centre, at twice the zoom', () => {
    expect(lv.scale).toBe(1);
    const under = toImage(view, finger);
    expect(toImage(lv, centre)).toEqual(under);
    // 10 px from the centre of the loupe is 5 px from the finger in the view.
    expect(toImage(lv, { x: centre.x + 10, y: centre.y })).toEqual(toImage(view, { x: finger.x + 5, y: finger.y }));
  });

  it('moves the lines drawn over the image to the same place inside it', () => {
    expect(loupeTransform(finger, centre)).toBe('translate(60.0 160.0) scale(2) translate(-120.0 -230.0)');
  });
});
