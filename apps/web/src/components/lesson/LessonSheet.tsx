'use client';

import { useCallback, useRef, useState, type ReactNode, type RefObject } from 'react';
import { createPortal } from 'react-dom';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useSheetDrag } from '@/components/subject-mobile/useSheetDrag';
import { SidePanel, type SidePanelTab } from '@/components/lesson/SidePanel';

/**
 * Materiale | Tutor as a bottom sheet (the side panel of the desktop). The dialog exists only while
 * open (closed, nothing hides the page or blocks its scroll). The panels live in a detached host
 * element, rendered through a portal that never unmounts: the sheet just attaches the host while it is
 * open, so the page being read and the chat are not lost when it closes.
 */
export function LessonSheet({
  open,
  onOpenChange,
  tab,
  onTabChange,
  material,
  tutor,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: SidePanelTab;
  onTabChange: (tab: SidePanelTab) => void;
  material: ReactNode;
  tutor: ReactNode;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useSheetDrag(() => onOpenChange(false));
  const [host] = useState<HTMLElement | null>(() => {
    if (typeof document === 'undefined') return null;
    const el = document.createElement('div');
    el.className = 'flex min-h-0 flex-1 flex-col';
    return el;
  });
  const attach = useCallback(
    (slot: HTMLDivElement | null) => {
      if (slot && host && host.parentElement !== slot) slot.appendChild(host);
    },
    [host],
  );

  return (
    <>
      {host &&
        createPortal(
          <SidePanel
            tab={tab}
            onTabChange={onTabChange}
            className="min-h-0 flex-1"
            material={material}
            tutor={tutor}
          />,
          host,
        )}
      <DialogPrimitive.Root
        open={open}
        onOpenChange={(next) => {
          if (next) drag.reset();
          onOpenChange(next);
        }}
      >
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="anim-sheet-overlay fixed inset-0 z-[60] bg-black/60" />
          <DialogPrimitive.Content
            onOpenAutoFocus={(e) => {
              e.preventDefault();
              closeRef.current?.focus();
            }}
            onCloseAutoFocus={(e) => {
              e.preventDefault();
              returnFocusRef.current?.focus();
            }}
            style={{
              transform: drag.offset ? `translateY(${drag.offset}px)` : undefined,
              transition: drag.dragging ? 'none' : undefined,
            }}
            className="anim-sheet fixed inset-x-0 bottom-0 z-[60] flex h-[85dvh] flex-col rounded-t-[var(--radius-modal)] border-t border-border-strong bg-bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2 text-fg-primary outline-none"
          >
            <div {...drag.handlers} className="touch-none">
              <div
                aria-hidden="true"
                className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong"
              />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 pt-1">
                  <DialogPrimitive.Title className="text-lg font-semibold">
                    Materiale e tutor
                  </DialogPrimitive.Title>
                  <DialogPrimitive.Description className="sr-only">
                    Il documento della lezione e la chat con il tutor.
                  </DialogPrimitive.Description>
                </div>
                <button
                  ref={closeRef}
                  type="button"
                  aria-label="Chiudi"
                  onClick={() => onOpenChange(false)}
                  className="-mr-2 flex h-11 w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary hover:text-fg-primary"
                >
                  <X className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>
            </div>
            <div ref={attach} className="flex min-h-0 flex-1 flex-col" />
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    </>
  );
}
