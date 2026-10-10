import { useTranslation } from 'react-i18next';
import { Viewer } from '../canvas/Viewer';
import { useUI } from '../state/store';
import { AboutDialog } from './AboutDialog';
import { BottomBar } from './BottomBar';
import { DonateDialog } from './DonateDialog';
import { DropZone } from './DropZone';
import { TaskStatus } from './TaskStatus';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { useGlobalInput } from './useGlobalInput';

export function App() {
  const { t } = useTranslation();
  const hasImage = useUI((s) => s.hasImage);
  const dragging = useUI((s) => s.dragging);
  const dialog = useUI((s) => s.dialog);
  const closeDialog = () => useUI.setState({ dialog: null });
  useGlobalInput();

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {hasImage ? <Viewer /> : <DropZone />}
        {dragging && <div className="drop-overlay">{t('drop')}</div>}
        <TaskStatus />
        <Toast />
      </main>
      {hasImage && <BottomBar />}
      {dialog === 'donate' && <DonateDialog onClose={closeDialog} />}
      {dialog === 'about' && <AboutDialog onClose={closeDialog} />}
    </div>
  );
}
