import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { CLEANUP_MAX, NO_ADJUST, SHIFT_MAX, SOFTEN_MAX, type EdgeAdjust } from '../mask/adjust';
import { beginEdges, edgesStale, endEdges, setEdges } from '../tools/edges/edges';
import { EdgesIcon } from './icons';

function EdgeSlider({ label, ends, value, min, max, onChange }: {
  label: string;
  /** Words for the two ends, e.g. Shrink / Grow. */
  ends: [string, string];
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <label className="edge-slider">
      <span className="edge-slider-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="edge-slider-ends" aria-hidden="true">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </span>
    </label>
  );
}

/**
 * Whole-image edge adjustments: move the edge in or out, make it crisper or
 * softer, and clean up specks. Each time the panel opens, its sliders start at
 * zero and adjust the mask as it is then, as one undo step.
 */
export function EdgesButton() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [adjust, setAdjust] = useState<EdgeAdjust>(NO_ADJUST);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    beginEdges();
    const close = () => setOpen(false);
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    // After an undo, another tool or a new image, these settings no longer describe the mask.
    const stop = editor.subscribe((event) => {
      if ((event.type === 'history' || event.type === 'image') && edgesStale()) close();
    });
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      stop();
      endEdges();
      setAdjust(NO_ADJUST);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const change = (patch: Partial<EdgeAdjust>) => {
    const next = { ...adjust, ...patch };
    setAdjust(next);
    void setEdges(next);
  };

  return (
    <div className="edges" ref={rootRef}>
      <button
        type="button"
        className="icon"
        title={t('edges.title')}
        aria-label={t('edges.title')}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <EdgesIcon />
      </button>
      {open && (
        <div className="menu edges-menu" role="dialog" aria-label={t('edges.title')}>
          <EdgeSlider label={t('edges.shift')} ends={[t('edges.shrink'), t('edges.grow')]}
            value={adjust.shift} min={-SHIFT_MAX} max={SHIFT_MAX} onChange={(shift) => change({ shift })} />
          <EdgeSlider label={t('edges.soften')} ends={[t('edges.crisp'), t('edges.soft')]}
            value={adjust.soften} min={-SOFTEN_MAX} max={SOFTEN_MAX} onChange={(soften) => change({ soften })} />
          <EdgeSlider label={t('edges.cleanup')} ends={[t('edges.off'), t('edges.strong')]}
            value={adjust.cleanup} min={0} max={CLEANUP_MAX} onChange={(cleanup) => change({ cleanup })} />
          <p className="edges-note">{t('edges.note')}</p>
        </div>
      )}
    </div>
  );
}
