import { describe, expect, it } from 'vitest';
import { unstored } from './db';

describe('stored Blobs', () => {
  it('gives a Blob back as it was stored, where IndexedDB takes Blobs', () => {
    const blob = new Blob(['photo'], { type: 'image/png' });
    expect(unstored(blob)).toBe(blob);
  });

  it('turns stored bytes back into a Blob of the same type, where it does not (WebKit private windows)', async () => {
    const bytes = new TextEncoder().encode('photo').buffer as ArrayBuffer;
    const blob = unstored({ bytes, type: 'image/jpeg' })!;
    expect(blob.type).toBe('image/jpeg');
    expect(await blob.text()).toBe('photo');
  });

  it('ignores anything else', () => {
    expect(unstored(undefined)).toBeUndefined();
    expect(unstored(null)).toBeUndefined();
    expect(unstored({ bytes: 'not bytes', type: 'image/png' })).toBeUndefined();
    expect(unstored(new Uint8Array(4))).toBeUndefined();
  });
});
