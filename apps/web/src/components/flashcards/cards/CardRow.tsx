'use client';

import { Pencil } from 'lucide-react';
import type { FlashcardDto } from '@studyhub/contracts';
import { formatCardDueLong, plainCardText } from '@/lib/flashcardMobile';
import type { CardAction } from '../shared/cardActions';
import { exclusionReason } from '../shared/cardActions';
import { StateDot, cardStateLabel } from '../shared/StateDot';
import { FOCUS, ICON_BTN } from '../shared/styles';
import { CardRowMenu } from './CardRowMenu';

export const ROW_GRID_FULL = 'grid-cols-[40px_minmax(0,1fr)_150px_110px_88px]';
export const ROW_GRID_COMPACT = 'grid-cols-[40px_minmax(0,1fr)_40px]';

/** One row of the list: selection checkbox, body button (opens the detail), state, due, actions. */
export function CardRow({
  card,
  deckStatus,
  compact,
  selected,
  current,
  onToggle,
  onOpen,
  onAction,
}: {
  card: FlashcardDto;
  deckStatus: string | undefined;
  compact: boolean;
  selected: boolean;
  current: boolean;
  onToggle: () => void;
  onOpen: (trigger: HTMLElement) => void;
  onAction: (card: FlashcardDto, id: CardAction['id']) => void;
}) {
  const front = plainCardText(card.front);
  const back = plainCardText(card.back);
  const reason = exclusionReason(card, deckStatus);
  const muted = card.suspended || !!card.flaggedAt;
  const nextText = reason ? 'esclusa' : formatCardDueLong(card);
  const rowCls = `grid items-center gap-3 border-b border-border px-4 py-2.5 last:border-b-0 min-h-14 ${
    compact ? ROW_GRID_COMPACT : ROW_GRID_FULL
  } ${current ? 'border-l-2 border-l-accent bg-accent-subtle' : selected ? 'bg-accent-subtle' : ''}`;

  return (
    <li data-card-id={card.id} aria-current={current ? 'true' : undefined} className={rowCls}>
      <label className="flex size-10 cursor-pointer items-center justify-center max-md:size-11">
        <input
          type="checkbox"
          checked={selected}
          onChange={onToggle}
          aria-label={`Seleziona card: ${front}`}
          className="size-4 accent-[var(--accent)]"
        />
      </label>
      <button
        type="button"
        onClick={(e) => onOpen(e.currentTarget)}
        className={`flex min-h-10 min-w-0 flex-col justify-center rounded-[var(--radius-control)] text-left ${FOCUS}`}
      >
        <span className={`truncate font-medium ${muted ? 'text-fg-secondary' : 'text-fg-primary'}`}>
          {front}
        </span>
        {compact ? (
          <span className="truncate text-[13px] text-fg-secondary">
            {cardStateLabel(card)} · {reason ? 'esclusa dal ripasso' : nextText}
          </span>
        ) : (
          <span className="truncate text-[13px] text-fg-secondary">{back}</span>
        )}
      </button>
      {!compact && (
        <>
          <StateDot card={card} />
          <span
            className={`text-[13px] ${nextText === 'oggi' ? 'font-medium text-accent-hover' : 'text-fg-secondary'}`}
          >
            {nextText}
          </span>
        </>
      )}
      <div className="flex justify-end gap-1">
        {!compact && (
          <button
            type="button"
            aria-label={`Modifica card: ${front}`}
            onClick={(e) => onOpen(e.currentTarget)}
            className={ICON_BTN}
          >
            <Pencil className="size-4" aria-hidden="true" />
          </button>
        )}
        <CardRowMenu card={card} onAction={onAction} />
      </div>
    </li>
  );
}
