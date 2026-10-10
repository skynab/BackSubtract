import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { ExportFormat } from '../export/exportImage';
import type { Mode } from '../mask/mask';
import type { ModelInfo } from '../ml/protocol';
import type { ShapeKind } from '../tools/shape/shape';

export type ToolId = 'auto' | 'select' | 'wand' | 'color' | 'brush' | 'shape';

export const AVAILABLE_TOOLS: readonly ToolId[] = ['auto', 'select', 'wand', 'color', 'brush', 'shape'];

/** Each tool starts in the mode it is most often used for. */
const DEFAULT_MODES: Record<ToolId, Mode> = {
  auto: 'keep',
  select: 'keep',
  wand: 'remove',
  color: 'remove',
  brush: 'remove',
  shape: 'remove',
};

/**
 * How the image is shown: the result, the result with removed areas half visible
 * (to spot and paint back what was missed), or the untouched original.
 */
export type ViewMode = 'result' | 'overlay' | 'original';

export const VIEW_MODES: readonly ViewMode[] = ['result', 'overlay', 'original'];

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 300;
/** Colour tolerance range, in ΔE. */
export const TOLERANCE_MIN = 1;
export const TOLERANCE_MAX = 100;

/** Something slow in progress, shown above the image. */
export interface Task {
  key: string;
  params?: Record<string, unknown>;
  /** 0–1 when known, e.g. a model download. */
  progress?: number;
}

export interface Notice {
  key: string;
  params?: Record<string, unknown>;
  tone: 'info' | 'error';
}

interface UIState {
  hasImage: boolean;
  tool: ToolId;
  modes: Record<ToolId, Mode>;
  /** Brush diameter in screen pixels, so it feels the same at any zoom. */
  brushSize: number;
  /** What the Shape tool draws. */
  shapeKind: ShapeKind;
  tolerances: { wand: number; color: number };
  exportFormat: ExportFormat;
  jpgBackground: string;
  trim: boolean;
  canUndo: boolean;
  canRedo: boolean;
  viewMode: ViewMode;
  dragging: boolean;
  notice: Notice | null;
  task: Task | null;
  /** Download size and status of each AI model, once known. */
  models: { auto?: ModelInfo; select?: ModelInfo };
  /** Whether Auto has already run on the current image. */
  autoRan: boolean;
  dialog: 'donate' | 'about' | null;
  setTool: (tool: ToolId) => void;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  setBrushSize: (size: number) => void;
  /** Step to the next view mode. */
  cycleViewMode: () => void;
  setTolerance: (tool: 'wand' | 'color', value: number) => void;
  showNotice: (notice: Notice) => void;
  clearNotice: () => void;
}

const clamp = (v: number, lo: number, hi: number) => Math.round(Math.min(hi, Math.max(lo, v)));

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      hasImage: false,
      tool: 'auto',
      modes: { ...DEFAULT_MODES },
      brushSize: 40,
      shapeKind: 'rect',
      tolerances: { wand: 20, color: 15 },
      exportFormat: 'png',
      jpgBackground: '#ffffff',
      trim: false,
      canUndo: false,
      canRedo: false,
      viewMode: 'result',
      dragging: false,
      notice: null,
      task: null,
      models: {},
      autoRan: false,
      dialog: null,
      setTool: (tool) => {
        if (AVAILABLE_TOOLS.includes(tool)) set({ tool });
      },
      toggleMode: () =>
        set((s) => ({ modes: { ...s.modes, [s.tool]: s.modes[s.tool] === 'keep' ? 'remove' : 'keep' } })),
      setMode: (mode) => set((s) => ({ modes: { ...s.modes, [s.tool]: mode } })),
      cycleViewMode: () =>
        set((s) => ({ viewMode: VIEW_MODES[(VIEW_MODES.indexOf(s.viewMode) + 1) % VIEW_MODES.length] })),
      setBrushSize: (size) => set({ brushSize: clamp(size, BRUSH_MIN, BRUSH_MAX) }),
      setTolerance: (tool, value) =>
        set((s) => ({ tolerances: { ...s.tolerances, [tool]: clamp(value, TOLERANCE_MIN, TOLERANCE_MAX) } })),
      showNotice: (notice) => set({ notice }),
      clearNotice: () => set({ notice: null }),
    }),
    {
      name: 'backsubtract.settings',
      version: 1,
      // Only remember preferences, never anything about the current image.
      partialize: (s) => ({
        tool: s.tool,
        brushSize: s.brushSize,
        shapeKind: s.shapeKind,
        tolerances: s.tolerances,
        exportFormat: s.exportFormat,
        jpgBackground: s.jpgBackground,
        trim: s.trim,
      }),
      merge: (saved, current) => {
        const merged = { ...current, ...(saved as Partial<UIState>) };
        if (!AVAILABLE_TOOLS.includes(merged.tool)) merged.tool = current.tool;
        return merged;
      },
    },
  ),
);

export const selectMode = (s: UIState): Mode => s.modes[s.tool];
