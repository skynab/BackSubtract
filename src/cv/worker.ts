/// <reference lib="webworker" />
/**
 * Image work that can take a noticeable moment on large photos (Magic Wand,
 * Color, export encoding) runs here, so the page never freezes.
 */
import { exportImage } from '../export/exportImage';
import { distanceMap, rgbToLab } from '../tools/color/lab';
import { refineEdges, selectContiguous, selectGlobal } from '../tools/color/select';
import type { CvRequest, CvResponse, PickRequest, SelectionResult } from './protocol';

declare const self: DedicatedWorkerGlobalScope;

let pixels: Uint8ClampedArray | null = null;
let width = 0;
let height = 0;
/** Colour distances from the last tap, reused when only the tolerance changes. */
let lastDist: Uint8Array | null = null;

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
        break;
      case 'pick':
        value = pick(req);
        break;
      case 'retune':
        value = retune(req);
        break;
      case 'export':
        if (!pixels) throw new Error('No image');
        value = await exportImage(pixels, req.mask, width, height, req.options);
        break;
    }
    const buffer = (value as SelectionResult | null)?.data?.buffer;
    post({ id: req.id, type: 'result', value }, buffer instanceof ArrayBuffer ? [buffer] : []);
  } catch (err) {
    post({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};
