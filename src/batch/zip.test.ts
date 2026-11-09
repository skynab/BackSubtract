import { describe, expect, it } from 'vitest';
import { crc32, uniqueName, zip } from './zip';

const bytes = (s: string) => new TextEncoder().encode(s);

interface Read {
  name: string;
  data: Uint8Array;
  flags: number;
  method: number;
  crc: number;
  time: number;
  day: number;
}

/** Read a zip back the way unzip tools do: from the end record, through the central directory, to each local header. */
async function unzip(blob: Blob): Promise<Read[]> {
  const buf = new Uint8Array(await blob.arrayBuffer());
  const view = new DataView(buf.buffer);
  const end = buf.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  const count = view.getUint16(end + 10, true);
  const dirSize = view.getUint32(end + 12, true);
  let p = view.getUint32(end + 16, true);
  expect(p + dirSize).toBe(end);
  const out: Read[] = [];
  for (let i = 0; i < count; i++) {
    expect(view.getUint32(p, true)).toBe(0x02014b50);
    const nameLen = view.getUint16(p + 28, true);
    const extra = view.getUint16(p + 30, true);
    const comment = view.getUint16(p + 32, true);
    const offset = view.getUint32(p + 42, true);
    const name = new TextDecoder().decode(buf.subarray(p + 46, p + 46 + nameLen));
    const size = view.getUint32(p + 24, true);

    // The local header repeats what the central directory says.
    expect(view.getUint32(offset, true)).toBe(0x04034b50);
    expect(view.getUint32(offset + 14, true)).toBe(view.getUint32(p + 16, true));
    expect(view.getUint32(offset + 18, true)).toBe(size);
    const localName = view.getUint16(offset + 26, true);
    const start = offset + 30 + localName + view.getUint16(offset + 28, true);
    out.push({
      name,
      data: buf.slice(start, start + size),
      flags: view.getUint16(p + 8, true),
      method: view.getUint16(p + 10, true),
      crc: view.getUint32(p + 16, true),
      time: view.getUint16(p + 12, true),
      day: view.getUint16(p + 14, true),
    });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

describe('crc32', () => {
  it('matches the standard check values', () => {
    expect(crc32(bytes(''))).toBe(0);
    expect(crc32(bytes('123456789'))).toBe(0xcbf43926);
    expect(crc32(bytes('The quick brown fox jumps over the lazy dog'))).toBe(0x414fa339);
  });

  it('can continue over data in pieces', () => {
    expect(crc32(bytes('6789'), crc32(bytes('12345')))).toBe(0xcbf43926);
  });
});

describe('zip', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
  const jpg = new Uint8Array(70_000).map((_, i) => (i * 31) & 0xff);

  it('stores each file as it is, with its checksum, in order', async () => {
    const blob = zip([
      { name: 'cat-no-bg.png', data: png },
      { name: 'dog-no-bg.jpg', data: jpg },
    ]);
    expect(blob.type).toBe('application/zip');
    const files = await unzip(blob);
    expect(files.map((f) => f.name)).toEqual(['cat-no-bg.png', 'dog-no-bg.jpg']);
    expect(files[0].data).toEqual(png);
    expect(files[1].data).toEqual(jpg);
    for (const f of files) {
      expect(f.method).toBe(0);
      expect(f.crc).toBe(crc32(f.data));
    }
  });

  it('keeps non-Latin file names, marked as UTF-8', async () => {
    const names = ['café-no-bg.png', 'חתול-no-bg.png', '猫-no-bg.webp'];
    const files = await unzip(zip(names.map((name) => ({ name, data: png }))));
    expect(files.map((f) => f.name)).toEqual(names);
    for (const f of files) expect(f.flags & 0x0800).toBe(0x0800);
  });

  it('dates the files in MS-DOS form', async () => {
    const [f] = await unzip(zip([{ name: 'a.png', data: png }], new Date(2026, 10, 8, 14, 30, 42)));
    expect(f.day).toBe(((2026 - 1980) << 9) | (11 << 5) | 8);
    expect(f.time).toBe((14 << 11) | (30 << 5) | 21);
  });

  it('makes an empty zip from no files', async () => {
    const blob = zip([]);
    expect(blob.size).toBe(22);
    expect(await unzip(blob)).toEqual([]);
  });
});

describe('uniqueName', () => {
  it('numbers repeats, ignoring case, before the extension', () => {
    const taken = new Set<string>();
    expect(uniqueName('cat-no-bg.png', taken)).toBe('cat-no-bg.png');
    expect(uniqueName('cat-no-bg.png', taken)).toBe('cat-no-bg (2).png');
    expect(uniqueName('CAT-no-bg.png', taken)).toBe('CAT-no-bg (3).png');
    expect(uniqueName('dog-no-bg.png', taken)).toBe('dog-no-bg.png');
    expect(uniqueName('README', taken)).toBe('README');
    expect(uniqueName('README', taken)).toBe('README (2)');
  });
});
