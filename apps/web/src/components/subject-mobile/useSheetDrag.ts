'use client';

import { useRef, useState, type PointerEvent } from 'react';

const CLOSE_DISTANCE = 96;
const CLOSE_VELOCITY = 0.5; // px/ms

/**
 * Swipe-down-to-close for a bottom sheet. Spread `handlers` on the grip/header only (with
 * `touch-action: none` there): the scrollable body never competes for the gesture.
 * `offset` is the current translateY to apply to the sheet while dragging.
 */
export function useSheetDrag(onClose: () => void) {
  const [offset, setOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const start = useRef<{ y: number; t: number } | null>(null);

  const handlers = {
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if ((e.target as HTMLElement).closest('button')) return; // taps on the close button stay taps
      start.current = { y: e.clientY, t: e.timeStamp };
      setDragging(true);
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      if (!start.current) return;
      setOffset(Math.max(0, e.clientY - start.current.y));
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const s = start.current;
      start.current = null;
      setDragging(false);
      if (!s) return;
      const dy = e.clientY - s.y;
      const velocity = dy / Math.max(1, e.timeStamp - s.t);
      if (dy > CLOSE_DISTANCE || velocity > CLOSE_VELOCITY) {
        onClose(); // keep the offset: the exit animation starts from where the finger left it
      } else {
        setOffset(0);
      }
    },
    onPointerCancel: () => {
      start.current = null;
      setDragging(false);
      setOffset(0);
    },
  };

  const reset = () => setOffset(0);

  return { offset, dragging, handlers, reset };
}
