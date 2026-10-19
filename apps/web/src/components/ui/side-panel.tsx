'use client';

import type { ReactNode, RefObject } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

/**
 * Right-anchored modal drawer (focus trap, Esc, focus returned to `returnFocusRef`). Used when the
 * detail does not fit next to the list; phones use `BottomSheet` instead.
 */
export function SidePanel({
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
  description?: string;
  returnFocusRef?: RefObject<HTMLElement | null>;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="anim-sheet-overlay fixed inset-0 z-50 bg-black/60" />
        <DialogPrimitive.Content
          onCloseAutoFocus={(e) => {
            if (!returnFocusRef?.current) return;
            e.preventDefault();
            returnFocusRef.current.focus();
          }}
          className="anim-panel fixed inset-y-0 right-0 z-50 w-[min(440px,100vw)] overflow-y-auto border-l border-border-strong bg-bg-surface text-fg-primary shadow-lg outline-none"
        >
          <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
            <DialogPrimitive.Title className="text-base font-semibold">
              {title}
            </DialogPrimitive.Title>
            <DialogPrimitive.Close
              aria-label="Chiudi"
              className="flex size-10 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary outline-none hover:text-fg-primary focus-visible:outline-2 focus-visible:outline-accent"
            >
              <X className="size-4" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>
          <DialogPrimitive.Description className="sr-only">
            {description ?? title}
          </DialogPrimitive.Description>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
