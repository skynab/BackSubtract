import { blurInWorker } from '../cv/client';
import { editor } from '../editor/editor';
import { coverRect, type Background, type RgbaImage } from '../export/background';
import { exportFrame } from '../export/exportImage';
import type { Rect } from '../mask/mask';
import { selectBackground, useUI } from '../state/store';
import type { RGB } from './renderer';

/**
 * While the Download menu is open, the canvas shows the download's background and
 * frame (with Crop to subject) in place of the checkerboard, so what you see is
 * what you download. Closing the menu brings the checkerboard back, since it is
 * better for spotting missed bits.
 */

/** The longest side an Image background is shown at on the canvas (the download uses the whole photo). */
const PREVIEW_SIDE = 2048;

export type BackdropFill =
  | { kind: 'checker' }
  | { kind: 'color'; color: RGB }
  /** A picture over `rect` (image px). `id` changes only when the picture does, so it is uploaded once. */
  | { kind: 'texture'; source: ImageBitmap | RgbaImage; rect: Rect; id: number };

export interface Backdrop {
  /** The part of the image the download covers (image px); may reach past the image. */
  frame: Rect;
  fill: BackdropFill;
}

let current: Backdrop | null = null;
const listeners = new Set<(backdrop: Backdrop | null) => void>();

/** Listen for changes; called straight away with the current backdrop. */
export function onBackdrop(listener: (backdrop: Backdrop | null) => void): () => void {
  listeners.add(listener);
  listener(current);
  return () => listeners.delete(listener);
}

function publish(next: Backdrop | null): void {
  current = next;
  for (const listener of listeners) listener(next);
}

let nextId = 1;
const ids = new WeakMap<object, number>();
const idOf = (o: object) => {
  let id = ids.get(o);
  if (id === undefined) ids.set(o, (id = nextId++));
  return id;
};

/** Counts mask changes, so the frame and blur are redone only when the mask has changed. */
let maskVersion = 0;
/** What the backdrop on show was made from. */
let shownKey = '';
/** The Image background decoded for the canvas, and the file it came from. */
let decoded: { blob: Blob; bitmap: ImageBitmap } | null = null;
/** Blur runs one request at a time; a change made meanwhile is picked up when it finishes. */
let blurBusy = false;
let blurAgain = false;

/** What the backdrop should be made from now, or null when none should show. */
function wanted(): { key: string; background: Background } | null {
  const ui = useUI.getState();
  if (!ui.downloadOpen || !editor.mask || ui.exportFormat === 'mask') return null;
  const background = selectBackground(ui);
  const detail =
    background.kind === 'color' ? background.color
    : background.kind === 'blur' ? background.strength
    : background.kind === 'image' ? idOf(background.image)
    : '';
  return { key: [background.kind, detail, ui.trim, ui.margin, ui.aspect, maskVersion].join('|'), background };
}

function frameNow(): Rect {
  const mask = editor.mask!;
  return exportFrame(mask.data, mask.width, mask.height, useUI.getState());
}

function hexToRgb(hex: string): RGB {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255] : [1, 1, 1];
}

async function decode(blob: Blob): Promise<ImageBitmap> {
  if (decoded?.blob === blob) return decoded.bitmap;
  let bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  const scale = PREVIEW_SIDE / Math.max(bitmap.width, bitmap.height);
  if (scale < 1) {
    const small = await createImageBitmap(bitmap, {
      resizeWidth: Math.max(1, Math.round(bitmap.width * scale)),
      resizeHeight: Math.max(1, Math.round(bitmap.height * scale)),
      resizeQuality: 'high',
    });
    bitmap.close();
    bitmap = small;
  }
  // The renderer has its own copy of an earlier one, uploaded as a texture.
  decoded?.bitmap.close();
  decoded = { blob, bitmap };
  return bitmap;
}

async function update(): Promise<void> {
  const want = wanted();
  if (!want) {
    shownKey = '';
    if (current) publish(null);
    return;
  }
  if (want.key === shownKey) return;
  const { key, background } = want;
  switch (background.kind) {
    case 'none':
    case 'color':
      shownKey = key;
      publish({
        frame: frameNow(),
        fill: background.kind === 'color' ? { kind: 'color', color: hexToRgb(background.color) } : { kind: 'checker' },
      });
      return;
    case 'image': {
      let bitmap: ImageBitmap;
      try {
        bitmap = await decode(background.image);
      } catch {
        // Checked when it was picked, so this is unlikely; the download reports its own error.
        return;
      }
      if (wanted()?.key !== key) return;
      const frame = frameNow();
      shownKey = key;
      publish({ frame, fill: { kind: 'texture', source: bitmap, rect: coverRect(bitmap.width, bitmap.height, frame), id: idOf(bitmap) } });
      return;
    }
    case 'blur':
      return blur();
  }
}

async function blur(): Promise<void> {
  if (blurBusy) {
    blurAgain = true;
    return;
  }
  blurBusy = true;
  try {
    do {
      blurAgain = false;
      const want = wanted();
      if (!want || want.background.kind !== 'blur' || want.key === shownKey) break;
      const frame = frameNow();
      const small = await blurInWorker(editor.mask!.data, want.background.strength, frame);
      // Something else may have been chosen meanwhile; if it was another strength, the loop runs again.
      if (wanted()?.key !== want.key) continue;
      shownKey = want.key;
      publish({ frame, fill: { kind: 'texture', source: small, rect: frame, id: nextId++ } });
    } while (blurAgain);
  } catch (err) {
    console.warn('Blurred background preview failed', err);
  } finally {
    blurBusy = false;
  }
}

export function startBackdrop(): void {
  useUI.subscribe((s, prev) => {
    if (
      s.downloadOpen !== prev.downloadOpen ||
      s.exportFormat !== prev.exportFormat ||
      s.background !== prev.background ||
      s.bgColor !== prev.bgColor ||
      s.bgBlur !== prev.bgBlur ||
      s.bgImage !== prev.bgImage ||
      s.trim !== prev.trim ||
      s.margin !== prev.margin ||
      s.aspect !== prev.aspect
    ) {
      void update();
    }
  });
  editor.subscribe((event) => {
    if (event.type === 'history') return;
    maskVersion++;
    if (useUI.getState().downloadOpen) void update();
  });
}
