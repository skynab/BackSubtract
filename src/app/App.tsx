import { useTranslation } from 'react-i18next';
import { Viewer } from '../canvas/Viewer';
import { useUI } from '../state/store';
import { BottomBar } from './BottomBar';
import { DropZone } from './DropZone';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { useGlobalInput } from './useGlobalInput';

export function App() {
  const { t } = useTranslation();
  const hasImage = useUI((s) => s.hasImage);
  const dragging = useUI((s) => s.dragging);
  useGlobalInput();

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {hasImage ? <Viewer /> : <DropZone />}
        {dragging && <div className="drop-overlay">{t('drop')}</div>}
        <Toast />
      </main>
      {hasImage && <BottomBar />}
    </div>
  );
}
