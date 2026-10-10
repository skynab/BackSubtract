import { describe, expect, it } from 'vitest';
import { applyMaskAlpha, exportName, frameRect, maskToRgba } from './exportImage';

describe('applyMaskAlpha', () => {
  it('scales alpha by the mask and leaves colour untouched', () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 255, 10, 20, 30, 255, 1, 2, 3, 128]);
    applyMaskAlpha(rgba, new Uint8Array([255, 0, 128]));
    expect([...rgba]).toEqual([10, 20, 30, 255, 10, 20, 30, 0, 1, 2, 3, 64]);
  });
});

describe('exportName', () => {
  it('adds a suffix and replaces the extension', () => {
    expect(exportName('holiday photo.jpg', 'png')).toBe('holiday photo-no-bg.png');
    expect(exportName('archive.tar.gz', 'png')).toBe('archive.tar-no-bg.png');
    expect(exportName('noext', 'png')).toBe('noext-no-bg.png');
    expect(exportName('', 'png')).toBe('image-no-bg.png');
  });

  it('can use another suffix, e.g. for the mask', () => {
    expect(exportName('cat.jpg', 'png', 'mask')).toBe('cat-mask.png');
  });
});

describe('maskToRgba', () => {
  it('turns the mask into opaque grey pixels', () => {
    expect([...maskToRgba(new Uint8Array([0, 128, 255]))]).toEqual([0, 0, 0, 255, 128, 128, 128, 255, 255, 255, 255, 255]);
  });
});

describe('frameRect', () => {
  const subject = { x: 100, y: 50, w: 200, h: 100 };

  it('is the subject itself with no margin and a free shape', () => {
    expect(frameRect(subject, 0, 'free')).toEqual(subject);
  });

  it('adds the margin on every side, measured from the longer side', () => {
    // 10% of 200 = 20 px.
    expect(frameRect(subject, 10, 'free')).toEqual({ x: 80, y: 30, w: 240, h: 140 });
  });

  it('grows the short side to reach the aspect ratio, staying centred', () => {
    expect(frameRect(subject, 0, '1:1')).toEqual({ x: 100, y: 0, w: 200, h: 200 });
    // A wide subject in a portrait frame: the height grows to 200 / (4 / 5) = 250.
    expect(frameRect(subject, 0, '4:5')).toEqual({ x: 100, y: -25, w: 200, h: 250 });
    // A tall subject in a wide frame: the width grows.
    expect(frameRect({ x: 0, y: 0, w: 90, h: 160 }, 0, '16:9')).toEqual({ x: -97, y: 0, w: 284, h: 160 });
  });

  it('applies the margin before the aspect ratio', () => {
    const r = frameRect(subject, 10, '1:1');
    expect(r.w).toBe(240);
    expect(r.h).toBe(240);
  });
});
