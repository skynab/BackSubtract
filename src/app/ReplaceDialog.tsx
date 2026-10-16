import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { answerReplace } from '../session/openImage';
import { Modal } from './Modal';

/**
 * Asks before a new image (dropped, pasted or chosen) replaces one with edits.
 * The app's own dialog rather than window.confirm, which some browsers and
 * embedded views suppress, and which would leave a drop silently doing nothing.
 */
export function ReplaceDialog() {
  const { t } = useTranslation();
  const openRef = useRef<HTMLButtonElement>(null);

  // Enter opens the new image, as a drop most often means to. Opening the modal focuses its
  // first button (Close), so move focus once that has happened.
  useEffect(() => {
    const frame = requestAnimationFrame(() => openRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <Modal title={t('replace.title')} onClose={() => answerReplace(false)}>
      <p>{t('replace.body')}</p>
      <div className="modal-actions">
        <button type="button" className="secondary" onClick={() => answerReplace(false)}>
          {t('replace.cancel')}
        </button>
        <button type="button" className="primary" ref={openRef} onClick={() => answerReplace(true)}>
          {t('replace.open')}
        </button>
      </div>
    </Modal>
  );
}
