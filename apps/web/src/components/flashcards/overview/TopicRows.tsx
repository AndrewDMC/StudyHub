'use client';

import { useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { DeckGroupDto, TopicDto } from '@studyhub/contracts';
import {
  buildDeckTree,
  canReview,
  groupFilterValue,
  groupName,
  reviewHref,
} from '@/lib/deckGroups';
import { useDeckGroups } from '@/lib/deckGroupsClient';
import { flashcardsLink } from '@/lib/flashcardsView';
import { useAutoSort } from '../../deck-groups/useAutoSort';
import { invalidateFlashcards, useFlashcardStats } from '../api';
import { MasteryBar } from '../shared/MasteryBar';
import { BlockError, SkeletonRows } from '../shared/Skeletons';
import { BTN_SECONDARY, CARD_BOX, FOCUS } from '../shared/styles';
import { AutoSortRow } from './AutoSortRow';

const GRID =
  '@2xl/fc:grid @2xl/fc:grid-cols-[minmax(160px,2fr)_minmax(120px,1.3fr)_minmax(150px,1.4fr)_104px]';

function TodayCell({ group }: { group: DeckGroupDto }) {
  const blocked = group.newBlockedCount ?? 0;
  if (group.due > 0) {
    return (
      <span className="text-[13px]">
        <span className="font-medium text-accent-hover">{group.due} da ripassare</span>
        {group.new > 0 && <span className="text-fg-secondary"> · {group.new} nuove</span>}
      </span>
    );
  }
  if (group.new > 0)
    return <span className="text-[13px] text-fg-secondary">{group.new} nuove</span>;
  if (blocked > 0)
    return <span className="text-[13px] text-fg-secondary">In attesa del piano</span>;
  return <span className="text-[13px] text-fg-secondary">Niente da ripassare oggi</span>;
}

function TopicRow({
  slug,
  group,
  depth,
  childCount,
  mastery,
}: {
  slug: string;
  group: DeckGroupDto;
  depth: 0 | 1;
  childCount: number;
  mastery: number | null | undefined;
}) {
  const name = groupName(group);
  const waiting = (group.newBlockedCount ?? 0) > 0 && group.due + group.new === 0;
  return (
    <li
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3.5 last:border-0 ${GRID} ${depth === 1 ? 'bg-bg-inset @2xl/fc:pl-10' : ''}`}
    >
      <Link
        href={flashcardsLink(slug, { view: 'card', argomento: groupFilterValue(group) })}
        scroll={false}
        className={`flex min-h-10 min-w-0 flex-1 basis-40 flex-col justify-center ${FOCUS}`}
      >
        <span className="truncate font-medium text-fg-primary">
          {depth === 1 && <span aria-hidden="true">↳ </span>}
          {name}
        </span>
        <span className="text-[13px] text-fg-secondary">
          {group.total} card
          {childCount > 0 &&
            ` · ${childCount} ${childCount === 1 ? 'sotto-argomento' : 'sotto-argomenti'}`}
        </span>
      </Link>
      <div className="order-last basis-full @2xl/fc:order-none @2xl/fc:basis-auto">
        <MasteryBar mastery={mastery ?? null} />
      </div>
      <TodayCell group={group} />
      <div className="ml-auto @2xl/fc:ml-0">
        {canReview(group) ? (
          <Link
            href={reviewHref(slug, group)}
            aria-label={`Ripassa ${name}`}
            className={`${BTN_SECONDARY} w-full`}
          >
            Ripassa
          </Link>
        ) : waiting ? (
          <span className="text-[13px] text-fg-secondary">Non ancora</span>
        ) : null}
      </div>
    </li>
  );
}

/** "Le tue card" per argomento: mastery, today's work, and the review link of each topic. */
export function TopicRows({ slug, topics }: { slug: string; topics: TopicDto[] }) {
  const qc = useQueryClient();
  const query = useDeckGroups(slug);
  const stats = useFlashcardStats(slug);
  const onFinished = useCallback(() => invalidateFlashcards(qc, slug), [qc, slug]);
  const sort = useAutoSort(slug, onFinished);

  const tree = useMemo(() => buildDeckTree(query.data ?? [], topics), [query.data, topics]);
  const mastery = useMemo(
    () => new Map((stats.data?.topicMastery ?? []).map((t) => [t.topicId, t.mastery])),
    [stats.data],
  );
  const childCounts = useMemo(() => {
    const map = new Map<string, number>();
    for (const { group, depth } of tree.rows) {
      if (depth === 1 && group.parentTopicId) {
        map.set(group.parentTopicId, (map.get(group.parentTopicId) ?? 0) + 1);
      }
    }
    return map;
  }, [tree.rows]);

  if (query.isError) {
    return (
      <BlockError
        message="Impossibile caricare gli argomenti."
        onRetry={() => void query.refetch()}
      />
    );
  }
  if (query.isLoading) {
    return (
      <div aria-busy="true">
        <SkeletonRows count={5} />
      </div>
    );
  }
  const showUnsorted = (tree.unsorted && tree.unsorted.total > 0) || sort.touched;
  if (tree.rows.length === 0 && !showUnsorted) return null;
  const unsorted: DeckGroupDto = tree.unsorted ?? {
    topicId: null,
    topicName: null,
    parentTopicId: null,
    total: 0,
    due: 0,
    new: 0,
    suspended: 0,
  };

  return (
    <div className={`${CARD_BOX} overflow-hidden`}>
      <div
        aria-hidden="true"
        className={`hidden gap-4 border-b border-border px-5 py-2.5 text-xs uppercase tracking-[0.05em] text-fg-secondary ${GRID}`}
      >
        <span>Argomento</span>
        <span>Padronanza</span>
        <span>Oggi</span>
        <span />
      </div>
      <ul aria-label="Mazzi per argomento">
        {tree.rows.map(({ group, depth }) => (
          <TopicRow
            key={group.topicId}
            slug={slug}
            group={group}
            depth={depth}
            childCount={childCounts.get(group.topicId ?? '') ?? 0}
            mastery={group.topicId ? mastery.get(group.topicId) : null}
          />
        ))}
        {showUnsorted && (
          <AutoSortRow slug={slug} group={unsorted} hasTopics={topics.length > 0} sort={sort} />
        )}
      </ul>
    </div>
  );
}

/** Sum of the cards of the topic groups: the number shown next to "Le tue card". */
export function topicGroupsTotal(groups: DeckGroupDto[] | undefined): number | null {
  return groups ? groups.reduce((sum, g) => sum + g.total, 0) : null;
}
