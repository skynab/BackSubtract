import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { exportInWorker } from '../cv/client';
import {
  ASPECTS,
  canEncodeWebp,
  downloadBlob,
  exportName,
  extensionFor,
  MIME,
  type ExportFormat,
  type ExportOptions,
} from '../export/exportImage';
import { MARGIN_MAX, useUI } from '../state/store';
import { ChevronIcon, CopyIcon, DownloadIcon, ShareIcon } from './icons';

const SWATCHES = [
  { color: '#ffffff', name: 'white' },
  { color: '#000000', name: 'black' },
];

/** The clipboard takes images where ClipboardItem exists (it needs a secure page). */
const canCopy = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

let shareSupport: boolean | undefined;

/** Whether the system share sheet takes image files (most phones, some desktops). */
function canShareFiles(): boolean {
  if (shareSupport === undefined) {
    try {
      shareSupport = !!navigator.canShare?.({ files: [new File([], 'test.png', { type: 'image/png' })] });
    } catch {
      shareSupport = false;
    }
  }
  return shareSupport;
}

export function DownloadButton() {
  const { t } = useTranslation();
  const format = useUI((s) => s.exportFormat);
  const background = useUI((s) => s.jpgBackground);
  const trim = useUI((s) => s.trim);
  const margin = useUI((s) => s.margin);
  const aspect = useUI((s) => s.aspect);
  const fullSize = useUI((s) => s.fullSize);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const formats: ExportFormat[] = canEncodeWebp() ? ['png', 'webp', 'jpg', 'mask'] : ['png', 'jpg', 'mask'];
  const active = formats.includes(format) ? format : 'png';
  // Read when the menu renders; the menu is closed whenever a new image opens.
  const reduced = editor.isReduced;
  const { width: fullW, height: fullH } = editor.sourceSize;

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

  /** Encode the image in the image worker, so the page stays responsive meanwhile. */
  const render = (extra?: Partial<ExportOptions>): Promise<Blob> => {
    const options: ExportOptions = { format: active, background, trim, margin, aspect, ...extra };
    const source = fullSize && editor.isReduced ? editor.source ?? undefined : undefined;
    return exportInWorker(editor.mask!.data, options, source);
  };

  const fileName = () => exportName(editor.fileName, extensionFor(active), active === 'mask' ? 'mask' : 'no-bg');

  /** Run one way of getting the result out, with the button busy meanwhile. */
  const run = async (action: () => Promise<void>, errorKey: string) => {
    if (!editor.image || !editor.mask) return;
    setOpen(false);
    setBusy(true);
    try {
      await action();
    } catch (err) {
      // Closing the share sheet without choosing anything isn't an error.
      if (!(err instanceof DOMException && err.name === 'AbortError')) {
        console.error(err);
        useUI.getState().showNotice({ key: errorKey, tone: 'error' });
      }
    } finally {
      setBusy(false);
    }
  };

  const download = () => run(async () => downloadBlob(await render(), fileName()), 'errors.export');

  const copy = () =>
    run(async () => {
      // Safari only allows clipboard writes started in the click itself, so hand over the blob as a promise.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': render({ asPng: true }) })]);
      useUI.getState().showNotice({ key: 'download.copied', tone: 'info' });
    }, 'errors.copy');

  const share = () =>
    run(async () => {
      const file = new File([await render()], fileName(), { type: MIME[active] });
      await navigator.share({ files: [file] });
    }, 'errors.share');

  return (
    <div className="download" ref={rootRef}>
      <button type="button" className="primary split-main" disabled={busy} onClick={download}>
        <DownloadIcon />
        <span className="label">
          {busy ? t('actions.exporting') : t('download.button', { format: t(`download.formats.${active}`) })}
        </span>
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
        <div className="menu download-menu" role="dialog" aria-label={t('download.options')}>
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
          {trim && (
            <div className="menu-sub">
              <label className="menu-slider">
                <span>{t('download.margin')}</span>
                <input
                  type="range"
                  min={0}
                  max={MARGIN_MAX}
                  value={margin}
                  onChange={(e) => useUI.setState({ margin: Number(e.target.value) })}
                />
                <output>{margin}%</output>
              </label>
              <div className="segmented small" role="group" aria-label={t('download.aspect')}>
                {ASPECTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    aria-pressed={aspect === a}
                    onClick={() => useUI.setState({ aspect: a })}
                  >
                    {a === 'free' ? t('download.aspectFree') : a}
                  </button>
                ))}
              </div>
            </div>
          )}

          {reduced && (
            <label className="menu-row check">
              <input
                type="checkbox"
                checked={fullSize}
                onChange={(e) => useUI.setState({ fullSize: e.target.checked })}
              />
              {t('download.fullSize', { width: fullW, height: fullH })}
            </label>
          )}

          {(canCopy() || canShareFiles()) && (
            <div className="menu-row menu-actions">
              {canCopy() && (
                <button type="button" className="secondary" onClick={copy}>
                  <CopyIcon width={18} height={18} />
                  {t('download.copy')}
                </button>
              )}
              {canShareFiles() && (
                <button type="button" className="secondary" onClick={share}>
                  <ShareIcon width={18} height={18} />
                  {t('download.share')}
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
