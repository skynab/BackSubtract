import { create } from 'zustand';
import type { Mode } from '../mask/mask';

export type ToolId = 'auto' | 'select' | 'wand' | 'color' | 'brush';

/** Tools that are built so far; the rest show as "coming soon". */
export const AVAILABLE_TOOLS: readonly ToolId[] = ['brush'];

/** Each tool starts in the mode it is most often used for. */
const DEFAULT_MODES: Record<ToolId, Mode> = {
  auto: 'keep',
  select: 'keep',
  wand: 'remove',
  color: 'remove',
  brush: 'remove',
};

export const BRUSH_MIN = 4;
export const BRUSH_MAX = 300;

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
  canUndo: boolean;
  canRedo: boolean;
  dragging: boolean;
  notice: Notice | null;
  setTool: (tool: ToolId) => void;
  toggleMode: () => void;
  setMode: (mode: Mode) => void;
  setBrushSize: (size: number) => void;
  showNotice: (notice: Notice) => void;
  clearNotice: () => void;
}

export const useUI = create<UIState>()((set) => ({
  hasImage: false,
  tool: 'brush',
  modes: { ...DEFAULT_MODES },
  brushSize: 40,
  canUndo: false,
  canRedo: false,
  dragging: false,
  notice: null,
  setTool: (tool) => {
    if (AVAILABLE_TOOLS.includes(tool)) set({ tool });
  },
  toggleMode: () =>
    set((s) => ({ modes: { ...s.modes, [s.tool]: s.modes[s.tool] === 'keep' ? 'remove' : 'keep' } })),
  setMode: (mode) => set((s) => ({ modes: { ...s.modes, [s.tool]: mode } })),
  setBrushSize: (size) =>
    set({ brushSize: Math.round(Math.min(BRUSH_MAX, Math.max(BRUSH_MIN, size))) }),
  showNotice: (notice) => set({ notice }),
  clearNotice: () => set({ notice: null }),
}));

export const selectMode = (s: UIState): Mode => s.modes[s.tool];
