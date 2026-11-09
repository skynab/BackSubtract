import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { downloadAll, shareAll } from '../batch/batch';
import { useBatch } from '../batch/state';
import { editor } from '../editor/editor';
import { exportInWorker } from '../cv/client';
import { BACKGROUND_KINDS, BLUR_MAX, BLUR_MIN, type BackgroundKind } from '../export/background';
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
import { saveBackgroundImage } from '../session/autosave';
import { isHeic } from '../session/openImage';
import { MARGIN_MAX, selectBackground, useUI } from '../state/store';
import { ChevronIcon, CopyIcon, DownloadIcon, ShareIcon } from './icons';

const SWATCHES = [
  { color: '#ffffff', name: 'white' },
  { color: '#000000', name: 'black' },
];

/** The clipboard takes images where ClipboardItem exists (it needs a secure page). */
const canCopy = () => typeof ClipboardItem !== 'undefined' && !!navigator.clipboard?.write;

/** Pick a photo for the Image background. It stays on the device, kept for next time. */
function pickBackgroundImage(): void {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = 'image/*,.heic,.heif';
  input.addEventListener('change', async () => {
    const file = input.files?.[0];
    if (!file) return;
    try {
      // Only take a photo this browser can open (Safari opens HEIC; others can't).
      (await createImageBitmap(file)).close();
    } catch {
      useUI.getState().showNotice({ key: isHeic(file) ? 'errors.heic' : 'errors.load', tone: 'error' });
      return;
    }
    useUI.setState({ bgImage: file, background: 'image' });
    void saveBackgroundImage(file);
  });
  input.click();
}

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

/**
 * The Download button and its menu of settings. With `batch`, it downloads every finished
 * image of the batch as one zip (Share sends them as separate files, and there is no Copy).
 */
export function DownloadButton({ batch = false }: { batch?: boolean }) {
  const { t } = useTranslation();
  const format = useUI((s) => s.exportFormat);
  const bgKind = useUI((s) => s.background);
  const bgColor = useUI((s) => s.bgColor);
  const bgBlur = useUI((s) => s.bgBlur);
  const bgImage = useUI((s) => s.bgImage);
  const trim = useUI((s) => s.trim);
  const margin = useUI((s) => s.margin);
  const aspect = useUI((s) => s.aspect);
  const fullSize = useUI((s) => s.fullSize);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  /** While a batch is being exported: which image of how many. */
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const batchDone = useBatch((s) => (batch ? s.items.filter((i) => i.status === 'done').length : 0));
  const batchReduced = useBatch((s) => batch && s.items.some((i) => i.status === 'done' && i.sourceWidth > i.width));
  const [thumb, setThumb] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const formats: ExportFormat[] = canEncodeWebp() ? ['png', 'webp', 'jpg', 'mask'] : ['png', 'jpg', 'mask'];
  const active = formats.includes(format) ? format : 'png';
  const background = selectBackground({ exportFormat: active, background: bgKind, bgColor, bgBlur, bgImage });
  // JPG can't be transparent.
  const kinds = active === 'jpg' ? BACKGROUND_KINDS.filter((k) => k !== 'none') : BACKGROUND_KINDS;

  // The canvas shows the download's background while the menu is open (a batch's grid has no canvas).
  useEffect(() => {
    if (!batch) useUI.setState({ downloadOpen: open });
  }, [open, batch]);
  useEffect(
    () => () => {
      if (!batch) useUI.setState({ downloadOpen: false });
    },
    [batch],
  );

  useEffect(() => {
    if (!bgImage) {
      setThumb(null);
      return;
    }
    const url = URL.createObjectURL(bgImage);
    setThumb(url);
    return () => URL.revokeObjectURL(url);
  }, [bgImage]);

  const chooseBackground = (kind: BackgroundKind) => {
    if (kind === 'image' && !bgImage) pickBackgroundImage();
    else useUI.setState({ background: kind });
  };
  // Read when the menu renders; the menu is closed whenever a new image opens.
  const reduced = batch ? batchReduced : editor.isReduced;
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

  const options = (extra?: Partial<ExportOptions>): ExportOptions => ({ format: active, background, trim, margin, aspect, ...extra });

  /** Encode the image in the image worker, so the page stays responsive meanwhile. */
  const render = (extra?: Partial<ExportOptions>): Promise<Blob> => {
    const source = fullSize && editor.isReduced ? editor.source ?? undefined : undefined;
    return exportInWorker(editor.mask!.data, options(extra), source);
  };
  const onProgress = (done: number, total: number) => setProgress({ done, total });

  const fileName = () => exportName(editor.fileName, extensionFor(active), active === 'mask' ? 'mask' : 'no-bg');

  /** Run one way of getting the result out, with the button busy meanwhile. */
  const run = async (action: () => Promise<void>, errorKey: string) => {
    if (batch ? !batchDone : !editor.image || !editor.mask) return;
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
      setProgress(null);
    }
  };

  const download = () =>
    batch
      ? run(() => downloadAll(options(), fullSize, onProgress), 'errors.export')
      : run(async () => downloadBlob(await render(), fileName()), 'errors.export');

  const copy = () =>
    run(async () => {
      // Safari only allows clipboard writes started in the click itself, so hand over the blob as a promise.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': render({ asPng: true }) })]);
      useUI.getState().showNotice({ key: 'download.copied', tone: 'info' });
    }, 'errors.copy');

  const share = () =>
    batch
      ? run(() => shareAll(options(), fullSize, onProgress), 'batch.shareFailed')
      : run(async () => {
          const file = new File([await render()], fileName(), { type: MIME[active] });
          await navigator.share({ files: [file] });
        }, 'errors.share');

  const label = busy
    ? progress
      ? t('batch.preparing', progress)
      : t('actions.exporting')
    : batch
      ? t('batch.downloadAll')
      : t('download.button', { format: t(`download.formats.${active}`) });
  const copyable = !batch && canCopy();

  return (
    <div className="download" ref={rootRef}>
      <button type="button" className="primary split-main" disabled={busy || (batch && !batchDone)} onClick={download}>
        <DownloadIcon />
        <span className="label">{label}</span>
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

          {active !== 'mask' && (
            <div className="menu-row stack" role="group" aria-label={t('download.background')}>
              <span>{t('download.background')}</span>
              <div className="segmented small">
                {kinds.map((k) => (
                  <button key={k} type="button" aria-pressed={background.kind === k} onClick={() => chooseBackground(k)}>
                    {t(`download.backgrounds.${k}`)}
                  </button>
                ))}
              </div>
              {background.kind === 'color' && (
                <div className="swatches">
                  {SWATCHES.map(({ color, name }) => (
                    <button
                      key={color}
                      type="button"
                      className="swatch"
                      style={{ background: color }}
                      title={t(`download.colors.${name}`)}
                      aria-label={t(`download.colors.${name}`)}
                      aria-pressed={bgColor === color}
                      onClick={() => useUI.setState({ bgColor: color })}
                    />
                  ))}
                  <label
                    className="swatch custom"
                    aria-pressed={!SWATCHES.some((s) => s.color === bgColor)}
                    title={t('download.customColor')}
                  >
                    <input
                      type="color"
                      value={bgColor}
                      aria-label={t('download.customColor')}
                      onChange={(e) => useUI.setState({ bgColor: e.target.value })}
                    />
                  </label>
                </div>
              )}
              {background.kind === 'blur' && (
                <label className="menu-slider">
                  <span>{t('download.blurStrength')}</span>
                  <input
                    type="range"
                    min={BLUR_MIN}
                    max={BLUR_MAX}
                    value={bgBlur}
                    onChange={(e) => useUI.setState({ bgBlur: Number(e.target.value) })}
                  />
                  <output>{bgBlur}</output>
                </label>
              )}
              {background.kind === 'image' && (
                <div className="bg-image">
                  {thumb && <img src={thumb} alt="" />}
                  <button type="button" className="secondary" onClick={pickBackgroundImage}>
                    {t('download.changeImage')}
                  </button>
                </div>
              )}
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
              {batch ? t('batch.fullSize') : t('download.fullSize', { width: fullW, height: fullH })}
            </label>
          )}

          {(copyable || canShareFiles()) && (
            <div className="menu-row menu-actions">
              {copyable && (
                <button type="button" className="secondary" onClick={copy}>
                  <CopyIcon width={18} height={18} />
                  {t('download.copy')}
                </button>
              )}
              {canShareFiles() && (
                <button type="button" className="secondary" disabled={batch && !batchDone} onClick={share}>
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
