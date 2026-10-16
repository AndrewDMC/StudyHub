'use client';

import Link from 'next/link';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import { materialHref } from '@/lib/subjectTabs';
import { CardText } from '../CardText';
import { STATE_LABELS, fetchPage, useDebounced, type Filters } from '../FlashcardListPanel';
import { primaryButton } from '../simulation-mobile/styles';
import { SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { useTopicList, useUpdateTaskFlashcards } from './queries';
import { MAX_ATTACH, attachableCards, topicFilterParam, topicOptions } from './taskFlashcardsModel';

const SELECT =
  'min-h-11 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-base text-fg-primary md:min-h-9 md:text-sm';
const SEARCH =
  'min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-base text-fg-primary outline-none focus:border-accent md:min-h-9 md:text-sm';
const EMPTY_FILTERS: Filters = {
  topicId: '',
  state: '',
  deckId: '',
  tag: '',
  q: '',
  flagged: false,
};

/** Multi-select of the subject's cards to attach to a task; already attached ones are shown checked and disabled. */
export function AttachCardsPicker({
  slug,
  task,
  topicId,
  attachedIds,
  ready,
  variant,
  onCancel,
  onAttached,
}: {
  slug: string;
  task: { id: string; title: string };
  /** Topic of the task: preselected in the filter. */
  topicId: string | null;
  attachedIds: ReadonlySet<string>;
  /** The attached list is loaded: "Attacca" waits for it. */
  ready: boolean;
  variant: 'desktop' | 'mobile';
  onCancel: () => void;
  onAttached: (count: number) => void;
}) {
  const mobile = variant === 'mobile';
  const uid = useId();
  const searchRef = useRef<HTMLInputElement>(null);
  const [q, setQ] = useState('');
  const [topicFilter, setTopicFilter] = useState(topicId ?? 'all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const debouncedQ = useDebounced(q, 250);
  const topics = useTopicList(slug);
  const update = useUpdateTaskFlashcards(slug, task.id);

  useEffect(() => searchRef.current?.focus(), []);

  const filters: Filters = {
    ...EMPTY_FILTERS,
    topicId: topicFilterParam(topicFilter),
    q: debouncedQ,
  };
  const query = useInfiniteQuery({
    queryKey: ['task-card-picker', slug, task.id, topicFilter, debouncedQ],
    queryFn: ({ pageParam }) => fetchPage(slug, filters, pageParam, { suspended: false }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const rows = useMemo(
    () => attachableCards(query.data?.pages ?? [], attachedIds),
    [query.data, attachedIds],
  );
  const options = useMemo(() => topicOptions(topics.data ?? []), [topics.data]);
  const topicName = (id: string | null) =>
    id ? (topics.data?.find((t) => t.id === id)?.name ?? null) : null;

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const count = selected.size;
  const tooMany = count > MAX_ATTACH;
  const submit = async () => {
    setError(null);
    try {
      await update.mutateAsync({ add: [...selected] });
      onAttached(count);
    } catch (err) {
      setError((err as Error).message);
    }
  };

  const noCardsAtAll = topicFilter === 'all' && debouncedQ === '';

  return (
    <div data-testid="attach-picker" className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <button
          type="button"
          aria-label="Torna alla task"
          onClick={onCancel}
          className="-ml-2 flex min-h-11 items-center gap-1 rounded-[var(--radius-control)] px-2 text-sm text-fg-secondary hover:text-fg-primary"
        >
          <ArrowLeft aria-hidden="true" className="h-4 w-4" />
          Indietro
        </button>
        <h3 className="text-sm font-medium text-fg-primary">Attacca card</h3>
      </div>
      <div className="flex flex-col gap-2">
        <label htmlFor={`${uid}-q`} className="sr-only">
          Cerca nelle card
        </label>
        <input
          ref={searchRef}
          id={`${uid}-q`}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Cerca nelle card"
          className={SEARCH}
        />
        <label htmlFor={`${uid}-topic`} className="text-xs text-fg-muted">
          Argomento
        </label>
        <select
          id={`${uid}-topic`}
          aria-label="Filtra per argomento"
          value={topicFilter}
          onChange={(e) => setTopicFilter(e.target.value)}
          className={SELECT}
        >
          <option value="all">Tutti</option>
          <option value="none">Senza argomento</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.label}
            </option>
          ))}
        </select>
      </div>
      <p role="status" aria-live="polite" className="text-xs text-fg-muted">
        {rows.length} card · {count} selezionate
      </p>

      {query.isPending ? (
        <div aria-busy="true">
          <SkeletonRows count={4} />
        </div>
      ) : query.isError ? (
        <SectionError
          message="Impossibile caricare le flashcard"
          onRetry={() => void query.refetch()}
        />
      ) : rows.length === 0 ? (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4 text-center text-sm text-fg-muted">
          {noCardsAtAll ? (
            <>
              <p>Questa materia non ha ancora flashcard. Generale dal materiale.</p>
              <Link
                href={materialHref(slug, 'tutti')}
                className="mt-2 inline-flex min-h-11 items-center text-fg-primary underline"
              >
                Vai al materiale
              </Link>
            </>
          ) : (
            <>
              <p>Nessuna card trovata.</p>
              {topicFilter !== 'all' && (
                <button
                  type="button"
                  onClick={() => setTopicFilter('all')}
                  className="mt-2 min-h-11 text-fg-primary underline"
                >
                  Mostra tutte le card
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <ul
          role="list"
          aria-label="Card della materia"
          className={`rounded-[var(--radius-card)] border border-border bg-bg-surface ${
            mobile ? '' : 'max-h-[50dvh] overflow-y-auto'
          }`}
        >
          {rows.map(({ card, attached }) => {
            const metaId = `${uid}-meta-${card.id}`;
            return (
              <li
                key={card.id}
                data-testid="attach-card-row"
                className="border-t border-border first:border-t-0"
              >
                <label
                  className={`flex min-h-14 items-start gap-3 px-3.5 py-3 ${
                    attached ? 'opacity-70' : 'cursor-pointer'
                  }`}
                >
                  <input
                    type="checkbox"
                    checked={attached || selected.has(card.id)}
                    disabled={attached}
                    onChange={() => toggle(card.id)}
                    aria-describedby={metaId}
                    className="mt-0.5 size-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 flex-1">
                    <CardText
                      text={card.front}
                      side="front"
                      className="line-clamp-2 break-words text-[15px] text-fg-primary md:text-sm"
                    />
                    <span id={metaId} className="block truncate text-xs text-fg-muted">
                      {topicName(card.topicId) ?? 'Senza argomento'} · {STATE_LABELS[card.state]}
                    </span>
                  </span>
                  {attached && (
                    <span className="shrink-0 rounded-full border border-border px-2 py-0.5 text-xs text-fg-secondary">
                      Già attaccata
                    </span>
                  )}
                </label>
              </li>
            );
          })}
        </ul>
      )}
      {query.hasNextPage && (
        <button
          type="button"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
          className="min-h-11 rounded-[var(--radius-control)] border border-border px-4 text-sm text-fg-primary disabled:opacity-50"
        >
          {query.isFetchingNextPage ? 'Caricamento…' : 'Carica altre'}
        </button>
      )}

      <div className="sticky bottom-0 -mx-1 flex flex-col gap-2 border-t border-border bg-bg-surface px-1 pb-[env(safe-area-inset-bottom)] pt-3">
        {tooMany && (
          <p className="text-xs text-fg-muted">Puoi attaccare al massimo 500 card per volta.</p>
        )}
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-12 flex-1 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-4 text-sm font-semibold text-fg-primary md:min-h-11 md:flex-none"
          >
            Annulla
          </button>
          <button
            type="button"
            disabled={count === 0 || tooMany || !ready || update.isPending}
            onClick={() => void submit()}
            className={`${primaryButton} min-h-12 flex-1 text-sm md:min-h-11 md:w-auto md:flex-none`}
          >
            Attacca ({count})
          </button>
        </div>
      </div>
    </div>
  );
}
