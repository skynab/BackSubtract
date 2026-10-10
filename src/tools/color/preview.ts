import { previewInWorker } from '../../cv/client';
import type { PickTool, SelectionResult } from '../../cv/protocol';
import { editor } from '../../editor/editor';
import type { Mode } from '../../mask/mask';
import { useUI } from '../../state/store';

/** What a tap at the pointer would do, shown before it happens. */
export interface Preview {
  selection: SelectionResult;
  mode: Mode;
}

/** How long the pointer must rest before a preview is worked out. */
const REST_MS = 60;

let target: { tool: PickTool; x: number; y: number } | null = null;
let shown: Preview | null = null;
let busy = false;
let again = false;
let timer = 0;
const listeners = new Set<(preview: Preview | null) => void>();

/** Called with each new preview, or null when it should disappear. */
export function onPreview(listener: (preview: Preview | null) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function show(preview: Preview | null): void {
  if (!preview && !shown) return;
  shown = preview;
  for (const listener of listeners) listener(preview);
}

/** The pointer is over this image position with the Magic Wand or Color tool. */
export function previewAt(tool: PickTool, imageX: number, imageY: number): void {
  const image = editor.image;
  const x = Math.floor(imageX);
  const y = Math.floor(imageY);
  if (!image || x < 0 || y < 0 || x >= image.width || y >= image.height) {
    clearPreview();
    return;
  }
  if (target?.tool === tool && target.x === x && target.y === y && shown) return;
  target = { tool, x, y };
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(), REST_MS);
}

/** Hide the preview, e.g. when the pointer leaves the image or a tap applies it. */
export function clearPreview(): void {
  clearTimeout(timer);
  target = null;
  show(null);
}

async function run(): Promise<void> {
  // Only one request at a time; the newest position is worked out next.
  if (busy) {
    again = true;
    return;
  }
  const want = target;
  const image = editor.image;
  if (!want || !image) return;
  const ui = useUI.getState();
  busy = true;
  try {
    const selection = await previewInWorker({ ...want, tolerance: ui.tolerances[want.tool], refine: false });
    // Drop it if the pointer has moved on, left, or the image changed meanwhile.
    if (target === want && editor.image === image) {
      show(selection ? { selection, mode: useUI.getState().modes[want.tool] } : null);
    }
  } catch (err) {
    console.error(err);
  } finally {
    busy = false;
  }
  if (again) {
    again = false;
    void run();
  }
}

/** Work the preview out again at the same spot, e.g. after the tolerance or mode changed. */
function refresh(): void {
  if (!target) return;
  const { tool } = useUI.getState();
  if (tool !== target.tool) {
    clearPreview();
    return;
  }
  clearTimeout(timer);
  timer = window.setTimeout(() => void run(), REST_MS);
}

useUI.subscribe((s, prev) => {
  if (s.tool !== prev.tool || s.tolerances !== prev.tolerances || s.modes !== prev.modes) refresh();
});
editor.subscribe((event) => {
  // After any edit the old preview no longer matches what a tap would change.
  if (event.type === 'image' || event.type === 'history') clearPreview();
});
