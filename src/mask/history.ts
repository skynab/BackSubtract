import { extract, type Mask, type Rect } from './mask';

/** One undoable step: only the changed rectangle of the mask, before and after. */
export interface Edit {
  rect: Rect;
  before: Uint8Array;
  after: Uint8Array;
}

const editBytes = (e: Edit) => e.before.byteLength + e.after.byteLength;

/**
 * Build an edit from a snapshot of the mask taken before the change.
 * Returns null when nothing actually changed.
 */
export function makeEdit(snapshot: Uint8Array, mask: Mask, rect: Rect): Edit | null {
  const before = extract(snapshot, mask.width, rect);
  const after = mask.read(rect);
  for (let i = 0; i < before.length; i++) {
    if (before[i] !== after[i]) return { rect, before, after };
  }
  return null;
}

export class History {
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  private bytes = 0;

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  push(edit: Edit): void {
    for (const e of this.redoStack) this.bytes -= editBytes(e);
    this.redoStack = [];
    this.undoStack.push(edit);
    this.bytes += editBytes(edit);
    // Drop the oldest steps once history gets too large, but always keep the latest.
    while (this.bytes > this.maxBytes && this.undoStack.length > 1) {
      this.bytes -= editBytes(this.undoStack.shift()!);
    }
  }

  /** Revert the latest edit on `mask`. Returns the changed rect, or null if there was nothing to undo. */
  undo(mask: Mask): Rect | null {
    const edit = this.undoStack.pop();
    if (!edit) return null;
    mask.write(edit.rect, edit.before);
    this.redoStack.push(edit);
    return edit.rect;
  }

  redo(mask: Mask): Rect | null {
    const edit = this.redoStack.pop();
    if (!edit) return null;
    mask.write(edit.rect, edit.after);
    this.undoStack.push(edit);
    return edit.rect;
  }

  clear(): void {
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
}
