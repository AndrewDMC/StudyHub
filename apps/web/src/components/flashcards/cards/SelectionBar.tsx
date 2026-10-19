'use client';

import { X } from 'lucide-react';
import { FOCUS } from '../shared/styles';

const BTN = `inline-flex h-10 items-center rounded-[var(--radius-control)] px-3 text-[13px] text-fg-primary transition-colors duration-120 hover:bg-bg-surface disabled:opacity-60 ${FOCUS}`;

/** Floating toolbar of the multi-selection. */
export function SelectionBar({
  count,
  anySuspended,
  moreNotLoaded,
  busy,
  onSuspend,
  onUnsuspend,
  onMove,
  onTags,
  onDelete,
  onClear,
}: {
  count: number;
  anySuspended: boolean;
  /** All loaded cards are selected but more exist. */
  moreNotLoaded: boolean;
  busy: boolean;
  onSuspend: () => void;
  onUnsuspend: () => void;
  onMove: () => void;
  onTags: () => void;
  onDelete: () => void;
  onClear: () => void;
}) {
  return (
    <div className="sticky bottom-4 z-30 flex flex-col items-center gap-1 self-center">
      <div
        role="toolbar"
        aria-label="Azioni sulle card selezionate"
        className="flex flex-wrap items-center gap-1 rounded-[var(--radius-card)] border border-border-strong bg-bg-raised p-1.5 pl-4 shadow-lg"
      >
        <strong aria-live="polite" className="mr-2 text-[13px] font-medium">
          {count === 1 ? '1 selezionata' : `${count} selezionate`}
        </strong>
        <button type="button" disabled={busy} onClick={onSuspend} className={BTN}>
          Sospendi
        </button>
        {anySuspended && (
          <button type="button" disabled={busy} onClick={onUnsuspend} className={BTN}>
            Riattiva
          </button>
        )}
        <button type="button" disabled={busy} onClick={onMove} className={BTN}>
          Sposta…
        </button>
        <button type="button" disabled={busy} onClick={onTags} className={BTN}>
          Tag…
        </button>
        <button type="button" disabled={busy} onClick={onDelete} className={`${BTN} text-danger`}>
          Elimina
        </button>
        <span aria-hidden="true" className="mx-1 h-5 w-px bg-border-strong" />
        <button
          type="button"
          aria-label="Annulla selezione"
          onClick={onClear}
          className={`flex size-10 items-center justify-center rounded-[var(--radius-control)] text-fg-secondary hover:text-fg-primary ${FOCUS}`}
        >
          <X className="size-4" aria-hidden="true" />
        </button>
      </div>
      {moreNotLoaded && (
        <p className="rounded bg-bg-raised px-2 py-0.5 text-xs text-fg-secondary">
          Selezionate le {count} card caricate.
        </p>
      )}
    </div>
  );
}
