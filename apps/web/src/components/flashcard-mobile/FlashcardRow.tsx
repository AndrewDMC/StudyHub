'use client';

import type { FlashcardDto } from '@studyhub/contracts';
import { CARD_STATE_VIEW, TONE_VAR, plainCardText } from '@/lib/flashcardMobile';
import { CardText } from '../CardText';

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
  topicName,
  onOpen,
}: {
  card: FlashcardDto;
  topicName: string | null;
  onOpen: (trigger: HTMLButtonElement) => void;
}) {
  const view = CARD_STATE_VIEW[card.state];
  return (
    <button
      type="button"
      aria-haspopup="dialog"
      aria-label={`${plainCardText(card.front)}, ${view.label}${card.suspended ? ', sospesa' : ''}${card.flaggedAt ? ', segnalata' : ''}`}
      onClick={(e) => onOpen(e.currentTarget)}
      className="flex min-h-16 w-full min-w-0 flex-col gap-1.5 px-3.5 py-3 text-left"
    >
      <CardText
        text={card.front}
        side="front"
        className="line-clamp-2 w-full min-w-0 break-words text-[15px] text-fg-primary"
      />
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        <CardStatePills card={card} />
        {topicName && <span className="min-w-0 truncate text-xs text-fg-muted">{topicName}</span>}
      </span>
    </button>
  );
}
