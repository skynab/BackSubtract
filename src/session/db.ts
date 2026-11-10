/** The app's IndexedDB database, on this device only: the saved session, a batch, the background photo. */

const DB_NAME = 'backsubtract';
const STORE = 'session';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * A Blob as IndexedDB can store it here. WebKit refuses Blobs in IndexedDB in its
 * ephemeral sessions, Safari's private windows among them: the transaction aborts
 * without saying why, so neither the photo nor anything saved with it would keep. There,
 * the bytes are stored instead.
 */
export interface StoredBytes {
  bytes: ArrayBuffer;
  type: string;
}

const PROBE_KEY = 'probe/blob';
let blobsWork: Promise<boolean> | undefined;

/** Whether IndexedDB takes Blobs here: tried once, with a tiny one. */
function canStoreBlobs(): Promise<boolean> {
  blobsWork ??= withStore('readwrite', (s) => s.put(new Blob(['x']), PROBE_KEY)).then(
    async () => {
      await withStore('readwrite', (s) => s.delete(PROBE_KEY)).catch(() => undefined);
      return true;
    },
    () => false,
  );
  return blobsWork;
}

/** The Blob itself where IndexedDB takes Blobs, otherwise its bytes. */
export async function storable(blob: Blob): Promise<Blob | StoredBytes> {
  return (await canStoreBlobs()) ? blob : { bytes: await blob.arrayBuffer(), type: blob.type };
}

/** The Blob back from what `storable` gave (or an earlier version stored), or undefined for anything else. */
export function unstored(value: unknown): Blob | undefined {
  if (value instanceof Blob) return value;
  const v = value as Partial<StoredBytes> | null | undefined;
  return v?.bytes instanceof ArrayBuffer && typeof v.type === 'string' ? new Blob([v.bytes], { type: v.type }) : undefined;
}

/** Run one request in its own transaction, resolving once the transaction has completed. */
export async function withStore<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
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
