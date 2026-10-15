'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { FlashcardDto } from '@studyhub/contracts';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { reviewDeckCard } from './queries';

const field =
  'min-h-24 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-3 text-base text-fg-primary';

/** Edits front and back of a generated card right away (PATCH `edit`), not deferred to the approval. */
export function ReviewCardEditSheet({
  slug,
  artifactId,
  card,
  onClose,
  onSaved,
  returnFocusRef,
}: {
  slug: string;
  artifactId: string;
  card: FlashcardDto | null;
  onClose: () => void;
  onSaved: (updated: FlashcardDto | null) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  useEffect(() => {
    setFront(card?.front ?? '');
    setBack(card?.back ?? '');
  }, [card?.id]);

  const save = useMutation({
    mutationFn: () => reviewDeckCard(slug, artifactId, card!.id, { action: 'edit', front, back }),
    onSuccess: (updated) => {
      onSaved(updated);
      onClose();
    },
  });

  const changed = card !== null && (front !== card.front || back !== card.back);
  const canSave = changed && front.trim() !== '' && back.trim() !== '' && !save.isPending;

  return (
    <BottomSheet
      open={card !== null}
      onOpenChange={(open) => {
        if (!open) {
          save.reset();
          onClose();
        }
      }}
      title="Modifica card"
      returnFocusRef={returnFocusRef}
    >
      <form
        className="mt-3 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) save.mutate();
        }}
      >
        <label className="flex flex-col gap-1.5 text-xs text-fg-secondary">
          Fronte
          <textarea value={front} onChange={(e) => setFront(e.target.value)} className={field} />
        </label>
        <label className="flex flex-col gap-1.5 text-xs text-fg-secondary">
          Retro
          <textarea value={back} onChange={(e) => setBack(e.target.value)} className={field} />
        </label>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {(save.error as Error).message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-11 rounded-[var(--radius-control)] border border-border-strong text-sm font-medium"
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={!canSave}
            className="min-h-11 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
          >
            {save.isPending ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
