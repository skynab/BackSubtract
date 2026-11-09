import { useTranslation } from 'react-i18next';
import { closeBatch, forgetShare, shareReady } from '../batch/batch';
import { useUI } from '../state/store';
import { ShareIcon } from './icons';
import { Modal } from './Modal';

/** Asks before a batch is closed, since its images and edits go with it. */
export function CloseBatchDialog() {
  const { t } = useTranslation();
  const cancel = () => useUI.setState({ dialog: null });
  return (
    <Modal title={t('batch.closeTitle')} onClose={cancel}>
      <p>{t('batch.closeBody')}</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={cancel}>
          {t('replace.cancel')}
        </button>
        <button
          type="button"
          className="primary"
          onClick={() => {
            cancel();
            void closeBatch();
          }}
        >
          {t('batch.closeConfirm')}
        </button>
      </div>
    </Modal>
  );
}

/** Shown when the images took too long to prepare for the share sheet to open by itself: one more tap opens it. */
export function ShareBatchDialog() {
  const { t } = useTranslation();
  return (
    <Modal title={t('batch.shareTitle')} onClose={forgetShare}>
      <p>{t('batch.shareBody')}</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={forgetShare}>
          {t('replace.cancel')}
        </button>
        <button type="button" className="primary" onClick={() => void shareReady()}>
          <ShareIcon width={18} height={18} />
          {t('download.share')}
        </button>
      </div>
    </Modal>
  );
}
