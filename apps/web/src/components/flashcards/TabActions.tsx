'use client';

import type { Ref } from 'react';
import Link from 'next/link';
import { Play, Plus } from 'lucide-react';
import type { FlashcardView } from '@/lib/flashcardsView';
import { reviewHref } from '@/lib/quickReview';
import { useSubjectOverview } from './api';
import { BTN_SECONDARY, FOCUS } from './shared/styles';

/** "Aggiungi" (opens the dialog) and, in Card / Statistiche, the "Ripassa N" shortcut. */
export function TabActions({
  slug,
  view,
  onAdd,
  addRef,
}: {
  slug: string;
  view: FlashcardView;
  onAdd: () => void;
  addRef: Ref<HTMLButtonElement>;
}) {
  const overview = useSubjectOverview(slug).data;
  const n = overview ? overview.dueCount + overview.newCount : 0;
  return (
    <div className="flex items-center gap-2">
      <button
        ref={addRef}
        type="button"
        aria-haspopup="dialog"
        onClick={onAdd}
        className={BTN_SECONDARY}
      >
        <Plus className="size-4" aria-hidden="true" />
        Aggiungi
      </button>
      {view !== 'panoramica' && n > 0 && (
        <Link
          href={reviewHref(slug)}
          aria-label={`Ripassa ${n} card`}
          className={`inline-flex h-10 items-center gap-2 rounded-[var(--radius-control)] bg-accent px-4 text-[13px] font-semibold text-bg-base hover:bg-accent-hover ${FOCUS}`}
        >
          <Play className="size-3.5" aria-hidden="true" />
          Ripassa {n}
        </Link>
      )}
    </div>
  );
}
