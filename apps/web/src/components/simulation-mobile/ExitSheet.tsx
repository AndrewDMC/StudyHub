'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { primaryButton, secondaryButton } from './styles';

/** Moves the first focus from "Chiudi" to the safe action of a confirmation sheet. */
export function useSafeFocus(open: boolean) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const id = setTimeout(() => ref.current?.focus(), 50);
    return () => clearTimeout(id);
  }, [open]);
  return ref;
}

/** Leaving does not hand in: the answers are saved and the timer keeps running server-side. */
export function ExitSheet({
  open,
  onOpenChange,
  onExit,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Resolves false when the last answers could not be saved (the user stays in the exam). */
  onExit: () => Promise<boolean>;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const continueRef = useSafeFocus(open);
  const [leaving, setLeaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (open) setFailed(false);
  }, [open]);
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Uscire dalla simulazione?"
      description="Il tempo continua a scorrere. Le risposte vengono salvate prima di uscire e puoi riprendere dalla lista."
      returnFocusRef={returnFocusRef}
    >
      {failed && (
        <p role="alert" className="mt-3 text-sm text-danger">
          Impossibile salvare le ultime risposte: riprova prima di uscire.
        </p>
      )}
      <div className="mt-4 grid grid-cols-2 gap-2">
        <button
          type="button"
          ref={continueRef}
          onClick={() => onOpenChange(false)}
          className={`${primaryButton} min-h-12 text-sm`}
        >
          Continua l&apos;esame
        </button>
        <button
          type="button"
          disabled={leaving}
          onClick={() => {
            setLeaving(true);
            setFailed(false);
            void onExit()
              .then((ok) => setFailed(!ok))
              .finally(() => setLeaving(false));
          }}
          className={`${secondaryButton} min-h-12`}
        >
          {leaving ? 'Esco…' : 'Esci'}
        </button>
      </div>
    </BottomSheet>
  );
}
