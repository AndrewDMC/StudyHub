'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Flag, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { FlashcardDto } from '@studyhub/contracts';
import { deleteCard, updateCard } from '@/lib/deckEditorClient';
import { REVIEW_OVERVIEW_KEY } from '@/lib/reviewOverview';
import { CardText } from '../CardText';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { CardStatePills } from './FlashcardRow';

const action =
  'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left text-[15px] text-fg-primary disabled:opacity-50';
const field =
  'min-h-24 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-3 text-base text-fg-primary';

type Mode = 'view' | 'edit' | 'confirm-delete';

/** Full card plus the actions of the desktop list: edit, suspend, clear the flag, delete. */
export function FlashcardDetailSheet({
  slug,
  card,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  card: FlashcardDto | null;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('view');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');

  useEffect(() => {
    setMode('view');
    setFront(card?.front ?? '');
    setBack(card?.back ?? '');
  }, [card?.id]);

  // Same invalidations as the desktop list, plus the overview that feeds "da ripassare oggi".
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['flashcard-list', slug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-tags', slug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-stats', slug] });
    void queryClient.invalidateQueries({ queryKey: ['stats', slug] });
    void queryClient.invalidateQueries({ queryKey: REVIEW_OVERVIEW_KEY });
  };

  const update = useMutation({
    mutationFn: (patch: Parameters<typeof updateCard>[2]) => updateCard(slug, card!.id, patch),
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });
  const remove = useMutation({
    mutationFn: () => deleteCard(slug, card!.id),
    onSuccess: () => {
      refresh();
      onOpenChange(false);
    },
  });

  const busy = update.isPending || remove.isPending;
  const error = (update.error ?? remove.error) as Error | null;
  const changed = card !== null && (front !== card.front || back !== card.back);
  const canSave = changed && front.trim() !== '' && back.trim() !== '' && !busy;

  const handleOpenChange = (open: boolean) => {
    if (!open) {
      update.reset();
      remove.reset();
    }
    onOpenChange(open);
  };

  return (
    <BottomSheet
      open={card !== null}
      onOpenChange={handleOpenChange}
      title="Card"
      returnFocusRef={returnFocusRef}
    >
      {card && mode === 'edit' ? (
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSave) update.mutate({ front, back });
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
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setFront(card.front);
                setBack(card.back);
                setMode('view');
              }}
              className="min-h-11 rounded-[var(--radius-control)] border border-border-strong text-sm font-medium"
            >
              Annulla
            </button>
            <button
              type="submit"
              disabled={!canSave}
              className="min-h-11 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
            >
              {update.isPending ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </form>
      ) : card ? (
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <CardStatePills card={card} />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <p className="text-[11px] uppercase tracking-[0.06em] text-fg-muted">Domanda</p>
            <CardText
              text={card.front}
              side="front"
              className="mt-1 break-words text-[17px] font-medium text-fg-primary"
            />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <p className="text-[11px] uppercase tracking-[0.06em] text-fg-muted">Risposta</p>
            <CardText
              text={card.back}
              side="back"
              className="mt-1 break-words text-[15px] text-fg-primary"
            />
          </div>
          {card.hint && <p className="text-sm italic text-fg-secondary">{card.hint}</p>}
          {card.sourceRef && (
            <p className="break-words rounded-[var(--radius-control)] bg-bg-inset px-3 py-2 font-mono text-xs text-fg-secondary">
              pag. {card.sourceRef.page} — &quot;{card.sourceRef.quote}&quot;
            </p>
          )}
          {card.tags.length > 0 && (
            <ul className="flex flex-wrap gap-1.5" aria-label="Tag">
              {card.tags.map((tag) => (
                <li
                  key={tag}
                  className="rounded-full border border-border px-2.5 py-0.5 text-xs text-fg-secondary"
                >
                  #{tag}
                </li>
              ))}
            </ul>
          )}

          {error && (
            <p role="alert" className="text-sm text-danger">
              {error.message}
            </p>
          )}

          {mode === 'confirm-delete' ? (
            <div role="group" aria-label="Conferma eliminazione" className="flex flex-col gap-2">
              <p className="text-sm text-fg-primary">
                Eliminare questa card? L’azione non è reversibile.
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  autoFocus
                  onClick={() => setMode('view')}
                  className="min-h-11 rounded-[var(--radius-control)] border border-border-strong text-sm font-medium"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove.mutate()}
                  className="min-h-11 rounded-[var(--radius-control)] border border-danger text-sm font-semibold text-danger disabled:opacity-50"
                >
                  {remove.isPending ? 'Elimino…' : 'Sì, elimina'}
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col border-t border-border pt-1">
              {card.sourceRef && (
                <a
                  href={`/api/subjects/${slug}/documents/${card.sourceRef.docId}/file#page=${card.sourceRef.page}`}
                  target="_blank"
                  rel="noopener"
                  className={action}
                >
                  Apri la fonte
                </a>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('edit')}
                className={action}
              >
                <Pencil className="size-[18px] text-fg-secondary" aria-hidden="true" />
                Modifica
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={() => update.mutate({ suspended: !card.suspended })}
                className={action}
              >
                {card.suspended ? (
                  <Play className="size-[18px] text-fg-secondary" aria-hidden="true" />
                ) : (
                  <Pause className="size-[18px] text-fg-secondary" aria-hidden="true" />
                )}
                {update.isPending && update.variables && 'suspended' in update.variables
                  ? 'Salvo…'
                  : card.suspended
                    ? 'Riattiva'
                    : 'Sospendi'}
              </button>
              {card.flaggedAt && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => update.mutate({ flagged: false })}
                  className={action}
                >
                  <Flag className="size-[18px] text-fg-secondary" aria-hidden="true" />
                  Rimuovi segnalazione
                </button>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={() => setMode('confirm-delete')}
                className={`${action} text-danger`}
              >
                <Trash2 className="size-[18px]" aria-hidden="true" />
                Elimina
              </button>
            </div>
          )}
        </div>
      ) : null}
    </BottomSheet>
  );
}
