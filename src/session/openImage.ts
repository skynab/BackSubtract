import { editor } from '../editor/editor';
import { i18n } from '../i18n';
import { useUI } from '../state/store';
import { loadSession } from './autosave';

/** Longest side kept in memory; larger photos are scaled down on open. */
export const MAX_SIDE = 4096;

async function decodeImage(file: Blob): Promise<{ bitmap: ImageBitmap; resized: boolean }> {
  const options: ImageBitmapOptions = { imageOrientation: 'from-image', premultiplyAlpha: 'none' };
  const probe = await createImageBitmap(file, options);
  const scale = MAX_SIDE / Math.max(probe.width, probe.height);
  if (scale >= 1) return { bitmap: probe, resized: false };

  const resizeWidth = Math.round(probe.width * scale);
  const resizeHeight = Math.round(probe.height * scale);
  probe.close();
  const bitmap = await createImageBitmap(file, { ...options, resizeWidth, resizeHeight, resizeQuality: 'high' });
  return { bitmap, resized: true };
}

export async function openImage(file: File): Promise<void> {
  const ui = useUI.getState();
  if (!file.type.startsWith('image/')) {
    ui.showNotice({ key: 'errors.notImage', tone: 'error' });
    return;
  }
  if (editor.history.canUndo && !window.confirm(i18n.t('confirmReplace'))) return;

  try {
    const { bitmap, resized } = await decodeImage(file);
    editor.load(bitmap, file, file.name);
    useUI.setState({
      hasImage: true,
      notice: resized ? { key: 'notices.resized', params: { max: MAX_SIDE }, tone: 'info' } : null,
    });
  } catch {
    ui.showNotice({ key: 'errors.load', tone: 'error' });
  }
}

/** Reopen the image and edits saved from the last visit, if any. */
export async function restoreSession(): Promise<void> {
  const saved = await loadSession();
  if (!saved) return;
  try {
    const { bitmap } = await decodeImage(saved.file);
    // If the image decodes to a different size than before, the saved edits no longer line up.
    const fits = bitmap.width === saved.width && bitmap.height === saved.height;
    editor.load(bitmap, saved.file, saved.fileName, fits ? { mask: saved.mask, edits: saved.edits } : undefined);
    useUI.setState({ hasImage: true, notice: { key: 'notices.restored', tone: 'info' } });
  } catch {
    // A saved session that can't be reopened is simply skipped.
  }
}

/** Show the system file picker (which also offers the camera on phones). */
export function chooseImage(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*';
  input.addEventListener('change', () => {
    const file = input.files?.[0];
    if (file) void openImage(file);
  });
  input.click();
}
