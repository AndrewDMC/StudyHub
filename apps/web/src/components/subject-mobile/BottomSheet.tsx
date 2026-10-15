'use client';

import { useEffect, useRef, type ReactNode, type RefObject } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { useSheetDrag } from './useSheetDrag';

/**
 * Generic bottom sheet with the same chrome as `AssistantSheet` (grip, "Chiudi" with first focus,
 * swipe/Esc/overlay to close, focus returned to the trigger). Content goes in `children`.
 */
export function BottomSheet({
  open,
  onOpenChange,
  title,
  description,
  returnFocusRef,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string | undefined;
  /** Element that opened the sheet: gets the focus back on close. */
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const drag = useSheetDrag(() => onOpenChange(false));

  useEffect(() => {
    if (open) drag.reset();
  }, [open]);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-sheet-overlay fixed inset-0 z-[60] bg-black/60" />
        <DialogPrimitive.Content
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            closeRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => {
            if (!returnFocusRef) return;
            e.preventDefault();
            returnFocusRef.current?.focus();
          }}
          style={{
            transform: drag.offset ? `translateY(${drag.offset}px)` : undefined,
            transition: drag.dragging ? 'none' : undefined,
          }}
          className="anim-sheet fixed inset-x-0 bottom-0 z-[60] max-h-[min(760px,90dvh)] overflow-y-auto rounded-t-[var(--radius-modal)] border-t border-border-strong bg-bg-surface px-4 pb-[calc(env(safe-area-inset-bottom)+16px)] pt-2 text-fg-primary outline-none"
        >
          <div {...drag.handlers} className="touch-none">
            <div
              aria-hidden="true"
              className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong"
            />
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 pt-1">
                <DialogPrimitive.Title className="text-lg font-semibold">
                  {title}
                </DialogPrimitive.Title>
                {description ? (
                  <DialogPrimitive.Description className="break-words text-[13px] text-fg-secondary">
                    {description}
                  </DialogPrimitive.Description>
                ) : (
                  <DialogPrimitive.Description className="sr-only">
                    {title}
                  </DialogPrimitive.Description>
                )}
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
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
