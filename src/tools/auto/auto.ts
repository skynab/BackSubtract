import { editor } from '../../editor/editor';
import { resizePlane } from '../../mask/resample';
import { removeBackground, workCopy } from '../../ml/client';
import { refreshModelInfo, withModelTask } from '../../ml/status';
import { useUI } from '../../state/store';

let running = false;

/**
 * Remove the background with the AI model. The result replaces the whole mask
 * as one undoable step, so running it again resets to the model's result.
 */
export async function runAuto(): Promise<void> {
  const image = editor.image;
  if (!image || running) return;
  running = true;
  try {
    const result = await withModelTask('auto', 'task.auto', async () => removeBackground(await workCopy(image)));
    // Ignore the result if a different image was opened meanwhile.
    if (!result || editor.image !== image) return;
    const full = resizePlane(result.data, result.width, result.height, image.width, image.height);
    editor.replaceMask(full, { tool: 'auto' });
    useUI.setState({ autoRan: true });
  } finally {
    running = false;
  }
}

/** Run Auto without asking, but only if its model is already downloaded and it hasn't run on this image. */
export async function autoRunIfReady(): Promise<void> {
  if (!editor.image) return;
  const info = await refreshModelInfo('auto');
  // Read the state after the await: e.g. a restored session marks Auto as already run.
  const { tool, autoRan } = useUI.getState();
  if (info.cached && tool === 'auto' && !autoRan) await runAuto();
}
