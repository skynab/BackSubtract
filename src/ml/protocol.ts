/** Messages between the app and the ML worker. */

export type ModelName = 'auto' | 'select';

export interface ModelInfo {
  device: 'webgpu' | 'wasm';
  /** Approximate one-time download size in MB, for the device in use. */
  sizeMB: number;
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

export interface AutoResult extends MaskResult {
  /** The best model failed on this device and a more compatible one was used; remember that. */
  fellBack: boolean;
}

export type Request =
  /** avoidBirefnet: BiRefNet failed here on an earlier visit, so use the compatible model. */
  | { id: number; type: 'info'; model: ModelName; avoidBirefnet?: boolean }
  | { id: number; type: 'auto'; image: ImageBitmap; avoidBirefnet?: boolean }
  | { id: number; type: 'encode'; image: ImageBitmap }
  /** Points are in the pixel coordinates of the last encoded image; label 1 = object, 0 = not object. */
  | { id: number; type: 'decode'; points: [number, number][]; labels: number[] };

export type Response =
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string }
  | { type: 'progress'; model: ModelName; loaded: number; total: number };
