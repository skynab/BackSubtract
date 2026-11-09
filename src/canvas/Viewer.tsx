import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewSwitch } from '../app/ViewSwitch';
import { editor } from '../editor/editor';
import { unionRect, type Rect } from '../mask/mask';
import { selectMode, useUI } from '../state/store';
import { coreFraction } from '../tools/brush/brush';
import { pick } from '../tools/color/pick';
import { clearPreview, onPreview, previewAt, type Preview } from '../tools/color/preview';
import { applyLasso, throughCentres } from '../tools/lasso/lasso';
import { MagneticTrace, type Pixel } from '../tools/lasso/livewire';
import { PolygonTrace } from '../tools/lasso/polygon';
import { applyShape } from '../tools/shape/apply';
import { dragBox } from '../tools/shape/shape';
import { selectAt, selectLoop } from '../tools/select/select';
import { onBackdrop, type Backdrop } from './backdrop';
import { CHECKER_SPEED, checkerColors } from './checker';
import { LOUPE_DELAY_MS, LOUPE_SIZE, LOUPE_ZOOM, loupeTransform, loupeView, placeLoupe } from './loupe';
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
/** Polygon lasso: how near the first corner a tap closes the outline (screen px). */
const CORNER_REACH = 10;

type Gesture =
  | { kind: 'none' }
  /**
   * `trail` (screen points) is drawn for refine strokes, which change nothing until they end.
   * `last` is the stroke's latest point in image px, where a Shift+click line will start from.
   */
  | { kind: 'stroke'; id: number; trail: Point[] | null; last: Point }
  | { kind: 'pan'; id: number; last: Point }
  | { kind: 'hold'; id: number; start: Point; timer: number }
  | { kind: 'lasso'; id: number; points: Point[] }
  | { kind: 'shape'; id: number; start: Point; end: Point; square: boolean }
  /** Lasso: `pending` is the latest pointer position, followed once per frame since path finding takes a few ms. */
  | { kind: 'trace'; id: number; trace: MagneticTrace; pending: Point | null }
  /** Polygon lasso: a press that adds a corner where it is let go, so dragging first fine-tunes where. */
  | { kind: 'corner'; id: number; at: Point }
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
  const trailRef = useRef<SVGPathElement>(null);
  const lineRef = useRef<SVGPathElement>(null);
  const startRef = useRef<SVGCircleElement>(null);
  const overlayRef = useRef<SVGGElement>(null);
  const holeRef = useRef<SVGCircleElement>(null);
  const loupeRef = useRef<SVGSVGElement>(null);
  const loupeClipRef = useRef<SVGCircleElement>(null);
  const loupeRimRef = useRef<SVGCircleElement>(null);
  const loupeLinesRef = useRef<SVGGElement>(null);
  const lassoCopyRef = useRef<SVGPathElement>(null);
  const trailCopyRef = useRef<SVGPathElement>(null);
  const startCopyRef = useRef<SVGCircleElement>(null);
  const ringRef = useRef<SVGCircleElement>(null);
  const crossRef = useRef<SVGPathElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const cursor = cursorRef.current!;
    const coreRing = coreRef.current!;
    const badge = badgeRef.current!;
    const lasso = lassoRef.current!;
    const trail = trailRef.current!;
    const linePreview = lineRef.current!;
    const startMark = startRef.current!;
    const overlay = overlayRef.current!;
    const hole = holeRef.current!;
    const loupeSvg = loupeRef.current!;
    const loupeClip = loupeClipRef.current!;
    const loupeRim = loupeRimRef.current!;
    const loupeLines = loupeLinesRef.current!;
    const lassoCopy = lassoCopyRef.current!;
    const trailCopy = trailCopyRef.current!;
    const startCopy = startCopyRef.current!;
    const ring = ringRef.current!;
    const cross = crossRef.current!;

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
    let shiftDown = false;
    /** Where the last brush stroke ended (image px): Shift+click paints a straight line from here. */
    let lastBrush: Point | null = null;
    /** Polygon lasso: the outline being drawn. It lasts across taps, zooming and panning, until it is closed or thrown away. */
    let polygon: PolygonTrace | null = null;
    let pendingMask: Rect | null = null;
    let preview: Preview | null = null;
    /** While the Download menu is open: the download's background and frame. */
    let backdrop: Backdrop | null = null;
    let backdropUploaded = 0;
    /**
     * Touch: the loupe, while one finger draws. It shows (`shown`) once the finger
     * has been down a moment or has moved, so quick taps don't flash it.
     */
    let loupe: { id: number; start: Point; at: Point; shown: boolean; timer: number } | null = null;
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
      // Showing the download: the result as it will be, so no ghost and not the original (unless held to compare).
      const ghost = backdrop ? 0 : ui.viewMode === 'overlay' ? OVERLAY : selectMode(ui) === 'keep' ? GHOST : 0;
      const original = comparing || (!backdrop && ui.viewMode === 'original') ? 1 : 0;
      if (gesture.kind === 'trace') followTrace(gesture);
      drawPolygon();
      drawLinePreview();
      const shownPreview =
        preview && !comparing ? { mode: preview.mode, tint: preview.mode === 'keep' ? KEEP_TINT : REMOVE_TINT } : null;
      const [checkerA, checkerB] = checkerColors(colors.checkerA, colors.checkerB, ui.checkerContrast);
      // A sliding checkerboard makes leftover bits stand out: they stay still while it moves behind them.
      const slid = ui.checkerMotion ? (performance.now() / 1000) * CHECKER_SPEED : 0;
      const loupeAt = loupe?.shown && editor.image ? placeLoupe(loupe.at, size.w, size.h) : null;
      renderer.render({
        view, width: size.w, height: size.h, dpr: size.dpr, ghost, original, preview: shownPreview,
        background: colors.background, checkerA, checkerB, checkerOffset: [slid, slid],
        frame: backdrop?.frame,
        fill: !backdrop || backdrop.fill.kind === 'checker' ? undefined
          : backdrop.fill.kind === 'color' ? backdrop.fill
          : { kind: 'texture', rect: backdrop.fill.rect },
        loupe: loupe && loupeAt ? { centre: loupeAt, radius: LOUPE_SIZE / 2, view: loupeView(view, loupe.at, loupeAt) } : undefined,
      });
      drawLoupe(loupeAt);
      // Keep drawing while it moves (the browser pauses this in hidden tabs).
      if (ui.checkerMotion && editor.image && (!backdrop || backdrop.fill.kind === 'checker')) requestRender();
    }

    function fit() {
      if (!editor.image || !size.w) return;
      view = fitView(editor.image.width, editor.image.height, size.w, size.h);
      userMoved = false;
      requestRender();
    }

    function loadImage() {
      lastBrush = null;
      discardPolygon();
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
        coreRing.hidden = core > d - 4 || ui.brushKind === 'refine';
      }
      if (e) shiftDown = e.shiftKey;
      drawLinePreview();
      drawPolygon();
    }

    const toScreen = (ip: Point): Point => ({ x: ip.x * view.scale + view.x, y: ip.y * view.scale + view.y });

    /**
     * With a mouse or pen, holding Shift over the image with the brush shows the
     * straight line a click would paint, from where the last stroke ended.
     */
    function drawLinePreview() {
      const ui = useUI.getState();
      const show =
        shiftDown && lastBrush && hover && hover.e.pointerType !== 'touch' &&
        ui.tool === 'brush' && gesture.kind === 'none' && !spaceDown;
      if (!show) {
        linePreview.setAttribute('d', '');
        return;
      }
      const a = toScreen(lastBrush!), b = hover!.p;
      linePreview.setAttribute('d', `M${a.x},${a.y}L${b.x},${b.y}`);
    }

    function drawTrail(points: Point[] | null) {
      trail.setAttribute('d', points?.length ? `M${points.map((p) => `${p.x},${p.y}`).join('L')}` : '');
      trail.style.strokeWidth = `${useUI.getState().brushSize}px`;
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

    /**
     * The polygon lasso's outline, with a side from its last corner to the pointer
     * (pressed, or a mouse or pen hovering). The first corner is marked, and filled
     * in when a tap there would close the outline.
     */
    function drawPolygon() {
      if (!polygon) return;
      const live =
        gesture.kind === 'corner' ? gesture.at
        : hover && hover.e.pointerType !== 'touch' && gesture.kind === 'none' && !spaceDown ? hover.p
        : null;
      const target = live ? polygon.target(toImage(view, live), shiftDown, polygonReach()) : null;
      const points = target && !target.closes ? [...polygon.corners, target.point] : polygon.corners;
      const d = points.map(toScreen).map((s, i) => `${i ? 'L' : 'M'}${s.x.toFixed(1)},${s.y.toFixed(1)}`);
      lasso.setAttribute('d', d.join('') + (target?.closes ? 'Z' : ''));
      const first = polygon.corners[0];
      startMark.setAttribute('visibility', first ? 'visible' : 'hidden');
      if (first) {
        const s = toScreen(first);
        startMark.setAttribute('cx', s.x.toFixed(1));
        startMark.setAttribute('cy', s.y.toFixed(1));
        startMark.classList.toggle('ready', !!target?.closes);
      }
    }

    const polygonReach = () => CORNER_REACH / view.scale;

    function discardPolygon() {
      if (!polygon) return;
      polygon = null;
      drawLasso(null);
      startMark.setAttribute('visibility', 'hidden');
    }

    /** Apply the polygon lasso's outline (with three corners or more) and start afresh. */
    function closePolygon() {
      const corners = polygon?.canClose ? polygon.corners : null;
      discardPolygon();
      if (corners) applyLasso(corners);
    }

    function startLoupe(e: PointerEvent, p: Point, shown = false) {
      if (e.pointerType !== 'touch') return;
      stopLoupe();
      const next = { id: e.pointerId, start: p, at: p, shown, timer: 0 };
      if (!shown) {
        next.timer = window.setTimeout(() => {
          next.shown = true;
          requestRender();
        }, LOUPE_DELAY_MS);
      }
      loupe = next;
      requestRender();
    }

    function moveLoupe(e: PointerEvent, p: Point) {
      if (!loupe || loupe.id !== e.pointerId) return;
      loupe.at = p;
      if (Math.hypot(p.x - loupe.start.x, p.y - loupe.start.y) > DRAG_SLOP) loupe.shown = true;
      requestRender();
    }

    function stopLoupe() {
      if (!loupe) return;
      clearTimeout(loupe.timer);
      loupe = null;
      requestRender();
    }

    /**
     * Over the loupe: its rim, the lines drawn over the image (copied in at its zoom),
     * the brush's outline and a crosshair at the finger. The lines outside stay out of it.
     */
    function drawLoupe(centre: Point | null) {
      loupeSvg.setAttribute('visibility', centre ? 'visible' : 'hidden');
      if (!centre || !loupe) {
        overlay.removeAttribute('mask');
        return;
      }
      const cx = centre.x.toFixed(1);
      const cy = centre.y.toFixed(1);
      for (const c of [loupeClip, loupeRim, hole, ring]) {
        c.setAttribute('cx', cx);
        c.setAttribute('cy', cy);
      }
      overlay.setAttribute('mask', 'url(#loupe-hole)');
      loupeLines.setAttribute('transform', loupeTransform(loupe.at, centre));
      lassoCopy.setAttribute('d', lasso.getAttribute('d') ?? '');
      trailCopy.setAttribute('d', trail.getAttribute('d') ?? '');
      trailCopy.style.strokeWidth = trail.style.strokeWidth;
      for (const name of ['cx', 'cy']) {
        const value = startMark.getAttribute(name);
        if (value !== null) startCopy.setAttribute(name, value);
      }
      startCopy.setAttribute('visibility', startMark.getAttribute('visibility') ?? 'hidden');
      startCopy.classList.toggle('ready', startMark.classList.contains('ready'));
      const ui = useUI.getState();
      ring.setAttribute('visibility', ui.tool === 'brush' ? 'visible' : 'hidden');
      ring.setAttribute('r', String((ui.brushSize / 2) * LOUPE_ZOOM));
      const { x, y } = centre;
      cross.setAttribute('d', `M${x - 9},${y}H${x - 3}M${x + 3},${y}H${x + 9}M${x},${y - 9}V${y - 3}M${x},${y + 3}V${y + 9}`);
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
      if (gesture.kind === 'stroke') {
        editor.endStroke();
        lastBrush = gesture.last;
        drawTrail(null);
      }
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
          if (outline.length >= 3) applyLasso(throughCentres(outline));
        }
        drawLasso(null);
      }
      if (gesture.kind === 'corner' && tapped) {
        polygon ??= new PolygonTrace();
        if (polygon.tap(toImage(view, gesture.at), shiftDown, polygonReach())) closePolygon();
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
      stopLoupe();
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
        stopLoupe();
        if (gesture.kind === 'stroke') editor.cancelStroke();
        if (gesture.kind === 'stroke') lastBrush = null;
        if (gesture.kind === 'hold') clearTimeout(gesture.timer);
        drawLasso(null);
        drawTrail(null);
        setComparing(false);
        const [a, b] = [...pointers.values()];
        gesture = {
          kind: 'pinch',
          startDist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
          startMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          startView: view,
        };
        // A press that would have added a corner is dropped, but the outline stays.
        drawPolygon();
        return;
      }
      if (pointers.size > 2) return;

      const ui = useUI.getState();
      if (e.button === 1 || spaceDown) {
        gesture = { kind: 'pan', id: e.pointerId, last: p };
      } else if (ui.tool === 'brush') {
        const ip = toImage(view, p);
        const refine = ui.brushKind === 'refine';
        // A refine stroke fades over half its radius, so its edge blends into what was there.
        const hardness = refine ? 0.5 : ui.brushHardness / 100;
        // Shift+click (mouse or pen): a straight line from where the last stroke ended, as one step.
        const from = e.shiftKey && e.pointerType !== 'touch' && lastBrush ? lastBrush : null;
        const start = from ?? ip;
        editor.beginStroke(start.x, start.y, ui.brushSize / 2 / view.scale, ui.modes.brush, hardness, refine);
        if (from) editor.continueStroke(ip.x, ip.y);
        gesture = { kind: 'stroke', id: e.pointerId, trail: refine ? (from ? [toScreen(from), p] : [p]) : null, last: ip };
        if (refine) drawTrail(gesture.trail);
        linePreview.setAttribute('d', '');
      } else if (ui.tool === 'lasso' && ui.lassoKind === 'polygon') {
        gesture = { kind: 'corner', id: e.pointerId, at: p };
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
      // Drawing with a finger hides the spot it draws on, so the loupe shows it.
      if (gesture.kind === 'stroke' || gesture.kind === 'corner' || gesture.kind === 'trace' || gesture.kind === 'shape') {
        startLoupe(e, p);
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
      moveLoupe(e, p);

      switch (gesture.kind) {
        case 'stroke':
          if (gesture.id !== e.pointerId) return;
          // Some browsers (and synthetic events) give an empty list; the event itself still counts.
          const coalesced = e.getCoalescedEvents?.();
          for (const ce of coalesced?.length ? coalesced : [e]) {
            const ip = toImage(view, local(ce));
            editor.continueStroke(ip.x, ip.y);
            gesture.last = ip;
          }
          if (gesture.trail) {
            gesture.trail.push(p);
            drawTrail(gesture.trail);
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
            if (gesture.kind === 'lasso') startLoupe(e, p, true);
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
        case 'corner':
          if (gesture.id !== e.pointerId) return;
          gesture.at = p;
          drawPolygon();
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
      if (loupe?.id === e.pointerId) stopLoupe();
      if (gesture.kind === 'pinch') {
        // Wait until every finger is lifted before starting anything new.
        if (pointers.size === 0) gesture = { kind: 'none' };
        return;
      }
      if (gesture.kind === 'corner' && gesture.id === e.pointerId) gesture.at = local(e);
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
      if (e.key === 'Shift') {
        shiftDown = true;
        drawLinePreview();
        drawPolygon();
      }
      if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.key === 'Escape' && (polygon || gesture.kind === 'trace' || gesture.kind === 'lasso' || gesture.kind === 'shape')) {
        // Throw away the line, outline or shape being drawn.
        endGesture();
        discardPolygon();
      } else if (e.key === 'Enter' && polygon) {
        e.preventDefault();
        closePolygon();
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && polygon) {
        e.preventDefault();
        polygon.pop();
        if (polygon.corners.length) drawPolygon();
        else discardPolygon();
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
      if (e.key === 'Shift') {
        shiftDown = false;
        drawLinePreview();
        drawPolygon();
      }
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
      if (s.tool !== 'lasso' || s.lassoKind !== 'polygon') discardPolygon();
      requestRender();
      if (hover && !cursor.hidden && (s.brushSize !== prev.brushSize || s.brushHardness !== prev.brushHardness)) {
        updateCursor(hover.e, hover.p);
      }
    });
    const stopBackdrop = onBackdrop((next) => {
      backdrop = next;
      if (next?.fill.kind === 'texture' && next.fill.id !== backdropUploaded) {
        renderer.setBackdrop(next.fill.source);
        backdropUploaded = next.fill.id;
      }
      requestRender();
    });
    const stopPreview = onPreview((next) => {
      preview = next;
      if (next && editor.image) renderer.setPreview(next.selection.data, editor.image.width, editor.image.height);
      requestRender();
    });
    const onLeave = () => {
      cursor.hidden = true;
      hover = null;
      drawLinePreview();
      drawPolygon();
      if (gesture.kind === 'none') clearPreview();
    };
    const onBlur = () => {
      stopLoupe();
      spaceDown = false;
      shiftDown = false;
      drawLinePreview();
      drawPolygon();
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
      stopLoupe();
      discardPolygon();
      cancelAnimationFrame(frame);
      resizeObserver.disconnect();
      dark.removeEventListener('change', onTheme);
      stopEditor();
      stopUI();
      stopBackdrop();
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
        <defs>
          {/* Keeps the lines out of the loupe, which shows its own copy of them. */}
          <mask id="loupe-hole" maskUnits="userSpaceOnUse" x="-100%" y="-100%" width="300%" height="300%">
            <rect x="-100%" y="-100%" width="300%" height="300%" fill="white" />
            <circle ref={holeRef} r={LOUPE_SIZE / 2 + 1} fill="black" />
          </mask>
        </defs>
        <g ref={overlayRef}>
          <path ref={lassoRef} />
          <path ref={trailRef} className="trail" />
          <path ref={lineRef} className="line-preview" />
          <circle ref={startRef} className="start" r="5" visibility="hidden" />
        </g>
      </svg>
      <ViewSwitch />
      <div className="badge" ref={badgeRef} hidden>
        {t('viewer.original')}
      </div>
      <svg className="lasso loupe" ref={loupeRef} aria-hidden="true" visibility="hidden">
        <defs>
          <clipPath id="loupe-clip">
            <circle ref={loupeClipRef} r={LOUPE_SIZE / 2} />
          </clipPath>
        </defs>
        <g clipPath="url(#loupe-clip)">
          <g ref={loupeLinesRef} className="loupe-lines">
            <path ref={lassoCopyRef} />
            <path ref={trailCopyRef} className="trail" />
            <circle ref={startCopyRef} className="start" r={5 / LOUPE_ZOOM} visibility="hidden" />
          </g>
          <circle ref={ringRef} className="ring" visibility="hidden" />
          <path ref={crossRef} className="cross" />
        </g>
        <circle ref={loupeRimRef} className="rim" r={LOUPE_SIZE / 2} />
      </svg>
    </div>
  );
}
