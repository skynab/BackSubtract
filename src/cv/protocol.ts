/** Messages between the app and the image worker (Magic Wand, Color, export). */
import type { ExportOptions } from '../export/exportImage';
import type { EdgeAdjust } from '../mask/adjust';
import type { Rect } from '../mask/mask';

export type PickTool = 'wand' | 'color';

export interface PickRequest {
  tool: PickTool;
  x: number;
  y: number;
  /** ΔE tolerance. */
  tolerance: number;
  /** Anti-alias the selection's edge against the image (slower; skipped while a slider is moving). */
  refine: boolean;
}

export interface SelectionResult {
  /** Full-size plane of selection strength, 0–255. */
  data: Uint8Array;
  rect: Rect;
}

export type CvRequest =
  /** Pixels are shared memory when cross-origin isolated, otherwise a copy. */
  | { id: number; type: 'image'; pixels: Uint8ClampedArray; width: number; height: number }
  /** A new tap: measures colour distance from the tapped pixel, then selects. */
  | ({ id: number; type: 'pick' } & PickRequest)
  /** The same tap with a new tolerance: reuses the distances from the last pick. */
  | ({ id: number; type: 'retune' } & PickRequest)
  /** What a tap here would select, for showing before it happens. Leaves the last pick alone, so re-tuning still works. */
  | ({ id: number; type: 'preview' } & PickRequest)
  /** With `source`, export at the original file's full size (it was scaled down on opening). */
  | { id: number; type: 'export'; mask: Uint8Array; options: ExportOptions; source?: Blob }
  /**
   * Export an image that isn't open (one of a batch): the worker decodes `source` itself, at
   * `width` × `height` (the size `mask` is for), or at its full size with `fullSize`. Leaves the open image alone.
   */
  | { id: number; type: 'exportFile'; source: Blob; mask: Uint8Array; width: number; height: number; options: ExportOptions; fullSize: boolean }
  /** The Blur background over `frame` (image px), for showing on the canvas. Returns a small RgbaImage to scale up. */
  | { id: number; type: 'blur'; mask: Uint8Array; strength: number; frame: Rect }
  /** Adjust the edges of `mask` (the mask from before the adjustment, so settings don't compound). Returns a new plane. */
  /** `key` is the same for every request from one Edges panel session (same mask), so the worker can reuse its work. */
  | { id: number; type: 'edges'; mask: Uint8Array; adjust: EdgeAdjust; key: number };

export type CvResponse =
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string };
