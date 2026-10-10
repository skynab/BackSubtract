import type { AutoResult, MaskResult, ModelInfo, ModelName, Proposals, Request, Response } from './protocol';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(model: ModelName, loaded: number, total: number) => void>();

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Response>) => {
      const msg = event.data;
      if (msg.type === 'progress') {
        for (const l of progressListeners) l(msg.model, msg.loaded, msg.total);
        return;
      }
      const p = pending.get(msg.id);
      if (!p) return;
      pending.delete(msg.id);
      if (msg.type === 'result') p.resolve(msg.value);
      else p.reject(new Error(msg.message));
    };
  }
  return worker;
}

function call<T>(req: DistributiveOmit<Request, 'id'>, transfer: Transferable[] = []): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
    getWorker().postMessage({ ...req, id }, transfer);
  });
}

export function onDownloadProgress(listener: (model: ModelName, loaded: number, total: number) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** The longest side sent to the models; they work at about 1024 px internally. */
const WORK_SIDE = 1024;

/** A downscaled copy of the image for the models. The original stays untouched. */
export async function workCopy(image: ImageBitmap): Promise<ImageBitmap> {
  const scale = Math.min(1, WORK_SIDE / Math.max(image.width, image.height));
  return createImageBitmap(image, {
    resizeWidth: Math.round(image.width * scale),
    resizeHeight: Math.round(image.height * scale),
    resizeQuality: 'high',
  });
}

const FALLBACK_KEY = 'backsubtract.autoFallback';

/** Whether the best background model failed on this device before (remembered across visits). */
function avoidBirefnet(): boolean {
  try {
    return localStorage.getItem(FALLBACK_KEY) === '1';
  } catch {
    return false;
  }
}

export const modelInfo = (model: ModelName) => call<ModelInfo>({ type: 'info', model, avoidBirefnet: avoidBirefnet() });

export async function removeBackground(image: ImageBitmap): Promise<MaskResult> {
  const result = await call<AutoResult>({ type: 'auto', image, avoidBirefnet: avoidBirefnet() }, [image]);
  if (result.fellBack) {
    try {
      localStorage.setItem(FALLBACK_KEY, '1');
    } catch {
      // Not remembered; it will fall back again next time.
    }
  }
  return result;
}

export const encodeImage = (image: ImageBitmap) => call<boolean>({ type: 'encode', image }, [image]);

export const segment = (points: [number, number][], labels: number[]) =>
  call<Proposals>({ type: 'decode', points, labels });
