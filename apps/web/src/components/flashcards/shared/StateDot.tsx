import { Flag, Pause } from 'lucide-react';
import type { FlashcardDto } from '@studyhub/contracts';
import { CARD_STATE_VIEW, type FsrsCardState } from '@/lib/flashcardMobile';

const TONE_BG = {
  accent: 'bg-accent',
  warn: 'bg-warn',
  ok: 'bg-ok',
  danger: 'bg-danger',
  info: 'bg-info',
} as const;

type StateLike = Pick<FlashcardDto, 'state'> & {
  suspended?: boolean;
  flaggedAt?: string | null;
};

/** Text of the state of a card: flagged and suspended prevail over the FSRS state. */
export function cardStateLabel(card: StateLike): string {
  if (card.flaggedAt) return 'Segnalata';
  if (card.suspended) return 'Sospesa';
  return CARD_STATE_VIEW[card.state].label;
}

/** Marker (shape + colour, hidden from AT) followed by the state text: never colour alone. */
export function StateDot({ card, className = '' }: { card: StateLike; className?: string }) {
  const label = cardStateLabel(card);
  let marker;
  let textClass = 'text-fg-primary';
  if (card.flaggedAt) {
    marker = <Flag className="size-3.5 shrink-0 text-danger" aria-hidden="true" />;
    textClass = 'text-danger';
  } else if (card.suspended) {
    marker = <Pause className="size-3.5 shrink-0 text-fg-secondary" aria-hidden="true" />;
    textClass = 'text-fg-secondary';
  } else if (card.state === 'new') {
    marker = (
      <span
        aria-hidden="true"
        className="size-2 shrink-0 rounded-full border-[1.5px] border-info"
      />
    );
  } else {
    marker = (
      <span
        aria-hidden="true"
        className={`size-2 shrink-0 rounded-full ${TONE_BG[CARD_STATE_VIEW[card.state].tone]}`}
      />
    );
  }
  return (
    <span
      className={`inline-flex min-w-0 items-center gap-1.5 text-[13px] ${textClass} ${className}`}
    >
      {marker}
      <span className="truncate">{label}</span>
    </span>
  );
}

/** FSRS-state label with its marker, for filters and tiles (no flag/suspend). */
export function PlainStateDot({ state }: { state: FsrsCardState }) {
  return <StateDot card={{ state }} />;
}
