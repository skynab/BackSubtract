import { History, makeEdit, type Edit } from '../mask/history';
import { extract, Mask, padRect, unionRect, type Mode, type Rect } from '../mask/mask';
import { snapRadius, snapToEdges, stampDab, stampSegment, type Plane } from '../tools/brush/brush';

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
  /** The file the image came from, kept so the session can be saved and restored. */
  source: Blob | null = null;
  fileName = '';
  mask: Mask | null = null;
  readonly history = new History();
  private stroke: Stroke | null = null;
  /** Scratch plane for the stroke in progress; all zero between strokes. */
  private coverage: Plane | null = null;
  private pixelCache: Uint8ClampedArray | null = null;
  private nextTag = 1;
  private listeners = new Set<(event: EditorEvent) => void>();

  subscribe(listener: (event: EditorEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: EditorEvent): void {
    for (const listener of this.listeners) listener(event);
  }

  load(image: ImageBitmap, source: Blob, fileName: string, saved?: { mask: Uint8Array; edits: Edit[] }): void {
    this.stroke = null;
    this.image?.close();
    this.image = image;
    this.source = source;
    this.fileName = fileName;
    this.mask = new Mask(image.width, image.height, saved?.mask);
    this.coverage = null;
    this.pixelCache = null;
    if (saved) this.history.restore(saved.edits);
    else this.history.clear();
    this.emit({ type: 'image' });
    this.emit({ type: 'history' });
  }

  /** The original image's RGBA pixels, decoded once on first use. */
  get pixels(): Uint8ClampedArray {
    if (!this.pixelCache) {
      const image = this.image!;
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      this.pixelCache = ctx.getImageData(0, 0, image.width, image.height).data;
    }
    return this.pixelCache;
  }

  get isStroking(): boolean {
    return this.stroke !== null;
  }

  beginStroke(x: number, y: number, radius: number, mode: Mode): void {
    const mask = this.mask;
    if (!mask) return;
    if (this.stroke) this.endStroke();
    this.coverage ??= { data: new Uint8Array(mask.width * mask.height), width: mask.width, height: mask.height };
    this.stroke = { snapshot: mask.data.slice(), dirty: null, lastX: x, lastY: y, radius, mode };
    this.paint(stampDab(this.coverage, x, y, radius));
  }

  continueStroke(x: number, y: number): void {
    const s = this.stroke;
    if (!s || !this.coverage) return;
    this.paint(stampSegment(this.coverage, s.lastX, s.lastY, x, y, s.radius));
    s.lastX = x;
    s.lastY = y;
  }

  /** Finish the stroke: snap its edge to the image, then record it as one undo step. */
  endStroke(): void {
    const s = this.stroke;
    const mask = this.mask;
    const coverage = this.coverage;
    this.stroke = null;
    if (!s?.dirty || !mask || !coverage) return;

    const r = snapRadius(s.radius);
    const rect = mask.clip(padRect(s.dirty, r))!;
    snapToEdges(coverage, this.pixels, rect, r);
    mask.combineFrom(s.snapshot, coverage.data, rect, s.mode);
    this.clearCoverage(rect);
    this.emit({ type: 'mask', rect });

    const edit = makeEdit(s.snapshot, mask, rect, this.nextTag++);
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
    this.clearCoverage(s.dirty);
    this.emit({ type: 'mask', rect: s.dirty });
  }

  /**
   * Apply a selection (full-size plane) as one undo step and return its tag.
   * Passing the tag of the latest step replaces that step instead, which lets a
   * slider re-tune the last tap without piling up history.
   */
  applySelection(selection: Uint8Array, rect: Rect, mode: Mode, replaceTag?: number): number | null {
    const mask = this.mask;
    if (!mask || this.stroke) return null;
    let dirty: Rect | null = null;
    if (replaceTag !== undefined && this.history.latestTag === replaceTag) {
      dirty = this.history.discardLatest(mask);
    }
    const snapshot = mask.data.slice();
    mask.apply(selection, rect, mode);
    dirty = unionRect(dirty, rect)!;
    this.emit({ type: 'mask', rect: dirty });

    const tag = this.nextTag++;
    const edit = makeEdit(snapshot, mask, rect, tag);
    if (edit) this.history.push(edit);
    this.emit({ type: 'history' });
    return edit ? tag : null;
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

  private paint(rect: Rect | null): void {
    const s = this.stroke;
    if (!rect || !s || !this.mask || !this.coverage) return;
    this.mask.combineFrom(s.snapshot, this.coverage.data, rect, s.mode);
    s.dirty = unionRect(s.dirty, rect);
    this.emit({ type: 'mask', rect });
  }

  private clearCoverage(rect: Rect): void {
    const c = this.coverage!;
    for (let row = rect.y; row < rect.y + rect.h; row++) {
      c.data.fill(0, row * c.width + rect.x, row * c.width + rect.x + rect.w);
    }
  }
}

export const editor = new Editor();
