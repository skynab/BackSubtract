import { editor } from '../editor/editor';
import type { Edit } from '../mask/history';
import { useBatch } from '../batch/state';
import { saveMask } from '../batch/storage';
import { useUI } from '../state/store';
import { type StoredBytes, storable, unstored, withStore } from './db';

/**
 * Saves the work in progress to IndexedDB, on this device only, so a refresh or
 * a closed tab doesn't lose it. One session is kept; opening a new image replaces it.
 * While an image of a batch is open, its edits are saved with the batch instead.
 */

const KEY = 'current';
const SAVE_DELAY_MS = 800;
/** Cap on saved undo history, so saving stays quick. */
const HISTORY_BYTES = 64 * 1024 * 1024;
/** A batch can hold many edited images, so each keeps less history. */
const BATCH_HISTORY_BYTES = 16 * 1024 * 1024;

export interface SavedSession {
  version: 1;
  file: Blob;
  fileName: string;
  width: number;
  height: number;
  mask: Uint8Array;
  edits: Edit[];
}

/** As stored: the file may be its bytes (see storable in db.ts). */
type StoredSession = Omit<SavedSession, 'file'> & { file: Blob | StoredBytes };

export async function loadSession(): Promise<SavedSession | null> {
  try {
    const saved = await withStore<StoredSession | undefined>('readonly', (s) => s.get(KEY));
    const file = unstored(saved?.file);
    return saved?.version === 1 && file ? { ...saved, file } : null;
  } catch {
    return null;
  }
}

/** The photo picked as the Image background. Kept under its own key, so it stays when another image is opened. */
const BACKGROUND_KEY = 'background';

export async function saveBackgroundImage(file: Blob): Promise<void> {
  try {
    const value = await storable(file);
    await withStore('readwrite', (s) => s.put(value, BACKGROUND_KEY));
  } catch (err) {
    // It still works until the page closes; it just won't be there next visit.
    console.warn('Saving the background image failed', err);
  }
}

export async function loadBackgroundImage(): Promise<Blob | null> {
  try {
    return unstored(await withStore<unknown>('readonly', (s) => s.get(BACKGROUND_KEY))) ?? null;
  } catch {
    return null;
  }
}

/** Forget the saved single image, e.g. when a batch takes its place. */
export async function clearSession(): Promise<void> {
  try {
    await withStore('readwrite', (s) => s.delete(KEY));
  } catch {
    // Nothing more can be done; it would only be restored if no batch is.
  }
}

async function save(): Promise<void> {
  const { image, mask, source } = editor;
  if (!image || !mask || !source) return;
  const { open } = useBatch.getState();
  if (open) {
    // Until something is done to it, the batch already has what there is to keep
    // (the Auto result, or nothing yet, so Auto still runs on it).
    if (!editor.history.canUndo && !editor.history.canRedo) return;
    await saveMask(open, { mask: mask.data.slice(), edits: editor.history.newest(BATCH_HISTORY_BYTES) });
    return;
  }
  const session: StoredSession = {
    version: 1,
    file: await storable(source),
    fileName: editor.fileName,
    width: mask.width,
    height: mask.height,
    mask: mask.data.slice(),
    edits: editor.history.newest(HISTORY_BYTES),
  };
  await withStore('readwrite', (s) => s.put(session, KEY));
}

/**
 * Ask the browser to keep this site's data (the saved session and the downloaded AI
 * models) rather than clear it when the device runs low on space. Chrome and Safari
 * decide by themselves, but Firefox asks the user, so this is only called when they
 * agree to download a model: a moment when keeping data is clearly what they want.
 */
export async function requestPersistentStorage(): Promise<void> {
  try {
    if (!(await navigator.storage.persisted())) await navigator.storage.persist();
  } catch {
    // Unsupported (or not a secure context): the data stays, just without the promise.
  }
}

let timer = 0;
/** Whether the last save failed, so a run of failures warns only once. */
let failing = false;

/** Save now rather than after the usual pause, e.g. before leaving an image of a batch. */
export function flushAutosave(): Promise<void> {
  clearTimeout(timer);
  timer = 0;
  // If storage is full or blocked, editing still works, but a refresh would lose the
  // work: say so once, and again only if saving starts failing after it worked.
  return save().then(
    () => {
      failing = false;
    },
    (err) => {
      if (failing) return;
      failing = true;
      console.warn('Autosave failed', err);
      useUI.getState().showNotice({ key: 'errors.save', tone: 'error' });
    },
  );
}

/** Save shortly after each change, and when the page is hidden. */
export function startAutosave(): void {
  const flush = () => void flushAutosave();
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
