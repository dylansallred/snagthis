import { useEffect, useRef, type MouseEvent, type PointerEvent } from 'react';

// Pressing and moving a few pixels on the logo or the tabs drags the window, like the rest of
// the header. They can't be native drag regions: macOS gives those no pointer events, so the
// logo couldn't shine on hover and the tabs couldn't be clicked. A drag never counts as a click.
const DRAG_THRESHOLD = 4;

type Press = { pointerId: number; x: number; y: number; dragging: boolean };

export function useWindowDrag() {
  const press = useRef<Press | null>(null);
  const swallowClick = useRef(false);
  const swallowTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const end = () => {
    if (press.current?.dragging) {
      void window.desktop?.endWindowDrag?.();
      if (swallowTimer.current) clearTimeout(swallowTimer.current);
      swallowTimer.current = setTimeout(() => {
        swallowClick.current = false;
        swallowTimer.current = null;
      }, 0);
    }
    press.current = null;
  };
  useEffect(() => {
    window.addEventListener('blur', end);
    window.addEventListener('pointerup', end);
    window.addEventListener('pointercancel', end);
    return () => {
      window.removeEventListener('blur', end);
      window.removeEventListener('pointerup', end);
      window.removeEventListener('pointercancel', end);
      if (swallowTimer.current) clearTimeout(swallowTimer.current);
      end();
    };
  }, []);
  return {
    onPointerDown(event: PointerEvent<HTMLElement>) {
      if (swallowTimer.current) { clearTimeout(swallowTimer.current); swallowTimer.current = null; }
      swallowClick.current = false;
      if (event.button !== 0 || !window.desktop?.startWindowDrag) return;
      press.current = { pointerId: event.pointerId, x: event.screenX, y: event.screenY, dragging: false };
    },
    onPointerMove(event: PointerEvent<HTMLElement>) {
      const current = press.current;
      if (!current || current.dragging || event.pointerId !== current.pointerId) return;
      if ((event.buttons & 1) === 0) { end(); return; }
      if (Math.hypot(event.screenX - current.x, event.screenY - current.y) < DRAG_THRESHOLD) return;
      current.dragging = true;
      swallowClick.current = true;
      try { event.currentTarget.setPointerCapture(event.pointerId); } catch { /* Element may not accept capture. */ }
      void window.desktop?.startWindowDrag?.();
    },
    onPointerUp: end,
    onPointerCancel: end,
    onLostPointerCapture: end,
    onClickCapture(event: MouseEvent<HTMLElement>) {
      if (!swallowClick.current) return;
      if (swallowTimer.current) { clearTimeout(swallowTimer.current); swallowTimer.current = null; }
      swallowClick.current = false;
      event.preventDefault();
      event.stopPropagation();
    },
  };
}
