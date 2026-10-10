import { pickInWorker, retuneInWorker } from '../../cv/client';
import type { PickTool, SelectionResult } from '../../cv/protocol';
import { editor } from '../../editor/editor';
import type { Mode } from '../../mask/mask';
import { useUI } from '../../state/store';

export type { PickTool };

interface LastPick {
  tool: PickTool;
  x: number;
  y: number;
  mode: Mode;
  image: ImageBitmap;
  tag: number | null;
  /** History version right after this pick was applied. */
  version: number;
}

let last: LastPick | null = null;
/** A pick or re-tune is running in the worker; slider moves meanwhile are coalesced into one more run. */
let busy = false;
let retuneQueued = false;
let refineTimer = 0;

/** How long the slider must be still before the slower, edge-refined version is applied. */
const SETTLE_MS = 250;

editor.subscribe((event) => {
  if (event.type === 'image') last = null;
});

function apply(pick: LastPick, selection: SelectionResult | null, replace: boolean): void {
  // Ignore results for an image that has since been replaced.
  if (!selection || editor.image !== pick.image) return;
  pick.tag = editor.applySelection(selection.data, selection.rect, pick.mode, { tool: pick.tool, mode: pick.mode }, {
    replaceTag: replace ? (pick.tag ?? undefined) : undefined,
  });
  pick.version = editor.history.version;
}

/** Tap with the Magic Wand or Color tool at an image position. */
export async function pick(tool: PickTool, imageX: number, imageY: number): Promise<void> {
  const image = editor.image;
  if (!image || busy) return;
  const x = Math.floor(imageX);
  const y = Math.floor(imageY);
  if (x < 0 || y < 0 || x >= image.width || y >= image.height) return;

  const state = useUI.getState();
  const current: LastPick = { tool, x, y, mode: state.modes[tool], image, tag: null, version: -1 };
  busy = true;
  try {
    apply(current, await pickInWorker({ tool, x, y, tolerance: state.tolerances[tool], refine: true }), false);
    last = current;
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
}

/**
 * Called when the tolerance slider moves: if the last tap with this tool is
 * still the newest change, redo it with the new tolerance in place.
 */
export async function retune(tool: PickTool, refine = false): Promise<void> {
  // While the slider moves, use the quick version; refine the edges once it settles.
  clearTimeout(refineTimer);
  if (!refine) refineTimer = window.setTimeout(() => void retune(tool, true), SETTLE_MS);
  if (busy) {
    retuneQueued = true;
    return;
  }
  const pick = last;
  // Only while nothing else has happened since the tap (no undo, no other edit).
  if (pick?.tool !== tool || pick.version !== editor.history.version) return;

  busy = true;
  try {
    const tolerance = useUI.getState().tolerances[tool];
    const selection = await retuneInWorker({ tool, x: pick.x, y: pick.y, tolerance, refine });
    if (pick.version === editor.history.version) apply(pick, selection, true);
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
  if (retuneQueued) {
    retuneQueued = false;
    await retune(tool);
  }
}
