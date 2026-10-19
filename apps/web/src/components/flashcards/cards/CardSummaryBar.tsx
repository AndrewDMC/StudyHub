'use client';

import { ChevronDown } from 'lucide-react';
import { Menu, MenuRadioGroup, MenuRadioItem } from '@/components/ui/menu';
import type { FlashcardOrder } from '@/lib/flashcardsView';
import { FOCUS } from '../shared/styles';

/** "N card in X · Azzera filtri" on the left, the sort menu on the right. */
export function CardSummaryBar({
  total,
  scope,
  filtered,
  order,
  onReset,
  onOrderChange,
}: {
  total: number | null;
  /** Name of the topic/deck being filtered, if any. */
  scope: string | null;
  filtered: boolean;
  order: FlashcardOrder;
  onReset: () => void;
  onOrderChange: (order: FlashcardOrder) => void;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px] text-fg-secondary">
      <p className="flex flex-wrap items-center gap-x-1">
        <span aria-live="polite">
          <strong className="font-medium text-fg-primary">
            {total === null ? '…' : total === 1 ? '1 card' : `${total} card`}
          </strong>
          {scope && ` in ${scope}`}
        </span>
        {filtered && (
          <>
            <span aria-hidden="true">·</span>
            <button
              type="button"
              onClick={onReset}
              className={`min-h-10 px-1 text-accent-hover hover:underline max-md:min-h-11 ${FOCUS}`}
            >
              Azzera filtri
            </button>
          </>
        )}
      </p>
      <Menu
        label="Ordina"
        trigger={
          <button
            type="button"
            className={`inline-flex min-h-10 items-center gap-1 px-1 hover:text-fg-primary max-md:min-h-11 ${FOCUS}`}
          >
            Ordina: {order === 'due' ? 'prima in scadenza' : 'più recenti'}
            <ChevronDown className="size-4" aria-hidden="true" />
          </button>
        }
      >
        <MenuRadioGroup value={order} onValueChange={(v) => onOrderChange(v as FlashcardOrder)}>
          <MenuRadioItem value="due">Prima in scadenza</MenuRadioItem>
          <MenuRadioItem value="recenti">Più recenti</MenuRadioItem>
        </MenuRadioGroup>
      </Menu>
    </div>
  );
}
