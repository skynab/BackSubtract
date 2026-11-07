import { describe, expect, it } from 'vitest';
import { PolygonTrace, snapAngle } from './polygon';

const REACH = 5;

describe('snapAngle', () => {
  it('moves the point onto the nearest 45° line, at its distance along it', () => {
    const p = snapAngle({ x: 10, y: 10 }, { x: 30, y: 12 });
    expect(p.x).toBeCloseTo(30);
    expect(p.y).toBeCloseTo(10);
    const q = snapAngle({ x: 0, y: 0 }, { x: 9, y: -11 });
    expect(q.x).toBeCloseTo(10);
    expect(q.y).toBeCloseTo(-10);
    const r = snapAngle({ x: 0, y: 0 }, { x: -1, y: 20 });
    expect(r.x).toBeCloseTo(0);
    expect(r.y).toBeCloseTo(20);
  });
});

describe('PolygonTrace', () => {
  it('adds a corner per tap and closes on a tap near the first corner', () => {
    const poly = new PolygonTrace();
    expect(poly.tap({ x: 10, y: 10 }, false, REACH)).toBe(false);
    expect(poly.tap({ x: 50, y: 10 }, false, REACH)).toBe(false);
    expect(poly.tap({ x: 50, y: 40 }, false, REACH)).toBe(false);
    expect(poly.target({ x: 12, y: 13 }, false, REACH)).toEqual({ point: { x: 10, y: 10 }, closes: true });
    expect(poly.tap({ x: 12, y: 13 }, false, REACH)).toBe(true);
    expect(poly.corners).toEqual([{ x: 10, y: 10 }, { x: 50, y: 10 }, { x: 50, y: 40 }]);
  });

  it('needs three corners before the first one closes it', () => {
    const poly = new PolygonTrace();
    poly.tap({ x: 10, y: 10 }, false, REACH);
    poly.tap({ x: 50, y: 10 }, false, REACH);
    expect(poly.target({ x: 11, y: 11 }, false, REACH).closes).toBe(false);
    expect(poly.tap({ x: 11, y: 30 }, false, REACH)).toBe(false);
    expect(poly.corners).toHaveLength(3);
  });

  it('a second tap on the last corner (a double-click) closes it, or adds nothing when too few corners', () => {
    const poly = new PolygonTrace();
    poly.tap({ x: 10, y: 10 }, false, REACH);
    expect(poly.tap({ x: 11, y: 10 }, false, REACH)).toBe(false);
    expect(poly.corners).toHaveLength(1);
    poly.tap({ x: 50, y: 10 }, false, REACH);
    poly.tap({ x: 50, y: 40 }, false, REACH);
    expect(poly.tap({ x: 51, y: 41 }, false, REACH)).toBe(true);
    expect(poly.corners).toHaveLength(3);
  });

  it('with straight on, keeps the side at 45° steps from the last corner', () => {
    const poly = new PolygonTrace();
    poly.tap({ x: 10, y: 10 }, true, REACH);
    poly.tap({ x: 40, y: 13 }, true, REACH);
    expect(poly.corners[1].x).toBeCloseTo(40);
    expect(poly.corners[1].y).toBeCloseTo(10);
  });

  it('takes back the last corner', () => {
    const poly = new PolygonTrace();
    poly.tap({ x: 10, y: 10 }, false, REACH);
    poly.tap({ x: 50, y: 10 }, false, REACH);
    poly.pop();
    expect(poly.corners).toEqual([{ x: 10, y: 10 }]);
    expect(poly.canClose).toBe(false);
  });
});
