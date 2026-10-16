import { editor } from '../editor/editor';
import { useUI } from '../state/store';
import { loadSession } from './autosave';

/** Longest side kept in memory; larger photos are scaled down on open. */
export const MAX_SIDE = 4096;

interface Decoded {
  bitmap: ImageBitmap;
  resized: boolean;
  /** The file's own size, kept for exporting at full size. */
  full: { width: number; height: number };
}

async function decodeImage(file: Blob): Promise<Decoded> {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };
  const probe = await createImageBitmap(file, options);
  const full = { width: probe.width, height: probe.height };
  const scale = MAX_SIDE / Math.max(probe.width, probe.height);
  if (scale >= 1) return { bitmap: probe, resized: false, full };

  const resizeWidth = Math.round(probe.width * scale);
  const resizeHeight = Math.round(probe.height * scale);
  probe.close();
  const bitmap = await createImageBitmap(file, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
  return { bitmap, resized: true, full };
}

/** The answer to "Open a new image?" while it's being asked. */
let pendingReplace: ((open: boolean) => void) | null = null;

/** Ask (in the app's own dialog) whether a new image may replace the current one and its edits. */
function askReplace(): Promise<boolean> {
  // A second drop while asking replaces the first: the newer file is the one to ask about.
  pendingReplace?.(false);
  return new Promise((resolve) => {
    pendingReplace = resolve;
    useUI.setState({ dialog: 'replace' });
  });
}

/** Called by the dialog with the user's answer. */
export function answerReplace(open: boolean): void {
  const resolve = pendingReplace;
  pendingReplace = null;
  if (useUI.getState().dialog === 'replace') useUI.setState({ dialog: null });
  resolve?.(open);
}

/** iPhone photos. Some systems report no type for them, so check the name too. */
export const isHeic = (file: File) => /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);

export async function openImage(file: File): Promise<void> {
  const ui = useUI.getState();
  const heic = isHeic(file);
  if (!file.type.startsWith('image/') && !heic) {
    ui.showNotice({ key: 'errors.notImage', tone: 'error' });
    return;
  }
  if (editor.history.canUndo && !(await askReplace())) return;

  try {
    const { bitmap, resized, full } = await decodeImage(file);
    editor.load(bitmap, file, file.name, undefined, full);
    useUI.setState({
      hasImage: true,
      notice: resized ? { key: 'notices.resized', params: { max: MAX_SIDE }, tone: 'info' } : null,
    });
  } catch {
    // Safari can open HEIC itself; other browsers can't, so say what to do instead.
    ui.showNotice({ key: heic ? 'errors.heic' : 'errors.load', tone: 'error' });
  }
}

/** Reopen the image and edits saved from the last visit, if any. */
export async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (!saved) return;
  try {
    const { bitmap, full } = await decodeImage(saved.file);
    // If the image decodes to a different size than before, the saved edits no longer line up.
    const fits = bitmap.width === saved.width && bitmap.height === saved.height;
    editor.load(bitmap, saved.file, saved.fileName, fits ? { mask: saved.mask, edits: saved.edits } : undefined, full);
    // Don't let Auto overwrite restored work.
    useUI.setState({ hasImage: true, autoRan: true, notice: { key: 'notices.restored', tone: 'info' } });
  } catch {
    // A saved session that can't be reopened is simply skipped.
  }
}

/** Show the system file picker (which also offers the camera on phones). */
export function chooseImage(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openImage(file);
  });
  input.click();
}
