'use client';

import Link from 'next/link';
import { Fragment, useEffect, useId, useRef, useState, type RefObject } from 'react';
import type { TaskFlashcardDto } from '@studyhub/contracts';
import { plainCardText } from '@/lib/flashcardMobile';
import { CardText } from '../CardText';
import { primaryButton, secondaryButton } from '../simulation-mobile/styles';
import { SectionEmpty, SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { AttachCardsPicker } from './AttachCardsPicker';
import { useTaskFlashcards, useTopicList, useUpdateTaskFlashcards } from './queries';
import {
  attachedAnnouncement,
  BLOCKED_LABELS,
  cardCountLabel,
  draftDeckIds,
  focusIndexAfterRemoval,
  reviewableCount,
  ripassaTaskHref,
} from './taskFlashcardsModel';

export type Variant = 'desktop' | 'mobile';
export type PanelView = 'detail' | 'picker';

interface TaskRef {
  id: string;
  title: string;
}

/** Attached cards of one task, with "Stacca" per row and "Attacca card…" (presentational: the view is owned by the panel). */
function TaskFlashcardsSection({
  slug,
  task,
  variant,
  onAttach,
  attachRef,
  onAnnounce,
}: {
  slug: string;
  task: TaskRef;
  variant: Variant;
  onAttach: () => void;
  attachRef: RefObject<HTMLButtonElement | null>;
  onAnnounce: (message: string) => void;
}) {
  const mobile = variant === 'mobile';
  const titleId = useId();
  const cards = useTaskFlashcards(slug, task.id, true);
  const topics = useTopicList(slug);
  const update = useUpdateTaskFlashcards(slug, task.id);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Where the focus goes once the row is gone: a card id, or 'attach'.
  const [focusTarget, setFocusTarget] = useState<string | null>(null);
  const stackRefs = useRef(new Map<string, HTMLButtonElement>());

  const items: TaskFlashcardDto[] = cards.data?.items ?? [];
  const reviewable = reviewableCount(items);
  const drafts = draftDeckIds(items);
  const topicName = (id: string | null) =>
    id ? (topics.data?.find((t) => t.id === id)?.name ?? null) : null;

  useEffect(() => {
    if (focusTarget === null) return;
    if (focusTarget === 'attach') attachRef.current?.focus();
    else stackRefs.current.get(focusTarget)?.focus();
    setFocusTarget(null);
  }, [focusTarget, attachRef]);

  const detach = async (card: TaskFlashcardDto, index: number) => {
    setPendingId(card.id);
    setError(null);
    try {
      await update.mutateAsync({ remove: [card.id] });
      onAnnounce('Card staccata.');
      const next = focusIndexAfterRemoval(index, items.length);
      const rest = items.filter((c) => c.id !== card.id);
      setFocusTarget(next === null ? 'attach' : (rest[next]?.id ?? 'attach'));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setPendingId(null);
    }
  };

  const attachButton = (
    <button
      ref={attachRef}
      type="button"
      onClick={onAttach}
      className={
        mobile
          ? `${secondaryButton} min-h-12`
          : 'min-h-11 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-sm font-medium text-fg-primary hover:bg-bg-inset'
      }
    >
      Attacca card…
    </button>
  );

  return (
    <section
      aria-labelledby={`task-cards-title-${titleId}`}
      aria-busy={cards.isPending || undefined}
      data-testid="task-flashcards"
      className="flex flex-col gap-2"
    >
      <div className="flex items-center justify-between gap-3">
        <h3
          id={`task-cards-title-${titleId}`}
          className="text-xs font-semibold uppercase tracking-[0.06em] text-fg-secondary"
        >
          Flashcard
        </h3>
        {items.length > 0 && (
          <span className="font-mono text-xs text-fg-muted">{cardCountLabel(items.length)}</span>
        )}
      </div>
      {cards.isPending ? (
        <SkeletonRows count={2} />
      ) : cards.isError ? (
        <SectionError message={cards.error.message} onRetry={() => void cards.refetch()} />
      ) : items.length === 0 ? (
        <>
          <SectionEmpty>
            <p>Nessuna flashcard attaccata a questa task.</p>
            {cards.data.topicId && (
              <p className="mt-1 text-xs">
                Le card dell’argomento vengono attaccate in automatico quando ci sono.
              </p>
            )}
          </SectionEmpty>
          {attachButton}
        </>
      ) : (
        <>
          <ul
            role="list"
            aria-label="Flashcard attaccate"
            className="rounded-[var(--radius-card)] border border-border bg-bg-surface"
          >
            {items.map((card, index) => (
              <li
                key={card.id}
                data-testid="task-flashcard-row"
                className="flex items-center gap-2 border-t border-border px-3 py-2 first:border-t-0"
              >
                <div className="min-w-0 flex-1">
                  <CardText
                    text={card.front}
                    side="front"
                    className={`line-clamp-2 break-words ${mobile ? 'text-[15px]' : 'text-sm'} text-fg-primary`}
                  />
                  <p className="flex min-w-0 items-center gap-1.5 text-xs text-fg-muted">
                    <span className="min-w-0 truncate">
                      {topicName(card.topicId) ?? 'Senza argomento'}
                    </span>
                    {!card.reviewable && (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-fg-secondary">
                        {card.blockedBy ? BLOCKED_LABELS[card.blockedBy] : 'Non in ripasso'}
                      </span>
                    )}
                    {card.source === 'user' && (
                      <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-fg-secondary">
                        manuale
                      </span>
                    )}
                  </p>
                </div>
                <button
                  ref={(el) => {
                    if (el) stackRefs.current.set(card.id, el);
                    else stackRefs.current.delete(card.id);
                  }}
                  type="button"
                  aria-label={`Stacca: ${plainCardText(card.front)}`}
                  aria-busy={pendingId === card.id || undefined}
                  disabled={pendingId === card.id}
                  onClick={() => void detach(card, index)}
                  className={`shrink-0 rounded-[var(--radius-control)] border border-border text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50 ${
                    mobile ? 'min-h-11 min-w-11 px-3' : 'min-h-7 px-2 py-1 max-md:min-h-11'
                  }`}
                >
                  Stacca
                </button>
              </li>
            ))}
          </ul>
          {drafts.length > 0 && (
            <p className="text-xs text-fg-secondary" data-testid="task-flashcards-drafts">
              {drafts.length === 1
                ? 'Alcune card sono in un mazzo ancora in bozza: approvalo per ripassarle. '
                : `Alcune card sono in ${drafts.length} mazzi ancora in bozza: approvali per ripassarle. `}
              {drafts.map((id, i) => (
                <Fragment key={id}>
                  {i > 0 && ' · '}
                  <Link
                    href={`/materie/${slug}/artifacts/${id}`}
                    className="font-medium text-accent underline-offset-2 hover:underline"
                  >
                    {drafts.length === 1 ? 'Apri il mazzo' : `Mazzo ${i + 1}`}
                  </Link>
                </Fragment>
              ))}
            </p>
          )}
          {reviewable > 0 ? (
            <div className="grid grid-cols-2 gap-2">
              {/* Same lesson-scoped queue as the session's "Flashcard della lezione". */}
              <Link
                href={ripassaTaskHref(slug, task.id)}
                aria-label={`Ripassa le ${reviewable} flashcard della task`}
                data-testid="task-flashcards-review"
                className={
                  mobile
                    ? `${primaryButton} min-h-12 text-sm`
                    : 'inline-flex min-h-11 items-center justify-center rounded-[var(--radius-control)] bg-accent px-4 text-sm font-semibold text-bg-base hover:bg-accent-hover'
                }
              >
                Ripassa ({reviewable})
              </Link>
              {attachButton}
            </div>
          ) : (
            attachButton
          )}
        </>
      )}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
    </section>
  );
}

/**
 * Detail <-> picker of the cards of one task, shared by the desktop dialog and the mobile sheet.
 * `onViewChange` lets the host hide its own actions while the picker is open.
 */
export function TaskFlashcardsPanel({
  slug,
  task,
  variant,
  onViewChange,
}: {
  slug: string;
  task: TaskRef;
  variant: Variant;
  onViewChange?: (view: PanelView) => void;
}) {
  const [view, setViewState] = useState<PanelView>('detail');
  const [announcement, setAnnouncement] = useState('');
  const attachRef = useRef<HTMLButtonElement>(null);
  const [refocusAttach, setRefocusAttach] = useState(false);
  const cards = useTaskFlashcards(slug, task.id, true);

  const setView = (next: PanelView) => {
    setViewState(next);
    onViewChange?.(next);
    if (next === 'detail') setRefocusAttach(true);
  };

  useEffect(() => {
    if (view === 'detail' && refocusAttach && attachRef.current) {
      attachRef.current.focus();
      setRefocusAttach(false);
    }
  }, [view, refocusAttach, cards.isSuccess]);

  return (
    <>
      {view === 'picker' ? (
        <AttachCardsPicker
          slug={slug}
          task={task}
          topicId={cards.data?.topicId ?? null}
          attachedIds={new Set((cards.data?.items ?? []).map((c) => c.id))}
          ready={cards.isSuccess}
          variant={variant}
          onCancel={() => setView('detail')}
          onAttached={(n) => {
            setAnnouncement(attachedAnnouncement(n));
            setView('detail');
          }}
        />
      ) : (
        <TaskFlashcardsSection
          slug={slug}
          task={task}
          variant={variant}
          onAttach={() => setView('picker')}
          attachRef={attachRef}
          onAnnounce={setAnnouncement}
        />
      )}
      <div role="status" aria-live="polite" className="sr-only">
        {announcement}
      </div>
    </>
  );
}
