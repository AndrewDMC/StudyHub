'use client';

import { useId, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ConflictDiff, resolveConflict } from '../DocumentContentClient';

/** Vault conflict: the file changed on disk after the user's edit. Pick a side or compare first. */
export function ConflictBanner({
  slug,
  documentId,
  mine,
  theirs,
}: {
  slug: string;
  documentId: string;
  mine: string;
  theirs: string;
}) {
  const queryClient = useQueryClient();
  const [showDiff, setShowDiff] = useState(false);
  const diffId = useId();
  const mutation = useMutation({
    mutationFn: (keep: 'mine' | 'new') => resolveConflict(slug, documentId, keep),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documentContent', slug, documentId] });
      queryClient.invalidateQueries({ queryKey: ['documents', slug] });
      queryClient.invalidateQueries({ queryKey: ['document', slug, documentId] });
    },
  });

  return (
    <div
      role="status"
      className="rounded-[var(--radius-card)] border border-warn p-3.5"
      style={{ background: 'color-mix(in srgb, var(--warn) 10%, var(--bg-surface))' }}
    >
      <p className="text-sm">
        <b className="font-semibold text-warn">Conflitto con la copia nel vault.</b> Il file è
        cambiato su disco dopo la tua modifica.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('mine')}
          className="min-h-11 flex-1 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
        >
          Tieni la mia
        </button>
        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => mutation.mutate('new')}
          className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-sm font-medium disabled:opacity-50"
        >
          Usa il disco
        </button>
      </div>
      <button
        type="button"
        aria-expanded={showDiff}
        aria-controls={diffId}
        onClick={() => setShowDiff((v) => !v)}
        className="mt-1 min-h-11 text-sm text-fg-secondary underline-offset-2 hover:underline"
      >
        {showDiff ? 'Nascondi differenze' : 'Mostra differenze'}
      </button>
      <div id={diffId} hidden={!showDiff}>
        {showDiff && (
          <>
            <p className="mb-2 text-xs text-fg-secondary">
              Rosso = solo nella tua versione, verde = solo nella nuova versione.
            </p>
            <ConflictDiff mine={mine} theirs={theirs} />
          </>
        )}
      </div>
      {mutation.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
