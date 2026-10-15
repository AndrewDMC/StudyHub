'use client';

import type { RefObject } from 'react';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { useSafeFocus } from './ExitSheet';
import { primaryButton, secondaryButton } from './styles';

/** Confirmation of the hand-in, with the count of answered exercises. */
export function SubmitSheet({
  open,
  onOpenChange,
  answered,
  total,
  isSubmitting,
  error,
  onSubmit,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  answered: number;
  total: number;
  isSubmitting: boolean;
  error: string | null;
  onSubmit: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const continueRef = useSafeFocus(open);
  const missing = total - answered;
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Consegnare l'esame?"
      description={`Hai risposto a ${answered} esercizi su ${total}. Le risposte non saranno più modificabili.`}
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-4 flex flex-col gap-3">
        {missing > 0 && (
          <p className="text-sm text-warn">
            {missing} {missing === 1 ? 'esercizio senza risposta' : 'esercizi senza risposta'}.
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            ref={continueRef}
            disabled={isSubmitting}
            onClick={() => onOpenChange(false)}
            className={`${secondaryButton} min-h-12`}
          >
            Continua l&apos;esame
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={onSubmit}
            className={`${primaryButton} min-h-12 text-sm`}
          >
            {isSubmitting ? 'Consegno…' : 'Consegna'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
