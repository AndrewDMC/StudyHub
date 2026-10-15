'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import { postJson } from '../ExamPrepPanel';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { primaryButton, secondaryButton } from './styles';

/** Starts the profile extraction job (same POST as the desktop: only `useImages`). */
export function ReextractSheet({
  slug,
  hasProfile,
  open,
  onOpenChange,
  onStarted,
  returnFocusRef,
}: {
  slug: string;
  hasProfile: boolean;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: () => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [useImages, setUseImages] = useState(false);
  const extract = useMutation({
    mutationFn: () => postJson(`/api/subjects/${slug}/exam-profile`, { useImages }),
    onSuccess: () => {
      onStarted();
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (open) {
      setUseImages(false);
      extract.reset();
    }
  }, [open]);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={hasProfile ? 'Ri-estrai il profilo' : 'Estrai il profilo'}
      description={
        hasProfile
          ? 'Un profilo modificato a mano non viene sovrascritto.'
          : 'Il profilo si ricava dagli esami passati che hai caricato.'
      }
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-4 flex flex-col gap-3">
        <label className="flex min-h-11 items-start gap-3 text-sm text-fg-secondary">
          <input
            type="checkbox"
            checked={useImages}
            onChange={(e) => setUseImages(e.target.checked)}
            className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
          />
          Usa anche le pagine degli esami come immagini (figure e grafici; costa di più)
        </label>
        {extract.isError && (
          <p role="alert" className="text-sm text-danger">
            {(extract.error as Error).message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={`${secondaryButton} min-h-12`}
          >
            Annulla
          </button>
          <button
            type="button"
            onClick={() => extract.mutate()}
            disabled={extract.isPending}
            className={`${primaryButton} min-h-12 text-sm`}
          >
            {extract.isPending ? 'Avvio…' : hasProfile ? 'Ri-estrai' : 'Estrai'}
          </button>
        </div>
      </div>
    </BottomSheet>
  );
}
