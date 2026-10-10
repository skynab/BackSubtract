import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CONTRAST_MAX } from '../canvas/checker';
import { useUI, VIEW_MODES } from '../state/store';
import { CheckerIcon } from './icons';

/**
 * How the transparency checkerboard looks: its contrast, and whether it slides.
 * Both help spot bits that were missed.
 */
function BackgroundButton() {
  const { t } = useTranslation();
  const contrast = useUI((s) => s.checkerContrast);
  const motion = useUI((s) => s.checkerMotion);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

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

  return (
    <div className="checker-settings" ref={rootRef}>
      <button
        type="button"
        className="checker-button"
        title={t('checker.title')}
        aria-label={t('checker.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <CheckerIcon width={18} height={18} />
      </button>
      {open && (
        <div className="menu checker-menu" role="dialog" aria-label={t('checker.title')}>
          <label className="edge-slider">
            <span className="edge-slider-label">{t('checker.contrast')}</span>
            <input
              type="range"
              min={0}
              max={CONTRAST_MAX}
              value={contrast}
              onChange={(e) => useUI.setState({ checkerContrast: Number(e.target.value) })}
            />
            <span className="edge-slider-ends" aria-hidden="true">
              <span>{t('checker.low')}</span>
              <span>{t('checker.high')}</span>
            </span>
          </label>
          <label className="menu-row check">
            <input type="checkbox" checked={motion} onChange={(e) => useUI.setState({ checkerMotion: e.target.checked })} />
            {t('checker.motion')}
          </label>
        </div>
      )}
    </div>
  );
}

/** Switch between the result, the result over a faint original, and the original itself. */
export function ViewSwitch() {
  const { t } = useTranslation();
  const viewMode = useUI((s) => s.viewMode);
  return (
    <div className="view-controls">
      <div className="segmented view-switch" role="group" aria-label={t('view.label')}>
        {VIEW_MODES.map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={viewMode === mode}
            title={t(`view.hints.${mode}`)}
            onClick={() => useUI.setState({ viewMode: mode })}
          >
            {t(`view.${mode}`)}
          </button>
        ))}
      </div>
      <BackgroundButton />
    </div>
  );
}
