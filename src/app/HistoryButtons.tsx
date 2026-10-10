import { useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import type { StepLabel } from '../mask/history';
import { useUI } from '../state/store';
import { RedoIcon, UndoIcon } from './icons';

/** How long Undo or Redo must be held to open the history list. */
const HOLD_MS = 450;

function HoldButton({ label, title, disabled, onClick, onHold, children }: {
  label: string;
  title: string;
  disabled: boolean;
  onClick: () => void;
  onHold: () => void;
  children: ReactNode;
}) {
  const timer = useRef(0);
  const held = useRef(false);
  const cancel = () => clearTimeout(timer.current);
  useEffect(() => cancel, []);

  return (
    <button
      type="button"
      className="icon"
      title={title}
      aria-label={label}
      disabled={disabled}
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        held.current = false;
        cancel();
        timer.current = window.setTimeout(() => {
          held.current = true;
          onHold();
        }, HOLD_MS);
      }}
      onPointerUp={cancel}
      onPointerLeave={cancel}
      onPointerCancel={cancel}
      // Right-click, the menu key and a phone's long-press all open the list too.
      onContextMenu={(e) => {
        e.preventDefault();
        cancel();
        held.current = true;
        onHold();
      }}
      onClick={() => {
        // The press that opened the list shouldn't also undo a step.
        if (held.current) held.current = false;
        else onClick();
      }}
    >
      {children}
    </button>
  );
}

/** Undo and Redo. Holding either one lists every step, so you can jump straight to any of them. */
export function HistoryButtons() {
  const { t } = useTranslation();
  const canUndo = useUI((s) => s.canUndo);
  const canRedo = useUI((s) => s.canRedo);
  const [open, setOpen] = useState(false);
  const [, refresh] = useReducer((n: number) => n + 1, 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const currentRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const stopEditor = editor.subscribe((event) => {
      if (event.type === 'history') refresh();
      if (event.type === 'image') setOpen(false);
    });
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      stopEditor();
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Start with the current step in view and focused, so arrow keys and Enter work from there.
  useEffect(() => {
    if (!open) return;
    currentRef.current?.scrollIntoView({ block: 'center' });
    currentRef.current?.focus({ preventScroll: true });
  }, [open]);

  const describe = (label?: StepLabel) => {
    if (!label) return t('history.edit');
    const tool = t(`tools.${label.tool}`);
    return label.mode ? t('history.step', { tool, mode: t(`mode.${label.mode}`) }) : tool;
  };

  const steps = open ? editor.history.steps : [];
  const position = editor.history.position;
  const rows = [{ text: t('history.start'), mode: undefined }, ...steps.map((s) => ({ text: describe(s.label), mode: s.label?.mode }))];

  return (
    <div className="history" ref={rootRef}>
      <HoldButton
        label={t('actions.undo')}
        title={`${t('actions.undo')} (${t('history.hint')})`}
        disabled={!canUndo}
        onClick={() => editor.undo()}
        onHold={() => setOpen(true)}
      >
        <UndoIcon className="flip-rtl" />
      </HoldButton>
      <HoldButton
        label={t('actions.redo')}
        title={`${t('actions.redo')} (${t('history.hint')})`}
        disabled={!canRedo}
        onClick={() => editor.redo()}
        onHold={() => setOpen(true)}
      >
        <RedoIcon className="flip-rtl" />
      </HoldButton>

      {open && (
        <div className="menu history-menu" role="dialog" aria-label={t('history.title')}>
          <ol>
            {rows.map((row, i) => (
              <li key={i}>
                <button
                  type="button"
                  ref={i === position ? currentRef : undefined}
                  className={i > position ? 'undone' : undefined}
                  aria-current={i === position ? 'step' : undefined}
                  onClick={() => editor.goTo(i)}
                  onKeyDown={(e) => {
                    const next = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
                    if (!next) return;
                    e.preventDefault();
                    const items = rootRef.current?.querySelectorAll<HTMLButtonElement>('.history-menu button');
                    items?.[Math.max(0, Math.min(rows.length - 1, i + next))]?.focus();
                  }}
                >
                  <span className={`step-mark ${row.mode ?? ''}`} aria-hidden="true" />
                  {row.text}
                </button>
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}
