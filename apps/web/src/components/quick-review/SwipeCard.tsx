'use client';

import { useEffect, useRef, useState } from 'react';

/** Past this many px the release rates the card (docs/09-ripasso-mobile.md §1.5). */
export const SWIPE_THRESHOLD = 70;
/** Below this the gesture is still a tap, not a drag. */
const DRAG_SLOP = 10;

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const onChange = () => setReduced(mq.matches);
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * The session card: with `enabled` it follows a horizontal drag (→ Bene, ← Di nuovo) and tints
 * past the threshold; a release short of it springs back. `touch-action: pan-y` keeps vertical
 * scrolling of a long answer to the browser. Off under `prefers-reduced-motion`: the buttons and
 * the tap still do everything.
 */
export function SwipeCard({
  enabled,
  onSwipe,
  onTap,
  children,
}: {
  enabled: boolean;
  onSwipe: (direction: 'left' | 'right') => void;
  onTap?: (() => void) | undefined;
  children: React.ReactNode;
}) {
  const reducedMotion = usePrefersReducedMotion();
  const active = enabled && !reducedMotion;
  const [dx, setDx] = useState(0);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef<{ x: number; y: number; id: number } | null>(null);
  const draggedRef = useRef(false);
  const pastRef = useRef(false);

  const reset = () => {
    startRef.current = null;
    pastRef.current = false;
    setDragging(false);
    setDx(0);
  };

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    draggedRef.current = false;
    if (!active || e.button !== 0) return;
    startRef.current = { x: e.clientX, y: e.clientY, id: e.pointerId };
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.id !== e.pointerId) return;
    const moveX = e.clientX - start.x;
    const moveY = e.clientY - start.y;
    if (!dragging) {
      if (Math.abs(moveX) < DRAG_SLOP || Math.abs(moveX) < Math.abs(moveY)) return;
      setDragging(true);
      draggedRef.current = true;
      e.currentTarget.setPointerCapture(e.pointerId);
    }
    setDx(moveX);
    const past = Math.abs(moveX) > SWIPE_THRESHOLD;
    if (past && !pastRef.current) navigator.vibrate?.(10);
    pastRef.current = past;
  };

  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || start.id !== e.pointerId) return;
    const moveX = e.clientX - start.x;
    const wasDragging = dragging;
    reset();
    if (wasDragging && Math.abs(moveX) > SWIPE_THRESHOLD) onSwipe(moveX > 0 ? 'right' : 'left');
  };

  const progress = Math.min(1, Math.abs(dx) / SWIPE_THRESHOLD);
  const past = Math.abs(dx) > SWIPE_THRESHOLD;
  const tint = dx > 0 ? 'var(--ok)' : 'var(--danger)';

  return (
    // The tap is a shortcut for the "Mostra risposta" button below the card, which stays the
    // accessible way to reveal: no role or key handler here on purpose.
    <div
      data-testid="swipe-card"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={reset}
      onClick={() => {
        if (!draggedRef.current) onTap?.();
      }}
      className="relative flex min-h-0 min-w-0 flex-1 touch-pan-y select-none"
      style={{
        transform: dx ? `translateX(${dx}px) rotate(${dx / 24}deg)` : undefined,
        transition: dragging ? 'none' : 'transform 200ms var(--ease-standard)',
      }}
    >
      {children}
      {dx !== 0 && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-start rounded-[var(--radius-modal)] border-2 p-5"
          style={{
            borderColor: tint,
            background: `color-mix(in srgb, ${tint} ${Math.round(progress * 14)}%, transparent)`,
            justifyContent: dx > 0 ? 'flex-start' : 'flex-end',
            opacity: 0.4 + progress * 0.6,
          }}
        >
          <span
            className="rounded-[var(--radius-control)] border px-2 py-1 text-xs font-semibold uppercase tracking-wide"
            style={{ color: tint, borderColor: tint, opacity: past ? 1 : 0.6 }}
          >
            {dx > 0 ? 'Bene' : 'Di nuovo'}
          </span>
        </div>
      )}
    </div>
  );
}
