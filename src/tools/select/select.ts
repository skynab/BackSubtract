import type { Point } from '../../canvas/view';
import { editor } from '../../editor/editor';
import { boundingBox } from '../../mask/mask';
import { resizePlane } from '../../mask/resample';
import { snapToEdgesTiled } from '../../mask/snap';
import { encodeImage, segment, workCopy } from '../../ml/client';
import type { MaskResult, Proposals } from '../../ml/protocol';
import { refreshModelInfo, withModelTask } from '../../ml/status';
import { useUI } from '../../state/store';
import { bestFit, dilate, loopPrompts, mostConfident, rasterizeLoop } from './loop';

/** The first Keep selection hides everything outside it; later ones add to it. */
const FIRST_KEEP = 'select-keep';
/** Below this fit score, no proposal really matches the loop. */
const MIN_FIT = 0.1;

/** Image currently encoded in the worker, and the scale from full size to the size it was encoded at. */
let encodedFor: ImageBitmap | null = null;
let encoding: Promise<boolean> | null = null;
let scale = 1;
let busy = false;

editor.subscribe((event) => {
  if (event.type === 'image') {
    encodedFor = null;
    encoding = null;
  }
});

/** Make sure the current image is encoded (the slow step, done once per image). */
function ensureEncoded(image: ImageBitmap): Promise<boolean> {
  if (encodedFor === image) return Promise.resolve(true);
  encoding ??= (async () => {
    const work = await workCopy(image);
    scale = work.width / image.width;
    const ok = await withModelTask('select', 'task.preparing', () => encodeImage(work));
    if (ok !== null && editor.image === image) {
      encodedFor = image;
      return true;
    }
    encoding = null;
    return false;
  })();
  return encoding;
}

/** Start encoding in the background if the model is already downloaded, so the first tap is quick. */
export async function prepareSelect(): Promise<void> {
  const image = editor.image;
  if (!image || encodedFor === image) return;
  const info = await refreshModelInfo('select');
  if (info.cached && useUI.getState().tool === 'select' && editor.image === image) await ensureEncoded(image);
}

async function run(segmentation: () => Promise<{ result: MaskResult; clip?: Uint8Array } | null>): Promise<void> {
  const image = editor.image;
  if (!image || busy) return;
  busy = true;
  try {
    if (!(await ensureEncoded(image))) return;
    const out = await withModelTask('select', 'task.selecting', segmentation);
    if (!out || editor.image !== image) return;
    apply(image, out.result, out.clip);
  } finally {
    busy = false;
  }
}

/** Mask `index` of a block of SAM proposals, as its own plane. */
function proposal(p: Proposals, index: number): MaskResult {
  const size = p.width * p.height;
  return { data: p.data.slice(index * size, (index + 1) * size), width: p.width, height: p.height };
}

/** Select the object under a point (full-image coordinates). */
export function selectAt(x: number, y: number): Promise<void> {
  return run(async () => {
    const p = await segment([[x * scale, y * scale]], [1]);
    return { result: proposal(p, mostConfident(p.scores).index) };
  });
}

/** Select the object inside a loop drawn around it (full-image coordinates). */
export function selectLoop(path: Point[]): Promise<void> {
  return run(async () => {
    const image = editor.image!;
    const w = Math.round(image.width * scale), h = Math.round(image.height * scale);
    const inside = rasterizeLoop(path.map((p) => ({ x: p.x * scale, y: p.y * scale })), w, h);
    const prompts = loopPrompts(inside, w, h);
    if (!prompts) return null;

    // Loops are drawn roughly, so allow the object to poke out a little.
    let loopArea = 0;
    for (const v of inside) if (v) loopArea++;
    const slack = Math.max(2, Math.round(Math.sqrt(loopArea) * 0.03));
    const clip = dilate(inside, w, h, slack);

    // Try each candidate point on its own and keep the proposal that best fits the loop.
    let best: { result: MaskResult; score: number } | null = null;
    for (const point of prompts.candidates) {
      const p = await segment([point, ...prompts.negatives], [1, ...prompts.negatives.map(() => 0)]);
      const choice = bestFit(p.data, p.scores, clip, loopArea);
      if (!best || choice.score > best.score) best = { result: proposal(p, choice.index), score: choice.score };
    }

    // If nothing fits (no clear object in the loop), use the loop itself; its edge still snaps to the image.
    if (!best || best.score < MIN_FIT) return { result: { data: inside, width: w, height: h } };
    return { result: best.result, clip };
  });
}

/** Scale a model mask up to full size, snap its edge to the image, and apply it with the current mode. */
function apply(image: ImageBitmap, result: MaskResult, clip?: Uint8Array): void {
  const work = clip ? result.data.map((v, i) => (clip[i] ? v : 0)) : result.data;
  const W = image.width, H = image.height;
  const full = resizePlane(work, result.width, result.height, W, H);

  const rect = boundingBox(full, W, H);
  if (!rect) return;
  // The upscaled edge is a soft ramp about 1/scale px wide; snap it onto the real edge.
  const radius = Math.max(3, Math.ceil(2 / scale));
  const padded = {
    x: Math.max(0, rect.x - radius), y: Math.max(0, rect.y - radius),
    w: Math.min(W, rect.x + rect.w + radius) - Math.max(0, rect.x - radius),
    h: Math.min(H, rect.y + rect.h + radius) - Math.max(0, rect.y - radius),
  };
  snapToEdgesTiled({ data: full, width: W, height: H }, editor.pixels, padded, radius);

  const mode = useUI.getState().modes.select;
  const label = { tool: 'select', mode };
  if (mode === 'keep' && !editor.history.hasKind(FIRST_KEEP)) {
    // First Keep: hide everything that isn't the object (intersect with what's visible now).
    for (let i = 0; i < full.length; i++) full[i] = 255 - full[i];
    editor.applySelection(full, { x: 0, y: 0, w: W, h: H }, 'remove', label, { kind: FIRST_KEEP });
  } else {
    editor.applySelection(full, padded, mode, label);
  }
}
