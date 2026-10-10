import { editor } from '../../editor/editor';
import type { Mode } from '../../mask/mask';
import { useUI } from '../../state/store';
import { distanceMap, rgbToLab } from './lab';
import { selectContiguous, selectGlobal } from './select';

export type PickTool = 'wand' | 'color';

interface LastPick {
  tool: PickTool;
  x: number;
  y: number;
  mode: Mode;
  /** Distance from every pixel to the tapped colour; reused when the slider moves. */
  dist: Uint8Array;
  tag: number | null;
  /** History version right after this pick was applied. */
  version: number;
}

let last: LastPick | null = null;
let retuneFrame = 0;

editor.subscribe((event) => {
  if (event.type === 'image') last = null;
});

function run(pick: LastPick, replace: boolean): void {
  const mask = editor.mask!;
  const tolerance = useUI.getState().tolerances[pick.tool];
  const selection =
    pick.tool === 'wand'
      ? selectContiguous(pick.dist, mask.width, mask.height, pick.x, pick.y, tolerance)
      : selectGlobal(pick.dist, mask.width, mask.height, tolerance);
  if (!selection) return;
  pick.tag = editor.applySelection(selection.data, selection.rect, pick.mode, replace ? (pick.tag ?? undefined) : undefined);
  pick.version = editor.history.version;
}

/** Tap with the Magic Wand or Color tool at an image position. */
export function pick(tool: PickTool, imageX: number, imageY: number): void {
  const mask = editor.mask;
  if (!mask) return;
  const x = Math.floor(imageX);
  const y = Math.floor(imageY);
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return;

  const px = editor.pixels;
  const p = (y * mask.width + x) * 4;
  const dist = distanceMap(px, rgbToLab(px[p], px[p + 1], px[p + 2]));
  last = { tool, x, y, mode: useUI.getState().modes[tool], dist, tag: null, version: -1 };
  run(last, false);
}

/**
 * Called when the tolerance slider moves: if the last tap with this tool is
 * still the newest change, redo it with the new tolerance in place.
 */
export function retune(tool: PickTool): void {
  if (retuneFrame) return;
  retuneFrame = requestAnimationFrame(() => {
    retuneFrame = 0;
    // Only while nothing else has happened since the tap (no undo, no other edit).
    if (last?.tool === tool && last.version === editor.history.version) run(last, true);
  });
}
