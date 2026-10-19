'use client';

import Link from 'next/link';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { useDeckGroups } from '@/lib/deckGroupsClient';
import { reviewHref } from '@/lib/quickReview';
import { MasteryBar } from '../shared/MasteryBar';
import { CARD_BOX, FOCUS } from '../shared/styles';

/** "Padronanza per argomento": one row per topic with cards, with its review link. */
export function MasteryList({
  slug,
  topics,
}: {
  slug: string;
  topics: FlashcardStatsDto['topicMastery'];
}) {
  const rows = topics.filter((t) => t.cardCount > 0);
  // Same rule as the Panoramica: the link is there only if something is due or new today.
  const groups = useDeckGroups(slug).data;
  const due = new Map((groups ?? []).map((g) => [g.topicId ?? '', g.due + g.new]));
  return (
    <section aria-labelledby="fc-padr" className={`${CARD_BOX} flex flex-col gap-2 p-5`}>
      <h2 id="fc-padr" className="text-[15px] font-semibold">
        Padronanza per argomento
      </h2>
      {rows.length === 0 ? (
        <p className="text-sm text-fg-secondary">Nessun argomento con card.</p>
      ) : (
        <ul>
          {rows.map((t) => (
            <li
              key={t.topicId}
              className="flex min-h-11 flex-wrap items-center gap-x-3 gap-y-1 py-1 @container/row"
            >
              <span className="min-w-0 flex-1 basis-32 truncate text-sm">{t.name}</span>
              <MasteryBar
                mastery={t.mastery}
                className="order-last basis-full sm:order-none sm:w-40 sm:basis-auto"
              />
              {(due.get(t.topicId) ?? 0) > 0 && (
                <Link
                  href={reviewHref(slug, t.topicId)}
                  aria-label={`Ripassa ${t.name}`}
                  className={`inline-flex min-h-10 min-w-10 items-center justify-center px-2 text-[13px] text-accent-hover hover:underline max-md:min-h-11 ${FOCUS}`}
                >
                  Ripassa
                </Link>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
