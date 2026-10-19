'use client';

import { useRef, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from './dialog';
import { cn } from '@/lib/utils';

const BTN =
  'inline-flex h-10 items-center justify-center rounded-[var(--radius-control)] px-4 text-[13px] font-medium outline-none transition-colors duration-120 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:opacity-60 max-md:h-11';

/**
 * Confirmation of a destructive (or irreversible) action, replacing `window.confirm`.
 * The first focus is on "Annulla"; the dialog stays open until `onConfirm` resolves, and shows the
 * error of a failed attempt inline.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  cancelLabel = 'Annulla',
  tone = 'danger',
  busy: busyProp,
  error: errorProp,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: 'danger' | 'default';
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void | Promise<void>;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const [pending, setPending] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const busy = busyProp ?? pending;
  const error = errorProp ?? localError;

  const handleOpenChange = (next: boolean) => {
    if (busy) return;
    if (!next) setLocalError(null);
    onOpenChange(next);
  };

  const confirm = async () => {
    setLocalError(null);
    setPending(true);
    try {
      await onConfirm();
      onOpenChange(false);
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : 'Operazione non riuscita.');
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        role="alertdialog"
        hideClose
        overlayClassName="z-[70]"
        className="z-[70] max-w-sm"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          cancelRef.current?.focus();
        }}
      >
        <DialogTitle className="text-base font-semibold">{title}</DialogTitle>
        <DialogDescription className={cn('mt-1 text-[13px]', !description && 'sr-only')}>
          {description ?? title}
        </DialogDescription>
        {error && (
          <p role="alert" className="mt-3 text-[13px] text-danger">
            {error}
          </p>
        )}
        <div className="mt-5 flex justify-end gap-2">
          <button
            ref={cancelRef}
            type="button"
            disabled={busy}
            onClick={() => handleOpenChange(false)}
            className={cn(BTN, 'border border-border-strong text-fg-primary hover:bg-bg-raised')}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void confirm()}
            className={cn(
              BTN,
              tone === 'danger'
                ? 'bg-danger text-bg-base hover:opacity-90'
                : 'bg-accent text-bg-base hover:bg-accent-hover',
            )}
          >
            {busy ? '…' : confirmLabel}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
