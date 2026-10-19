'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, FolderInput, Pause, Pencil, Play, Trash2 } from 'lucide-react';
import type { DeckSummaryDto, FlashcardDto, TopicDto } from '@studyhub/contracts';
import { deleteCard, updateCard } from '@/lib/deckEditorClient';
import { cardHistoryLabel, formatCardDueLong } from '@/lib/flashcardMobile';
import { cardSourceHref } from '@/lib/quickReview';
import { invalidateFlashcards } from '../flashcards/api';
import { exclusionReason } from '../flashcards/shared/cardActions';
import { StateDot } from '../flashcards/shared/StateDot';
import { CardText } from '../CardText';
import { BottomSheet } from '../subject-mobile/BottomSheet';

const action =
  'flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left text-[15px] text-fg-primary disabled:opacity-50';
const field =
  'min-h-24 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-3 text-base text-fg-primary';

type Mode = 'view' | 'edit' | 'topic' | 'confirm-delete';

const NO_TOPIC_VALUE = '';

/** Full card plus the actions of the desktop list: edit, suspend, clear the flag, delete. */
export function FlashcardDetailSheet({
  slug,
  topics,
  decks,
  card,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  topics: TopicDto[];
  decks: DeckSummaryDto[];
  card: FlashcardDto | null;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const [mode, setMode] = useState<Mode>('view');
  const [front, setFront] = useState('');
  const [back, setBack] = useState('');
  const [topicChoice, setTopicChoice] = useState(NO_TOPIC_VALUE);
  const changeTopicRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    setMode('view');
    setFront(card?.front ?? '');
    setBack(card?.back ?? '');
    setTopicChoice(card?.topicId ?? NO_TOPIC_VALUE);
  }, [card?.id]);

  // Same invalidations as the desktop list, plus the overview that feeds "da ripassare oggi".
  const refresh = () => invalidateFlashcards(queryClient, slug);

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
  const topicChanged = card !== null && topicChoice !== (card.topicId ?? NO_TOPIC_VALUE);
  const cardTopicName = topics.find((t) => t.id === card?.topicId)?.name ?? null;
  const cardDeck = decks.find((d) => d.id === card?.deckId);
  const reason = card ? exclusionReason(card, cardDeck?.status) : null;
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
      ) : card && mode === 'topic' ? (
        <div className="mt-3 flex flex-col gap-3">
          <div role="radiogroup" aria-label="Argomento" className="flex flex-col">
            {[{ id: NO_TOPIC_VALUE, name: 'Senza argomento' }, ...topics].map((t) => {
              const checked = topicChoice === t.id;
              return (
                <button
                  key={t.id || 'none'}
                  type="button"
                  role="radio"
                  aria-checked={checked}
                  autoFocus={checked}
                  disabled={busy}
                  onClick={() => setTopicChoice(t.id)}
                  className="flex min-h-12 w-full items-center gap-3 rounded-[var(--radius-control)] px-2 text-left text-[15px] text-fg-primary hover:bg-bg-raised disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className={`flex size-5 shrink-0 items-center justify-center rounded-full border ${
                      checked ? 'border-accent bg-accent text-bg-base' : 'border-border-strong'
                    }`}
                  >
                    {checked && <Check className="size-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{t.name}</span>
                </button>
              );
            })}
          </div>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error.message}
            </p>
          )}
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => {
                setTopicChoice(card.topicId ?? NO_TOPIC_VALUE);
                setMode('view');
                requestAnimationFrame(() => changeTopicRef.current?.focus());
              }}
              className="min-h-11 rounded-[var(--radius-control)] border border-border-strong text-sm font-medium"
            >
              Annulla
            </button>
            <button
              type="button"
              disabled={!topicChanged || busy}
              onClick={() => update.mutate({ topicId: topicChoice || null })}
              className="min-h-11 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
            >
              {update.isPending ? 'Salvo…' : 'Salva'}
            </button>
          </div>
        </div>
      ) : card ? (
        <div className="mt-3 flex min-w-0 flex-col gap-3">
          <dl className="grid grid-cols-1 gap-2 rounded-[var(--radius-control)] bg-bg-inset p-3 text-[13px]">
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Stato</dt>
              <dd>
                <StateDot card={card} />
              </dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Prossimo ripasso</dt>
              <dd>{reason ? 'esclusa' : formatCardDueLong(card)}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-fg-secondary">Storico</dt>
              <dd>{cardHistoryLabel(card.reps ?? 0, card.lapses ?? 0)}</dd>
            </div>
          </dl>
          {reason && (
            <div className="flex flex-col gap-2 text-[13px]">
              <p className={reason === 'flagged' ? 'text-danger' : 'text-fg-secondary'}>
                {reason === 'flagged'
                  ? 'Segnalata · esclusa dal ripasso'
                  : reason === 'suspended'
                    ? 'Sospesa · esclusa dal ripasso'
                    : `Il mazzo «${cardDeck?.title ?? ''}» non è approvato · esclusa dal ripasso`}
              </p>
              {reason === 'flagged' && (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => update.mutate({ flagged: false })}
                  className="min-h-11 rounded-[var(--radius-control)] border border-border-strong px-4 text-sm font-medium disabled:opacity-50"
                >
                  Rimetti nel ripasso
                </button>
              )}
            </div>
          )}
          <div className="min-w-0 overflow-x-auto">
            <p className="text-xs uppercase tracking-[0.06em] text-fg-secondary">Domanda</p>
            <CardText
              text={card.front}
              side="front"
              className="mt-1 break-words text-[17px] font-medium text-fg-primary"
            />
          </div>
          <div className="min-w-0 overflow-x-auto">
            <p className="text-xs uppercase tracking-[0.06em] text-fg-secondary">Risposta</p>
            <CardText
              text={card.back}
              side="back"
              className="mt-1 break-words text-[15px] text-fg-primary"
            />
          </div>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.06em] text-fg-secondary">Argomento</p>
            <p
              className={`mt-1 truncate text-[15px] ${cardTopicName ? 'text-fg-primary' : 'text-fg-secondary'}`}
            >
              {cardTopicName ?? 'Senza argomento'}
            </p>
          </div>
          <label className="flex min-w-0 flex-col gap-1.5 text-xs uppercase tracking-[0.06em] text-fg-secondary">
            Mazzo
            <select
              value={card.deckId}
              disabled={busy}
              onChange={(e) => update.mutate({ deckId: e.target.value })}
              className="min-h-11 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 text-base normal-case tracking-normal text-fg-primary"
            >
              {decks
                .filter((d) => d.status === 'approved' || d.id === card.deckId)
                .map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.title}
                  </option>
                ))}
            </select>
          </label>
          {card.hint && <p className="text-sm italic text-fg-secondary">{card.hint}</p>}
          {card.sourceRef && (
            <p className="break-words rounded-[var(--radius-control)] bg-bg-inset px-3 py-2 text-[13px] text-fg-secondary">
              {card.sourceRef.docTitle ? `Da “${card.sourceRef.docTitle}”` : 'Da un documento'}
              {card.sourceRef.page ? `, pagina ${card.sourceRef.page}` : ''}
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
                  href={
                    cardSourceHref({ subjectSlug: slug, sourceRef: card.sourceRef }) ?? undefined
                  }
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
                ref={changeTopicRef}
                type="button"
                disabled={busy}
                onClick={() => setMode('topic')}
                className={action}
              >
                <FolderInput className="size-[18px] text-fg-secondary" aria-hidden="true" />
                Cambia argomento
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
