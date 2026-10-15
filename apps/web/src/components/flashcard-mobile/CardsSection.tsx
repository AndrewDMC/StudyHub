'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import type { FlashcardDto, FlashcardStatsDto, TopicDto } from '@studyhub/contracts';
import { materialHref } from '@/lib/subjectTabs';
import type { Filters } from '../FlashcardListPanel';
import {
  MobileSection,
  SectionEmpty,
  SectionError,
  SkeletonRows,
} from '../subject-mobile/SectionState';
import { FlashcardDetailSheet } from './FlashcardDetailSheet';
import { FlashcardRow } from './FlashcardRow';
import { useFlashcardPages } from './queries';

const chip =
  'min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent border-border text-fg-secondary';

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** "Le tue card": count, search, topic chips, the list (50 per page on demand) and the detail sheet. */
export function CardsSection({
  slug,
  topics,
  stats,
}: {
  slug: string;
  topics: TopicDto[];
  stats: FlashcardStatsDto | undefined;
}) {
  const [topicId, setTopicId] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<FlashcardDto | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);

  const q = useDebounced(text.trim(), 250);
  const filters: Filters = { topicId, state: '', deckId: '', tag: '', q, flagged: false };
  const filtered = topicId !== '' || q !== '';

  const query = useFlashcardPages(slug, filters);
  const cards = query.data?.pages.flatMap((p) => p.items) ?? [];
  const topicChips = (stats?.topicMastery ?? []).filter((t) => t.cardCount > 0);

  const total = stats
    ? Object.values(stats.countsByState).reduce((a, b) => a + b, 0) +
      stats.suspendedCount +
      stats.flaggedCount
    : null;
  const count = filtered
    ? `${cards.length}${query.hasNextPage ? '+' : ''}`
    : total !== null
      ? String(total)
      : null;

  return (
    <MobileSection
      title="Le tue card"
      busy={query.isLoading}
      action={
        <span className="flex items-center gap-1">
          {count !== null && <span className="font-mono text-xs text-fg-muted">{count}</span>}
          <button
            type="button"
            aria-label="Cerca tra le flashcard"
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen((v) => !v)}
            className="-mr-2 flex size-11 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary"
          >
            <Search className="size-5" aria-hidden="true" />
          </button>
        </span>
      }
    >
      {searchOpen && (
        <input
          type="search"
          aria-label="Cerca nelle card"
          placeholder="Cerca nel testo…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          className="mb-2 min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-base text-fg-primary"
        />
      )}

      {topicChips.length > 0 && (
        <div
          role="group"
          aria-label="Filtra per argomento"
          className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4"
        >
          <button
            type="button"
            aria-pressed={topicId === ''}
            onClick={() => setTopicId('')}
            className={chip}
          >
            Tutte
          </button>
          {topicChips.map((t) => (
            <button
              key={t.topicId}
              type="button"
              aria-pressed={topicId === t.topicId}
              onClick={() => setTopicId(t.topicId)}
              className={chip}
            >
              {t.name}
            </button>
          ))}
        </div>
      )}

      {query.isLoading ? (
        <SkeletonRows count={4} />
      ) : query.isError ? (
        <SectionError
          message={(query.error as Error).message}
          onRetry={() => void query.refetch()}
        />
      ) : cards.length === 0 ? (
        filtered ? (
          <SectionEmpty>Nessuna flashcard corrisponde ai filtri.</SectionEmpty>
        ) : (
          <SectionEmpty>
            <p>Nessuna flashcard ancora. Genera un mazzo da un documento.</p>
            <Link
              href={materialHref(slug, 'tutti')}
              className="mt-2 inline-flex min-h-11 items-center font-medium text-accent"
            >
              Vai al materiale
            </Link>
          </SectionEmpty>
        )
      ) : (
        <>
          <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface">
            {cards.map((card, i) => (
              <li key={card.id} className={i > 0 ? 'border-t border-border' : undefined}>
                <FlashcardRow
                  card={card}
                  topicName={topics.find((t) => t.id === card.topicId)?.name ?? null}
                  onOpen={(trigger) => {
                    triggerRef.current = trigger;
                    setSelected(card);
                  }}
                />
              </li>
            ))}
          </ul>
          {query.hasNextPage && (
            <button
              type="button"
              disabled={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
              className="mt-2 min-h-11 w-full rounded-[var(--radius-control)] border border-border text-sm text-fg-primary disabled:opacity-60"
            >
              {query.isFetchingNextPage ? 'Caricamento…' : 'Mostra altre'}
            </button>
          )}
        </>
      )}

      <FlashcardDetailSheet
        slug={slug}
        card={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        returnFocusRef={triggerRef}
      />
    </MobileSection>
  );
}
