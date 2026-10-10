import { describe, expect, it } from 'vitest';
import { applyMaskAlpha, exportName } from './exportImage';

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
});
