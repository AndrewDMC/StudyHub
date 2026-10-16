'use client';

import Link from 'next/link';
import { useCallback, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Play } from 'lucide-react';
import type { DeckGroupDto, TopicDto } from '@studyhub/contracts';
import {
  buildDeckTree,
  canReview,
  groupFilterValue,
  groupName,
  groupSummary,
  reviewHref,
} from '@/lib/deckGroups';
import { deckGroupsKey, useDeckGroups } from '@/lib/deckGroupsClient';
import { materialHref } from '@/lib/subjectTabs';
import { AutoSortCta, useAutoSort } from '../deck-groups/AutoSortCta';
import {
  MobileSection,
  SectionEmpty,
  SectionError,
  SkeletonRows,
} from '../subject-mobile/SectionState';

export const CARDS_TITLE_ID = 'flashcard-cards-title';
const COLLAPSED_LIMIT = 5;

function DeckRowItem({
  slug,
  group,
  depth,
  selected,
  onSelect,
  children,
}: {
  slug: string;
  group: DeckGroupDto;
  depth: 0 | 1;
  selected: boolean;
  onSelect: () => void;
  children?: React.ReactNode;
}) {
  const name = groupName(group);
  return (
    <li className={`border-t border-border first:border-t-0 ${selected ? 'bg-accent-subtle' : ''}`}>
      <div className="flex items-center">
        <button
          type="button"
          aria-pressed={selected}
          aria-label={`Mazzo ${name}: ${groupSummary(group)}`}
          onClick={onSelect}
          className={`flex min-h-14 min-w-0 flex-1 flex-col justify-center py-2 pr-2 text-left ${depth === 1 ? 'pl-8' : 'pl-4'} ${selected ? 'border-l-4 border-accent' : ''}`}
        >
          <span className="block truncate text-[15px] text-fg-primary">{name}</span>
          <span className="block truncate text-xs text-fg-muted">{groupSummary(group)}</span>
        </button>
        {canReview(group) ? (
          <Link
            href={reviewHref(slug, group)}
            aria-label={`Ripassa ${name}`}
            className="flex size-11 shrink-0 items-center justify-center text-accent"
          >
            <Play className="size-[18px]" aria-hidden="true" />
          </Link>
        ) : (
          <span aria-hidden="true" className="size-11 shrink-0" />
        )}
      </div>
      {children}
    </li>
  );
}

/** "Mazzi per argomento": a row per topic with cards; tapping one filters "Le tue card" below. */
export function DeckGroupsSection({
  slug,
  topics,
  topicId,
  onTopicChange,
}: {
  slug: string;
  topics: TopicDto[];
  topicId: string;
  onTopicChange: (topicId: string) => void;
}) {
  const queryClient = useQueryClient();
  const query = useDeckGroups(slug);
  const [expanded, setExpanded] = useState(false);
  const onFinished = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: deckGroupsKey(slug) });
    void queryClient.invalidateQueries({ queryKey: ['flashcard-list', slug] });
    void queryClient.invalidateQueries({ queryKey: ['stats', slug] });
  }, [queryClient, slug]);
  const sort = useAutoSort(slug, onFinished);

  const tree = useMemo(() => buildDeckTree(query.data ?? [], topics), [query.data, topics]);
  const showUnsorted = tree.unsorted !== null || sort.touched;
  const rows = expanded || tree.rows.length <= 6 ? tree.rows : tree.rows.slice(0, COLLAPSED_LIMIT);
  const unsortedGroup: DeckGroupDto = tree.unsorted ?? {
    topicId: null,
    topicName: null,
    parentTopicId: null,
    total: 0,
    due: 0,
    new: 0,
    suspended: 0,
  };

  const toggle = (g: DeckGroupDto) => {
    const value = groupFilterValue(g);
    const next = topicId === value ? '' : value;
    onTopicChange(next);
    if (next !== '') {
      const title = document.getElementById(CARDS_TITLE_ID);
      title?.scrollIntoView({ block: 'start' });
      title?.focus();
    }
  };

  return (
    <MobileSection
      title="Mazzi"
      busy={query.isLoading}
      action={
        query.isSuccess && tree.rows.length > 0 ? (
          <span className="font-mono text-xs text-fg-muted">{tree.rows.length} argomenti</span>
        ) : undefined
      }
    >
      {query.isLoading ? (
        <SkeletonRows count={3} />
      ) : query.isError ? (
        <SectionError
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : tree.rows.length === 0 && !showUnsorted ? (
        <SectionEmpty>
          <p>Nessun mazzo ancora. Genera flashcard dal materiale.</p>
          <Link
            href={materialHref(slug, 'tutti')}
            className="mt-2 inline-flex min-h-11 items-center font-medium text-accent"
          >
            Vai al materiale
          </Link>
        </SectionEmpty>
      ) : (
        <>
          <ul
            aria-label="Mazzi per argomento"
            className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface"
          >
            {rows.map(({ group, depth }) => (
              <DeckRowItem
                key={group.topicId}
                slug={slug}
                group={group}
                depth={depth}
                selected={topicId === groupFilterValue(group)}
                onSelect={() => toggle(group)}
              />
            ))}
            {showUnsorted && (
              <DeckRowItem
                slug={slug}
                group={unsortedGroup}
                depth={0}
                selected={topicId === groupFilterValue(unsortedGroup)}
                onSelect={() => toggle(unsortedGroup)}
              >
                <div className="px-4 pb-3">
                  <AutoSortCta
                    sort={sort}
                    hasTopics={topics.length > 0}
                    variant="mobile"
                    noTopicsLink={
                      <Link
                        href={materialHref(slug, 'tutti')}
                        className="inline-flex min-h-11 items-center font-medium text-accent"
                      >
                        Vai al materiale
                      </Link>
                    }
                  />
                </div>
              </DeckRowItem>
            )}
          </ul>
          {tree.rows.length > 6 && (
            <button
              type="button"
              aria-expanded={expanded}
              onClick={() => setExpanded((v) => !v)}
              className="mt-2 min-h-11 w-full rounded-[var(--radius-control)] border border-border text-sm text-fg-primary"
            >
              {expanded ? 'Mostra meno' : `Mostra tutti (${tree.rows.length})`}
            </button>
          )}
        </>
      )}
    </MobileSection>
  );
}
