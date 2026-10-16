'use client';

import Link from 'next/link';
import { useCallback, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckGroupDto, TopicDto } from '@studyhub/contracts';
import {
  buildDeckTree,
  canReview,
  groupFilterValue,
  groupName,
  reviewHref,
} from '@/lib/deckGroups';
import { deckGroupsKey, useDeckGroups } from '@/lib/deckGroupsClient';
import { AutoSortCta, useAutoSort } from './AutoSortCta';

const REVIEW_LINK =
  'shrink-0 rounded-[var(--radius-control)] border border-border px-2 py-0.5 text-[11px] text-fg-primary hover:bg-bg-inset';

function focusTopicsTitle() {
  const el = document.getElementById('topics-panel-title');
  el?.scrollIntoView({ block: 'center' });
  el?.focus();
}

function DeckTile({
  slug,
  group,
  depth,
  selected,
  onSelect,
  dashed,
  children,
}: {
  slug: string;
  group: DeckGroupDto;
  depth: 0 | 1;
  selected: boolean;
  onSelect: () => void;
  dashed?: boolean;
  children?: React.ReactNode;
}) {
  const name = groupName(group);
  const reviewable = canReview(group);
  return (
    <li
      className={`flex min-w-0 flex-col gap-1 rounded-[var(--radius-control)] border p-2 ${
        selected ? 'border-2 border-accent bg-accent-subtle' : 'border-border bg-bg-inset'
      } ${dashed ? 'border-dashed' : ''} ${depth === 1 ? 'ml-4' : ''}`}
    >
      <button
        type="button"
        aria-pressed={selected}
        aria-label={`Mazzo ${name}: ${group.total} card, ${group.due} da ripassare, ${group.new} nuove`}
        onClick={onSelect}
        className="min-w-0 text-left"
      >
        <span className="block truncate text-sm text-fg-primary">
          {depth === 1 && <span aria-hidden="true">↳ </span>}
          {name}
        </span>
        <span className="block text-xs text-fg-muted">{group.total} card</span>
      </button>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
        <span className={group.due > 0 ? 'text-accent' : 'text-fg-muted'}>
          {group.due} da ripassare
        </span>
        <span className="text-fg-muted">{group.new} nuove</span>
        {reviewable ? (
          <Link
            href={reviewHref(slug, group)}
            aria-label={`Ripassa ${name}`}
            className={`${REVIEW_LINK} ml-auto`}
          >
            Ripassa
          </Link>
        ) : (
          <span
            aria-disabled="true"
            aria-label={`Ripassa ${name}`}
            className={`${REVIEW_LINK} ml-auto opacity-50`}
          >
            Ripassa
          </span>
        )}
      </div>
      {children}
    </li>
  );
}

/** "Mazzi per argomento": one tile per topic with cards; selecting one filters the list below. */
export function DeckGroupsPanel({
  subjectSlug,
  topics,
  selectedTopicId,
  onSelect,
}: {
  subjectSlug: string;
  topics: TopicDto[];
  selectedTopicId: string;
  onSelect: (topicId: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useDeckGroups(subjectSlug);
  const onFinished = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: deckGroupsKey(subjectSlug) });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-list', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-stats', subjectSlug] });
    void queryClient.invalidateQueries({ queryKey: ['stats', subjectSlug] });
  }, [queryClient, subjectSlug]);
  const sort = useAutoSort(subjectSlug, onFinished);

  const tree = useMemo(() => buildDeckTree(query.data ?? [], topics), [query.data, topics]);
  const toggle = (g: DeckGroupDto) => {
    const value = groupFilterValue(g);
    onSelect(selectedTopicId === value ? '' : value);
  };
  const showUnsorted = tree.unsorted !== null || sort.touched;
  const empty = query.isSuccess && tree.rows.length === 0 && !showUnsorted;
  const unsortedGroup: DeckGroupDto = tree.unsorted ?? {
    topicId: null,
    topicName: null,
    parentTopicId: null,
    total: 0,
    due: 0,
    new: 0,
    suspended: 0,
  };

  return (
    <section
      aria-labelledby="deck-groups-title"
      aria-busy={query.isLoading || undefined}
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3"
    >
      <div className="mb-2 flex items-center justify-between gap-2 px-1">
        <h2
          id="deck-groups-title"
          className="text-xs font-medium uppercase tracking-wide text-fg-muted"
        >
          Mazzi per argomento
        </h2>
        {selectedTopicId !== '' && (
          <button
            type="button"
            onClick={() => onSelect('')}
            className="text-[11px] text-fg-muted hover:text-fg-primary"
          >
            Mostra tutte le card
          </button>
        )}
      </div>

      {query.isLoading && (
        <div
          aria-hidden="true"
          className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-20 animate-pulse rounded-[var(--radius-control)] bg-bg-inset"
            />
          ))}
        </div>
      )}
      {query.isError && (
        <div className="flex items-center gap-3 px-1">
          <p role="alert" className="text-xs text-danger">
            {(query.error as Error).message}
          </p>
          <button
            type="button"
            onClick={() => void query.refetch()}
            className="text-xs text-fg-primary underline"
          >
            Riprova
          </button>
        </div>
      )}
      {empty && (
        <p className="px-1 text-xs text-fg-muted">
          Nessuna flashcard ancora. Genera un mazzo dal materiale.
        </p>
      )}
      {query.isSuccess && !empty && (
        <ul
          role="list"
          aria-label="Mazzi per argomento"
          className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-2"
        >
          {tree.rows.map(({ group, depth }) => (
            <DeckTile
              key={group.topicId}
              slug={subjectSlug}
              group={group}
              depth={depth}
              selected={selectedTopicId === groupFilterValue(group)}
              onSelect={() => toggle(group)}
            />
          ))}
          {showUnsorted && (
            <DeckTile
              slug={subjectSlug}
              group={unsortedGroup}
              depth={0}
              dashed
              selected={selectedTopicId === groupFilterValue(unsortedGroup)}
              onSelect={() => toggle(unsortedGroup)}
            >
              <AutoSortCta
                sort={sort}
                hasTopics={topics.length > 0}
                variant="desktop"
                noTopicsLink={
                  <button
                    type="button"
                    onClick={focusTopicsTitle}
                    className="text-accent underline"
                  >
                    Apri il pannello Argomenti a sinistra
                  </button>
                }
              />
            </DeckTile>
          )}
        </ul>
      )}
    </section>
  );
}
