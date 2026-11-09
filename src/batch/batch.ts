import { exportFileInWorker } from '../cv/client';
import { editor } from '../editor/editor';
import { downloadBlob, exportName, extensionFor, MIME, type ExportOptions } from '../export/exportImage';
import { resizePlane } from '../mask/resample';
import { removeBackground, workSize } from '../ml/client';
import { refreshModelInfo, withModelTask } from '../ml/status';
import { clearSession, flushAutosave } from '../session/autosave';
import { decodeImage, editedSize, isHeic, isImageFile } from '../session/openImage';
import { useUI } from '../state/store';
import { BATCH_MAX, updateItem, useBatch, type BatchItem, type SavedItem } from './state';
import * as storage from './storage';
import { makeThumb, thumbSize } from './thumbnail';
import { uniqueName, zip } from './zip';

/**
 * Batch Auto: several images opened at once go into a grid, and Auto runs on each
 * in turn, in the one AI worker. Any of them can be opened in the editor to fix it;
 * Auto pauses meanwhile. Only thumbnails stay in memory: each image's file and mask
 * live in IndexedDB (see storage.ts), and an image is decoded only while it runs,
 * is open, or is being exported.
 */

/** Bumped when a batch ends, so work still under way for it is dropped. */
let generation = 0;
let nextId = 1;
const newId = () => `${Date.now().toString(36)}-${(nextId++).toString(36)}`;

const DECODE: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };

function toSaved({ status, thumb: _thumb, ...item }: BatchItem): SavedItem {
  return { ...item, done: status === 'done' };
}

let indexWrite: Promise<void> | null = null;
let indexDirty = false;

/** Save the list of images (and which is open). Writes one at a time, always the latest state. */
function persistIndex(): Promise<void> {
  indexDirty = true;
  indexWrite ??= (async () => {
    while (indexDirty) {
      indexDirty = false;
      const { items, open } = useBatch.getState();
      if (items.length) await storage.saveIndex({ version: 1, items: items.map(toSaved), open });
    }
    indexWrite = null;
  })();
  return indexWrite;
}

function setThumb(id: string, thumb: Blob): void {
  const old = useBatch.getState().items.find((i) => i.id === id)?.thumb;
  if (old) URL.revokeObjectURL(old);
  updateItem(id, { thumb: URL.createObjectURL(thumb) });
}

/**
 * Read a file into a new batch image: its size and a thumbnail (which also checks it opens),
 * with the file stored. Null if the batch it was for has ended meanwhile.
 */
async function readItem(file: File, gen: number): Promise<BatchItem | null> {
  const probe = await createImageBitmap(file, DECODE);
  const sourceWidth = probe.width;
  const sourceHeight = probe.height;
  const { width, height } = editedSize(sourceWidth, sourceHeight);
  let thumb: Blob;
  try {
    const t = thumbSize(width, height);
    const small = await createImageBitmap(probe, { resizeWidth: t.width, resizeHeight: t.height, resizeQuality: 'high' });
    try {
      thumb = await makeThumb(small);
    } finally {
      small.close();
    }
  } finally {
    probe.close();
  }
  if (gen !== generation) return null;
  const id = newId();
  await Promise.all([storage.saveFile(id, file), storage.saveThumb(id, thumb)]);
  return {
    id,
    fileName: file.name || 'image',
    width,
    height,
    sourceWidth,
    sourceHeight,
    done: false,
    edited: false,
    status: 'waiting',
    thumb: URL.createObjectURL(thumb),
  };
}

let adding: Promise<void> = Promise.resolve();

/**
 * Add images to the batch (which opens it, if none is open), one at a time in the
 * background. Files that aren't images, or can't be opened, are left out with a
 * message, as is anything beyond BATCH_MAX images.
 */
export function addFiles(files: File[]): void {
  const images = files.filter(isImageFile);
  const s = useBatch.getState();
  const room = Math.max(0, BATCH_MAX - s.items.length - s.adding);
  const taken = images.slice(0, room);
  const ui = useUI.getState();
  if (images.length > room) ui.showNotice({ key: 'batch.tooMany', params: { max: BATCH_MAX }, tone: 'error' });
  else if (images.length < files.length) ui.showNotice({ key: 'batch.skipped', tone: 'error' });
  if (!taken.length) return;

  useBatch.setState({ adding: s.adding + taken.length });
  const gen = generation;
  adding = adding.then(async () => {
    const failed: File[] = [];
    for (const file of taken) {
      if (gen !== generation) return;
      try {
        const item = await readItem(file, gen);
        if (!item || gen !== generation) return;
        useBatch.setState((st) => ({ items: [...st.items, item], adding: st.adding - 1 }));
        void persistIndex();
        void runQueue();
      } catch (err) {
        console.warn('Could not add an image to the batch', err);
        failed.push(file);
        if (gen === generation) useBatch.setState((st) => ({ adding: st.adding - 1 }));
      }
    }
    if (failed.length && gen === generation) {
      // Safari can open HEIC; other browsers can't, so say what to do instead.
      useUI.getState().showNotice({ key: failed.some(isHeic) ? 'errors.heic' : 'batch.skipped', tone: 'error' });
    }
  });
}

/** Start a new batch with these files, in place of whatever was open. */
export function startBatch(files: File[]): void {
  useUI.setState({ hasImage: false, notice: null });
  editor.unload();
  void clearSession();
  // Anything left from an earlier batch; saving the new one waits for this.
  void storage.clearBatch();
  generation++;
  useBatch.setState({ items: [], adding: 0, open: null });
  addFiles(files);
}

/** End the batch: its images, edits and stored files are removed. */
export async function closeBatch(): Promise<void> {
  generation++;
  const { items, open } = useBatch.getState();
  for (const item of items) if (item.thumb) URL.revokeObjectURL(item.thumb);
  if (open) {
    useUI.setState({ hasImage: false });
    editor.unload();
  }
  useBatch.setState({ items: [], adding: 0, open: null });
  await indexWrite;
  await storage.clearBatch();
}

const nextWaiting = () => {
  const s = useBatch.getState();
  return s.open === null ? s.items.find((i) => i.status === 'waiting') : undefined;
};

/** Run Auto on one image: decoded straight to the size the model works at, with the result stored at the edited size. */
async function processItem(item: BatchItem, gen: number): Promise<void> {
  const [file, saved] = await Promise.all([storage.loadFile(item.id), storage.loadMask(item.id)]);
  if (!file) throw new Error('A batch image is missing from storage');
  const work = workSize(item.width, item.height);
  const bitmap = await createImageBitmap(file, { ...DECODE, resizeWidth: work.width, resizeHeight: work.height, resizeQuality: 'high' });
  const t = thumbSize(item.width, item.height);
  let small: ImageBitmap;
  try {
    small = await createImageBitmap(bitmap, { resizeWidth: t.width, resizeHeight: t.height, resizeQuality: 'high' });
  } catch (err) {
    bitmap.close();
    throw err;
  }
  try {
    let mask: { data: Uint8Array; width: number; height: number };
    if (saved && saved.mask.length === item.width * item.height) {
      // Edited before Auto got to it (e.g. open when the page was refreshed): keep the edits.
      bitmap.close();
      mask = { data: saved.mask, width: item.width, height: item.height };
    } else {
      const result = await removeBackground(bitmap);
      if (gen !== generation) return;
      const full = resizePlane(result.data, result.width, result.height, item.width, item.height);
      await storage.saveMask(item.id, { mask: full, edits: [] });
      mask = result;
    }
    const thumb = await makeThumb(small, mask);
    if (gen !== generation) return;
    await storage.saveThumb(item.id, thumb);
    setThumb(item.id, thumb);
    updateItem(item.id, { status: 'done', done: true });
    void persistIndex();
  } finally {
    small.close();
  }
}

/** Work through the waiting images until none is left, or one is opened in the editor. */
async function runWaiting(): Promise<true> {
  const gen = generation;
  for (let item = nextWaiting(); item && gen === generation; item = nextWaiting()) {
    updateItem(item.id, { status: 'running' });
    try {
      await processItem(item, gen);
    } catch (err) {
      if (gen === generation) updateItem(item.id, { status: 'waiting' });
      throw err;
    }
  }
  return true;
}

let running = false;
let rerun = false;

/**
 * Run Auto on each waiting image in turn. Without `ask` it only starts if the model is
 * already downloaded, as Auto does on a single image; with it (the Remove backgrounds
 * button), the first download is asked about. Stops on "Not now", Cancel or a model
 * error, leaving the rest waiting.
 */
export async function runQueue(ask = false): Promise<void> {
  if (running) {
    rerun = true;
    return;
  }
  running = true;
  useBatch.setState({ running: true });
  try {
    do {
      rerun = false;
      if (!nextWaiting()) return;
      if (!ask && !(await refreshModelInfo('auto').catch(() => null))?.cached) return;
      ask = false;
      if ((await withModelTask('auto', 'batch.task', runWaiting)) === null) return;
    } while (rerun);
  } finally {
    running = false;
    useBatch.setState({ running: false });
  }
}

/** Open one image of the batch in the editor, with its result (as an undoable Auto step) or its saved edits. */
export async function openItem(id: string): Promise<void> {
  const s = useBatch.getState();
  const item = s.items.find((i) => i.id === id);
  if (!item || item.status === 'running' || s.open) return;
  const gen = generation;
  const [file, saved] = await Promise.all([storage.loadFile(id), storage.loadMask(id)]);
  let decoded: Awaited<ReturnType<typeof decodeImage>> | null = null;
  try {
    if (file) decoded = await decodeImage(file);
  } catch {
    // Reported below.
  }
  if (!file || !decoded) {
    useUI.getState().showNotice({ key: 'errors.load', tone: 'error' });
    return;
  }
  const { bitmap, full } = decoded;
  if (gen !== generation || useBatch.getState().open) {
    bitmap.close();
    return;
  }
  const fits = !!saved && saved.mask.length === bitmap.width * bitmap.height;
  useBatch.setState({ open: id });
  void persistIndex();
  if (fits && saved.edits.length) {
    editor.load(bitmap, file, item.fileName, saved, full);
  } else {
    editor.load(bitmap, file, item.fileName, undefined, full);
    if (fits) editor.replaceMask(saved.mask, { tool: 'auto' });
  }
  // With a result already, Auto mustn't run again by itself.
  useUI.setState({ hasImage: true, autoRan: fits, notice: null });
}

/** Leave the editor for the grid, keeping what was done to the image there. */
export async function backToBatch(): Promise<void> {
  const id = useBatch.getState().open;
  if (!id) return;
  const { image, mask, history } = editor;
  const changed = history.canUndo || history.canRedo;
  // Changed with a tool, rather than just given Auto's result.
  const edited = history.newest(Infinity).some((e) => e.label?.tool !== 'auto');
  let thumb: Blob | null = null;
  if (image && mask && changed) {
    try {
      thumb = await makeThumb(image, mask);
    } catch (err) {
      console.warn('Thumbnail failed', err);
    }
  }
  await flushAutosave();
  useUI.setState({ hasImage: false });
  editor.unload();
  if (changed) {
    const item = useBatch.getState().items.find((i) => i.id === id);
    updateItem(id, { status: 'done', done: true, edited: !!item?.edited || edited });
    if (thumb) {
      setThumb(id, thumb);
      void storage.saveThumb(id, thumb);
    }
  }
  useBatch.setState({ open: null });
  void persistIndex();
  void runQueue();
}

/** Bring back a batch saved on an earlier visit, and the image that was open. False if there is none. */
export async function restoreBatch(): Promise<boolean> {
  const index = await storage.loadIndex();
  if (!index?.items.length) return false;
  const items = await Promise.all(
    index.items.map(async (saved): Promise<BatchItem> => {
      const thumb = await storage.loadThumb(saved.id);
      return { ...saved, status: saved.done ? 'done' : 'waiting', thumb: thumb ? URL.createObjectURL(thumb) : null };
    }),
  );
  useBatch.setState({ items, adding: 0, open: null });
  if (index.open && items.some((i) => i.id === index.open)) await openItem(index.open);
  useUI.setState({ notice: { key: 'batch.restored', tone: 'info' } });
  void runQueue();
  return true;
}

/** Export every finished image with the Download settings, one at a time. */
async function exportAll(options: ExportOptions, fullSize: boolean, progress: (done: number, total: number) => void): Promise<File[]> {
  const items = useBatch.getState().items.filter((i) => i.status === 'done');
  const ext = extensionFor(options.format);
  const suffix = options.format === 'mask' ? 'mask' : 'no-bg';
  const taken = new Set<string>();
  const files: File[] = [];
  for (const [i, item] of items.entries()) {
    progress(i + 1, items.length);
    const [file, saved] = await Promise.all([storage.loadFile(item.id), storage.loadMask(item.id)]);
    if (!file || saved?.mask.length !== item.width * item.height) continue;
    const reduced = item.sourceWidth > item.width;
    const blob = await exportFileInWorker(file, saved.mask, item.width, item.height, options, fullSize && reduced);
    files.push(new File([blob], uniqueName(exportName(item.fileName, ext, suffix), taken), { type: MIME[options.format] }));
  }
  return files;
}

/** "Download all": one zip of every finished image. */
export async function downloadAll(options: ExportOptions, fullSize: boolean, progress: (done: number, total: number) => void): Promise<void> {
  const files = await exportAll(options, fullSize, progress);
  if (!files.length) throw new Error('Nothing to download');
  const entries = await Promise.all(files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.arrayBuffer()) })));
  downloadBlob(zip(entries), exportName('images', 'zip', options.format === 'mask' ? 'mask' : 'no-bg'));
}

/** Files prepared for sharing whose moment passed (see shareAll), until the 'shareBatch' dialog shares them. */
let readyToShare: File[] = [];

/**
 * Share every finished image through the system share sheet, as separate files. Browsers
 * only open it straight after a tap, which a long export outlasts; then a dialog says the
 * images are ready, and its button opens the sheet.
 */
export async function shareAll(options: ExportOptions, fullSize: boolean, progress: (done: number, total: number) => void): Promise<void> {
  const files = await exportAll(options, fullSize, progress);
  if (!files.length || !navigator.canShare?.({ files })) throw new Error('These files cannot be shared');
  try {
    await navigator.share({ files });
  } catch (err) {
    if (!(err instanceof DOMException && err.name === 'NotAllowedError')) throw err;
    readyToShare = files;
    useUI.setState({ dialog: 'shareBatch' });
  }
}

/** The 'shareBatch' dialog's button. */
export async function shareReady(): Promise<void> {
  const files = readyToShare;
  readyToShare = [];
  useUI.setState({ dialog: null });
  try {
    await navigator.share({ files });
  } catch (err) {
    // Closing the share sheet without choosing anything isn't an error.
    if (!(err instanceof DOMException && err.name === 'AbortError')) {
      console.error(err);
      useUI.getState().showNotice({ key: 'batch.shareFailed', tone: 'error' });
    }
  }
}

export function forgetShare(): void {
  readyToShare = [];
  useUI.setState({ dialog: null });
}
