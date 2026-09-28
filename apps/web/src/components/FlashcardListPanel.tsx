'use client';

import { useRef, useState } from 'react';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useVirtualizer } from '@tanstack/react-virtual';
import type { FlashcardPageDto, TopicDto } from '@studyhub/contracts';

async function fetchPage(
  slug: string,
  params: { topicId?: string | undefined; state?: string | undefined; cursor?: string | undefined },
): Promise<FlashcardPageDto> {
  const qs = new URLSearchParams();
  if (params.topicId) qs.set('topicId', params.topicId);
  if (params.state) qs.set('state', params.state);
  if (params.cursor) qs.set('cursor', params.cursor);
  const res = await fetch(`/api/subjects/${slug}/flashcards?${qs.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le flashcard');
  return body.page as FlashcardPageDto;
}

async function setSuspended(slug: string, cardId: string, suspended: boolean): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/flashcards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspended }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Aggiornamento fallito');
  }
}

const STATE_LABELS: Record<string, string> = {
  new: 'Nuova',
  learning: 'In apprendimento',
  review: 'In ripasso',
  relearning: 'Da rinforzare',
};

/**
 * Read-only flashcard list for the Flashcard tab (docs/fasi/F2-materie.md — bulk editing stays
 * F4). Virtualized (`@tanstack/react-virtual`) so a deck of thousands stays reactive
 * ("La pagina con 200 documenti e 2000 flashcard resta reattiva") — only the rows in (or near)
 * the visible window are ever mounted, cursor pages load lazily as the user scrolls near the end.
 */
export function FlashcardListPanel({
  subjectSlug,
  topics,
}: {
  subjectSlug: string;
  topics: TopicDto[];
}) {
  const [topicId, setTopicId] = useState('');
  const [state, setState] = useState('');
  const queryClient = useQueryClient();
  const parentRef = useRef<HTMLDivElement>(null);

  const query = useInfiniteQuery({
    queryKey: ['flashcard-list', subjectSlug, topicId, state],
    queryFn: ({ pageParam }) =>
      fetchPage(subjectSlug, {
        topicId: topicId || undefined,
        state: state || undefined,
        cursor: pageParam,
      }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });

  const suspendMutation = useMutation({
    mutationFn: ({ cardId, suspended }: { cardId: string; suspended: boolean }) =>
      setSuspended(subjectSlug, cardId, suspended),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['flashcard-list', subjectSlug] }),
  });

  const cards = query.data?.pages.flatMap((p) => p.items) ?? [];
  // One extra virtual row for the "carica altre" sentinel, only when there's actually more to load.
  const rowCount = cards.length + (query.hasNextPage ? 1 : 0);

  const rowVirtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 76,
    overscan: 10,
  });

  // Auto-load the next page once the sentinel row scrolls into (or near) view.
  const virtualItems = rowVirtualizer.getVirtualItems();
  const lastItem = virtualItems[virtualItems.length - 1];
  if (
    lastItem &&
    lastItem.index >= cards.length &&
    query.hasNextPage &&
    !query.isFetchingNextPage
  ) {
    void query.fetchNextPage();
  }

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 px-1">
        <h2 className="text-xs font-medium uppercase tracking-wide text-fg-muted">Flashcard</h2>
        <div className="flex flex-wrap gap-2">
          <select
            value={topicId}
            onChange={(e) => setTopicId(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
          >
            <option value="">Tutti gli argomenti</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select
            value={state}
            onChange={(e) => setState(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
          >
            <option value="">Tutti gli stati</option>
            {Object.entries(STATE_LABELS).map(([key, label]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && cards.length === 0 && (
        <p className="px-1 text-xs text-fg-muted">Nessuna flashcard corrisponde ai filtri.</p>
      )}

      {query.isSuccess && cards.length > 0 && (
        <div ref={parentRef} className="max-h-[70vh] overflow-y-auto">
          <div style={{ height: rowVirtualizer.getTotalSize(), position: 'relative' }}>
            {virtualItems.map((virtualRow) => {
              if (virtualRow.index >= cards.length) {
                return (
                  <div
                    key="sentinel"
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                    className="px-1 py-3 text-center text-xs text-fg-muted"
                  >
                    Caricamento altre…
                  </div>
                );
              }
              const card = cards[virtualRow.index]!;
              return (
                <div
                  key={card.id}
                  data-index={virtualRow.index}
                  ref={rowVirtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-start justify-between gap-3 border-b border-border px-1 py-2"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm text-fg-primary">{card.front}</p>
                    <p className="mt-0.5 truncate text-xs text-fg-muted">{card.back}</p>
                    <span className="mt-1 inline-block rounded-full border border-border px-1.5 py-0.5 text-[10px] text-fg-secondary">
                      {STATE_LABELS[card.state]}
                      {card.suspended ? ' · sospesa' : ''}
                    </span>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      suspendMutation.mutate({ cardId: card.id, suspended: !card.suspended })
                    }
                    disabled={suspendMutation.isPending}
                    className="shrink-0 text-[11px] text-fg-muted hover:text-fg-primary"
                  >
                    {card.suspended ? 'Riattiva' : 'Sospendi'}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {suspendMutation.isError && (
        <p role="alert" className="mt-1 px-1 text-xs text-danger">
          {(suspendMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
