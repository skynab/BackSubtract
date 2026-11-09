import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App';
import './app/app.css';
import { editor } from './editor/editor';
import { initI18n } from './i18n';
import { startBackdrop } from './canvas/backdrop';
import { loadBackgroundImage, startAutosave } from './session/autosave';
import { restore } from './session/open';
import { useUI } from './state/store';
import './tools/controller';

editor.subscribe((event) => {
  if (event.type === 'history') {
    useUI.setState({ canUndo: editor.history.canUndo, canRedo: editor.history.canRedo });
  }
});

/** Supporters come back from Stripe to /?thanks: say thank you, then tidy the address bar. */
function thankSupporter() {
  const url = new URL(location.href);
  if (!url.searchParams.has('thanks')) return;
  url.searchParams.delete('thanks');
  history.replaceState(null, '', url);
  useUI.setState({ notice: { key: 'donate.thanks', tone: 'info' } });
}

/** Bring back the photo picked as the Image background; without it, Image falls back to no background. */
async function restoreBackgroundImage() {
  const image = await loadBackgroundImage();
  if (image) useUI.setState({ bgImage: image });
  else if (useUI.getState().background === 'image') useUI.setState({ background: 'none' });
}

async function start() {
  await Promise.all([initI18n(), restore(), restoreBackgroundImage()]);
  startBackdrop();
  // Start saving only after restoring, so the restore itself isn't saved straight back.
  startAutosave();
  thankSupporter();
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

void start();
