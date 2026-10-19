'use client';

import type { TopicDto } from '@studyhub/contracts';
import { useDeckGroups } from '@/lib/deckGroupsClient';
import type { FlashcardGroup } from '@/lib/flashcardsView';
import { useDeckSummaries, useFlashcardStats } from '../api';
import { EmptyState } from '../shared/EmptyState';
import { SKELETON } from '../shared/styles';
import { AttentionList } from './AttentionList';
import { DeckRows, activeDeckTotals } from './DeckRows';
import { GroupToggle } from './GroupToggle';
import { TodayHero } from './TodayHero';
import { TopicRows, topicGroupsTotal } from './TopicRows';

/** Panoramica: today's review, what needs fixing, and "Le tue card" per argomento or per mazzo. */
export function OverviewView({
  slug,
  topics,
  group,
  onGroupChange,
  onAdd,
}: {
  slug: string;
  topics: TopicDto[];
  group: FlashcardGroup;
  onGroupChange: (group: FlashcardGroup) => void;
  onAdd: (mode: 'ai' | 'manual' | 'deck') => void;
}) {
  const stats = useFlashcardStats(slug);
  const groups = useDeckGroups(slug);
  const decks = useDeckSummaries(slug);

  const s = stats.data;
  const noCards =
    !!s &&
    Object.values(s.countsByState).reduce((a, b) => a + b, 0) +
      s.suspendedCount +
      s.flaggedCount +
      s.draftCardCount ===
      0;
  const hasBlockedNew = (groups.data ?? []).some((g) => (g.newBlockedCount ?? 0) > 0);

  const focusCards = () => {
    const el = document.getElementById('fc-mazzi');
    el?.scrollIntoView({ block: 'start' });
    el?.focus();
  };

  if (noCards) {
    return <EmptyState onGenerate={() => onAdd('ai')} onWrite={() => onAdd('manual')} />;
  }

  const topicTotal = topicGroupsTotal(groups.data);
  const deckTotals = activeDeckTotals(decks.data);
  let count: string | null = null;
  if (group === 'argomento' && topicTotal !== null) count = String(topicTotal);
  if (group === 'mazzo' && deckTotals) {
    count = `${deckTotals.cards} in ${deckTotals.count} ${deckTotals.count === 1 ? 'mazzo attivo' : 'mazzi attivi'}`;
  }

  return (
    <div className="flex flex-col gap-5">
      <TodayHero slug={slug} hasBlockedNew={hasBlockedNew} onPickTopic={focusCards} />
      <AttentionList slug={slug} />
      <section id="fc-argomenti" aria-labelledby="fc-mazzi" className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 id="fc-mazzi" tabIndex={-1} className="text-base font-semibold outline-none">
            Le tue card{' '}
            {count !== null ? (
              <span className="text-sm font-normal text-fg-secondary">· {count}</span>
            ) : (
              <span
                aria-hidden="true"
                className={`ml-1 inline-block h-4 w-10 rounded align-middle ${SKELETON}`}
              />
            )}
          </h2>
          <GroupToggle value={group} onChange={onGroupChange} />
        </div>
        {group === 'argomento' ? (
          <TopicRows slug={slug} topics={topics} />
        ) : (
          <DeckRows slug={slug} onAdd={onAdd} />
        )}
      </section>
    </div>
  );
}
