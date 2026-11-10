import type { Edit } from '../mask/history';
import { storable, unstored, withStore } from '../session/db';
import { useUI } from '../state/store';
import type { SavedItem } from './state';

/**
 * Keeps a batch in IndexedDB, so only thumbnails need to stay in memory and a
 * refresh doesn't lose it. The index lists the images; each image's original file,
 * mask (with its undo history) and thumbnail have keys of their own, so saving an
 * edit doesn't write the photo again.
 *
 * If storage fails (full, or blocked), the batch carries on with what failed kept in
 * memory instead, and a message says the work can't be saved, as for a single image.
 */

export interface BatchIndex {
  version: 1;
  items: SavedItem[];
  /** The image that was open in the editor. */
  open: string | null;
}

export interface SavedMask {
  mask: Uint8Array;
  edits: Edit[];
}

const INDEX_KEY = 'batch';
const fileKey = (id: string) => `batch/${id}/file`;
const maskKey = (id: string) => `batch/${id}/mask`;
const thumbKey = (id: string) => `batch/${id}/thumb`;

/** What couldn't be stored, kept here instead until the batch is closed. */
const memory = new Map<string, unknown>();
let warned = false;
/** A clearing in progress: reads and writes wait for it, so a new batch's images aren't caught up in it. */
let clearing: Promise<void> = Promise.resolve();

async function put(key: string, value: unknown): Promise<void> {
  await clearing;
  try {
    // A photo or thumbnail is stored as IndexedDB here can keep it (see storable in db.ts).
    const stored = value instanceof Blob ? await storable(value) : value;
    await withStore('readwrite', (s) => s.put(stored, key));
    memory.delete(key);
  } catch (err) {
    memory.set(key, value);
    if (!warned) {
      warned = true;
      console.warn('Saving the batch failed', err);
      useUI.getState().showNotice({ key: 'errors.save', tone: 'error' });
    }
  }
}

async function get<T>(key: string): Promise<T | undefined> {
  await clearing;
  if (memory.has(key)) return memory.get(key) as T;
  try {
    return await withStore<T | undefined>('readonly', (s) => s.get(key));
  } catch {
    return undefined;
  }
}

export const saveIndex = (index: BatchIndex) => put(INDEX_KEY, index);
export const saveFile = (id: string, file: Blob) => put(fileKey(id), file);
export const saveMask = (id: string, saved: SavedMask) => put(maskKey(id), saved);
export const saveThumb = (id: string, thumb: Blob) => put(thumbKey(id), thumb);

export async function loadIndex(): Promise<BatchIndex | null> {
  const index = await get<BatchIndex>(INDEX_KEY);
  return index?.version === 1 && Array.isArray(index.items) ? index : null;
}

export async function loadFile(id: string): Promise<Blob | null> {
  return unstored(await get<unknown>(fileKey(id))) ?? null;
}

export async function loadMask(id: string): Promise<SavedMask | null> {
  const saved = await get<SavedMask>(maskKey(id));
  return saved?.mask instanceof Uint8Array ? saved : null;
}

export async function loadThumb(id: string): Promise<Blob | null> {
  return unstored(await get<unknown>(thumbKey(id))) ?? null;
}

/** Remove everything a batch stored. Saving and loading wait until it's done. */
export function clearBatch(): Promise<void> {
  memory.clear();
  warned = false;
  const previous = clearing;
  clearing = (async () => {
    await previous;
    try {
      // Every key above, and nothing else ('background' sorts before them, 'current' after).
      await withStore('readwrite', (s) => s.delete(IDBKeyRange.bound(INDEX_KEY, `${INDEX_KEY}/\uffff`)));
    } catch {
      // Nothing more can be done; a leftover batch is only found again if its index survived.
    }
  })();
  return clearing;
}
