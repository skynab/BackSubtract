import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { editor } from '../editor/editor';
import { unionRect, type Rect } from '../mask/mask';
import { selectMode, useUI } from '../state/store';
import { pick } from '../tools/color/pick';
import { cssColor, Renderer } from './renderer';
import { clamp, fitView, MAX_SCALE, minScale, toImage, zoomAt, type Point, type View } from './view';

/** How visible removed areas are while in Keep mode, so users can see what they can bring back. */
const GHOST = 0.15;
const HOLD_MS = 450;
const DRAG_SLOP = 6;

type Gesture =
  | { kind: 'none' }
  | { kind: 'stroke'; id: number }
  | { kind: 'pan'; id: number; last: Point }
  | { kind: 'hold'; id: number; start: Point; timer: number }
  | { kind: 'pinch'; startDist: number; startMid: Point; startView: View };

const isEditable = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

export function Viewer() {
  const { t } = useTranslation();
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const badgeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const wrap = wrapRef.current!;
    const canvas = canvasRef.current!;
    const cursor = cursorRef.current!;
    const badge = badgeRef.current!;

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
      const ghost = selectMode(useUI.getState()) === 'keep' ? GHOST : 0;
      renderer.render({ view, width: size.w, height: size.h, dpr: size.dpr, ghost, original: comparing ? 1 : 0, ...colors });
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

    function updateCursor(e: PointerEvent | null, p?: Point) {
      const ui = useUI.getState();
      const brush = ui.tool === 'brush' && !spaceDown;
      const tapTool = ui.tool === 'wand' || ui.tool === 'color';
      canvas.style.cursor =
        spaceDown || gesture.kind === 'pan' ? 'grab' : brush ? 'none' : tapTool ? 'crosshair' : 'default';
      const showRing = brush && p && e && e.pointerType !== 'touch';
      cursor.hidden = !showRing;
      if (showRing) {
        const d = ui.brushSize;
        cursor.style.width = cursor.style.height = `${d}px`;
        cursor.style.transform = `translate(${p.x - d / 2}px, ${p.y - d / 2}px)`;
      }
    }

    function endGesture(tapped = false) {
      if (gesture.kind === 'stroke') editor.endStroke();
      if (gesture.kind === 'hold') {
        clearTimeout(gesture.timer);
        // A quick press without moving is a tap; a long one only showed the original.
        if (tapped && !comparing) {
          const tool = useUI.getState().tool;
          if (tool === 'wand' || tool === 'color') {
            const ip = toImage(view, gesture.start);
            pick(tool, ip.x, ip.y);
          }
        }
        setComparing(false);
      }
      gesture = { kind: 'none' };
    }

    function onPointerDown(e: PointerEvent) {
      if (!editor.image || (e.button !== 0 && e.button !== 1)) return;
      canvas.setPointerCapture(e.pointerId);
      const p = local(e);
      pointers.set(e.pointerId, p);

      if (pointers.size === 2) {
        // A second finger turns whatever the first one started into a pinch.
        if (gesture.kind === 'stroke') editor.cancelStroke();
        if (gesture.kind === 'hold') clearTimeout(gesture.timer);
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
        editor.beginStroke(ip.x, ip.y, ui.brushSize / 2 / view.scale, ui.modes.brush);
        gesture = { kind: 'stroke', id: e.pointerId };
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
            gesture = { kind: 'pan', id: e.pointerId, last: p };
          }
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
      if (isEditable(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === ' ') {
        if (!(e.target instanceof HTMLButtonElement)) e.preventDefault();
        spaceDown = true;
        updateCursor(null);
      } else if (e.key === 'c' || e.key === 'C') {
        setComparing(true);
      } else if (e.key === '0') {
        fit();
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
    const stopUI = useUI.subscribe(requestRender);
    const onLeave = () => (cursor.hidden = true);
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
      <div className="brush-cursor" ref={cursorRef} hidden />
      <div className="badge" ref={badgeRef} hidden>
        {t('viewer.original')}
      </div>
    </div>
  );
}
