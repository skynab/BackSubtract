import { History, makeEdit } from '../mask/history';
import { extract, Mask, unionRect, type Mode, type Rect } from '../mask/mask';
import { stampDab, stampSegment } from '../tools/brush/brush';

export type EditorEvent =
  | { type: 'image' }
  | { type: 'mask'; rect: Rect }
  | { type: 'history' };

interface Stroke {
  snapshot: Uint8Array;
  dirty: Rect | null;
  lastX: number;
  lastY: number;
  radius: number;
  mode: Mode;
}

/**
 * Holds the open document: the untouched original image, the hidden mask and
 * its undo history. Lives outside React so the canvas can update it at pointer rate.
 */
export class Editor {
  image: ImageBitmap | null = null;
  fileName = '';
  mask: Mask | null = null;
  readonly history = new History();
  private stroke: Stroke | null = null;
  private listeners = new Set<(event: EditorEvent) => void>();

  subscribe(listener: (event: EditorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  load(image: ImageBitmap, fileName: string): void {
    this.stroke = null;
    this.image?.close();
    this.image = image;
    this.fileName = fileName;
    this.mask = new Mask(image.width, image.height);
    this.history.clear();
    this.emit({ type: 'image' });
    this.emit({ type: 'history' });
  }

  get isStroking(): boolean {
    return this.stroke !== null;
  }

  beginStroke(x: number, y: number, radius: number, mode: Mode): void {
    if (!this.mask) return;
    if (this.stroke) this.endStroke();
    this.stroke = { snapshot: this.mask.data.slice(), dirty: null, lastX: x, lastY: y, radius, mode };
    this.markStroke(stampDab(this.mask, x, y, radius, mode));
  }

  continueStroke(x: number, y: number): void {
    const s = this.stroke;
    if (!s || !this.mask) return;
    this.markStroke(stampSegment(this.mask, s.lastX, s.lastY, x, y, s.radius, s.mode));
    s.lastX = x;
    s.lastY = y;
  }

  endStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s?.dirty || !this.mask) return;
    const edit = makeEdit(s.snapshot, this.mask, s.dirty);
    if (edit) {
      this.history.push(edit);
      this.emit({ type: 'history' });
    }
  }

  /** Throw away the stroke in progress, e.g. when a second finger turns it into a pinch. */
  cancelStroke(): void {
    const s = this.stroke;
    this.stroke = null;
    if (!s?.dirty || !this.mask) return;
    this.mask.write(s.dirty, extract(s.snapshot, this.mask.width, s.dirty));
    this.emit({ type: 'mask', rect: s.dirty });
  }

  undo(): void {
    if (this.stroke || !this.mask) return;
    const rect = this.history.undo(this.mask);
    if (rect) {
      this.emit({ type: 'mask', rect });
      this.emit({ type: 'history' });
    }
  }

  redo(): void {
    if (this.stroke || !this.mask) return;
    const rect = this.history.redo(this.mask);
    if (rect) {
      this.emit({ type: 'mask', rect });
      this.emit({ type: 'history' });
    }
  }

  private markStroke(rect: Rect | null): void {
    if (!rect || !this.stroke) return;
    this.stroke.dirty = unionRect(this.stroke.dirty, rect);
    this.emit({ type: 'mask', rect });
  }
}

export const editor = new Editor();
