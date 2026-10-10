import { useEffect, type ComponentType, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { chooseImage } from '../session/openImage';
import {
  BRUSH_MAX,
  BRUSH_MIN,
  selectMode,
  TOLERANCE_MAX,
  TOLERANCE_MIN,
  useUI,
  type ToolId,
} from '../state/store';
import { refreshModelInfo } from '../ml/status';
import { runAuto } from '../tools/auto/auto';
import { retune } from '../tools/color/pick';
import { DownloadButton } from './DownloadButton';
import {
  AutoIcon,
  BrushIcon,
  ColorIcon,
  ImageIcon,
  MinusIcon,
  PlusIcon,
  RedoIcon,
  SelectIcon,
  UndoIcon,
  WandIcon,
} from './icons';

const TOOLS: { id: ToolId; Icon: ComponentType<SVGProps<SVGSVGElement>> }[] = [
  { id: 'auto', Icon: AutoIcon },
  { id: 'select', Icon: SelectIcon },
  { id: 'wand', Icon: WandIcon },
  { id: 'color', Icon: ColorIcon },
];

function ToolButton({ id, Icon }: { id: ToolId; Icon: ComponentType<SVGProps<SVGSVGElement>> }) {
  const { t } = useTranslation();
  const active = useUI((s) => s.tool === id);
  const label = t(`tools.${id}`);
  return (
    <button
      type="button"
      className="tool"
      aria-pressed={active}
      title={label}
      onClick={() => useUI.getState().setTool(id)}
    >
      <Icon />
      <span>{label}</span>
    </button>
  );
}

function Slider({ value, min, max, label, onChange }: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="slider">
      <span className="dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        title={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="dot" style={{ width: 16, height: 16 }} aria-hidden="true" />
    </label>
  );
}

function ToolSlider() {
  const { t } = useTranslation();
  const tool = useUI((s) => s.tool);
  const brushSize = useUI((s) => s.brushSize);
  const tolerances = useUI((s) => s.tolerances);

  if (tool === 'brush') {
    return (
      <Slider value={brushSize} min={BRUSH_MIN} max={BRUSH_MAX} label={t('brushSize')}
        onChange={(v) => useUI.getState().setBrushSize(v)} />
    );
  }
  if (tool === 'wand' || tool === 'color') {
    return (
      <Slider value={tolerances[tool]} min={TOLERANCE_MIN} max={TOLERANCE_MAX} label={t('tolerance')}
        onChange={(v) => {
          useUI.getState().setTolerance(tool, v);
          retune(tool);
        }} />
    );
  }
  return null;
}

function AutoButton() {
  const { t } = useTranslation();
  const info = useUI((s) => s.models.auto);
  const ran = useUI((s) => s.autoRan);
  const busy = useUI((s) => s.task !== null);

  useEffect(() => {
    if (!info) void refreshModelInfo('auto').catch(() => {});
  }, [info]);

  const label = ran
    ? t('auto.again')
    : info && !info.cached
      ? t('auto.download', { size: info.sizeMB })
      : t('auto.run');
  return (
    <button type="button" className="secondary" disabled={busy} onClick={() => void runAuto()}>
      <AutoIcon width={18} height={18} />
      {label}
    </button>
  );
}

function ModeToggle() {
  const { t } = useTranslation();
  const mode = useUI(selectMode);
  return (
    <div className="segmented" role="group" aria-label={t('mode.label')}>
      <button type="button" aria-pressed={mode === 'keep'} onClick={() => useUI.getState().setMode('keep')}>
        <PlusIcon width={18} height={18} />
        {t('mode.keep')}
      </button>
      <button type="button" aria-pressed={mode === 'remove'} onClick={() => useUI.getState().setMode('remove')}>
        <MinusIcon width={18} height={18} />
        {t('mode.remove')}
      </button>
    </div>
  );
}

function ContextRow() {
  const { t } = useTranslation();
  const tool = useUI((s) => s.tool);
  if (tool === 'auto') return <AutoButton />;
  return (
    <>
      <ModeToggle />
      <ToolSlider />
      {tool === 'select' && <span className="hint">{t('select.hint')}</span>}
    </>
  );
}

export function BottomBar() {
  const { t } = useTranslation();
  const canUndo = useUI((s) => s.canUndo);
  const canRedo = useUI((s) => s.canRedo);

  return (
    <footer className="bottombar">
      <div className="tools" role="toolbar" aria-label={t('tools.label')}>
        {TOOLS.map((tl) => (
          <ToolButton key={tl.id} {...tl} />
        ))}
        <span className="divider" aria-hidden="true" />
        <ToolButton id="brush" Icon={BrushIcon} />
      </div>

      <div className="context">
        <ContextRow />
      </div>

      <div className="actions">
        <button type="button" className="icon" title={t('actions.open')} aria-label={t('actions.open')} onClick={chooseImage}>
          <ImageIcon />
        </button>
        <button type="button" className="icon" title={t('actions.undo')} aria-label={t('actions.undo')} disabled={!canUndo} onClick={() => editor.undo()}>
          <UndoIcon className="flip-rtl" />
        </button>
        <button type="button" className="icon" title={t('actions.redo')} aria-label={t('actions.redo')} disabled={!canRedo} onClick={() => editor.redo()}>
          <RedoIcon className="flip-rtl" />
        </button>
        <DownloadButton />
      </div>
    </footer>
  );
}
