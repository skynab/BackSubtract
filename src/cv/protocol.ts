/** Messages between the app and the image worker (Magic Wand, Color, export). */
import type { ExportOptions } from '../export/exportImage';
import type { Rect } from '../mask/mask';

export type PickTool = 'wand' | 'color';

export interface PickRequest {
  tool: PickTool;
  x: number;
  y: number;
  /** ΔE tolerance. */
  tolerance: number;
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
  | { id: number; type: 'export'; mask: Uint8Array; options: ExportOptions };

export type CvResponse =
  | { id: number; type: 'result'; value: unknown }
  | { id: number; type: 'error'; message: string };
