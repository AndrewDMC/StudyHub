'use client';

import { useEffect, useRef } from 'react';
import { FileText, MoreHorizontal, Undo2, X } from 'lucide-react';
import type { ReviewQueueItemDto } from '@studyhub/contracts';
import { revealPlan } from '@/lib/cardText';
import { formatInterval } from '@/lib/format';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { RATINGS, RATING_LABELS, cardSourceHref, type Rating } from '@/lib/quickReview';
import { CardText } from '../CardText';
import { SwipeCard } from './SwipeCard';

export const RATING_COLORS: Record<Rating, string> = {
  1: 'var(--danger)',
  2: 'var(--warn)',
  3: 'var(--ok)',
  4: 'var(--accent-hover)',
};

/**
 * Artboards 2-3 (docs/09-ripasso-mobile.md §C2): question, then answer with the four ratings and
 * their intervals. Presentational: the session state lives in `QuickReviewClient`.
 */
export function QuickReviewSession({
  title,
  card,
  position,
  total,
  done,
  revealed,
  canUndo,
  onReveal,
  onRate,
  onUndo,
  onClose,
  onMore,
}: {
  title: string;
  card: ReviewQueueItemDto;
  position: number;
  total: number;
  done: number;
  revealed: boolean;
  canUndo: boolean;
  onReveal: () => void;
  onRate: (rating: Rating) => void;
  onUndo: () => void;
  onClose: () => void;
  onMore: () => void;
}) {
  const plan = revealPlan(card, revealed);
  const sourceHref = cardSourceHref(card);
  const crumb = `${card.subjectName}${card.topicName ? ` · ${card.topicName}` : ''}`;
  const pct = total ? Math.round((done / total) * 100) : 0;
  const answerRef = useRef<HTMLDivElement>(null);

  // A long answer is read from its start, not from where the question was scrolled.
  useEffect(() => {
    answerRef.current?.scrollTo({ top: 0 });
  }, [card.id, revealed]);

  const iconButton =
    'flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary disabled:text-fg-muted disabled:opacity-50';

  return (
    <>
      <div className="flex items-center gap-1 px-2 pt-2">
        <button type="button" onClick={onClose} aria-label="Chiudi sessione" className={iconButton}>
          <X size={22} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <div className="min-w-0 flex-1 text-center">
          <p className="truncate text-[13px] font-medium text-fg-primary">{title}</p>
          <p className="mt-0.5 font-mono text-xs text-fg-secondary">
            {position} / {total}
          </p>
        </div>
        <button
          type="button"
          onClick={onUndo}
          disabled={!canUndo}
          aria-label="Annulla ultima valutazione"
          className={iconButton}
        >
          <Undo2 size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" onClick={onMore} aria-label="Altre azioni" className={iconButton}>
          <MoreHorizontal size={20} strokeWidth={1.75} aria-hidden="true" />
        </button>
      </div>
      <div
        role="progressbar"
        aria-label="Avanzamento sessione"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done}
        className="mx-4 mt-2.5 h-[3px] overflow-hidden rounded-sm bg-border"
      >
        <div
          className="h-[3px] bg-accent transition-[width] duration-200"
          style={{ width: `${pct}%` }}
        />
      </div>
      <p aria-live="polite" className="sr-only">
        {revealed ? 'Risposta visibile' : `Card ${position} di ${total}: ${crumb}`}
      </p>

      <div className="flex min-h-0 flex-1 p-4">
        <SwipeCard
          key={position}
          enabled={revealed}
          onTap={revealed ? undefined : onReveal}
          onSwipe={(dir) => onRate(dir === 'right' ? 3 : 1)}
        >
          <div
            className={`flex min-w-0 flex-1 flex-col overflow-hidden rounded-[var(--radius-modal)] border bg-bg-surface ${
              revealed ? 'border-accent/30' : 'border-border'
            }`}
          >
            <div className="flex items-center gap-2 px-5 pt-4">
              <span
                aria-hidden="true"
                className="size-2 shrink-0 rounded-full"
                style={{ background: SUBJECT_COLOR_HEX[card.subjectColor] }}
              />
              <span className="min-w-0 flex-1 truncate text-xs text-fg-secondary">{crumb}</span>
              {sourceHref && (
                <a
                  href={sourceHref}
                  target="_blank"
                  rel="noopener"
                  aria-label="Apri la fonte nel documento"
                  onClick={(e) => e.stopPropagation()}
                  className="-my-2 -mr-2 inline-flex min-h-11 shrink-0 items-center gap-1.5 px-2.5 text-[13px] text-fg-secondary"
                >
                  <FileText size={14} aria-hidden="true" />
                  Fonte
                </a>
              )}
            </div>
            <div
              ref={answerRef}
              className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto overscroll-y-contain px-5 pb-5 pt-5"
            >
              <CardText
                text={card.front}
                side={plan.frontSide}
                className={
                  revealed && plan.frontSide === 'front'
                    ? 'text-[15px] leading-[1.45] text-fg-secondary'
                    : 'text-[22px] font-medium leading-[1.35] tracking-[-0.01em] text-fg-primary'
                }
              />
              {revealed ? (
                <>
                  {plan.showBack && (
                    <>
                      <div className="h-px shrink-0 bg-border" />
                      <p className="font-mono text-[11px] uppercase tracking-[0.06em] text-fg-secondary">
                        Risposta
                      </p>
                      <CardText
                        text={card.back}
                        side="back"
                        className="text-[19px] leading-[1.45] text-fg-primary"
                      />
                    </>
                  )}
                  {card.hint && <p className="text-sm italic text-fg-secondary">{card.hint}</p>}
                  {card.sourceRef && (
                    <p className="rounded-[var(--radius-control)] bg-bg-inset px-3 py-2 font-mono text-[11px] text-fg-secondary">
                      pag. {card.sourceRef.page} — &quot;{card.sourceRef.quote}&quot;
                    </p>
                  )}
                </>
              ) : (
                <p className="mt-auto self-center text-[13px] text-fg-secondary">
                  Tocca la card per vedere la risposta
                </p>
              )}
            </div>
          </div>
        </SwipeCard>
      </div>

      <div className="shrink-0 px-4 pb-[calc(env(safe-area-inset-bottom)+16px)]">
        {revealed ? (
          <>
            <p className="mb-2.5 text-center text-xs text-fg-secondary">
              Oppure scorri la card: ← di nuovo · bene →
            </p>
            <div role="group" aria-label="Quanto la ricordavi?" className="grid grid-cols-4 gap-2">
              {RATINGS.map((rating) => {
                const interval = formatInterval(card.intervals[rating]);
                return (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => onRate(rating)}
                    aria-label={`${RATING_LABELS[rating]}, prossimo ripasso ${interval}`}
                    className="flex h-16 flex-col items-center justify-center gap-1 rounded-[var(--radius-card)] border border-border-strong bg-bg-raised"
                  >
                    <span className="text-sm font-medium" style={{ color: RATING_COLORS[rating] }}>
                      {RATING_LABELS[rating]}
                    </span>
                    <span className="font-mono text-xs text-fg-secondary">{interval}</span>
                  </button>
                );
              })}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={onReveal}
            className="h-14 w-full rounded-[var(--radius-card)] bg-accent text-base font-semibold text-bg-base"
          >
            Mostra risposta
          </button>
        )}
      </div>
    </>
  );
}
