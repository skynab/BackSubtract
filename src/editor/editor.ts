import { History, makeEdit, type Edit, type StepLabel } from '../mask/history';
import { extract, Mask, padRect, unionRect, type Mode, type Rect } from '../mask/mask';
import { snapToEdges, type Plane } from '../mask/snap';
import { SNAP_MIN_HARDNESS, snapRadius, stampDab, stampSegment } from '../tools/brush/brush';
import { refineAlpha, refineReach } from '../tools/brush/refine';

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
  /** 0–1: how much of the radius is painted at full strength. */
  hardness: number;
  mode: Mode;
  /** A refine stroke (hair and fur): nothing changes while painting; the edge is worked out when it ends. */
  refine: boolean;
}

/** Bounding box of the pixels that differ between two planes, or null if none do. */
function diffRect(a: Uint8Array, b: Uint8Array, width: number, height: number): Rect | null {
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      if (a[row + x] !== b[row + x]) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
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
  /** Size of the original file, which is larger than `image` when it was scaled down on opening. */
  sourceSize = { width: 0, height: 0 };
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

  load(
    image: ImageBitmap,
    source: Blob,
    fileName: string,
    saved?: { mask: Uint8Array; edits: Edit[] },
    sourceSize = { width: image.width, height: image.height },
  ): void {
    this.stroke = null;
    this.image?.close();
    this.image = image;
    this.source = source;
    this.fileName = fileName;
    this.sourceSize = sourceSize;
    this.mask = new Mask(image.width, image.height, saved?.mask);
    this.coverage = null;
    this.pixelCache = null;
    if (saved) this.history.restore(saved.edits);
    else this.history.clear();
    this.emit({ type: 'image' });
    this.emit({ type: 'history' });
  }

  /**
   * The original image's RGBA pixels, decoded once on first use. When the page is
   * cross-origin isolated they live in shared memory, so workers can read them without a copy.
   */
  get pixels(): Uint8ClampedArray {
    if (!this.pixelCache) {
      const image = this.image!;
      const canvas = new OffscreenCanvas(image.width, image.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.drawImage(image, 0, 0);
      const data = ctx.getImageData(0, 0, image.width, image.height).data;
      if (globalThis.crossOriginIsolated) {
        const shared = new Uint8ClampedArray(new SharedArrayBuffer(data.length));
        shared.set(data);
        this.pixelCache = shared;
      } else {
        this.pixelCache = data;
      }
    }
    return this.pixelCache;
  }

  /** Whether the image was scaled down on opening, so a larger export is possible. */
  get isReduced(): boolean {
    return !!this.image && this.sourceSize.width > this.image.width;
  }

  get isStroking(): boolean {
    return this.stroke !== null;
  }

  beginStroke(x: number, y: number, radius: number, mode: Mode, hardness: number, refine = false): void {
    const mask = this.mask;
    if (!mask) return;
    if (this.stroke) this.endStroke();
    this.coverage ??= { data: new Uint8Array(mask.width * mask.height), width: mask.width, height: mask.height };
    this.stroke = { snapshot: mask.data.slice(), dirty: null, lastX: x, lastY: y, radius, hardness, mode, refine };
    this.paint(stampDab(this.coverage, x, y, radius, hardness));
  }

  continueStroke(x: number, y: number): void {
    const s = this.stroke;
    if (!s || !this.coverage) return;
    this.paint(stampSegment(this.coverage, s.lastX, s.lastY, x, y, s.radius, s.hardness));
    s.lastX = x;
    s.lastY = y;
  }

  /** Finish the stroke: snap its edge to the image (unless the brush is soft), then record it as one undo step. */
  endStroke(): void {
    const s = this.stroke;
    const mask = this.mask;
    const coverage = this.coverage;
    this.stroke = null;
    if (!s?.dirty || !mask || !coverage) return;
    if (s.refine) {
      this.endRefine(s, mask, coverage);
      return;
    }

    const snap = s.hardness >= SNAP_MIN_HARDNESS;
    const r = snap ? snapRadius(s.radius) : 0;
    const rect = mask.clip(padRect(s.dirty, r))!;
    if (snap) snapToEdges(coverage, this.pixels, rect, r);
    mask.combineFrom(s.snapshot, coverage.data, rect, s.mode);
    this.clearCoverage(rect);
    this.emit({ type: 'mask', rect });

    const edit = makeEdit(s.snapshot, mask, rect, this.nextTag++, { tool: 'brush', mode: s.mode });
    if (edit) {
      this.history.push(edit);
      this.emit({ type: 'history' });
    }
  }

  /** Work out the edge under a refine stroke from the colours around it, as one undo step. */
  private endRefine(s: Stroke, mask: Mask, coverage: Plane): void {
    const reach = refineReach(s.radius);
    const rect = mask.clip(padRect(s.dirty!, reach))!;
    refineAlpha(this.pixels, s.snapshot, coverage.data, mask.data, mask.width, rect, reach);
    this.clearCoverage(rect);
    this.emit({ type: 'mask', rect });
    const edit = makeEdit(s.snapshot, mask, rect, this.nextTag++, { tool: 'refine' });
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
  applySelection(
    selection: Uint8Array,
    rect: Rect,
    mode: Mode,
    label: StepLabel,
    replaceTag?: number,
  ): number | null {
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
    const edit = makeEdit(snapshot, mask, rect, tag, label);
    if (edit) this.history.push(edit);
    this.emit({ type: 'history' });
    return edit ? tag : null;
  }

  /**
   * Set the whole mask at once (e.g. to the Auto result) as one undo step, and return its tag.
   * Passing the tag of the latest step replaces that step instead (e.g. while a slider moves).
   * Only the area that changed is kept in the history.
   */
  replaceMask(values: Uint8Array, label: StepLabel, replaceTag?: number): number | null {
    const mask = this.mask;
    if (!mask || this.stroke || values.length !== mask.data.length) return null;
    let dirty: Rect | null = null;
    if (replaceTag !== undefined && this.history.latestTag === replaceTag) dirty = this.history.discardLatest(mask);
    const snapshot = mask.data.slice();
    mask.data.set(values);
    const rect = diffRect(snapshot, values, mask.width, mask.height);
    dirty = unionRect(dirty, rect);
    if (dirty) this.emit({ type: 'mask', rect: dirty });
    const tag = this.nextTag++;
    const edit = rect && makeEdit(snapshot, mask, rect, tag, label);
    if (edit) this.history.push(edit);
    if (dirty) this.emit({ type: 'history' });
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

  /** Jump straight to a point in the history: `position` is how many steps stay applied. */
  goTo(position: number): void {
    if (this.stroke || !this.mask) return;
    const rect = this.history.goTo(this.mask, position);
    if (rect) {
      this.emit({ type: 'mask', rect });
      this.emit({ type: 'history' });
    }
  }

  private paint(rect: Rect | null): void {
    const s = this.stroke;
    if (!rect || !s || !this.mask || !this.coverage) return;
    if (s.refine) {
      s.dirty = unionRect(s.dirty, rect);
      return;
    }
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
