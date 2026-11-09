/**
 * A minimal zip writer for "Download all". Entries are stored as they are, without
 * compression: PNG, WebP and JPG are already compressed, so deflating them again
 * would only cost time. That keeps it to headers and a CRC-32, with no dependency.
 */

let table: Uint32Array | null = null;

function crcTable(): Uint32Array {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
}

/** CRC-32 (the IEEE 802.3 polynomial, as zip uses). Pass the previous result to continue over more data. */
export function crc32(data: Uint8Array, previous = 0): number {
  const t = (table ??= crcTable());
  let c = ~previous;
  for (let i = 0; i < data.length; i++) c = t[(c ^ data[i]) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
}

export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

/** Bit 11: the names are UTF-8, so non-Latin file names come out right. */
const UTF8 = 0x0800;
/** Version 2.0 of the format: enough for stored entries with UTF-8 names. */
const VERSION = 20;
const MAX_32 = 0xffffffff;

/** A date in MS-DOS form (local time, 2-second steps), as zip headers keep it. */
function dosDateTime(date: Date): { time: number; day: number } {
  const year = Math.min(2107, Math.max(1980, date.getFullYear()));
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

/** A zip file of `entries`, in order. */
export function zip(entries: ZipEntry[], date = new Date()): Blob {
  if (entries.length > 0xffff) throw new Error('Too many files for a zip');
  const { time, day } = dosDateTime(date);
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;

  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const size = entry.data.length;
    const crc = crc32(entry.data);
    if (size > MAX_32 || offset > MAX_32) throw new Error('Zip too large');

    const local = new DataView(new ArrayBuffer(30 + name.length));
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, VERSION, true);
    local.setUint16(6, UTF8, true);
    local.setUint16(8, 0, true); // stored
    local.setUint16(10, time, true);
    local.setUint16(12, day, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, size, true);
    local.setUint32(22, size, true);
    local.setUint16(26, name.length, true);
    local.setUint16(28, 0, true);
    new Uint8Array(local.buffer).set(name, 30);

    const dir = new DataView(new ArrayBuffer(46 + name.length));
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, VERSION, true);
    dir.setUint16(6, VERSION, true);
    dir.setUint16(8, UTF8, true);
    dir.setUint16(10, 0, true);
    dir.setUint16(12, time, true);
    dir.setUint16(14, day, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, size, true);
    dir.setUint32(24, size, true);
    dir.setUint16(28, name.length, true);
    // Extra field, comment, disk number, internal and external attributes: none.
    dir.setUint32(42, offset, true);
    new Uint8Array(dir.buffer).set(name, 46);
    central.push(new Uint8Array(dir.buffer));

    parts.push(local.buffer, entry.data as Uint8Array<ArrayBuffer>);
    offset += local.byteLength + size;
  }

  const dirSize = central.reduce((n, c) => n + c.length, 0);
  if (offset > MAX_32) throw new Error('Zip too large');
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, dirSize, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as Uint8Array<ArrayBuffer>[]), end.buffer], { type: 'application/zip' });
}

/**
 * `name`, or "name (2).ext", "name (3).ext"… if it's already in `taken` (compared
 * ignoring case, as Windows and macOS do), so two photos with the same name don't
 * overwrite each other when the zip is opened. Adds the result to `taken`.
 */
export function uniqueName(name: string, taken: Set<string>): string {
  const dot = name.lastIndexOf('.');
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : '';
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${base} (${n})${ext}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}
