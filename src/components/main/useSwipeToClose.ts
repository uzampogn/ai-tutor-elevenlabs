import { useRef, type PointerEvent } from 'react';

interface Opts { onClose: () => void; direction: 'left' | 'right'; enabled: boolean; }
const THRESHOLD = 60;

/** Horizontal swipe-to-close. Returns pointer handlers to spread onto the panel. */
export function useSwipeToClose({ onClose, direction, enabled }: Opts) {
  const start = useRef<{ x: number; y: number } | null>(null);

  return {
    onPointerDown: (e: PointerEvent | { clientX: number; clientY: number }) => {
      if (!enabled) return;
      start.current = { x: e.clientX, y: e.clientY };
    },
    onPointerMove: (_e: PointerEvent | { clientX: number; clientY: number }) => {
      /* tracking only on up; nothing needed here */
    },
    onPointerUp: (e: PointerEvent | { clientX: number; clientY: number }) => {
      if (!enabled || !start.current) return;
      const dx = e.clientX - start.current.x;
      const dy = e.clientY - start.current.y;
      start.current = null;
      if (Math.abs(dx) < THRESHOLD || Math.abs(dy) > Math.abs(dx)) return;
      if ((direction === 'left' && dx < 0) || (direction === 'right' && dx > 0)) onClose();
    },
  };
}
