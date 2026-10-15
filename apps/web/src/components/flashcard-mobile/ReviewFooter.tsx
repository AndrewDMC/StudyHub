'use client';

import Link from 'next/link';

/** Sticky footer of the deck review: the counters and "Approva il mazzo". */
export function ReviewFooter({
  kept,
  dropped,
  left,
  approved,
  pending,
  error,
  backHref,
  onApprove,
}: {
  kept: number;
  dropped: number;
  left: number;
  approved: boolean;
  pending: boolean;
  error: string | null;
  backHref: string;
  onApprove: () => void;
}) {
  return (
    <div className="sticky bottom-0 z-10 border-t border-border bg-bg-surface px-4 pt-3 pb-[calc(env(safe-area-inset-bottom)+16px)]">
      {approved ? (
        <p role="status" className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <span className="text-fg-secondary">Mazzo già approvato.</span>
          <Link
            href={backHref}
            className="inline-flex min-h-11 items-center font-medium text-accent"
          >
            Torna alle flashcard
          </Link>
        </p>
      ) : (
        <>
          {error && (
            <p role="alert" className="mb-2 text-sm text-danger">
              {error}
            </p>
          )}
          <p role="status" className="mb-2.5 text-[13px] text-fg-secondary">
            <b className="font-mono font-semibold text-fg-primary">{kept}</b> tenute ·{' '}
            <b className="font-mono font-semibold text-fg-primary">{dropped}</b> scartate ·{' '}
            <b className="font-mono font-semibold text-fg-primary">{left}</b> da vedere
          </p>
          <button
            type="button"
            onClick={onApprove}
            disabled={pending}
            className="min-h-12 w-full rounded-[var(--radius-card)] bg-accent text-[15px] font-semibold text-bg-base disabled:opacity-60"
          >
            {pending ? 'Approvo…' : 'Approva il mazzo'}
          </button>
        </>
      )}
    </div>
  );
}
