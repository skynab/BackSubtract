import { describe, expect, it } from 'vitest';
import { checkerColors, DEFAULT_CONTRAST } from './checker';
import type { RGB } from './renderer';

const A: RGB = [1, 1, 1];
const B: RGB = [0.85, 0.85, 0.87];

describe('checkerColors', () => {
  it("is the theme's own colours at the default", () => {
    expect(checkerColors(A, B, DEFAULT_CONTRAST)).toEqual([A, B]);
  });

  it('is one even colour at 0', () => {
    const [a, b] = checkerColors(A, B, 0);
    expect(a).toEqual(b);
  });

  it('is white and black at 100', () => {
    expect(checkerColors(A, B, 100)).toEqual([[1, 1, 1], [0, 0, 0]]);
    // The same in a dark theme, where the first colour is the lighter one too.
    expect(checkerColors([0.23, 0.23, 0.25], [0.17, 0.18, 0.2], 100)).toEqual([[1, 1, 1], [0, 0, 0]]);
  });

  it('pushes the colours apart steadily above the default', () => {
    const gap = (c: number) => {
      const [a, b] = checkerColors(A, B, c);
      return a[0] - b[0];
    };
    expect(gap(30)).toBeGreaterThan(gap(15));
    expect(gap(60)).toBeGreaterThan(gap(30));
  });
});
