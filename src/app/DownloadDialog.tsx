import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { answerDownload, toMB } from '../ml/status';
import { useUI } from '../state/store';
import { Modal } from './Modal';

/**
 * Asks before an AI model's first download, saying how big it is, since that
 * can be a lot on a phone's data plan. Nothing is downloaded until Download.
 */
export function DownloadDialog() {
  const { t } = useTranslation();
  const model = useUI((s) => s.downloadModel);
  const info = useUI((s) => (s.downloadModel ? s.models[s.downloadModel] : undefined));
  const downloadRef = useRef<HTMLButtonElement>(null);

  // Enter downloads, as the tap that opened this asked for the tool. Opening the modal focuses
  // its first button (Close), so move focus once that has happened.
  useEffect(() => {
    const frame = requestAnimationFrame(() => downloadRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  if (!model || !info) return null;
  return (
    <Modal title={t('modelDownload.title')} onClose={() => answerDownload(false)}>
      <p>{t('modelDownload.body', { tool: t(`tools.${model}`), size: toMB(info.bytes) })}</p>
      <p className="muted small">{t('modelDownload.note')}</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => answerDownload(false)}>
          {t('modelDownload.cancel')}
        </button>
        <button type="button" className="primary" ref={downloadRef} onClick={() => answerDownload(true)}>
          {t('modelDownload.confirm')}
        </button>
      </div>
    </Modal>
  );
}
