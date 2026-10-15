'use client';

import type { FlashcardDto } from '@studyhub/contracts';
import { plainCardText, type ReviewMark } from '@/lib/flashcardMobile';
import { CardText } from '../CardText';

const action =
  'min-h-11 disabled:opacity-50 rounded-[var(--radius-control)] border border-border-strong text-sm font-medium text-fg-primary';

function activeStyle(token: string) {
  return { background: `color-mix(in srgb, ${token} 10%, transparent)` };
}

/** One generated card with Tieni / Modifica / Scarta; the marks are local until the deck is approved. */
export function ReviewCard({
  card,
  mark,
  onMark,
  onEdit,
  disabled = false,
}: {
  card: FlashcardDto;
  mark: ReviewMark | undefined;
  onMark: (mark: ReviewMark) => void;
  onEdit: (trigger: HTMLButtonElement) => void;
  disabled?: boolean;
}) {
  const summary = plainCardText(card.front);
  const dropped = mark === 'drop';
  return (
    <article
      className="flex min-w-0 flex-col gap-2.5 rounded-[var(--radius-card)] border bg-bg-surface p-3.5"
      style={{
        borderColor:
          mark === 'keep' ? 'color-mix(in srgb, var(--ok) 35%, var(--border))' : 'var(--border)',
      }}
    >
      <div className="flex min-h-5 items-start justify-between gap-2">
        <span className="text-[11px] uppercase tracking-[0.06em] text-fg-muted">Domanda</span>
        {mark && (
          <span
            className={`rounded-full border px-2.5 py-0.5 text-xs ${
              dropped ? 'border-danger text-danger' : 'border-ok text-ok'
            }`}
          >
            {dropped ? 'Scartata' : 'Tenuta'}
          </span>
        )}
      </div>
      <div className={`min-w-0 overflow-x-auto ${dropped ? 'text-fg-muted line-through' : ''}`}>
        <CardText
          text={card.front}
          side="front"
          className="break-words text-[15px] font-medium text-fg-primary"
        />
        <p className="mt-2 text-[11px] uppercase tracking-[0.06em] text-fg-muted">Risposta</p>
        <CardText
          text={card.back}
          side="back"
          className="mt-1 break-words text-sm text-fg-secondary"
        />
      </div>
      {card.sourceRef && (
        <p className="break-words rounded-[var(--radius-control)] bg-bg-inset px-2.5 py-1.5 font-mono text-xs text-fg-muted">
          pag. {card.sourceRef.page} — &quot;{card.sourceRef.quote}&quot;
        </p>
      )}
      <div className="grid grid-cols-3 gap-1.5">
        <button
          type="button"
          disabled={disabled}
          aria-pressed={mark === 'keep'}
          aria-label={`Tieni: ${summary}`}
          onClick={() => onMark('keep')}
          className={`${action} ${mark === 'keep' ? 'border-ok text-ok' : ''}`}
          style={mark === 'keep' ? activeStyle('var(--ok)') : undefined}
        >
          Tieni
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-haspopup="dialog"
          aria-label={`Modifica: ${summary}`}
          onClick={(e) => onEdit(e.currentTarget)}
          className={action}
        >
          Modifica
        </button>
        <button
          type="button"
          disabled={disabled}
          aria-pressed={dropped}
          aria-label={`Scarta: ${summary}`}
          onClick={() => onMark('drop')}
          className={`${action} ${dropped ? 'border-danger text-danger' : ''}`}
          style={dropped ? activeStyle('var(--danger)') : undefined}
        >
          Scarta
        </button>
      </div>
    </article>
  );
}
