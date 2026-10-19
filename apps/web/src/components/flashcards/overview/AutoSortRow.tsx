'use client';

import Link from 'next/link';
import { Loader2, Play, Sparkles } from 'lucide-react';
import type { DeckGroupDto } from '@studyhub/contracts';
import { NO_TOPIC, canReview, reviewHref } from '@/lib/deckGroups';
import { flashcardsLink } from '@/lib/flashcardsView';
import { materialHref } from '@/lib/subjectTabs';
import type { AutoSort } from '../../deck-groups/useAutoSort';
import { BTN_SECONDARY, FOCUS } from '../shared/styles';

const NO_TOPICS_TEXT =
  'Questa materia non ha ancora argomenti. Estraili dal materiale per poter ordinare le card.';

function focusTopicsTitle() {
  const el = document.getElementById('topics-panel-title');
  el?.scrollIntoView({ block: 'center' });
  el?.focus();
}

/** "Senza argomento": the cards to assign, with the AI sort and its status (`sort-status`). */
export function AutoSortRow({
  slug,
  group,
  hasTopics,
  sort,
  mobile = false,
}: {
  slug: string;
  group: DeckGroupDto;
  hasTopics: boolean;
  sort: AutoSort;
  mobile?: boolean;
}) {
  const noTopics = !hasTopics || sort.noTopics;
  const h = mobile ? 'h-11' : 'h-10';
  let status: React.ReactNode;
  if (noTopics) {
    status = (
      <>
        {NO_TOPICS_TEXT}{' '}
        {mobile ? (
          <Link
            href={materialHref(slug, 'tutti')}
            className="inline-flex min-h-11 items-center font-medium text-accent"
          >
            Vai al materiale
          </Link>
        ) : (
          <button
            type="button"
            onClick={focusTopicsTitle}
            className={`min-h-10 text-accent-hover underline ${FOCUS}`}
          >
            Apri il pannello Argomenti a sinistra
          </button>
        )}
      </>
    );
  } else if (sort.running) {
    status = 'Ordino le card…';
  } else if (sort.failed) {
    status = <span className="text-danger">{sort.errorText}</span>;
  } else if (sort.message) {
    status = sort.message;
  } else {
    status = 'Assegna un argomento, così entrano nel ripasso al momento giusto.';
  }

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3.5 last:border-0">
      <div className="min-w-0 flex-1 basis-60">
        <p className="font-medium">
          Senza argomento
          <span className="font-normal text-fg-secondary"> · {group.total} card</span>
        </p>
        <p
          role={sort.failed && !sort.running && !noTopics ? 'alert' : 'status'}
          aria-live="polite"
          data-testid="sort-status"
          className="text-[13px] text-fg-secondary"
        >
          {status}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {group.total > 0 && (
          <Link
            href={flashcardsLink(slug, { view: 'card', argomento: NO_TOPIC })}
            scroll={false}
            className={`${BTN_SECONDARY} ${h}`}
          >
            Vedi le card
          </Link>
        )}
        {!noTopics && (
          <button
            type="button"
            onClick={sort.run}
            disabled={sort.running}
            aria-busy={sort.running || undefined}
            className={`inline-flex ${h} items-center gap-1.5 rounded-[var(--radius-control)] border border-accent/40 bg-accent-subtle px-3.5 text-[13px] font-medium text-accent-hover disabled:opacity-60 ${FOCUS}`}
          >
            {sort.running ? (
              <Loader2
                className="size-4 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Sparkles className="size-4" aria-hidden="true" />
            )}
            {sort.running ? 'Ordino…' : sort.failed ? 'Riprova' : "Ordina con l'AI"}
          </button>
        )}
        {canReview(group) && (
          <Link
            href={reviewHref(slug, group)}
            aria-label="Ripassa Senza argomento"
            className={`${BTN_SECONDARY} ${h}`}
          >
            <Play className="size-3.5" aria-hidden="true" />
            Ripassa
          </Link>
        )}
      </div>
    </li>
  );
}
