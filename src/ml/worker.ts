/// <reference lib="webworker" />
/**
 * Runs the AI models off the main thread, so the page stays responsive.
 * Models download once and are kept in the browser's Cache API by Transformers.js.
 */
import {
  AutoModel,
  AutoProcessor,
  env,
  RawImage,
  SamModel,
  Tensor,
  type PreTrainedModel,
  type Processor,
} from '@huggingface/transformers';
import { type Fallback, ModelError } from './fallback';
import { BIREFNET, fileUrl, isOtherRevision, ISNET, type Repo, SELECT } from './models';
import type { MaskResult, ModelInfo, ModelName, Proposals, Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;

/**
 * Background removal. BiRefNet-lite gives the best edges but needs a GPU that allows 17+
 * storage buffers per shader; IS-Net runs anywhere. Each is fixed to one commit (models.ts).
 */
const BIREFNET_STORAGE_BUFFERS = 17;

type Device = 'webgpu' | 'wasm';

interface Setup {
  device: Device;
  /** WebGPU with half-precision support: smaller, faster model files. */
  fp16: boolean;
  storageBuffers: number;
}

/**
 * What failed on this device, as the app tells it with each request: BiRefNet, so IS-Net
 * is used instead, or the GPU, so the models run on the CPU instead (see client.ts).
 */
const failed = new Set<Fallback>();

function avoid(fallbacks: Fallback[] = []) {
  for (const f of fallbacks) failed.add(f);
}

const CPU: Setup = { device: 'wasm', fp16: false, storageBuffers: 0 };

let gpuPromise: Promise<Setup> | null = null;

/** The GPU if the browser offers one and the models haven't failed on it, otherwise the CPU. */
function setup(): Promise<Setup> {
  if (failed.has('gpu')) return Promise.resolve(CPU);
  gpuPromise ??= (async () => {
    try {
      const adapter = await (navigator as Navigator & { gpu?: GPU }).gpu?.requestAdapter();
      if (adapter) {
        return {
          device: 'webgpu',
          fp16: adapter.features.has('shader-f16'),
          storageBuffers: adapter.limits.maxStorageBuffersPerShaderStage,
        };
      }
    } catch {
      // Fall through to WASM.
    }
    return CPU;
  })();
  return gpuPromise;
}

const useBirefnet = (s: Setup) =>
  !failed.has('birefnet') && s.device === 'webgpu' && s.fp16 && s.storageBuffers >= BIREFNET_STORAGE_BUFFERS;

interface ModelFiles {
  repo: Repo;
  dtype: unknown;
  device: unknown;
  paths: string[];
  /** Size of those files at the repository's fixed commit, as listed on Hugging Face. */
  bytes: number;
}

/** Which model and ONNX files to use on this device. */
function files(model: ModelName, s: Setup): ModelFiles {
  if (model === 'auto') {
    if (useBirefnet(s)) {
      return { repo: BIREFNET, dtype: 'fp16', device: 'webgpu', paths: ['onnx/model_fp16.onnx'], bytes: 114_538_221 };
    }
    return s.fp16
      ? { repo: ISNET, dtype: 'fp16', device: s.device, paths: ['onnx/model_fp16.onnx'], bytes: 88_152_708 }
      : { repo: ISNET, dtype: 'fp32', device: s.device, paths: ['onnx/model.onnx'], bytes: 176_149_806 };
  }
  // The small prompt decoder runs on WASM everywhere; it's quick and WebGPU gains little for it.
  return {
    repo: SELECT,
    dtype: { vision_encoder: s.fp16 ? 'fp16' : 'q8', prompt_encoder_mask_decoder: 'q8' },
    device: { vision_encoder: s.device, prompt_encoder_mask_decoder: 'wasm' },
    paths: [
      s.fp16 ? 'onnx/vision_encoder_fp16.onnx' : 'onnx/vision_encoder_quantized.onnx',
      'onnx/prompt_encoder_mask_decoder_quantized.onnx',
    ],
    // The vision encoder, then the prompt decoder.
    bytes: (s.fp16 ? 12_170_657 : 8_882_165) + 4_903_810,
  };
}

/**
 * The ONNX Runtime WebAssembly that runs every model. Transformers.js fetches it from
 * jsDelivr the first time a model loads and caches it. jsDelivr sends it compressed:
 * about 4.7 MB over the network, 27 MB unpacked.
 */
const RUNTIME_BYTES = 4_704_500;
/** Its unpacked size: reading it yields unpacked bytes, which this turns into download progress. */
const RUNTIME_UNPACKED_BYTES = 26_861_777;

function runtimeUrl(): string | undefined {
  const paths = env.backends.onnx.wasm?.wasmPaths;
  return typeof paths === 'object' && paths.wasm ? String(paths.wasm) : undefined;
}

async function isRuntimeCached(): Promise<boolean> {
  try {
    const runtime = runtimeUrl();
    return !!runtime && !!(await (await caches.open(env.cacheKey)).match(runtime));
  } catch {
    return false;
  }
}

/** While a model loads with the runtime still to download: told how much of RUNTIME_BYTES has arrived. */
let onRuntimeProgress: ((loaded: number) => void) | null = null;

// Transformers.js downloads the runtime with env.fetch (and gives no progress for it), so count it here.
const defaultFetch = env.fetch;
env.fetch = async (input, init) => {
  const response: globalThis.Response = await defaultFetch(input, init);
  const report = onRuntimeProgress;
  if (!report || String(input) !== runtimeUrl() || !response.ok || !response.body) return response;
  let read = 0;
  const counted = response.body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        read += chunk.byteLength;
        report(Math.min(read / RUNTIME_UNPACKED_BYTES, 1) * RUNTIME_BYTES);
        controller.enqueue(chunk);
      },
      flush: () => report(RUNTIME_BYTES),
    }),
  );
  return new globalThis.Response(counted, { status: response.status, statusText: response.statusText, headers: response.headers });
};

async function isCached(f: ModelFiles): Promise<boolean> {
  try {
    const cache = await caches.open(env.cacheKey);
    const hits = await Promise.all(f.paths.map((p) => cache.match(fileUrl(env.remoteHost, f.repo, p))));
    return hits.every(Boolean);
  } catch {
    // No Cache API (e.g. some private modes): treat as not downloaded.
    return false;
  }
}

/**
 * Deletes cached files of these models from other commits, which nothing will read again:
 * after a model moves to a newer commit, or the copies from `main` that versions before
 * the models were fixed downloaded. They can be 100 MB or more, and the browser won't
 * clear them on its own once it has agreed to keep the site's data.
 */
async function dropOtherRevisions() {
  try {
    const cache = await caches.open(env.cacheKey);
    for (const request of await cache.keys()) {
      if (isOtherRevision(env.remoteHost, request.url)) await cache.delete(request);
    }
  } catch {
    // No Cache API: nothing was downloaded to clean up.
  }
}

void dropOtherRevisions();

async function info(model: ModelName, fallbacks?: Fallback[]): Promise<ModelInfo> {
  avoid(fallbacks);
  const s = await setup();
  const f = files(model, s);
  const runtimeBytes = (await isRuntimeCached()) ? 0 : RUNTIME_BYTES;
  return { device: s.device, bytes: f.bytes + runtimeBytes, cached: await isCached(f) };
}

function post(message: Response, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

/**
 * Download progress for a model and, the first time, the runtime, measured against the
 * size of the files this device uses. Transformers.js's own total can count files it
 * never fetches (Select's other vision encoder), and leaves out the runtime.
 */
async function trackProgress(model: ModelName, f: ModelFiles) {
  const total = f.bytes + ((await isRuntimeCached()) ? 0 : RUNTIME_BYTES);
  let modelLoaded = 0;
  let runtimeLoaded = 0;
  const report = () => post({ type: 'progress', model, loaded: Math.min(modelLoaded + runtimeLoaded, total), total });
  if (total > f.bytes) {
    onRuntimeProgress = (n) => {
      runtimeLoaded = n;
      report();
    };
  }
  return (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress_total' && p.total) {
      modelLoaded = Math.min(p.loaded ?? 0, f.bytes);
      report();
    }
  };
}

type Loaded = { model: PreTrainedModel; processor: Processor };

const loaded = new Map<string, Promise<Loaded>>();

function load(name: ModelName, f: ModelFiles): Promise<Loaded> {
  const { id, revision } = f.repo;
  let p = loaded.get(id);
  if (!p) {
    p = (async () => {
      const progress_callback = await trackProgress(name, f);
      const options = { dtype: f.dtype, device: f.device, revision, progress_callback } as never;
      const Model = name === 'auto' ? AutoModel : SamModel;
      try {
        const [model, processor] = await Promise.all([
          Model.from_pretrained(id, options),
          AutoProcessor.from_pretrained(id, { revision }),
        ]);
        return { model, processor };
      } finally {
        onRuntimeProgress = null;
      }
    })();
    // If loading fails (e.g. offline), allow a retry next time.
    p.catch(() => loaded.delete(id));
    loaded.set(id, p);
  }
  return p;
}

/**
 * Loads and runs a model with the files that suit this device. If it fails once they're
 * downloaded (a failed download isn't the device's doing), the error names the fallback
 * that might work: IS-Net for BiRefNet, which can hit GPU limits that aren't visible up
 * front, or the CPU for the GPU, since WebGPU differs between browsers (ONNX Runtime's is
 * tested mostly in Chrome's). The app tries that in a fresh worker, as ONNX Runtime can be
 * left unusable by a failure on the GPU.
 */
async function runModel<T>(name: ModelName, run: (f: ModelFiles, loaded: Loaded) => Promise<T>): Promise<T> {
  const s = await setup();
  const f = files(name, s);
  try {
    return await run(f, await load(name, f));
  } catch (err) {
    const downloaded = (await isCached(f)) && (await isRuntimeCached());
    const fallback = !downloaded ? undefined : f.repo === BIREFNET ? 'birefnet' : s.device === 'webgpu' ? 'gpu' : undefined;
    throw new ModelError(err instanceof Error ? err.message : String(err), fallback);
  }
}

function toRawImage(image: ImageBitmap): RawImage {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(image, 0, 0);
  const { data } = ctx.getImageData(0, 0, image.width, image.height);
  image.close();
  return new RawImage(data, canvas.width, canvas.height, 4).rgb();
}

const asFloat32 = (t: Tensor) => (t.type === 'float32' ? t : t.to('float32'));

async function predictMatte(raw: RawImage, f: ModelFiles, { model, processor }: Loaded): Promise<Uint8Array> {
  const { pixel_values } = await processor(raw);
  let matte: RawImage;
  if (f.repo === BIREFNET) {
    const { output_image } = await model({ input_image: pixel_values });
    matte = RawImage.fromTensor(asFloat32(output_image[0]).sigmoid().mul(255).to('uint8'));
  } else {
    // IS-Net outputs a 0–1 matte; stretch it to the full range, as the original DIS code does.
    const session = (model as unknown as { sessions: Record<string, { inputNames: string[] }> }).sessions.model;
    const outputs = await model({ [session.inputNames[0]]: pixel_values });
    const out = asFloat32(Object.values(outputs)[0] as Tensor);
    const values = out.data as Float32Array;
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of values) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const range = hi - lo || 1;
    const bytes = new Uint8ClampedArray(values.length);
    for (let i = 0; i < values.length; i++) {
      // Treat near-certain values as certain, so no faint haze is left in the background.
      const v = (values[i] - lo) / range;
      bytes[i] = v < 0.03 ? 0 : v > 0.97 ? 255 : v * 255;
    }
    const [h, w] = out.dims.slice(-2);
    matte = new RawImage(bytes, w, h, 1);
  }
  const resized = await matte.resize(raw.width, raw.height);
  return new Uint8Array(resized.data);
}

async function runAuto(image: ImageBitmap, fallbacks?: Fallback[]): Promise<MaskResult> {
  avoid(fallbacks);
  const raw = toRawImage(image);
  const data = await runModel('auto', (f, model) => predictMatte(raw, f, model));
  return { data, width: raw.width, height: raw.height };
}

/** The encoded image for Select: computed once per image, reused for every tap with the model that encoded it. */
let encoded: {
  loaded: Loaded;
  embeddings: Record<string, Tensor>;
  originalSize: [number, number];
  reshapedSize: [number, number];
  inputs: { original_sizes: unknown; reshaped_input_sizes: unknown };
} | null = null;

async function encode(image: ImageBitmap, fallbacks?: Fallback[]): Promise<boolean> {
  encoded = null;
  avoid(fallbacks);
  const raw = toRawImage(image);
  encoded = await runModel('select', async (_, loaded) => {
    const inputs = await loaded.processor(raw);
    return {
      loaded,
      embeddings: await (loaded.model as SamModel).get_image_embeddings(inputs),
      originalSize: inputs.original_sizes[0],
      reshapedSize: inputs.reshaped_input_sizes[0],
      inputs: { original_sizes: inputs.original_sizes, reshaped_input_sizes: inputs.reshaped_input_sizes },
    };
  });
  return true;
}

async function decode(points: [number, number][], labels: number[]): Promise<Proposals> {
  if (!encoded) throw new Error('No image encoded');
  const { model, processor } = encoded.loaded;
  const [oh, ow] = encoded.originalSize;
  const [rh, rw] = encoded.reshapedSize;
  const scaled = points.flatMap(([x, y]) => [(x * rw) / ow, (y * rh) / oh]);
  const input_points = new Tensor('float32', Float32Array.from(scaled), [1, 1, points.length, 2]);
  const input_labels = new Tensor('int64', BigInt64Array.from(labels.map(BigInt)), [1, 1, labels.length]);

  const { pred_masks, iou_scores } = await model({ ...encoded.embeddings, input_points, input_labels });
  const [masks] = await (processor as Processor & {
    post_process_masks: (...args: unknown[]) => Promise<Tensor[]>;
  }).post_process_masks(pred_masks, encoded.inputs.original_sizes, encoded.inputs.reshaped_input_sizes);

  // SAM proposes three masks (e.g. part, object, group); the app picks one.
  const all = masks.data as Uint8Array;
  const data = new Uint8Array(all.length);
  for (let i = 0; i < all.length; i++) data[i] = all[i] ? 255 : 0;
  return { data, width: ow, height: oh, scores: Array.from(iou_scores.data as Float32Array) };
}

self.onmessage = async (event: MessageEvent<Request>) => {
  const req = event.data;
  try {
    let value: unknown;
    switch (req.type) {
      case 'info':
        value = await info(req.model, req.avoid);
        break;
      case 'auto':
        value = await runAuto(req.image, req.avoid);
        break;
      case 'encode':
        value = await encode(req.image, req.avoid);
        break;
      case 'decode':
        value = await decode(req.points, req.labels);
        break;
    }
    const buffer = (value as { data?: Uint8Array } | null)?.data?.buffer;
    post({ id: req.id, type: 'result', value }, buffer ? [buffer as ArrayBuffer] : []);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    post({ id: req.id, type: 'error', message, fallback: err instanceof ModelError ? err.fallback : undefined });
  }
};
