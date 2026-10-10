import { editor } from '../editor/editor';
import { useUI } from '../state/store';
import { autoRunIfReady } from './auto/auto';
import { prepareSelect } from './select/select';

/**
 * Starts AI work at the right moments: Auto runs when an image opens (or the
 * Auto tool is picked) if its model is already downloaded, and Select encodes
 * the image ahead of time so the first tap is quick.
 */
function onImageOrTool(): void {
  const { tool } = useUI.getState();
  if (tool === 'auto') void autoRunIfReady();
  else if (tool === 'select') void prepareSelect();
}

editor.subscribe((event) => {
  if (event.type === 'image') {
    useUI.setState({ autoRan: false });
    onImageOrTool();
  }
});

useUI.subscribe((state, prev) => {
  if (state.tool !== prev.tool) onImageOrTool();
});
