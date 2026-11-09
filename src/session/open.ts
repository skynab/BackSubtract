import { addFiles, backToBatch, restoreBatch, startBatch } from '../batch/batch';
import { inBatch } from '../batch/state';
import { editor } from '../editor/editor';
import { askReplace, isImageFile, openImage, restoreSession } from './openImage';

/**
 * Open what was chosen, dropped or pasted. One image opens in the editor as always;
 * several start a batch. While a batch is open, they join it instead.
 */
export async function openFiles(files: File[]): Promise<void> {
  if (!files.length) return;
  if (inBatch()) {
    await backToBatch();
    addFiles(files);
    return;
  }
  const images = files.filter(isImageFile);
  if (images.length < 2) return openImage(images[0] ?? files[0]);
  if (editor.history.canUndo && !(await askReplace(true))) return;
  startBatch(files);
}

/** Show the system file picker (which also offers the camera on phones). Several images can be picked at once. */
export function chooseImages(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif';
  input.multiple = true;
  input.addEventListener('change', () => void openFiles([...(input.files ?? [])]));
  input.click();
}

/** Reopen the batch, or else the single image, saved from the last visit. */
export async function restore(): Promise<void> {
  if (!(await restoreBatch())) await restoreSession();
}
