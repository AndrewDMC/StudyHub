'use client';

import type { RefObject } from 'react';
import type { PlanDto } from '@studyhub/contracts';
import { secondaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** Confirmation before deleting a plan (replaces the desktop `window.confirm`). */
export function DeletePlanSheet({
  open,
  onOpenChange,
  plan,
  returnFocusRef,
  pending,
  error,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plan: PlanDto | null;
  returnFocusRef: RefObject<HTMLElement | null>;
  pending: boolean;
  error: string | null;
  onConfirm: () => void;
}) {
  const what = plan?.status === 'draft' ? 'questa bozza' : 'il piano attivo';
  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Elimina piano"
      description={`Eliminare definitivamente ${what} e tutte le sue ${plan?.tasks.length ?? 0} task? L’operazione non si può annullare.`}
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-3 flex flex-col gap-2">
        <button
          type="button"
          disabled={pending}
          onClick={onConfirm}
          className="flex min-h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-danger px-4 text-sm font-semibold text-bg-base disabled:opacity-50"
        >
          {pending ? 'Elimino…' : 'Elimina'}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => onOpenChange(false)}
          className={`${secondaryButton} min-h-12`}
        >
          Annulla
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
