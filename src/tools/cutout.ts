import { editor } from '../editor/editor';
import type { Mode, Rect } from '../mask/mask';

/**
 * Apply an object outline (full-size plane, 0–255, nonzero only inside `rect`) the
 * way Select and Lasso do. Keep on an untouched image cuts the object out: everything
 * else is hidden. Once anything is hidden, Keep only brings areas back, so it can fix
 * what another tool removed. Remove hides the object.
 */
export function applyObject(plane: Uint8Array, rect: Rect, mode: Mode, tool: string): void {
  const mask = editor.mask;
  if (!mask) return;
  const label = { tool, mode };
  if (mode === 'keep' && !mask.hasHidden) {
    for (let i = 0; i < plane.length; i++) plane[i] = 255 - plane[i];
    editor.applySelection(plane, { x: 0, y: 0, w: mask.width, h: mask.height }, 'remove', label);
  } else {
    editor.applySelection(plane, rect, mode, label);
  }
}
