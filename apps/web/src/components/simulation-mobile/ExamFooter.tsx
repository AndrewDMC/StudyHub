'use client';

import type { Ref } from 'react';
import { ChevronLeft } from 'lucide-react';
import { iconButton } from '../document-mobile/DocHeader';
import { primaryButton } from './styles';

/** Previous / next exercise; on the last one the main button hands the exam in. */
export function ExamFooter({
  isFirst,
  isLast,
  disabled,
  onPrevious,
  onNext,
  onSubmit,
  submitRef,
}: {
  isFirst: boolean;
  isLast: boolean;
  disabled: boolean;
  onPrevious: () => void;
  onNext: () => void;
  onSubmit: () => void;
  submitRef: Ref<HTMLButtonElement>;
}) {
  return (
    <footer className="flex shrink-0 items-center gap-2 border-t border-border bg-bg-surface px-3 pt-2 pb-[calc(env(safe-area-inset-bottom)+8px)]">
      <button
        type="button"
        aria-label="Esercizio precedente"
        disabled={isFirst}
        onClick={onPrevious}
        className={`${iconButton} border border-border-strong`}
      >
        <ChevronLeft className="size-5" aria-hidden="true" />
      </button>
      {isLast ? (
        <button
          type="button"
          ref={submitRef}
          aria-haspopup="dialog"
          disabled={disabled}
          onClick={onSubmit}
          className={`${primaryButton} min-h-12 min-w-0 flex-1 text-[15px]`}
        >
          Consegna
        </button>
      ) : (
        <button
          type="button"
          disabled={disabled}
          onClick={onNext}
          className={`${primaryButton} min-h-12 min-w-0 flex-1 text-[15px]`}
        >
          Esercizio successivo
        </button>
      )}
    </footer>
  );
}
