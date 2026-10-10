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
import type { AutoResult, ModelInfo, ModelName, Proposals, Request, Response } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

env.allowLocalModels = false;

/**
 * Background removal. BiRefNet-lite (MIT) gives the best edges but needs a GPU that
 * allows 17+ storage buffers per shader; IS-Net (DIS, Apache-2.0 weights) runs anywhere.
 */
const BIREFNET_ID = 'onnx-community/BiRefNet_lite-ONNX';
const ISNET_ID = 'imgly/isnet-general-onnx';
/** Segment Anything: SlimSAM-77 (Apache-2.0). */
const SELECT_ID = 'Xenova/slimsam-77-uniform';
const BIREFNET_STORAGE_BUFFERS = 17;

type Device = 'webgpu' | 'wasm';

interface Setup {
  device: Device;
  /** WebGPU with half-precision support: smaller, faster model files. */
  fp16: boolean;
  storageBuffers: number;
}

let setupPromise: Promise<Setup> | null = null;

function setup(): Promise<Setup> {
  setupPromise ??= (async () => {
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
    return { device: 'wasm', fp16: false, storageBuffers: 0 };
  })();
  return setupPromise;
}

/** Set when BiRefNet failed on this device (now or on an earlier visit), so IS-Net is used instead. */
let birefnetFailed = false;

const useBirefnet = (s: Setup) =>
  !birefnetFailed && s.device === 'webgpu' && s.fp16 && s.storageBuffers >= BIREFNET_STORAGE_BUFFERS;

interface ModelFiles {
  id: string;
  dtype: unknown;
  device: unknown;
  paths: string[];
  sizeMB: number;
}

/** Which model and ONNX files to use on this device. */
function files(model: ModelName, s: Setup): ModelFiles {
  if (model === 'auto') {
    if (useBirefnet(s)) {
      return { id: BIREFNET_ID, dtype: 'fp16', device: 'webgpu', paths: ['onnx/model_fp16.onnx'], sizeMB: 115 };
    }
    return s.fp16
      ? { id: ISNET_ID, dtype: 'fp16', device: s.device, paths: ['onnx/model_fp16.onnx'], sizeMB: 88 }
      : { id: ISNET_ID, dtype: 'fp32', device: s.device, paths: ['onnx/model.onnx'], sizeMB: 176 };
  }
  // The small prompt decoder runs on WASM everywhere; it's quick and WebGPU gains little for it.
  return {
    id: SELECT_ID,
    dtype: { vision_encoder: s.fp16 ? 'fp16' : 'q8', prompt_encoder_mask_decoder: 'q8' },
    device: { vision_encoder: s.device, prompt_encoder_mask_decoder: 'wasm' },
    paths: [
      s.fp16 ? 'onnx/vision_encoder_fp16.onnx' : 'onnx/vision_encoder_quantized.onnx',
      'onnx/prompt_encoder_mask_decoder_quantized.onnx',
    ],
    sizeMB: s.fp16 ? 17 : 14,
  };
}

async function info(model: ModelName, avoidBirefnet?: boolean): Promise<ModelInfo> {
  if (avoidBirefnet) birefnetFailed = true;
  const s = await setup();
  const f = files(model, s);
  let cached = false;
  try {
    const cache = await caches.open(env.cacheKey);
    const hits = await Promise.all(f.paths.map((p) => cache.match(`${env.remoteHost}${f.id}/resolve/main/${p}`)));
    cached = hits.every(Boolean);
  } catch {
    // No Cache API (e.g. some private modes): treat as not downloaded.
  }
  return { device: s.device, sizeMB: f.sizeMB, cached };
}

function post(message: Response, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

function progressFor(model: ModelName) {
  return (p: { status: string; loaded?: number; total?: number }) => {
    if (p.status === 'progress_total' && p.total) {
      post({ type: 'progress', model, loaded: p.loaded ?? 0, total: p.total });
    }
  };
}

const loaded = new Map<string, Promise<{ model: PreTrainedModel; processor: Processor }>>();

function load(name: ModelName, f: ModelFiles) {
  let p = loaded.get(f.id);
  if (!p) {
    p = (async () => {
      const options = { dtype: f.dtype, device: f.device, progress_callback: progressFor(name) } as never;
      const Model = name === 'auto' ? AutoModel : SamModel;
      const [model, processor] = await Promise.all([
        Model.from_pretrained(f.id, options),
        AutoProcessor.from_pretrained(f.id),
      ]);
      return { model, processor };
    })();
    // If loading fails (e.g. offline), allow a retry next time.
    p.catch(() => loaded.delete(f.id));
    loaded.set(f.id, p);
  }
  return p;
}

async function loadSelect() {
  return load('select', files('select', await setup()));
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

async function predictMatte(raw: RawImage, s: Setup): Promise<Uint8Array> {
  const f = files('auto', s);
  const { model, processor } = await load('auto', f);
  const { pixel_values } = await processor(raw);
  let matte: RawImage;
  if (f.id === BIREFNET_ID) {
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

async function runAuto(image: ImageBitmap, avoidBirefnet?: boolean): Promise<AutoResult> {
  if (avoidBirefnet) birefnetFailed = true;
  const s = await setup();
  const raw = toRawImage(image);
  const result = (data: Uint8Array, fellBack: boolean) => ({ data, width: raw.width, height: raw.height, fellBack });
  try {
    return result(await predictMatte(raw, s), false);
  } catch (err) {
    if (!useBirefnet(s)) throw err;
    // BiRefNet can hit GPU limits that aren't visible up front; switch to IS-Net for good.
    console.warn('BiRefNet failed on this device; switching to IS-Net.', err);
    birefnetFailed = true;
    loaded.delete(BIREFNET_ID);
    return result(await predictMatte(raw, s), true);
  }
}

/** The encoded image for Select: computed once per image, reused for every tap. */
let encoded: {
  embeddings: Record<string, Tensor>;
  originalSize: [number, number];
  reshapedSize: [number, number];
  inputs: { original_sizes: unknown; reshaped_input_sizes: unknown };
} | null = null;

async function encode(image: ImageBitmap): Promise<boolean> {
  encoded = null;
  const { model, processor } = await loadSelect();
  const raw = toRawImage(image);
  const inputs = await processor(raw);
  const embeddings = await (model as SamModel).get_image_embeddings(inputs);
  encoded = {
    embeddings,
    originalSize: inputs.original_sizes[0],
    reshapedSize: inputs.reshaped_input_sizes[0],
    inputs: { original_sizes: inputs.original_sizes, reshaped_input_sizes: inputs.reshaped_input_sizes },
  };
  return true;
}

async function decode(points: [number, number][], labels: number[]): Promise<Proposals> {
  if (!encoded) throw new Error('No image encoded');
  const { model, processor } = await loadSelect();
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
        value = await info(req.model, req.avoidBirefnet);
        break;
      case 'auto':
        value = await runAuto(req.image, req.avoidBirefnet);
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
