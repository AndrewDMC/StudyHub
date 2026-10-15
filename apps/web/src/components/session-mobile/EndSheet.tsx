'use client';

import type { RefObject } from 'react';
import { formatClock } from '@/components/PomodoroTimer';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** Confirmation before "Termina": the tap next to the timer is easy to miss and the action also closes the task. */
export function EndSheet({
  open,
  onOpenChange,
  shownMs,
  pending,
  error,
  onConfirm,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shownMs: number;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Terminare la sessione?"
      description={`Hai studiato ${formatClock(shownMs)}. Nella schermata successiva puoi creare flashcard e drill.`}
      returnFocusRef={returnFocusRef}
    >
      <div className="flex flex-col gap-2 pt-3">
        <button
          type="button"
          onClick={onConfirm}
          disabled={pending}
          className={`${primaryButton} min-h-12`}
        >
          {pending ? 'Termino…' : 'Termina la sessione'}
        </button>
        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={`${secondaryButton} min-h-12`}
        >
          Continua a studiare
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
