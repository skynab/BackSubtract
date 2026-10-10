/// <reference lib="webworker" />
/**
 * Image work that can take a noticeable moment on large photos (Magic Wand,
 * Color, export encoding) runs here, so the page never freezes.
 */
import { exportFullSize, exportImage } from '../export/exportImage';
import { distanceMap, rgbToLab } from '../tools/color/lab';
import { refineEdges, selectContiguous, selectGlobal } from '../tools/color/select';
import type { CvRequest, CvResponse, PickRequest, SelectionResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let pixels: Uint8ClampedArray | null = null;
let width = 0;
let height = 0;
/** Colour distances from the last tap, reused when only the tolerance changes. */
let lastDist: Uint8Array | null = null;
/** Colour distances for the colour under the pointer, reused while hovering over the same colour. */
let previewDist: { color: number; dist: Uint8Array } | null = null;

function select(req: PickRequest, dist: Uint8Array): SelectionResult | null {
  const sel =
    req.tool === 'wand'
      ? selectContiguous(dist, width, height, req.x, req.y, req.tolerance)
      : selectGlobal(dist, width, height, req.tolerance);
  return sel && req.refine ? refineEdges(sel, pixels!, width, height) : sel;
}

function pick(req: PickRequest): SelectionResult | null {
  if (!pixels) throw new Error('No image');
  const p = (req.y * width + req.x) * 4;
  lastDist = distanceMap(pixels, rgbToLab(pixels[p], pixels[p + 1], pixels[p + 2]));
  return select(req, lastDist);
}

function preview(req: PickRequest): SelectionResult | null {
  if (!pixels) throw new Error('No image');
  const p = (req.y * width + req.x) * 4;
  const color = (pixels[p] << 16) | (pixels[p + 1] << 8) | pixels[p + 2];
  if (previewDist?.color !== color) {
    previewDist = { color, dist: distanceMap(pixels, rgbToLab(pixels[p], pixels[p + 1], pixels[p + 2])) };
  }
  return select(req, previewDist.dist);
}

function retune(req: PickRequest): SelectionResult | null {
  if (!lastDist) throw new Error('Nothing to re-tune');
  return select(req, lastDist);
}

function post(message: CvResponse, transfer: Transferable[] = []) {
  self.postMessage(message, transfer);
}

self.onmessage = async (event: MessageEvent<CvRequest>) => {
  const req = event.data;
  try {
    let value: unknown = null;
    switch (req.type) {
      case 'image':
        ({ pixels, width, height } = req);
        lastDist = null;
        previewDist = null;
        break;
      case 'preview':
        value = preview(req);
        break;
      case 'pick':
        value = pick(req);
        break;
      case 'retune':
        value = retune(req);
        break;
      case 'export':
        if (!pixels) throw new Error('No image');
        if (req.source) {
          try {
            value = await exportFullSize(req.source, req.mask, width, height, req.options);
          } catch (err) {
            // E.g. the full-size photo is over this browser's canvas limit: export at the edited size instead.
            console.warn('Full-size export failed; exporting at the edited size.', err);
          }
        }
        value ??= await exportImage(pixels, req.mask, width, height, req.options);
        break;
    }
    const buffer = (value as SelectionResult | null)?.data?.buffer;
    post({ id: req.id, type: 'result', value }, buffer instanceof ArrayBuffer ? [buffer] : []);
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
