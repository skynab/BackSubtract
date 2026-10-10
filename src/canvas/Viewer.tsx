import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewSwitch } from '../app/ViewSwitch';
import { editor } from '../editor/editor';
import { unionRect, type Rect } from '../mask/mask';
import { selectMode, useUI } from '../state/store';
import { coreFraction } from '../tools/brush/brush';
import { pick } from '../tools/color/pick';
import { clearPreview, onPreview, previewAt, type Preview } from '../tools/color/preview';
import { applyLasso } from '../tools/lasso/lasso';
import { MagneticTrace, type Pixel } from '../tools/lasso/livewire';
import { applyShape } from '../tools/shape/apply';
import { dragBox } from '../tools/shape/shape';
import { selectAt, selectLoop } from '../tools/select/select';
import { cssColor, Renderer } from './renderer';
import { clamp, fitView, MAX_SCALE, minScale, toImage, zoomAt, type Point, type View } from './view';

/** How visible removed areas are while in Keep mode, so users can see what they can bring back. */
const GHOST = 0.15;
/** How visible removed areas are in the Overlay view. */
const OVERLAY = 0.5;
const HOLD_MS = 450;
/** Tints for a previewed tap: what it would remove, and what it would bring back. */
const REMOVE_TINT: [number, number, number] = [1, 0.2, 0.2];
const KEEP_TINT: [number, number, number] = [0.2, 0.85, 0.4];
const DRAG_SLOP = 6;
/** Lasso: how far from the pointer it looks for an edge, and how long a segment gets before it is fixed (screen px). */
const LASSO_WIDTH = 10;
const LASSO_SPACING = 30;

type Gesture =
  | { kind: 'none' }
  | { kind: 'stroke'; id: number }
  | { kind: 'pan'; id: number; last: Point }
  | { kind: 'hold'; id: number; start: Point; timer: number }
  | { kind: 'lasso'; id: number; points: Point[] }
  | { kind: 'shape'; id: number; start: Point; end: Point; square: boolean }
  /** Lasso: `pending` is the latest pointer position, followed once per frame since path finding takes a few ms. */
  | { kind: 'trace'; id: number; trace: MagneticTrace; pending: Point | null }
  | { kind: 'pinch'; startDist: number; startMid: Point; startView: View };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function Viewer() {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);
  const lassoRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const cursor = cursorRef.current!;
    const coreRing = coreRef.current!;
    const badge = badgeRef.current!;
    const lasso = lassoRef.current!;

    let renderer: Renderer;
    try {
      renderer = new Renderer(canvas);
    } catch {
      useUI.getState().showNotice({ key: 'errors.webgl', tone: 'error' });
      return;
    }

    let view: View = { scale: 1, x: 0, y: 0 };
    let size = { w: 0, h: 0, dpr: 1 };
    let userMoved = false;
    let comparing = false;
    let spaceDown = false;
    let pendingMask: Rect | null = null;
    let preview: Preview | null = null;
    let frame = 0;
    let gesture: Gesture = { kind: 'none' };
    const pointers = new Map<number, Point>();

    const dark = matchMedia('(prefers-color-scheme: dark)');
    let colors = readColors();
    function readColors() {
      return {
        background: cssColor('--canvas-bg', [0.93, 0.93, 0.94]),
        checkerA: cssColor('--checker-a', [1, 1, 1]),
        checkerB: cssColor('--checker-b', [0.85, 0.85, 0.87]),
      };
    }

    function requestRender() {
      if (!frame) frame = requestAnimationFrame(draw);
    }

    function draw() {
      frame = 0;
      if (pendingMask && editor.mask) renderer.updateMask(editor.mask, pendingMask);
      pendingMask = null;
      const ui = useUI.getState();
      const ghost = ui.viewMode === 'overlay' ? OVERLAY : selectMode(ui) === 'keep' ? GHOST : 0;
      const original = comparing || ui.viewMode === 'original' ? 1 : 0;
      if (gesture.kind === 'trace') followTrace(gesture);
      const shownPreview =
        preview && !comparing ? { mode: preview.mode, tint: preview.mode === 'keep' ? KEEP_TINT : REMOVE_TINT } : null;
      renderer.render({ view, width: size.w, height: size.h, dpr: size.dpr, ghost, original, preview: shownPreview, ...colors });
    }

    function fit() {
      if (!editor.image || !size.w) return;
      view = fitView(editor.image.width, editor.image.height, size.w, size.h);
      userMoved = false;
      requestRender();
    }

    function loadImage() {
      if (!editor.image || !editor.mask) return;
      renderer.setImage(editor.image, editor.mask);
      pendingMask = null;
      fit();
    }

    function setView(next: View) {
      if (!editor.image) return;
      const min = minScale(editor.image.width, editor.image.height, size.w, size.h);
      const scale = clamp(next.scale, min, MAX_SCALE);
      view = scale === next.scale ? next : zoomAt(view, { x: size.w / 2, y: size.h / 2 }, scale);
      userMoved = true;
      requestRender();
    }

    function setComparing(on: boolean) {
      if (comparing === on) return;
      comparing = on;
      badge.hidden = !on;
      requestRender();
    }

    const local = (e: { clientX: number; clientY: number }): Point => {
      const r = canvas.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };

    /** Where the pointer last hovered, so the cursor can follow brush changes made from the keyboard. */
    let hover: { e: PointerEvent; p: Point } | null = null;

    function updateCursor(e: PointerEvent | null, p?: Point) {
      hover = e && p ? { e, p } : hover;
      const ui = useUI.getState();
      const brush = ui.tool === 'brush' && !spaceDown;
      const tapTool = ui.tool !== 'auto';
      canvas.style.cursor =
        spaceDown || gesture.kind === 'pan' ? 'grab' : brush ? 'none' : tapTool ? 'crosshair' : 'default';
      const showRing = brush && p && e && e.pointerType !== 'touch';
      cursor.hidden = !showRing;
      if (showRing) {
        const d = ui.brushSize;
        cursor.style.width = cursor.style.height = `${d}px`;
        cursor.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`;
        // The inner ring marks where the brush starts to fade; it is hidden when there is hardly any fade.
        const core = coreFraction(d / 2 / view.scale, ui.brushHardness / 100) * d;
        coreRing.style.width = coreRing.style.height = `${core}px`;
        coreRing.hidden = core > d - 4;
      }
    }

    function drawLasso(points: Point[] | null) {
      lasso.setAttribute('d', points?.length ? `M${points.map((p) => `${p.x},${p.y}`).join('L')}Z` : '');
    }

    /** Lasso sizes, in image px, at the current zoom; capped so path finding stays quick when zoomed far out. */
    const lassoRadius = () => clamp(LASSO_WIDTH / view.scale, 1, 40);
    const lassoSpacing = () => clamp(LASSO_SPACING / view.scale, 6, 150);

    const imagePixel = (p: Point): Pixel => {
      const ip = toImage(view, p);
      const { width, height } = editor.image!;
      return { x: clamp(Math.round(ip.x), 0, width - 1), y: clamp(Math.round(ip.y), 0, height - 1) };
    };

    /** Move the lasso line to the latest pointer position and redraw it (it is kept in image px, so it follows zooming). */
    function followTrace(g: Extract<Gesture, { kind: 'trace' }>) {
      if (g.pending) {
        g.trace.moveTo(imagePixel(g.pending), lassoRadius(), lassoSpacing());
        g.pending = null;
      }
      const d = g.trace.points
        .map((p, i) => `${i ? 'L' : 'M'}${((p.x + 0.5) * view.scale + view.x).toFixed(1)},${((p.y + 0.5) * view.scale + view.y).toFixed(1)}`)
        .join('');
      lasso.setAttribute('d', d);
    }

    function drawShape(g: Extract<Gesture, { kind: 'shape' }>) {
      const b = dragBox(g.start, g.end, g.square);
      if (useUI.getState().shapeKind === 'rect') {
        lasso.setAttribute('d', `M${b.x0},${b.y0}H${b.x1}V${b.y1}H${b.x0}Z`);
      } else {
        const rx = (b.x1 - b.x0) / 2, ry = (b.y1 - b.y0) / 2, cy = b.y0 + ry;
        lasso.setAttribute('d', `M${b.x0},${cy}A${rx},${ry} 0 1 0 ${b.x1},${cy}A${rx},${ry} 0 1 0 ${b.x0},${cy}Z`);
      }
    }

    function endGesture(tapped = false) {
      if (gesture.kind === 'stroke') editor.endStroke();
      if (gesture.kind === 'hold') {
        clearTimeout(gesture.timer);
        // A quick press without moving is a tap; a long one only showed the original.
        if (tapped && !comparing) {
          const tool = useUI.getState().tool;
          const ip = toImage(view, gesture.start);
          if (tool === 'wand' || tool === 'color') void pick(tool, ip.x, ip.y);
          else if (tool === 'select') void selectAt(ip.x, ip.y);
        }
        setComparing(false);
      }
      if (gesture.kind === 'lasso') {
        if (tapped && gesture.points.length >= 3) void selectLoop(gesture.points.map((p) => toImage(view, p)));
        drawLasso(null);
      }
      if (gesture.kind === 'trace') {
        if (tapped) {
          followTrace(gesture);
          const outline = gesture.trace.close(lassoRadius());
          if (outline.length >= 3) applyLasso(outline);
        }
        drawLasso(null);
      }
      if (gesture.kind === 'shape') {
        const { start, end, square } = gesture;
        // A tap without dragging draws nothing.
        if (tapped && Math.hypot(end.x - start.x, end.y - start.y) > DRAG_SLOP) {
          applyShape(toImage(view, start), toImage(view, end), square);
        }
        drawLasso(null);
      }
      gesture = { kind: 'none' };
    }

    function onPointerDown(e: PointerEvent) {
      if (!editor.image || (e.button !== 0 && e.button !== 1)) return;
      // Keep the preview through a tap (it is cleared once the tap applies), but not through a pan or pinch.
      if (e.button !== 0 || spaceDown || pointers.size > 0) clearPreview();
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        // The pointer may already be gone (e.g. released mid-event); the gesture still works without capture.
      }
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 2) {
        // A second finger turns whatever the first one started into a pinch.
        if (gesture.kind === 'stroke') editor.cancelStroke();
        if (gesture.kind === 'hold') clearTimeout(gesture.timer);
        drawLasso(null);
        setComparing(false);
        const [a, b] = [...pointers.values()];
        gesture = {
          kind: 'pinch',
          startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          startView: view,
        };
        return;
      }
      if (pointers.size > 2) return;

      const ui = useUI.getState();
      if (e.button === 1 || spaceDown) {
        gesture = { kind: 'pan', id: e.pointerId, last: p };
      } else if (ui.tool === 'brush') {
        const ip = toImage(view, p);
        editor.beginStroke(ip.x, ip.y, ui.brushSize / 2 / view.scale, ui.modes.brush, ui.brushHardness / 100);
        gesture = { kind: 'stroke', id: e.pointerId };
      } else if (ui.tool === 'lasso') {
        const { width, height } = editor.image;
        const trace = new MagneticTrace(editor.pixels, width, height, imagePixel(p), lassoRadius());
        gesture = { kind: 'trace', id: e.pointerId, trace, pending: null };
      } else if (ui.tool === 'shape') {
        gesture = { kind: 'shape', id: e.pointerId, start: p, end: p, square: e.shiftKey };
      } else {
        // Tap tools: a tap acts, dragging pans, press-and-hold shows the original.
        gesture = {
          kind: 'hold',
          id: e.pointerId,
          start: p,
          timer: window.setTimeout(() => setComparing(true), HOLD_MS),
        };
      }
      updateCursor(e, p);
    }

    function onPointerMove(e: PointerEvent) {
      const p = local(e);
      updateCursor(e, p);
      // With a mouse or pen hovering, show what a tap here would do.
      const tool = useUI.getState().tool;
      if ((tool === 'wand' || tool === 'color') && e.pointerType !== 'touch' && gesture.kind === 'none' && !spaceDown) {
        const ip = toImage(view, p);
        previewAt(tool, ip.x, ip.y);
      }
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, p);

      switch (gesture.kind) {
        case 'stroke':
          if (gesture.id !== e.pointerId) return;
          for (const ce of e.getCoalescedEvents?.() ?? [e]) {
            const ip = toImage(view, local(ce));
            editor.continueStroke(ip.x, ip.y);
          }
          return;
        case 'pan':
          if (gesture.id !== e.pointerId) return;
          setView({ ...view, x: view.x + p.x - gesture.last.x, y: view.y + p.y - gesture.last.y });
          gesture.last = p;
          return;
        case 'hold':
          if (gesture.id !== e.pointerId || comparing) return;
          if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) > DRAG_SLOP) {
            clearTimeout(gesture.timer);
            clearPreview();
            // With Select, dragging draws a loop around an object; with other tools it pans.
            gesture =
              useUI.getState().tool === 'select'
                ? { kind: 'lasso', id: e.pointerId, points: [gesture.start, p] }
                : { kind: 'pan', id: e.pointerId, last: p };
          }
          return;
        case 'lasso': {
          if (gesture.id !== e.pointerId) return;
          const last = gesture.points[gesture.points.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= 3) {
            gesture.points.push(p);
            drawLasso(gesture.points);
          }
          return;
        }
        case 'trace':
          if (gesture.id !== e.pointerId) return;
          gesture.pending = p;
          requestRender();
          return;
        case 'shape':
          if (gesture.id !== e.pointerId) return;
          gesture.end = p;
          gesture.square = e.shiftKey;
          drawShape(gesture);
          return;
        case 'pinch': {
          if (pointers.size < 2) return;
          const [a, b] = [...pointers.values()];
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
          const s = gesture.startView;
          const scale = clamp(
            (s.scale * dist) / gesture.startDist,
            minScale(editor.image!.width, editor.image!.height, size.w, size.h),
            MAX_SCALE,
          );
          const ix = (gesture.startMid.x - s.x) / s.scale;
          const iy = (gesture.startMid.y - s.y) / s.scale;
          view = { scale, x: mid.x - ix * scale, y: mid.y - iy * scale };
          userMoved = true;
          requestRender();
          return;
        }
      }
    }

    function onPointerUp(e: PointerEvent) {
      if (!pointers.delete(e.pointerId)) return;
      if (gesture.kind === 'pinch') {
        // Wait until every finger is lifted before starting anything new.
        if (pointers.size === 0) gesture = { kind: 'none' };
        return;
      }
      if ('id' in gesture && gesture.id === e.pointerId) endGesture(e.type === 'pointerup');
      updateCursor(e, local(e));
    }

    function onWheel(e: WheelEvent) {
      if (!editor.image) return;
      e.preventDefault();
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? size.h : 1;
      const factor = Math.exp(-e.deltaY * unit * (e.ctrlKey ? 0.01 : 0.002));
      const min = minScale(editor.image.width, editor.image.height, size.w, size.h);
      view = zoomAt(view, local(e), clamp(view.scale * factor, min, MAX_SCALE));
      userMoved = true;
      requestRender();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' && (gesture.kind === 'trace' || gesture.kind === 'lasso' || gesture.kind === 'shape')) {
        // Throw away the line or shape being drawn.
        endGesture();
      } else if (e.key === ' ') {
        if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
        spaceDown = true;
        updateCursor(null);
      } else if (e.key === 'c' || e.key === 'C') {
        setComparing(true);
      } else if (e.key === '0') {
        fit();
      } else if ((e.key === 'v' || e.key === 'V') && !e.repeat) {
        useUI.getState().cycleViewMode();
      }
    }

    function onKeyUp(e: KeyboardEvent) {
      if (e.key === ' ') {
        spaceDown = false;
        updateCursor(null);
      } else if (e.key === 'c' || e.key === 'C') {
        setComparing(false);
      }
    }

    const resizeObserver = new ResizeObserver(() => {
      const r = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = size.w === 0;
      size = { w: r.width, h: r.height, dpr };
      canvas.width = Math.max(1, Math.round(r.width * dpr));
      canvas.height = Math.max(1, Math.round(r.height * dpr));
      if (first || !userMoved) fit();
      requestRender();
    });
    resizeObserver.observe(wrap);

    const onTheme = () => {
      colors = readColors();
      requestRender();
    };
    dark.addEventListener('change', onTheme);

    const stopEditor = editor.subscribe((event) => {
      if (event.type === 'image') loadImage();
      if (event.type === 'mask') {
        pendingMask = unionRect(pendingMask, event.rect);
        requestRender();
      }
    });
    const stopUI = useUI.subscribe((s, prev) => {
      requestRender();
      if (hover && !cursor.hidden && (s.brushSize !== prev.brushSize || s.brushHardness !== prev.brushHardness)) {
        updateCursor(hover.e, hover.p);
      }
    });
    const stopPreview = onPreview((next) => {
      preview = next;
      if (next && editor.image) renderer.setPreview(next.selection.data, editor.image.width, editor.image.height);
      requestRender();
    });
    const onLeave = () => {
      cursor.hidden = true;
      hover = null;
      if (gesture.kind === 'none') clearPreview();
    };
    const onBlur = () => {
      spaceDown = false;
      setComparing(false);
    };

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('pointerleave', onLeave);
    canvas.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', onBlur);

    loadImage();

    return () => {
      endGesture();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      dark.removeEventListener('change', onTheme);
      stopEditor();
      stopUI();
      stopPreview();
      clearPreview();
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('pointerleave', onLeave);
      canvas.removeEventListener('wheel', onWheel);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', onBlur);
      renderer.dispose();
    };
  }, []);

  return (
    <div className="viewer" ref={wrapRef}>
      <canvas ref={canvasRef} role="img" aria-label={t('viewer.label')} />
      <div className="brush-cursor" ref={cursorRef} hidden>
        <div className="brush-core" ref={coreRef} />
      </div>
      <svg className="lasso" aria-hidden="true">
        <path ref={lassoRef} />
      </svg>
      <ViewSwitch />
      <div className="badge" ref={badgeRef} hidden>
        {t('viewer.original')}
      </div>
    </div>
  );
}
