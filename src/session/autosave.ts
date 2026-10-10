import { editor } from '../editor/editor';
import type { Edit } from '../mask/history';

/**
 * Saves the work in progress to IndexedDB, on this device only, so a refresh or
 * a closed tab doesn't lose it. One session is kept; opening a new image replaces it.
 */

const DB_NAME = 'backsubtract';
const STORE = 'session';
const KEY = 'current';
const SAVE_DELAY_MS = 800;
/** Cap on saved undo history, so saving stays quick. */
const HISTORY_BYTES = 64 * 1024 * 1024;

export interface SavedSession {
  version: 1;
  file: Blob;
  fileName: string;
  width: number;
  height: number;
  mask: Uint8Array;
  edits: Edit[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const saved = await withStore<SavedSession | undefined>('readonly', (s) => s.get(KEY));
    return saved?.version === 1 ? saved : null;
  } catch {
    return null;
  }
}

async function save(): Promise<void> {
  const { image, mask, source } = editor;
  if (!image || !mask || !source) return;
  const session: SavedSession = {
    version: 1,
    file: source,
    fileName: editor.fileName,
    width: mask.width,
    height: mask.height,
    mask: mask.data.slice(),
    edits: editor.history.newest(HISTORY_BYTES),
  };
  await withStore('readwrite', (s) => s.put(session, KEY));
}

let timer = 0;

/** Save shortly after each change, and when the page is hidden. */
export function startAutosave(): void {
  const flush = () => {
    clearTimeout(timer);
    timer = 0;
    // Saving is best-effort: if storage is full or blocked, editing still works.
    save().catch(() => {});
  };
  const schedule = () => {
    clearTimeout(timer);
    timer = window.setTimeout(flush, SAVE_DELAY_MS);
  };
  editor.subscribe((event) => {
    if (event.type === 'image') flush();
    else if (event.type === 'history') schedule();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && timer) flush();
  });
}
