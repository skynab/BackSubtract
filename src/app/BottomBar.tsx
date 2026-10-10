import { useEffect, type ComponentType, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { chooseImage } from '../session/openImage';
import {
  AI_TOOLS,
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
import { HistoryButtons } from './HistoryButtons';
import {
  AutoIcon,
  BrushIcon,
  ColorIcon,
  EllipseIcon,
  ImageIcon,
  LassoIcon,
  MinusIcon,
  PlusIcon,
  RectIcon,
  SelectIcon,
  ShapeIcon,
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
  const ai = AI_TOOLS.includes(id);
  return (
    <button
      type="button"
      className="tool"
      aria-pressed={active}
      title={ai ? `${label} · ${t('tools.aiHint')}` : label}
      onClick={() => useUI.getState().setTool(id)}
    >
      <span className="tool-icon">
        <Icon />
        {ai && (
          <span className="ai-badge" aria-hidden="true">
            {t('tools.ai')}
          </span>
        )}
      </span>
      <span>{label}</span>
    </button>
  );
}

function Slider({ value, min, max, label, onChange, soft }: {
  value: number;
  min: number;
  max: number;
  label: string;
  onChange: (value: number) => void;
  /** Show soft → hard ends instead of small → large. */
  soft?: boolean;
}) {
  return (
    <label className="slider">
      {soft ? (
        <span className="dot soft" style={{ width: 14, height: 14 }} aria-hidden="true" />
      ) : (
        <span className="dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
      )}
      <input
        type="range"
        min={min}
        max={max}
        value={value}
        aria-label={label}
        title={label}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="dot" style={soft ? { width: 14, height: 14 } : { width: 16, height: 16 }} aria-hidden="true" />
    </label>
  );
}

function ToolSlider() {
  const { t } = useTranslation();
  const tool = useUI((s) => s.tool);
  const brushSize = useUI((s) => s.brushSize);
  const brushHardness = useUI((s) => s.brushHardness);
  const tolerances = useUI((s) => s.tolerances);

  if (tool === 'brush') {
    return (
      <>
        <Slider value={brushSize} min={BRUSH_MIN} max={BRUSH_MAX} label={t('brushSize')}
          onChange={(v) => useUI.getState().setBrushSize(v)} />
        <Slider value={brushHardness} min={0} max={100} label={t('brushHardness')} soft
          onChange={(v) => useUI.getState().setBrushHardness(v)} />
      </>
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

function ShapeKindToggle() {
  const { t } = useTranslation();
  const kind = useUI((s) => s.shapeKind);
  return (
    <div className="segmented" role="group" aria-label={t('shape.label')}>
      <button type="button" aria-pressed={kind === 'rect'} onClick={() => useUI.setState({ shapeKind: 'rect' })}>
        <RectIcon width={18} height={18} />
        {t('shape.rect')}
      </button>
      <button type="button" aria-pressed={kind === 'ellipse'} onClick={() => useUI.setState({ shapeKind: 'ellipse' })}>
        <EllipseIcon width={18} height={18} />
        {t('shape.ellipse')}
      </button>
    </div>
  );
}

/** Select's hint, which mentions the one-time download until the model is on the device. */
function SelectHint() {
  const { t } = useTranslation();
  const info = useUI((s) => s.models.select);

  useEffect(() => {
    if (!info) void refreshModelInfo('select').catch(() => {});
  }, [info]);

  return (
    <span className="hint">
      {info && !info.cached ? t('select.hintDownload', { size: info.sizeMB }) : t('select.hint')}
    </span>
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
      {tool === 'shape' && <ShapeKindToggle />}
      {tool === 'select' && <SelectHint />}
      {tool === 'lasso' && <span className="hint">{t('lasso.hint')}</span>}
      {tool === 'shape' && <span className="hint">{t('shape.hint')}</span>}
    </>
  );
}

export function BottomBar() {
  const { t } = useTranslation();

  return (
    <footer className="bottombar">
      <div className="tools" role="toolbar" aria-label={t('tools.label')}>
        {TOOLS.map((tl) => (
          <ToolButton key={tl.id} {...tl} />
        ))}
        <span className="divider" aria-hidden="true" />
        <ToolButton id="lasso" Icon={LassoIcon} />
        <ToolButton id="brush" Icon={BrushIcon} />
        <ToolButton id="shape" Icon={ShapeIcon} />
      </div>

      <div className="context">
        <ContextRow />
      </div>

      <div className="actions">
        <button type="button" className="icon" title={t('actions.open')} aria-label={t('actions.open')} onClick={chooseImage}>
          <ImageIcon />
        </button>
        <HistoryButtons />
        <DownloadButton />
      </div>
    </footer>
  );
}
