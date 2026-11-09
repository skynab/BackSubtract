import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { BACKGROUND_KINDS, BLUR_DEFAULT, type Background, type BackgroundKind } from '../export/background';
import type { Aspect, ExportFormat } from '../export/exportImage';
import { DEFAULT_CONTRAST } from '../canvas/checker';
import type { Mode } from '../mask/mask';
import type { ModelInfo, ModelName } from '../ml/protocol';
import type { LassoKind } from '../tools/lasso/polygon';
import type { ShapeKind } from '../tools/shape/shape';

export type ToolId = 'auto' | 'select' | 'wand' | 'color' | 'lasso' | 'brush' | 'shape';

export const AVAILABLE_TOOLS: readonly ToolId[] = ['auto', 'select', 'wand', 'color', 'lasso', 'brush', 'shape'];

/** Tools that run an AI model (downloaded on first use). */
export const AI_TOOLS: readonly ToolId[] = ['auto', 'select'];

export const MARGIN_MAX = 30;

/** Each tool starts in the mode it is most often used for. */
const DEFAULT_MODES: Record<ToolId, Mode> = {
  auto: 'keep',
  select: 'keep',
  wand: 'remove',
  color: 'remove',
  lasso: 'keep',
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
  /** Brush hardness, 0–100: how much of the brush paints at full strength before it fades. */
  brushHardness: number;
  /** Paint (Keep / Remove) or Refine (works out hair and fur edges from the colours around them). */
  brushKind: 'paint' | 'refine';
  /** What the Shape tool draws. */
  shapeKind: ShapeKind;
  /** Magnetic (drag along an edge) or Polygon (tap corner by corner). */
  lassoKind: LassoKind;
  tolerances: { wand: number; color: number };
  exportFormat: ExportFormat;
  /** What goes behind the subject in the download (selectBackground gives what a format actually gets). */
  background: BackgroundKind;
  /** The Colour background. */
  bgColor: string;
  /** The Blur background's strength, BLUR_MIN–BLUR_MAX. */
  bgBlur: number;
  /** The Image background: a photo picked from the device, kept in IndexedDB (not in settings). */
  bgImage: Blob | null;
  /** Whether the Download menu is open: the canvas then shows the download's background and frame. */
  downloadOpen: boolean;
  trim: boolean;
  /** Space around the subject when trimming, in % of its longer side. */
  margin: number;
  aspect: Aspect;
  /** Export at the original file's size when it was scaled down on opening. */
  fullSize: boolean;
  canUndo: boolean;
  canRedo: boolean;
  viewMode: ViewMode;
  /** Transparency checkerboard: contrast 0–100 (DEFAULT_CONTRAST is the theme's own), and whether it slides. */
  checkerContrast: number;
  checkerMotion: boolean;
  dragging: boolean;
  notice: Notice | null;
  task: Task | null;
  /** Download size and status of each AI model, once known. */
  models: { auto?: ModelInfo; select?: ModelInfo };
  /** Whether Auto has already run on the current image. */
  autoRan: boolean;
  /**
   * 'replace' asks before a new image replaces one with edits (see openImage);
   * 'download' asks before an AI model's first download (see ml/status).
   */
  dialog: 'donate' | 'about' | 'replace' | 'download' | 'closeBatch' | 'shareBatch' | null;
  /** Whether the 'replace' dialog asks about several images (a new batch) rather than one. */
  replaceMany: boolean;
  /** The AI model the 'download' dialog asks about. */
  downloadModel: ModelName | null;
  setTool: (tool: ToolId) => void;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  setBrushSize: (size: number) => void;
  setBrushHardness: (hardness: number) => void;
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
      brushHardness: 60,
      brushKind: 'paint',
      shapeKind: 'rect',
      lassoKind: 'magnetic',
      tolerances: { wand: 20, color: 15 },
      exportFormat: 'png',
      background: 'none',
      bgColor: '#ffffff',
      bgBlur: BLUR_DEFAULT,
      bgImage: null,
      downloadOpen: false,
      trim: false,
      margin: 0,
      aspect: 'free',
      fullSize: true,
      canUndo: false,
      canRedo: false,
      viewMode: 'result',
      checkerContrast: DEFAULT_CONTRAST,
      checkerMotion: false,
      dragging: false,
      notice: null,
      task: null,
      models: {},
      autoRan: false,
      dialog: null,
      replaceMany: false,
      downloadModel: null,
      setTool: (tool) => {
        if (AVAILABLE_TOOLS.includes(tool)) set({ tool });
      },
      toggleMode: () =>
        set((s) => ({ modes: { ...s.modes, [s.tool]: s.modes[s.tool] === 'keep' ? 'remove' : 'keep' } })),
      setMode: (mode) => set((s) => ({ modes: { ...s.modes, [s.tool]: mode } })),
      cycleViewMode: () =>
        set((s) => ({ viewMode: VIEW_MODES[(VIEW_MODES.indexOf(s.viewMode) + 1) % VIEW_MODES.length] })),
      setBrushSize: (size) => set({ brushSize: clamp(size, BRUSH_MIN, BRUSH_MAX) }),
      setBrushHardness: (hardness) => set({ brushHardness: clamp(hardness, 0, 100) }),
      setTolerance: (tool, value) =>
        set((s) => ({ tolerances: { ...s.tolerances, [tool]: clamp(value, TOLERANCE_MIN, TOLERANCE_MAX) } })),
      showNotice: (notice) => set({ notice }),
      clearNotice: () => set({ notice: null }),
    }),
    {
      name: 'backsubtract.settings',
      version: 2,
      // Version 1 had a background colour for JPG only.
      migrate: (saved, version) => {
        const s = (saved ?? {}) as Record<string, unknown>;
        if (version < 2) {
          if (typeof s.jpgBackground === 'string') s.bgColor = s.jpgBackground;
          s.background = s.exportFormat === 'jpg' ? 'color' : 'none';
          delete s.jpgBackground;
        }
        // Anything still missing is filled in by merge, from the defaults.
        return s as unknown as UIState;
      },
      // Only remember preferences, never anything about the current image.
      partialize: (s) => ({
        tool: s.tool,
        brushSize: s.brushSize,
        brushHardness: s.brushHardness,
        brushKind: s.brushKind,
        shapeKind: s.shapeKind,
        lassoKind: s.lassoKind,
        tolerances: s.tolerances,
        exportFormat: s.exportFormat,
        background: s.background,
        bgColor: s.bgColor,
        bgBlur: s.bgBlur,
        trim: s.trim,
        margin: s.margin,
        aspect: s.aspect,
        fullSize: s.fullSize,
        checkerContrast: s.checkerContrast,
        checkerMotion: s.checkerMotion,
      }),
      merge: (saved, current) => {
        const merged = { ...current, ...(saved as Partial<UIState>) };
        if (!AVAILABLE_TOOLS.includes(merged.tool)) merged.tool = current.tool;
        if (!BACKGROUND_KINDS.includes(merged.background)) merged.background = current.background;
        return merged;
      },
    },
  ),
);

export const selectMode = (s: UIState): Mode => s.modes[s.tool];

/**
 * The background the download gets: Mask has none, JPG can't be transparent (so it
 * gets the colour), and Image without a picked photo is no background.
 */
export function selectBackground(
  s: Pick<UIState, 'exportFormat' | 'background' | 'bgColor' | 'bgBlur' | 'bgImage'>,
): Background {
  if (s.exportFormat === 'mask') return { kind: 'none' };
  let kind = s.background;
  if (kind === 'image' && !s.bgImage) kind = 'none';
  if (kind === 'none' && s.exportFormat === 'jpg') kind = 'color';
  switch (kind) {
    case 'color':
      return { kind, color: s.bgColor };
    case 'blur':
      return { kind, strength: s.bgBlur };
    case 'image':
      return { kind, image: s.bgImage! };
    default:
      return { kind: 'none' };
  }
}
