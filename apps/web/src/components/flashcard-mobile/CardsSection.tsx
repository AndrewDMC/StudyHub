'use client';

import { useRef, useState } from 'react';
import { Search, X } from 'lucide-react';
import type { FlashcardDto, TopicDto } from '@studyhub/contracts';
import {
  pagesToCards,
  useDebounced,
  useDeckSummaries,
  useFlashcardPages,
  useFlashcardStats,
  type Filters,
} from '../flashcards/api';
import { EmptyState } from '../flashcards/shared/EmptyState';
import { useFlashcardsParams } from '../flashcards/useFlashcardsParams';
import { MobileSection, SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { FlashcardDetailSheet } from './FlashcardDetailSheet';
import { FlashcardRow } from './FlashcardRow';

export const CARDS_TITLE_ID = 'flashcard-cards-title';

const chip =
  'min-h-11 shrink-0 rounded-full border px-4 text-sm whitespace-nowrap aria-pressed:border-accent aria-pressed:bg-accent-subtle aria-pressed:text-accent border-border text-fg-secondary';

/** Vista "Card": count, search, filters (topic chips, excluded, deck), the list (50 per page) and the detail sheet. */
export function CardsSection({
  slug,
  topics,
  onAdd,
}: {
  slug: string;
  topics: TopicDto[];
  onAdd: (mode: 'ai' | 'manual') => void;
}) {
  const { params, replace } = useFlashcardsParams(slug);
  const [searchOpen, setSearchOpen] = useState(false);
  const [text, setText] = useState('');
  const [selected, setSelected] = useState<FlashcardDto | null>(null);
  const triggerRef = useRef<HTMLElement | null>(null);
  const stats = useFlashcardStats(slug);
  const decks = useDeckSummaries(slug).data ?? [];

  const q = useDebounced(text.trim(), 250);
  const filters: Filters = {
    topicId: params.argomento ?? '',
    state: params.stato ?? '',
    deckId: params.mazzo ?? '',
    tag: params.tag ?? '',
    q,
    flagged: false,
    excluded: params.escluse,
    sort: 'due',
  };
  const filtered =
    !!(params.argomento || params.mazzo || params.stato || params.tag || params.escluse) ||
    q !== '';

  const query = useFlashcardPages(slug, filters);
  const cards = pagesToCards(query.data);
  const total = query.data?.pages[0]?.total ?? null;
  const topicChips = (stats.data?.topicMastery ?? []).filter((t) => t.cardCount > 0);
  const deck = params.mazzo ? decks.find((d) => d.id === params.mazzo) : undefined;
  const deckStatus = new Map(decks.map((d) => [d.id, d.status]));

  const reset = () => {
    setText('');
    replace({ argomento: null, mazzo: null, stato: null, tag: null, escluse: false });
  };

  return (
    <MobileSection
      title={
        <span id={CARDS_TITLE_ID} tabIndex={-1}>
          Le tue card
        </span>
      }
      busy={query.isLoading}
      action={
        <span className="flex items-center gap-1">
          <span className="font-mono text-xs text-fg-secondary" aria-live="polite">
            {total === null ? '' : total === 1 ? '1 card' : `${total} card`}
          </span>
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
          placeholder="Cerca in domande e risposte"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoFocus
          className="mb-2 min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-base text-fg-primary"
        />
      )}

      <div
        role="group"
        aria-label="Filtra per argomento"
        className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4"
      >
        <button
          type="button"
          aria-pressed={!params.argomento}
          onClick={() => replace({ argomento: null })}
          className={chip}
        >
          Tutte
        </button>
        {topicChips.map((t) => (
          <button
            key={t.topicId}
            type="button"
            aria-pressed={params.argomento === t.topicId}
            onClick={() => replace({ argomento: t.topicId })}
            className={chip}
          >
            {t.name}
          </button>
        ))}
      </div>
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        <button
          type="button"
          aria-pressed={params.escluse}
          onClick={() => replace({ escluse: !params.escluse })}
          className={chip}
        >
          Solo escluse dal ripasso
        </button>
        {params.mazzo && (
          <button
            type="button"
            aria-label="Rimuovi filtro mazzo"
            onClick={() => replace({ mazzo: null })}
            className={`${chip} inline-flex items-center gap-1.5 border-accent bg-accent-subtle text-accent`}
          >
            Mazzo: {deck?.title ?? '…'}
            <X className="size-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {filtered && (
        <button
          type="button"
          onClick={reset}
          className="mb-2 min-h-11 px-1 text-sm text-accent-hover"
        >
          Azzera filtri
        </button>
      )}

      {query.isLoading ? (
        <SkeletonRows count={4} />
      ) : query.isError && cards.length === 0 ? (
        <SectionError
          message="Impossibile caricare le card."
          onRetry={() => void query.refetch()}
        />
      ) : cards.length === 0 ? (
        filtered ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4 text-center text-sm text-fg-secondary">
            {params.escluse
              ? 'Nessuna card esclusa dal ripasso.'
              : 'Nessuna flashcard corrisponde ai filtri.'}
          </div>
        ) : (
          <EmptyState onGenerate={() => onAdd('ai')} onWrite={() => onAdd('manual')} />
        )
      ) : (
        <>
          <ul className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface">
            {cards.map((card, i) => (
              <li key={card.id} className={i > 0 ? 'border-t border-border' : undefined}>
                <FlashcardRow
                  card={card}
                  deckStatus={deckStatus.get(card.deckId)}
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
        topics={topics}
        decks={decks}
        card={selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
        returnFocusRef={triggerRef}
      />
    </MobileSection>
  );
}
