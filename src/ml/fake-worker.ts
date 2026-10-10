/// <reference lib="webworker" />
/**
 * A stand-in for the AI worker, used only in the end-to-end test build
 * (`vite build --mode e2e`), so the browser tests can cover everything around
 * the models without downloading 100+ MB of them. It speaks the same protocol
 * as worker.ts and behaves like it from the app's side: the first use of each
 * model "downloads" with progress, the download is then cached (and can be
 * cancelled by stopping the worker), and results come back as masks.
 *
 * Its results are simple colour rules, enough for test images of a flat
 * subject on a flat background:
 * - Auto keeps every pixel that differs clearly from the top-left corner's colour.
 * - Select proposes the area of similar colour connected to the tapped point,
 *   the whole image, and a small disk around the point.
 *
 * Tests can change its behaviour by writing JSON to the "fake-ai" cache at
 * "/config": { downloadMs?: number, fail?: boolean }.
 */
import type { AutoResult, ModelInfo, ModelName, Proposals, Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

const CACHE = 'fake-ai';
const SIZE_MB: Record<ModelName, number> = { auto: 88, select: 17 };
/** Colour distance (RGB) above which a pixel counts as different. */
const DIFFERENT = 60;

interface Config {
  downloadMs?: number;
  fail?: boolean;
}

async function config(): Promise<Config> {
  const hit = await (await caches.open(CACHE)).match('/config');
  return hit ? hit.json() : {};
}

const modelKey = (model: ModelName) => `/model/${model}`;

async function isCached(model: ModelName): Promise<boolean> {
  return !!(await (await caches.open(CACHE)).match(modelKey(model)));
}

function post(message: Response, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** "Download" a model the first time: progress in ten steps, then cache it. */
async function ensureModel(model: ModelName): Promise<void> {
  if (await isCached(model)) return;
  const { downloadMs = 600 } = await config();
  const total = SIZE_MB[model] * 1024 * 1024;
  for (let i = 0; i <= 10; i++) {
    post({ type: 'progress', model, loaded: Math.round((total * i) / 10), total });
    if (i < 10) await sleep(downloadMs / 10);
  }
  await (await caches.open(CACHE)).put(modelKey(model), new globalThis.Response('ok'));
}

async function failIfAsked(): Promise<void> {
  if ((await config()).fail) throw new Error('Fake model failure (requested by the test)');
}

function readPixels(image: ImageBitmap): { data: Uint8ClampedArray; width: number; height: number } {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  image.close();
  return { data, width: canvas.width, height: canvas.height };
}

const colourDistance = (d: Uint8ClampedArray, i: number, j: number) =>
  Math.hypot(d[i * 4] - d[j * 4], d[i * 4 + 1] - d[j * 4 + 1], d[i * 4 + 2] - d[j * 4 + 2]);

async function runAuto(image: ImageBitmap): Promise<AutoResult> {
  await ensureModel('auto');
  await failIfAsked();
  const { data, width, height } = readPixels(image);
  const matte = new Uint8Array(width * height);
  for (let i = 0; i < matte.length; i++) matte[i] = colourDistance(data, i, 0) > DIFFERENT ? 255 : 0;
  return { data: matte, width, height, fellBack: false };
}

let encoded: { data: Uint8ClampedArray; width: number; height: number } | null = null;

async function encode(image: ImageBitmap): Promise<boolean> {
  await ensureModel('select');
  await failIfAsked();
  encoded = readPixels(image);
  return true;
}

/** The area of similar colour connected to a pixel (4-connected flood fill). */
function floodFrom(x: number, y: number): Uint8Array {
  const { data, width, height } = encoded!;
  const out = new Uint8Array(width * height);
  const seed = y * width + x;
  const stack = [seed];
  out[seed] = 255;
  while (stack.length) {
    const i = stack.pop()!;
    const px = i % width, py = (i / width) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = px + dx, ny = py + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const j = ny * width + nx;
      if (!out[j] && colourDistance(data, j, seed) <= DIFFERENT) {
        out[j] = 255;
        stack.push(j);
      }
    }
  }
  return out;
}

async function decode(points: [number, number][], labels: number[]): Promise<Proposals> {
  if (!encoded) throw new Error('No image encoded');
  await failIfAsked();
  const { width, height } = encoded;
  const index = labels.indexOf(1);
  const [fx, fy] = points[Math.max(0, index)];
  const x = Math.min(width - 1, Math.max(0, Math.round(fx)));
  const y = Math.min(height - 1, Math.max(0, Math.round(fy)));
  const size = width * height;
  const data = new Uint8Array(size * 3);
  data.set(floodFrom(x, y), 0);
  data.fill(255, size, size * 2);
  for (let py = Math.max(0, y - 3); py <= Math.min(height - 1, y + 3); py++) {
    for (let px = Math.max(0, x - 3); px <= Math.min(width - 1, x + 3); px++) data[size * 2 + py * width + px] = 255;
  }
  return { data, width, height, scores: [0.95, 0.6, 0.4] };
}

async function info(model: ModelName): Promise<ModelInfo> {
  return { device: 'wasm', sizeMB: SIZE_MB[model], cached: await isCached(model) };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    let value: unknown;
    switch (req.type) {
      case 'info':
        value = await info(req.model);
        break;
      case 'auto':
        value = await runAuto(req.image);
        break;
      case 'encode':
        value = await encode(req.image);
        break;
      case 'decode':
        value = await decode(req.points, req.labels);
        break;
    }
    const buffer = (value as { data?: Uint8Array } | null)?.data?.buffer;
    post({ id: req.id, type: 'result', value }, buffer ? [buffer as ArrayBuffer] : []);
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
