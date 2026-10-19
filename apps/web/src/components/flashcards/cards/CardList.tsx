'use client';

import { useEffect, useRef } from 'react';
import type { FlashcardDto } from '@studyhub/contracts';
import type { CardAction } from '../shared/cardActions';
import { EmptyState } from '../shared/EmptyState';
import { BlockError, SkeletonRows } from '../shared/Skeletons';
import { BTN_SECONDARY, CARD_BOX } from '../shared/styles';
import { CardRow, ROW_GRID_COMPACT, ROW_GRID_FULL } from './CardRow';

/** Header + rows + "Mostra altre", with the loading / empty / error states of the list. */
export function CardList({
  cards,
  deckStatus,
  compact,
  selected,
  currentId,
  loading,
  error,
  onRetry,
  hasNext,
  fetchingNext,
  onFetchNext,
  nextError,
  filtered,
  onlyExcluded,
  onReset,
  onToggle,
  onToggleAll,
  onOpen,
  onAction,
  onGenerate,
  onWrite,
  listRef,
}: {
  cards: FlashcardDto[];
  deckStatus: Map<string, string>;
  compact: boolean;
  selected: Set<string>;
  currentId: string | null;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
  hasNext: boolean;
  fetchingNext: boolean;
  onFetchNext: () => void;
  nextError: Error | null;
  filtered: boolean;
  onlyExcluded: boolean;
  onReset: () => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onOpen: (card: FlashcardDto, trigger: HTMLElement) => void;
  onAction: (card: FlashcardDto, id: CardAction['id']) => void;
  onGenerate: () => void;
  onWrite: () => void;
  listRef: React.RefObject<HTMLDivElement | null>;
}) {
  const allRef = useRef<HTMLInputElement>(null);
  const pendingFocus = useRef<number | null>(null);
  const selectedHere = cards.filter((c) => selected.has(c.id)).length;
  const all = cards.length > 0 && selectedHere === cards.length;

  useEffect(() => {
    if (allRef.current) allRef.current.indeterminate = selectedHere > 0 && !all;
  }, [selectedHere, all]);

  useEffect(() => {
    const at = pendingFocus.current;
    if (at === null || cards.length <= at) return;
    pendingFocus.current = null;
    const rows = listRef.current?.querySelectorAll<HTMLElement>('li[data-card-id]');
    rows?.[at]?.querySelector<HTMLElement>('button')?.focus();
  }, [cards.length, listRef]);

  let body: React.ReactNode;
  if (loading) {
    body = (
      <div aria-hidden="true" className="p-2">
        <SkeletonRows count={6} height="h-14" />
      </div>
    );
  } else if (error && cards.length === 0) {
    return <BlockError message="Impossibile caricare le card." onRetry={onRetry} />;
  } else if (cards.length === 0) {
    if (!filtered) return <EmptyState onGenerate={onGenerate} onWrite={onWrite} />;
    return (
      <div className={`${CARD_BOX} flex flex-col items-center gap-3 p-8 text-center`}>
        <p className="text-sm text-fg-secondary">
          {onlyExcluded
            ? 'Nessuna card esclusa dal ripasso.'
            : 'Nessuna flashcard corrisponde ai filtri.'}
        </p>
        <button type="button" onClick={onReset} className={BTN_SECONDARY}>
          Azzera filtri
        </button>
      </div>
    );
  } else {
    body = (
      <ul>
        {cards.map((card) => (
          <CardRow
            key={card.id}
            card={card}
            deckStatus={deckStatus.get(card.deckId)}
            compact={compact}
            selected={selected.has(card.id)}
            current={card.id === currentId}
            onToggle={() => onToggle(card.id)}
            onOpen={(el) => onOpen(card, el)}
            onAction={onAction}
          />
        ))}
      </ul>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div
        ref={listRef}
        tabIndex={-1}
        aria-label="Elenco delle card"
        aria-busy={loading || undefined}
        className={`${CARD_BOX} overflow-hidden outline-none`}
      >
        {!compact && !loading && (
          <div
            className={`grid items-center gap-3 border-b border-border px-4 py-1.5 text-xs uppercase tracking-[0.05em] text-fg-secondary ${ROW_GRID_FULL}`}
          >
            <label className="flex size-10 cursor-pointer items-center justify-center">
              <input
                ref={allRef}
                type="checkbox"
                checked={all}
                onChange={onToggleAll}
                aria-label="Seleziona tutte le card"
                className="size-4 accent-[var(--accent)]"
              />
            </label>
            <span>Card</span>
            <span>Stato</span>
            <span>Prossimo</span>
            <span />
          </div>
        )}
        {compact && !loading && (
          <div
            className={`grid items-center gap-3 border-b border-border px-4 py-0.5 ${ROW_GRID_COMPACT}`}
          >
            <label className="flex size-10 cursor-pointer items-center justify-center max-md:size-11">
              <input
                ref={allRef}
                type="checkbox"
                checked={all}
                onChange={onToggleAll}
                aria-label="Seleziona tutte le card"
                className="size-4 accent-[var(--accent)]"
              />
            </label>
            <span className="text-xs uppercase tracking-[0.05em] text-fg-secondary">Card</span>
            <span />
          </div>
        )}
        {body}
      </div>
      {hasNext && (
        <button
          type="button"
          aria-busy={fetchingNext || undefined}
          disabled={fetchingNext}
          onClick={() => {
            pendingFocus.current = cards.length;
            onFetchNext();
          }}
          className={`${BTN_SECONDARY} self-center`}
        >
          {fetchingNext ? 'Caricamento…' : 'Mostra altre'}
        </button>
      )}
      {nextError && cards.length > 0 && (
        <p role="alert" className="text-center text-[13px] text-danger">
          Impossibile caricare altre card.{' '}
          <button type="button" onClick={onFetchNext} className="min-h-10 underline">
            Riprova
          </button>
        </p>
      )}
    </div>
  );
}
