import { editor } from '../editor/editor';
import { useUI } from '../state/store';
import { loadSession } from './autosave';

/** Longest side kept in memory; larger photos are scaled down on open. */
export const MAX_SIDE = 4096;

/** The size a photo of `width` × `height` is edited at. */
export function editedSize(width: number, height: number): { width: number; height: number } {
  const scale = MAX_SIDE / Math.max(width, height);
  return scale >= 1 ? { width, height } : { width: Math.round(width * scale), height: Math.round(height * scale) };
}

interface Decoded {
  bitmap: ImageBitmap;
  resized: boolean;
  /** The file's own size, kept for exporting at full size. */
  full: { width: number; height: number };
}

export async function decodeImage(file: Blob): Promise<Decoded> {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };
  const probe = await createImageBitmap(file, options);
  const full = { width: probe.width, height: probe.height };
  const size = editedSize(full.width, full.height);
  if (size.width === full.width && size.height === full.height) return { bitmap: probe, resized: false, full };

  probe.close();
  const bitmap = await createImageBitmap(file, { ...options, resizeWidth: size.width, resizeHeight: size.height, resizeQuality: 'high' });
  return { bitmap, resized: true, full };
}

/** The answer to "Open a new image?" while it's being asked. */
let pendingReplace: ((open: boolean) => void) | null = null;

/** Ask (in the app's own dialog) whether a new image, or several (`many`), may replace the current one and its edits. */
export function askReplace(many = false): Promise<boolean> {
  // A second drop while asking replaces the first: the newer file is the one to ask about.
  pendingReplace?.(false);
  return new Promise((resolve) => {
    pendingReplace = resolve;
    useUI.setState({ dialog: 'replace', replaceMany: many });
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

/** Whether a file looks like an image worth trying to open. */
export const isImageFile = (file: File) => file.type.startsWith('image/') || isHeic(file);

export async function openImage(file: File): Promise<void> {
  const ui = useUI.getState();
  const heic = isHeic(file);
  if (!isImageFile(file)) {
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
