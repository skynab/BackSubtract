import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/app.css';
import { editor } from './editor/editor';
import { initI18n } from './i18n';
import { startAutosave } from './session/autosave';
import { restoreSession } from './session/openImage';
import { useUI } from './state/store';

editor.subscribe((event) => {
  if (event.type === 'history') {
    useUI.setState({ canUndo: editor.history.canUndo, canRedo: editor.history.canRedo });
  }
});

async function start() {
  await Promise.all([initI18n(), restoreSession()]);
  // Start saving only after restoring, so the restore itself isn't saved straight back.
  startAutosave();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
