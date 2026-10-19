'use client';

import Link from 'next/link';
import { Flag, Layers } from 'lucide-react';
import { flashcardsLink } from '@/lib/flashcardsView';
import { useFlashcardStats } from '../api';
import { BTN_SECONDARY, CARD_BOX, SECTION_TITLE } from '../shared/styles';

/** "Da sistemare": draft decks and excluded cards. Absent when there is nothing to fix. */
export function AttentionList({ slug }: { slug: string }) {
  const stats = useFlashcardStats(slug).data;
  if (!stats) return null;
  const drafts = stats.draftDeckCount;
  const excluded = stats.excludedCount;
  if (drafts <= 0 && excluded <= 0) return null;

  const parts: string[] = [];
  if (stats.flaggedCount > 0)
    parts.push(
      `${stats.flaggedCount} ${stats.flaggedCount === 1 ? 'segnalata' : 'segnalate'} durante il ripasso`,
    );
  if (stats.suspendedCount > 0)
    parts.push(
      `${stats.suspendedCount} ${stats.suspendedCount === 1 ? 'sospesa' : 'sospese'} da te`,
    );
  // Only explain the split when it adds up to the headline number.
  const detail =
    stats.flaggedCount + stats.suspendedCount === excluded ? parts.join(', ') + '.' : null;

  const row =
    'flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-border px-5 py-3.5 last:border-0';
  const icon = 'flex size-8 shrink-0 items-center justify-center rounded-[var(--radius-control)]';

  return (
    <section aria-labelledby="fc-att" className={`${CARD_BOX} overflow-hidden`}>
      <h2 id="fc-att" className={`${SECTION_TITLE} px-5 pt-3.5`}>
        Da sistemare
      </h2>
      <ul>
        {drafts > 0 && (
          <li className={row}>
            <span aria-hidden="true" className={`${icon} bg-warn/12 text-warn`}>
              <Layers className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">
                {drafts === 1
                  ? '1 mazzo in bozza da approvare'
                  : `${drafts} mazzi in bozza da approvare`}
              </p>
              <p className="text-[13px] text-fg-secondary">
                {drafts === 1
                  ? `Le sue ${stats.draftCardCount} card non entrano nel ripasso finché non lo approvi.`
                  : `Le loro ${stats.draftCardCount} card non entrano nel ripasso finché non li approvi.`}
              </p>
            </div>
            <Link
              href={flashcardsLink(slug, { view: 'panoramica', group: 'mazzo' })}
              scroll={false}
              className={BTN_SECONDARY}
            >
              Rivedi i mazzi
            </Link>
          </li>
        )}
        {excluded > 0 && (
          <li className={row}>
            <span aria-hidden="true" className={`${icon} bg-danger/12 text-danger`}>
              <Flag className="size-4" />
            </span>
            <div className="min-w-0 flex-1 basis-60">
              <p className="font-medium">
                {excluded === 1
                  ? '1 card esclusa dal ripasso'
                  : `${excluded} card escluse dal ripasso`}
              </p>
              {detail && (
                <p className="text-[13px] text-fg-secondary">
                  {detail.charAt(0).toUpperCase() + detail.slice(1)}
                </p>
              )}
            </div>
            <Link
              href={flashcardsLink(slug, { view: 'card', escluse: true })}
              scroll={false}
              className={BTN_SECONDARY}
            >
              Controlla
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}
