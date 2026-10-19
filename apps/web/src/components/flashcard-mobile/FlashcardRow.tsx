'use client';

import type { FlashcardDto } from '@studyhub/contracts';
import { CARD_STATE_VIEW, TONE_VAR, formatCardDue, plainCardText } from '@/lib/flashcardMobile';
import { CardText } from '../CardText';
import { StateDot } from '../flashcards/shared/StateDot';
import { exclusionReason } from '../flashcards/shared/cardActions';

const pill = 'rounded-full border px-2.5 py-0.5 text-xs';

function tonePill(token: string) {
  return {
    color: token,
    borderColor: `color-mix(in srgb, ${token} 40%, transparent)`,
  };
}

/** Pill of the card state (always with text), plus "sospesa" and "Segnalata" when they apply. */
export function CardStatePills({ card }: { card: FlashcardDto }) {
  const view = CARD_STATE_VIEW[card.state];
  return (
    <>
      <span className={pill} style={tonePill(TONE_VAR[view.tone])}>
        {view.label}
        {card.suspended && ' · sospesa'}
      </span>
      {card.flaggedAt && (
        <span className={pill} style={tonePill('var(--danger)')}>
          Segnalata
        </span>
      )}
    </>
  );
}

/** One row of "Le tue card": a button that opens the detail sheet. */
export function FlashcardRow({
  card,
  deckStatus,
  topicName,
  onOpen,
}: {
  card: FlashcardDto;
  deckStatus?: string | undefined;
  topicName: string | null;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const view = CARD_STATE_VIEW[card.state];
  const hasDue = !card.suspended && !!card.dueAt;
  const due = formatCardDue(card.dueAt);
  const outOfDeck = exclusionReason(card, deckStatus) === 'deck';
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${plainCardText(card.front)}, ${view.label}${card.suspended ? ', sospesa' : ''}${card.flaggedAt ? ', segnalata' : ''}${hasDue ? `, scade ${due}` : ''}`}
      onClick={(e) => onOpen(e.currentTarget)}
      className="flex min-h-16 w-full min-w-0 flex-col gap-1.5 px-3.5 py-3 text-left"
    >
      <CardText
        text={card.front}
        side="front"
        className="line-clamp-2 w-full min-w-0 break-words text-[15px] text-fg-primary"
      />
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <StateDot card={card} />
        {outOfDeck && <span className="text-xs text-fg-secondary">· esclusa dal ripasso</span>}
        <span className="min-w-0 truncate text-xs text-fg-secondary">
          {topicName ?? 'Senza argomento'}
        </span>
        <span
          className="ml-auto shrink-0 font-mono text-xs tabular-nums text-fg-secondary"
          data-testid="card-due"
          aria-hidden={hasDue ? undefined : 'true'}
        >
          {due}
        </span>
      </span>
    </button>
  );
}
