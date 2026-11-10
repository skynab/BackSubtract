import { type Fallback, ModelError, withFallbacks } from './fallback';
import type { MaskResult, ModelInfo, ModelName, Proposals, Request, Response } from './protocol';

type Pending = { resolve: (value: unknown) => void; reject: (error: Error) => void };
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, Pending>();
const progressListeners = new Set<(model: ModelName, loaded: number, total: number) => void>();
const resetListeners = new Set<() => void>();

const ISOLATION_RELOAD_KEY = 'backsubtract.isolationReload';

/**
 * Whether the host sends the isolation headers itself, from a HEAD request for this page.
 * The service worker never answers HEAD requests (Workbox routes only GET), so this is
 * the host's own answer even once the worker has taken over.
 */
async function hostSendsIsolation(): Promise<boolean> {
  try {
    const response = await fetch(location.href, { method: 'HEAD', cache: 'no-store' });
    return response.headers.has('cross-origin-embedder-policy');
  } catch {
    return true; // Can't tell (offline?): don't reload on a guess.
  }
}

/**
 * The AI runtime's WebAssembly uses shared memory, which Firefox only allows in a
 * cross-origin isolated page. Where the host can't send the isolation headers (GitHub
 * Pages), the service worker adds them (public/sw-isolation.js), but only to pages it
 * serves. So reload once it's ready if it didn't serve this one (the first visit, or a
 * hard refresh, which bypasses it).
 *
 * Only where the host leaves the headers out, though. Where it sends them (Netlify,
 * Cloudflare Pages, the dev and preview servers), or the service worker served the page
 * with them, a page that still isn't isolated is in a browser without `credentialless`
 * (Safari). A reload can't help there, and it would land at an unpredictable moment, a
 * second or so in, throwing away whatever the person had started, such as choosing a
 * photo. A reload that didn't help isn't tried again either. That's remembered in
 * localStorage, since isolated and non-isolated pages don't share sessionStorage.
 */
function reloadIntoIsolation(): void {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    // Isolated: forget an earlier try, so a later hard refresh can reload again.
    if (window.crossOriginIsolated) return localStorage.removeItem(ISOLATION_RELOAD_KEY);
    if (localStorage.getItem(ISOLATION_RELOAD_KEY)) return;
  } catch {
    return; // No storage: can't remember having tried, so don't try.
  }
  const sw = navigator.serviceWorker;
  if (sw.controller) return;
  const tookOver = new Promise<void>((resolve) => {
    sw.addEventListener('controllerchange', () => resolve(), { once: true });
    void sw.ready.then(() => {
      if (!sw.controller) resolve();
    });
  });
  void Promise.all([hostSendsIsolation(), tookOver]).then(([hostIsolates]) => {
    if (hostIsolates) return;
    try {
      localStorage.setItem(ISOLATION_RELOAD_KEY, '1');
    } catch {
      return;
    }
    location.reload();
  });
}

reloadIntoIsolation();

/** The error AI calls fail with after cancelModelWork(). */
export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

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
      else p.reject(new ModelError(msg.message, msg.fallback));
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

/** Shut the worker down, failing its pending calls with `error`. A fresh one starts on the next AI call. */
function stopWorker(error: () => Error): void {
  if (!worker) return;
  worker.terminate();
  worker = null;
  for (const p of pending.values()) p.reject(error());
  pending.clear();
  for (const l of resetListeners) l();
}

/**
 * Stop whatever the AI worker is doing, e.g. a model download on a limited data plan.
 * The worker is shut down, which ends its downloads (nothing half-downloaded is kept).
 * Pending calls fail with CancelledError.
 */
export function cancelModelWork(): void {
  stopWorker(() => new CancelledError());
}

/** Called when the worker is shut down, so anything it held (e.g. Select's encoded image) is gone. */
export function onWorkerReset(listener: () => void): () => void {
  resetListeners.add(listener);
  return () => resetListeners.delete(listener);
}

export function onDownloadProgress(listener: (model: ModelName, loaded: number, total: number) => void): () => void {
  progressListeners.add(listener);
  return () => progressListeners.delete(listener);
}

/** The longest side sent to the models; they work at about 1024 px internally. */
const WORK_SIDE = 1024;

/** The size of the copy of a `width` × `height` image that the models are given. */
export function workSize(width: number, height: number): { width: number; height: number } {
  const scale = Math.min(1, WORK_SIDE / Math.max(width, height));
  return { width: Math.round(width * scale), height: Math.round(height * scale) };
}

/** A downscaled copy of the image for the models. The original stays untouched. */
export async function workCopy(image: ImageBitmap): Promise<ImageBitmap> {
  const size = workSize(image.width, image.height);
  return createImageBitmap(image, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
}

/**
 * What failed on this device on an earlier visit, so the worker doesn't try it again:
 * the best background model (BiRefNet), or running the models on the GPU.
 */
const FALLBACK_KEYS: Record<Fallback, string> = {
  birefnet: 'backsubtract.autoFallback',
  gpu: 'backsubtract.gpuFallback',
};

function avoided(): Fallback[] {
  try {
    return (Object.keys(FALLBACK_KEYS) as Fallback[]).filter((f) => localStorage.getItem(FALLBACK_KEYS[f]) === '1');
  } catch {
    return [];
  }
}

function rememberFallback(fallback: Fallback): void {
  try {
    localStorage.setItem(FALLBACK_KEYS[fallback], '1');
  } catch {
    // Not remembered; it will fall back again next time.
  }
}

export const modelInfo = (model: ModelName) => call<ModelInfo>({ type: 'info', model, avoid: avoided() });

/**
 * Run a model on an image, and when it fails in a way a more compatible option might
 * not (see runModel in worker.ts), try again with that option avoided, in a fresh worker.
 * A fallback is remembered once a try works, so a passing problem (e.g. offline) isn't
 * held against the device. Each try gets its own copy of the image, as sending one to
 * the worker gives it away.
 */
async function runOnImage<T>(image: ImageBitmap, send: (copy: ImageBitmap, avoid: Fallback[]) => Promise<T>): Promise<T> {
  try {
    const { value, fellBack } = await withFallbacks(
      avoided(),
      async (avoid) => send(await createImageBitmap(image), avoid),
      () => stopWorker(() => new Error('The AI worker was restarted')),
    );
    fellBack.forEach(rememberFallback);
    return value;
  } finally {
    image.close();
  }
}

export const removeBackground = (image: ImageBitmap) =>
  runOnImage(image, (copy, avoid) => call<MaskResult>({ type: 'auto', image: copy, avoid }, [copy]));

export const encodeImage = (image: ImageBitmap) =>
  runOnImage(image, (copy, avoid) => call<boolean>({ type: 'encode', image: copy, avoid }, [copy]));

export const segment = (points: [number, number][], labels: number[]) =>
  call<Proposals>({ type: 'decode', points, labels });
