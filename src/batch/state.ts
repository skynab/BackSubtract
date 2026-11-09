import { create } from 'zustand';

/** A batch holds at most this many images. */
export const BATCH_MAX = 50;

export type ItemStatus = 'waiting' | 'running' | 'done';

/** What is saved about each image of a batch (in the batch index); its file, mask and thumbnail have keys of their own. */
export interface SavedItem {
  id: string;
  fileName: string;
  /** The size it is edited at (scaled down to MAX_SIDE on opening, like a single image). */
  width: number;
  height: number;
  /** The file's own size, for exporting at full size. */
  sourceWidth: number;
  sourceHeight: number;
  /** Whether it has a result (from Auto or from editing). */
  done: boolean;
  /** Whether it was changed in the editor. */
  edited: boolean;
}

export interface BatchItem extends SavedItem {
  status: ItemStatus;
  /** Object URL of the thumbnail: the result once done, the original before. */
  thumb: string | null;
}

interface BatchState {
  items: BatchItem[];
  /** Files still being read and added. */
  adding: number;
  /** The image open in the editor, if any. Auto pauses meanwhile. */
  open: string | null;
  /** Whether Auto is working through the batch (or waiting to be allowed to download its model). */
  running: boolean;
}

/** Several images opened at once, each run through Auto in turn (see batch.ts). Kept apart from the UI store so nothing here is remembered as a setting. */
export const useBatch = create<BatchState>()(() => ({ items: [], adding: 0, open: null, running: false }));

/** Whether a batch is open: the grid, or one of its images in the editor. */
export const inBatch = (s: BatchState = useBatch.getState()) => s.items.length > 0 || s.adding > 0;

export function updateItem(id: string, change: Partial<BatchItem>): void {
  useBatch.setState((s) => ({ items: s.items.map((item) => (item.id === id ? { ...item, ...change } : item)) }));
}
