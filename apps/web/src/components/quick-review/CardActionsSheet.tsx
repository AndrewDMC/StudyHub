'use client';

import { useEffect, useState } from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Flag, FileText, Pause, Pencil } from 'lucide-react';
import type { FlashcardDto, ReviewQueueItemDto, UpdateFlashcardRequest } from '@studyhub/contracts';
import { cardSourceHref } from '@/lib/quickReview';

async function patchCard(
  card: ReviewQueueItemDto,
  patch: UpdateFlashcardRequest,
): Promise<FlashcardDto> {
  const res = await fetch(`/api/subjects/${card.subjectSlug}/flashcards/${card.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Aggiornamento fallito');
  return body.flashcard as FlashcardDto;
}

const rowClass =
  'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[15px] text-fg-primary hover:bg-bg-raised disabled:opacity-50';

/**
 * The session's `⋯` (docs/09-ripasso-mobile.md §1.6): edit, suspend, flag, open the source —
 * what the desktop review does with E / S / X / F. Suspend and flag take the card out of the
 * session; an edit updates it in place.
 */
export function CardActionsSheet({
  card,
  open,
  onOpenChange,
  onRemoved,
  onEdited,
}: {
  card: ReviewQueueItemDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRemoved: (cardId: string) => void;
  onEdited: (card: FlashcardDto) => void;
}) {
  const [editing, setEditing] = useState<{ front: string; back: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setEditing(null);
      setError(null);
    }
  }, [open]);

  const run = async (patch: UpdateFlashcardRequest, done: (updated: FlashcardDto) => void) => {
    setBusy(true);
    setError(null);
    try {
      done(await patchCard(card, patch));
      onOpenChange(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sourceHref = cardSourceHref(card);

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-[60] bg-black/60" />
        <DialogPrimitive.Content className="fixed inset-x-0 bottom-0 z-[60] max-h-[85dvh] overflow-y-auto rounded-t-[var(--radius-modal)] border-t border-border bg-bg-surface px-3 pb-[calc(env(safe-area-inset-bottom)+12px)] pt-2 text-fg-primary outline-none">
          <div aria-hidden="true" className="mx-auto mb-2 h-1 w-10 rounded-full bg-border-strong" />
          <DialogPrimitive.Title className="px-3 pb-1 text-sm font-medium">
            {editing ? 'Modifica card' : 'Azioni sulla card'}
          </DialogPrimitive.Title>
          <DialogPrimitive.Description className="sr-only">
            {card.subjectName}
            {card.topicName ? ` · ${card.topicName}` : ''}
          </DialogPrimitive.Description>

          {editing ? (
            <form
              className="flex flex-col gap-3 px-3 pt-2"
              onSubmit={(e) => {
                e.preventDefault();
                void run({ front: editing.front, back: editing.back }, onEdited);
              }}
            >
              <label className="text-xs text-fg-secondary">
                Fronte
                <textarea
                  value={editing.front}
                  onChange={(e) => setEditing({ ...editing, front: e.target.value })}
                  rows={3}
                  className="mt-1 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-2 text-base text-fg-primary"
                />
              </label>
              <label className="text-xs text-fg-secondary">
                Retro
                <textarea
                  value={editing.back}
                  onChange={(e) => setEditing({ ...editing, back: e.target.value })}
                  rows={4}
                  className="mt-1 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-2 text-base text-fg-primary"
                />
              </label>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setEditing(null)}
                  className="h-12 flex-1 rounded-[var(--radius-card)] border border-border-strong text-sm"
                >
                  Annulla
                </button>
                <button
                  type="submit"
                  disabled={busy || !editing.front.trim() || !editing.back.trim()}
                  className="h-12 flex-1 rounded-[var(--radius-card)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
                >
                  Salva
                </button>
              </div>
            </form>
          ) : (
            <ul className="flex flex-col">
              <li>
                <button
                  type="button"
                  className={rowClass}
                  onClick={() => setEditing({ front: card.front, back: card.back })}
                >
                  <Pencil size={18} strokeWidth={1.75} aria-hidden="true" /> Modifica
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => void run({ suspended: true }, (c) => onRemoved(c.id))}
                >
                  <Pause size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className="flex flex-col">
                    Sospendi
                    <span className="text-xs text-fg-secondary">
                      Esce dal ripasso finché non la riattivi
                    </span>
                  </span>
                </button>
              </li>
              <li>
                <button
                  type="button"
                  className={rowClass}
                  disabled={busy}
                  onClick={() => void run({ flagged: true }, (c) => onRemoved(c.id))}
                >
                  <Flag size={18} strokeWidth={1.75} aria-hidden="true" />
                  <span className="flex flex-col">
                    Segnala card scadente
                    <span className="text-xs text-fg-secondary">
                      Esclusa dal ripasso e raccolta per migliorare la generazione
                    </span>
                  </span>
                </button>
              </li>
              <li>
                {sourceHref ? (
                  <a href={sourceHref} target="_blank" rel="noopener" className={rowClass}>
                    <FileText size={18} strokeWidth={1.75} aria-hidden="true" />
                    <span className="flex flex-col">
                      Apri la fonte
                      <span className="text-xs text-fg-secondary">pag. {card.sourceRef!.page}</span>
                    </span>
                  </a>
                ) : (
                  <span className={`${rowClass} text-fg-muted`}>
                    <FileText size={18} strokeWidth={1.75} aria-hidden="true" /> Nessuna fonte
                  </span>
                )}
              </li>
            </ul>
          )}
          {error && (
            <p role="alert" className="px-3 pt-2 text-xs text-danger">
              {error}
            </p>
          )}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
