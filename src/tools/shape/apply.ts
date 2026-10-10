import { editor } from '../../editor/editor';
import { useUI } from '../../state/store';
import { dragBox, rasterizeShape, type Point } from './shape';

/** Apply a box or ellipse dragged from `a` to `b` (image coordinates) with the current mode, as one undo step. */
export function applyShape(a: Point, b: Point, square: boolean): void {
  const mask = editor.mask;
  if (!mask) return;
  const { shapeKind, modes } = useUI.getState();
  const shape = rasterizeShape(shapeKind, dragBox(a, b, square), mask.width, mask.height);
  if (shape) editor.applySelection(shape.data, shape.rect, modes.shape, { tool: 'shape', mode: modes.shape });
}
