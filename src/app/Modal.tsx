import { useEffect, useRef, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { CloseIcon } from './icons';

/**
 * A native modal dialog: focus is trapped, Esc closes it, and so does clicking outside.
 * Once it's gone, focus goes back to where it was, such as the button that opened it.
 */
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  // Read on the first render, before the dialog takes focus.
  const opener = useRef(document.activeElement);

  useEffect(() => {
    const dialog = ref.current!;
    if (!dialog.open) dialog.showModal();
    return () => {
      // The browser puts focus back itself only when the dialog closes itself (Esc). Closed
      // any other way (its ✕, its own buttons, a click outside), the dialog is just removed,
      // which leaves focus nowhere, and keyboard and screen reader users lose their place.
      const focus = document.activeElement;
      const lost = !focus || focus === document.body || dialog.contains(focus);
      if (lost && opener.current instanceof HTMLElement && opener.current.isConnected) opener.current.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby="modal-title"
      onClose={onClose}
      onClick={(e) => {
        // A click on the backdrop lands on the <dialog> itself, not its contents.
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="modal-body">
        <header className="modal-header">
          <h2 id="modal-title">{title}</h2>
          <button type="button" className="icon" aria-label={t('close')} onClick={onClose}>
            <CloseIcon />
          </button>
        </header>
        {children}
      </div>
    </dialog>
  );
}
