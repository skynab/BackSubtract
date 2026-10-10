import { useState, type ComponentType, type SVGProps } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { downloadBlob, exportName, exportPng } from '../export/exportImage';
import { chooseImage } from '../session/openImage';
import { AVAILABLE_TOOLS, BRUSH_MAX, BRUSH_MIN, selectMode, useUI, type ToolId } from '../state/store';
import {
  AutoIcon,
  BrushIcon,
  ColorIcon,
  DownloadIcon,
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
  const available = AVAILABLE_TOOLS.includes(id);
  const label = t(`tools.${id}`);
  return (
    <button
      type="button"
      className="tool"
      aria-pressed={active}
      disabled={!available}
      title={available ? label : t('tools.comingSoon', { tool: label })}
      onClick={() => useUI.getState().setTool(id)}
    >
      <Icon />
      <span>{label}</span>
    </button>
  );
}

async function download(onError: () => void) {
  if (!editor.image || !editor.mask) return;
  try {
    const blob = await exportPng(editor.image, editor.mask);
    downloadBlob(blob, exportName(editor.fileName, 'png'));
  } catch {
    onError();
  }
}

export function BottomBar() {
  const { t } = useTranslation();
  const tool = useUI((s) => s.tool);
  const mode = useUI(selectMode);
  const brushSize = useUI((s) => s.brushSize);
  const canUndo = useUI((s) => s.canUndo);
  const canRedo = useUI((s) => s.canRedo);
  const [exporting, setExporting] = useState(false);

  const onDownload = async () => {
    setExporting(true);
    await download(() => useUI.getState().showNotice({ key: 'errors.export', tone: 'error' }));
    setExporting(false);
  };

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
        {tool === 'brush' && (
          <label className="slider">
            <span className="dot" style={{ width: 6, height: 6 }} aria-hidden="true" />
            <input
              type="range"
              min={BRUSH_MIN}
              max={BRUSH_MAX}
              value={brushSize}
              aria-label={t('brushSize')}
              onChange={(e) => useUI.getState().setBrushSize(Number(e.target.value))}
            />
            <span className="dot" style={{ width: 16, height: 16 }} aria-hidden="true" />
          </label>
        )}
      </div>

      <div className="actions">
        <button type="button" className="icon" title={t('actions.open')} aria-label={t('actions.open')} onClick={chooseImage}>
          <ImageIcon />
        </button>
        <button type="button" className="icon" title={t('actions.undo')} aria-label={t('actions.undo')} disabled={!canUndo} onClick={() => editor.undo()}>
          <UndoIcon />
        </button>
        <button type="button" className="icon" title={t('actions.redo')} aria-label={t('actions.redo')} disabled={!canRedo} onClick={() => editor.redo()}>
          <RedoIcon />
        </button>
        <button type="button" className="primary" disabled={exporting} onClick={onDownload}>
          <DownloadIcon />
          {exporting ? t('actions.exporting') : t('actions.download')}
        </button>
      </div>
    </footer>
  );
}
