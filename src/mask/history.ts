import { extract, unionRect, type Mask, type Mode, type Rect } from './mask';

/** What the user did, for listing the step in the history menu. */
export interface StepLabel {
  /** The tool used, e.g. 'brush'. */
  tool: string;
  mode?: Mode;
}

/** One undoable step: only the changed rectangle of the mask, before and after. */
export interface Edit {
  rect: Rect;
  before: Uint8Array;
  after: Uint8Array;
  /** Identifies the action that made this edit, so it can be re-tuned in place. */
  tag?: number;
  /** What kind of action made it, e.g. 'select-keep'. */
  kind?: string;
  /** How to describe this step to the user. Missing on steps saved by older versions. */
  label?: StepLabel;
}

const editBytes = (e: Edit) => e.before.byteLength + e.after.byteLength;

/**
 * Build an edit from a snapshot of the mask taken before the change.
 * Returns null when nothing actually changed.
 */
export function makeEdit(
  snapshot: Uint8Array,
  mask: Mask,
  rect: Rect,
  tag?: number,
  kind?: string,
  label?: StepLabel,
): Edit | null {
  // Check for a change before copying anything out.
  const { data, width } = mask;
  let changed = false;
  for (let row = 0; row < rect.h && !changed; row++) {
    const start = (rect.y + row) * width + rect.x;
    for (let i = start; i < start + rect.w; i++) {
      if (snapshot[i] !== data[i]) {
        changed = true;
        break;
      }
    }
  }
  return changed ? { rect, before: extract(snapshot, width, rect), after: mask.read(rect), tag, kind, label } : null;
}

export class History {
  private undoStack: Edit[] = [];
  private redoStack: Edit[] = [];
  private bytes = 0;
  /** Bumped on every change, so callers can tell whether anything happened since they last looked. */
  version = 0;

  constructor(private readonly maxBytes = 256 * 1024 * 1024) {}

  get canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  get canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  /** The tag of the newest edit, if nothing has been undone since. */
  get latestTag(): number | undefined {
    return this.redoStack.length ? undefined : this.undoStack.at(-1)?.tag;
  }

  /** Whether any step that is currently applied (not undone) is of this kind. */
  hasKind(kind: string): boolean {
    return this.undoStack.some((e) => e.kind === kind);
  }

  push(edit: Edit): void {
    this.version++;
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
    this.version++;
    const edit = this.undoStack.pop();
    if (!edit) return null;
    mask.write(edit.rect, edit.before);
    this.redoStack.push(edit);
    return edit.rect;
  }

  redo(mask: Mask): Rect | null {
    this.version++;
    const edit = this.redoStack.pop();
    if (!edit) return null;
    mask.write(edit.rect, edit.after);
    this.undoStack.push(edit);
    return edit.rect;
  }

  /** Every step, oldest first, with whether it is currently applied (the rest can be redone). */
  get steps(): { label?: StepLabel; applied: boolean }[] {
    return [
      ...this.undoStack.map((e) => ({ label: e.label, applied: true })),
      ...[...this.redoStack].reverse().map((e) => ({ label: e.label, applied: false })),
    ];
  }

  /** How many steps are currently applied, i.e. the position in `steps`. */
  get position(): number {
    return this.undoStack.length;
  }

  /**
   * Undo or redo as many steps as needed so that exactly `position` steps are applied.
   * Returns the area that changed, or null if nothing did.
   */
  goTo(mask: Mask, position: number): Rect | null {
    let rect: Rect | null = null;
    while (this.undoStack.length > position && this.undoStack.length > 0) rect = unionRect(rect, this.undo(mask));
    while (this.undoStack.length < position && this.redoStack.length > 0) rect = unionRect(rect, this.redo(mask));
    return rect;
  }

  /** Revert the latest edit and forget it entirely (no redo), e.g. to replace it with a re-tuned version. */
  discardLatest(mask: Mask): Rect | null {
    this.version++;
    const edit = this.undoStack.pop();
    if (!edit) return null;
    mask.write(edit.rect, edit.before);
    this.bytes -= editBytes(edit);
    return edit.rect;
  }

  /** The newest edits, oldest first, that fit within `maxBytes` (for saving). */
  newest(maxBytes: number): Edit[] {
    const out: Edit[] = [];
    let total = 0;
    for (let i = this.undoStack.length - 1; i >= 0; i--) {
      total += editBytes(this.undoStack[i]);
      if (total > maxBytes) break;
      out.unshift(this.undoStack[i]);
    }
    return out;
  }

  /** Replace everything with previously saved edits (oldest first). */
  restore(edits: Edit[]): void {
    this.clear();
    for (const e of edits) this.push(e);
  }

  clear(): void {
    this.version++;
    this.undoStack = [];
    this.redoStack = [];
    this.bytes = 0;
  }
}
