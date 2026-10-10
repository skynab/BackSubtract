import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { exportInWorker } from '../cv/client';
import { canEncodeWebp, downloadBlob, exportName, type ExportFormat } from '../export/exportImage';
import { useUI } from '../state/store';
import { ChevronIcon, DownloadIcon } from './icons';

const SWATCHES = [
  { color: '#ffffff', name: 'white' },
  { color: '#000000', name: 'black' },
];

export function DownloadButton() {
  const { t } = useTranslation();
  const format = useUI((s) => s.exportFormat);
  const background = useUI((s) => s.jpgBackground);
  const trim = useUI((s) => s.trim);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const formats: ExportFormat[] = canEncodeWebp() ? ['png', 'webp', 'jpg'] : ['png', 'jpg'];
  const active = formats.includes(format) ? format : 'png';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const download = async () => {
    if (!editor.image || !editor.mask) return;
    setOpen(false);
    setBusy(true);
    try {
      // Encoding runs in the image worker, so the page stays responsive meanwhile.
      const blob = await exportInWorker(editor.mask.data, { format: active, background, trim });
      downloadBlob(blob, exportName(editor.fileName, active));
    } catch {
      useUI.getState().showNotice({ key: 'errors.export', tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="download" ref={rootRef}>
      <button type="button" className="primary split-main" disabled={busy} onClick={download}>
        <DownloadIcon />
        {busy ? t('actions.exporting') : t('download.button', { format: t(`download.formats.${active}`) })}
      </button>
      <button
        type="button"
        className="primary split-toggle"
        aria-label={t('download.options')}
        aria-expanded={open}
        aria-haspopup="dialog"
        disabled={busy}
        onClick={() => setOpen((o) => !o)}
      >
        <ChevronIcon width={18} height={18} />
      </button>

      {open && (
        <div className="menu" role="dialog" aria-label={t('download.options')}>
          <fieldset>
            <legend className="sr-only">{t('download.format')}</legend>
            {formats.map((f) => (
              <label key={f} className="menu-option">
                <input
                  type="radio"
                  name="format"
                  checked={active === f}
                  onChange={() => useUI.setState({ exportFormat: f })}
                />
                <span>
                  <strong>{t(`download.formats.${f}`)}</strong>
                  <small>{t(`download.hints.${f}`)}</small>
                </span>
              </label>
            ))}
          </fieldset>

          {active === 'jpg' && (
            <div className="menu-row" role="group" aria-label={t('download.background')}>
              <span>{t('download.background')}</span>
              <div className="swatches">
                {SWATCHES.map(({ color, name }) => (
                  <button
                    key={color}
                    type="button"
                    className="swatch"
                    style={{ background: color }}
                    title={t(`download.colors.${name}`)}
                    aria-label={t(`download.colors.${name}`)}
                    aria-pressed={background === color}
                    onClick={() => useUI.setState({ jpgBackground: color })}
                  />
                ))}
                <label
                  className="swatch custom"
                  aria-pressed={!SWATCHES.some((s) => s.color === background)}
                  title={t('download.customColor')}
                >
                  <input
                    type="color"
                    value={background}
                    aria-label={t('download.customColor')}
                    onChange={(e) => useUI.setState({ jpgBackground: e.target.value })}
                  />
                </label>
              </div>
            </div>
          )}

          <label className="menu-row check">
            <input type="checkbox" checked={trim} onChange={(e) => useUI.setState({ trim: e.target.checked })} />
            {t('download.trim')}
          </label>
        </div>
      )}
    </div>
  );
}
