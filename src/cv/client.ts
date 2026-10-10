import { editor } from '../editor/editor';
import type { ExportOptions } from '../export/exportImage';
import type { CvRequest, CvResponse, PickRequest, SelectionResult } from './protocol';

type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
/** The image whose pixels the worker currently has. */
let sentFor: ImageBitmap | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<CvResponse>) => {
      const msg = event.data;
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.value);
      else p.reject(new Error(msg.message));
    };
  }
  return worker;
}

function call<T>(req: DistributiveOmit<CvRequest, 'id'>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...req, id }, transfer);
  });
}

/** Give the worker the current image's pixels (shared, so no copy, when cross-origin isolated). */
function ensureImage(): void {
  const image = editor.image;
  if (!image || sentFor === image) return;
  void call({ type: 'image', pixels: editor.pixels, width: image.width, height: image.height });
  sentFor = image;
}

/** Messages are handled in order, so a request sent after ensureImage() sees the right image. */
export function pickInWorker(req: PickRequest): Promise<SelectionResult | null> {
  ensureImage();
  return call({ type: 'pick', ...req });
}

export function retuneInWorker(req: PickRequest): Promise<SelectionResult | null> {
  ensureImage();
  return call({ type: 'retune', ...req });
}

export function exportInWorker(mask: Uint8Array, options: ExportOptions): Promise<Blob> {
  ensureImage();
  // Send a snapshot of the mask, so edits made while encoding don't affect the file.
  const copy = mask.slice();
  return call({ type: 'export', mask: copy, options }, [copy.buffer]);
}
