import { useTranslation } from 'react-i18next';
import { inBatch, useBatch } from '../batch/state';
import { Viewer } from '../canvas/Viewer';
import { useUI } from '../state/store';
import { AboutDialog } from './AboutDialog';
import { CloseBatchDialog, ShareBatchDialog } from './BatchDialogs';
import { BatchBar, BatchView } from './BatchView';
import { BottomBar } from './BottomBar';
import { DonateDialog } from './DonateDialog';
import { DownloadDialog } from './DownloadDialog';
import { DropZone } from './DropZone';
import { ReplaceDialog } from './ReplaceDialog';
import { TaskStatus } from './TaskStatus';
import { Toast } from './Toast';
import { TopBar } from './TopBar';
import { useGlobalInput } from './useGlobalInput';

export function App() {
  const { t } = useTranslation();
  const hasImage = useUI((s) => s.hasImage);
  const dragging = useUI((s) => s.dragging);
  const dialog = useUI((s) => s.dialog);
  // A batch's grid shows when none of its images is open in the editor.
  const grid = useBatch((s) => inBatch(s)) && !hasImage;
  const closeDialog = () => useUI.setState({ dialog: null });
  useGlobalInput();

  return (
    <div className="app">
      <TopBar />
      <main className="stage">
        {/* A heading for screen readers to find the editor or the grid by; the start screen shows its own. */}
        {(hasImage || grid) && <h1 className="sr-only">{hasImage ? t('viewer.label') : t('batch.label')}</h1>}
        {hasImage ? <Viewer /> : grid ? <BatchView /> : <DropZone />}
        {dragging && <div className="drop-overlay">{t('drop')}</div>}
        {/* The grid shows it in its own header, rather than over the first row of images. */}
        {!grid && <TaskStatus />}
        <Toast />
      </main>
      {hasImage && <BottomBar />}
      {grid && <BatchBar />}
      {dialog === 'donate' && <DonateDialog onClose={closeDialog} />}
      {dialog === 'about' && <AboutDialog onClose={closeDialog} />}
      {dialog === 'replace' && <ReplaceDialog />}
      {dialog === 'download' && <DownloadDialog />}
      {dialog === 'closeBatch' && <CloseBatchDialog />}
      {dialog === 'shareBatch' && <ShareBatchDialog />}
    </div>
  );
}
