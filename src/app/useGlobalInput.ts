import { useEffect } from 'react';
import { editor } from '../editor/editor';
import { openImage } from '../session/openImage';
import { useUI } from '../state/store';

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['TEXTAREA', 'SELECT'].includes(target.tagName) ||
    (target instanceof HTMLInputElement && target.type !== 'range'));

/** Drop or paste an image anywhere, plus the app-wide keyboard shortcuts. */
export function useGlobalInput(): void {
  useEffect(() => {
    let dragDepth = 0;
    const hasFiles = (e: DragEvent) => e.dataTransfer?.types.includes('Files') ?? false;
    const setDragging = (dragging: boolean) => useUI.setState({ dragging });

    const onDragEnter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth++;
      setDragging(true);
    };
    const onDragOver = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      e.dataTransfer!.dropEffect = 'copy';
    };
    const onDragLeave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setDragging(false);
    };
    const onDrop = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      dragDepth = 0;
      setDragging(false);
      const file = e.dataTransfer?.files[0];
      if (file) void openImage(file);
    };
    const onPaste = (e: ClipboardEvent) => {
      if (isEditable(e.target)) return;
      const item = [...(e.clipboardData?.items ?? [])].find((i) => i.kind === 'file' && i.type.startsWith('image/'));
      const file = item?.getAsFile();
      if (file) {
        e.preventDefault();
        void openImage(file);
      }
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isEditable(e.target)) return;
      const ui = useUI.getState();
      const key = e.key.toLowerCase();
      if (e.ctrlKey || e.metaKey) {
        if (key === 'z') {
          e.preventDefault();
          if (e.shiftKey) editor.redo();
          else editor.undo();
        } else if (key === 'y') {
          e.preventDefault();
          editor.redo();
        }
        return;
      }
      if (e.altKey || !ui.hasImage) return;
      if (key === 'b') ui.setTool('brush');
      else if (key === 'x') ui.toggleMode();
      else if (e.key === '[') ui.setBrushSize(ui.brushSize / 1.25);
      else if (e.key === ']') ui.setBrushSize(ui.brushSize * 1.25);
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);
    window.addEventListener('paste', onPaste);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, []);
}
