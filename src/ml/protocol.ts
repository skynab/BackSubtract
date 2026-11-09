/** Messages between the app and the ML worker. */
import type { Fallback } from './fallback';

export type ModelName = 'auto' | 'select';

export interface ModelInfo {
  device: 'webgpu' | 'wasm';
  /** One-time download size in bytes for the device in use, including the AI runtime if it isn't downloaded yet. */
  bytes: number;
  cached: boolean;
}

/** A single-channel mask at the resolution of the image that was sent. */
export interface MaskResult {
  data: Uint8Array;
  width: number;
  height: number;
}

/** Segment Anything's candidate masks, back to back in `data` (scores.length × width × height). */
export interface Proposals extends MaskResult {
  scores: number[];
}

export type Request =
  /** avoid: what failed here on an earlier visit, so isn't tried again. */
  | { id: number; type: 'info'; model: ModelName; avoid?: Fallback[] }
  | { id: number; type: 'auto'; image: ImageBitmap; avoid?: Fallback[] }
  | { id: number; type: 'encode'; image: ImageBitmap; avoid?: Fallback[] }
  /** Points are in the pixel coordinates of the last encoded image; label 1 = object, 0 = not object. */
  | { id: number; type: 'decode'; points: [number, number][]; labels: number[] };

export type Response =
  | { id: number; type: 'result'; value: unknown }
  /** fallback: what to avoid in a retry that might work. */
  | { id: number; type: 'error'; message: string; fallback?: Fallback }
  | { type: 'progress'; model: ModelName; loaded: number; total: number };
