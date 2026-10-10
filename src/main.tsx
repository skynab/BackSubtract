import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/app.css';
import { editor } from './editor/editor';
import { initI18n } from './i18n';
import { useUI } from './state/store';

editor.subscribe((event) => {
  if (event.type === 'history') {
    useUI.setState({ canUndo: editor.history.canUndo, canRedo: editor.history.canRedo });
  }
});

void initI18n().then(() =>
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
);
