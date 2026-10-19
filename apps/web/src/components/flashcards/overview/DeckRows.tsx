'use client';

import { useId, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Play } from 'lucide-react';
import type { DeckSummaryDto } from '@studyhub/contracts';
import { patchDeck } from '@/lib/deckEditorClient';
import { flashcardsLink, reviewDeckHref } from '@/lib/flashcardsView';
import { invalidateFlashcards, useDeckSummaries } from '../api';
import { useNotify } from '../Notifier';
import { EmptyState } from '../shared/EmptyState';
import type { DeckDialogState } from '../shared/deckActions';
import { BlockError, SkeletonRows } from '../shared/Skeletons';
import { BTN_PRIMARY, BTN_SECONDARY, CARD_BOX, FOCUS } from '../shared/styles';
import { DeckActionsMenu } from './DeckActionsMenu';
import { DeckDialogs } from './DeckDialogs';

const GRID = '@2xl/fc:grid @2xl/fc:grid-cols-[minmax(180px,2fr)_minmax(150px,1.4fr)_104px_40px]';

function dayMonth(iso: string): string {
  return new Date(iso).toLocaleDateString('it-IT', { day: 'numeric', month: 'short' });
}

/** "12 card · generate dall'AI il 17 ott" depending on where the deck came from. */
export function deckOrigin(deck: DeckSummaryDto): string {
  const base = `${deck.cardCount} card`;
  const d = dayMonth(deck.createdAt);
  if (deck.generatedBy === 'ai') return `${base} · generate dall'AI il ${d}`;
  if (deck.generatedBy === 'import') return `${base} · importate il ${d}`;
  if (deck.generatedBy === 'manual') return `${base} · create a mano il ${d}`;
  return base;
}

function SectionHeading({
  id,
  children,
  tone,
}: {
  id: string;
  children: React.ReactNode;
  tone?: 'warn';
}) {
  return (
    <h3
      id={id}
      className={`mb-2 text-xs font-medium uppercase tracking-[0.05em] ${tone === 'warn' ? 'text-warn' : 'text-fg-secondary'}`}
    >
      {children}
    </h3>
  );
}

/** "Le tue card" per mazzo: drafts to approve, active decks with their menu, archived ones. */
export function DeckRows({
  slug,
  onAdd,
}: {
  slug: string;
  onAdd: (mode: 'ai' | 'manual' | 'deck') => void;
}) {
  const qc = useQueryClient();
  const notify = useNotify();
  const query = useDeckSummaries(slug);
  const [dialog, setDialog] = useState<DeckDialogState>(null);
  const [showArchived, setShowArchived] = useState(false);
  const archivedId = useId();
  const decks = query.data ?? [];

  if (query.isError) {
    return (
      <BlockError message="Impossibile caricare i mazzi." onRetry={() => void query.refetch()} />
    );
  }
  if (query.isLoading) {
    return (
      <div aria-busy="true">
        <SkeletonRows count={4} />
      </div>
    );
  }
  if (decks.length === 0 || decks.every((d) => d.cardCount === 0 && d.status !== 'draft')) {
    return (
      <EmptyState
        title="Nessun mazzo ancora"
        text="Genera un mazzo dal materiale o creane uno vuoto da riempire."
        onGenerate={() => onAdd('ai')}
        onWrite={() => onAdd('deck')}
        writeLabel="Nuovo mazzo vuoto"
      />
    );
  }

  const drafts = decks.filter((d) => d.status === 'draft');
  const active = decks.filter((d) => d.status === 'approved');
  const archived = decks.filter((d) => d.status === 'archived');

  const restore = async (deck: DeckSummaryDto) => {
    try {
      await patchDeck(slug, deck.id, { status: 'approved' });
      invalidateFlashcards(qc, slug);
      notify.success(`Mazzo «${deck.title}» ripristinato.`);
    } catch (err) {
      notify.error(err instanceof Error ? err.message : 'Ripristino non riuscito.');
    }
  };

  return (
    <div className="flex flex-col gap-5">
      {drafts.length > 0 && (
        <section aria-labelledby="fc-bozze">
          <SectionHeading id="fc-bozze" tone="warn">
            Da approvare · {drafts.length}
          </SectionHeading>
          <ul className={`${CARD_BOX} overflow-hidden`}>
            {drafts.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-x-5 gap-y-3 border-b border-border px-5 py-3.5 last:border-0"
              >
                <div className="min-w-0 flex-1 basis-52">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-[13px] text-fg-secondary">{deckOrigin(d)}</p>
                </div>
                <span className="text-[13px] text-fg-secondary">Non ancora nel ripasso</span>
                <Link href={`/materie/${slug}/artifacts/${d.id}`} className={BTN_PRIMARY}>
                  Rivedi e approva
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {active.length > 0 && (
        <section aria-labelledby="fc-attivi">
          <SectionHeading id="fc-attivi">Attivi · {active.length}</SectionHeading>
          <ul className={`${CARD_BOX} overflow-hidden`}>
            {active.map((d) => (
              <li
                key={d.id}
                className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border px-5 py-3.5 last:border-0 ${GRID}`}
              >
                <Link
                  href={flashcardsLink(slug, { view: 'card', mazzo: d.id })}
                  scroll={false}
                  className={`flex min-h-10 min-w-0 flex-1 basis-40 flex-col justify-center ${FOCUS}`}
                >
                  <span className="truncate font-medium">{d.title}</span>
                  <span className="text-[13px] text-fg-secondary">
                    {d.cardCount} card
                    {d.topicCount > 0 &&
                      ` · ${d.topicCount} ${d.topicCount === 1 ? 'argomento' : 'argomenti'}`}
                  </span>
                </Link>
                <span className="text-[13px]">
                  <span className="font-medium text-accent-hover">{d.dueCount} da ripassare</span>
                  <span className="text-fg-secondary"> · {d.newCount} nuove</span>
                </span>
                <div>
                  {d.dueCount + d.newCount > 0 && (
                    <Link
                      href={reviewDeckHref(slug, d.id)}
                      aria-label={`Ripassa ${d.title}`}
                      className={`${BTN_SECONDARY} w-full`}
                    >
                      <Play className="size-3.5" aria-hidden="true" />
                      Ripassa
                    </Link>
                  )}
                </div>
                <div className="ml-auto @2xl/fc:ml-0">
                  <DeckActionsMenu slug={slug} deck={d} onAction={setDialog} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {archived.length > 0 && (
        <section>
          <button
            type="button"
            aria-expanded={showArchived}
            aria-controls={archivedId}
            onClick={() => setShowArchived((v) => !v)}
            className={`inline-flex h-10 items-center gap-1.5 text-[13px] text-fg-secondary hover:text-fg-primary ${FOCUS}`}
          >
            <ChevronRight
              className={`size-4 transition-transform duration-120 ${showArchived ? 'rotate-90' : ''}`}
              aria-hidden="true"
            />
            Archiviati · {archived.length} {archived.length === 1 ? 'mazzo' : 'mazzi'}
          </button>
          <ul id={archivedId} hidden={!showArchived} className={`${CARD_BOX} mt-2 overflow-hidden`}>
            {archived.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-3 border-b border-border px-5 py-3 last:border-0"
              >
                <div className="min-w-0 flex-1 basis-40">
                  <p className="truncate font-medium">{d.title}</p>
                  <p className="text-[13px] text-fg-secondary">{d.cardCount} card · archiviato</p>
                </div>
                <button
                  type="button"
                  aria-label={`Ripristina ${d.title}`}
                  onClick={() => void restore(d)}
                  className={BTN_SECONDARY}
                >
                  Ripristina
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <DeckDialogs slug={slug} state={dialog} decks={decks} onClose={() => setDialog(null)} />
    </div>
  );
}

/** Sum of the cards of the approved decks and how many there are: "N in K mazzi attivi". */
export function activeDeckTotals(decks: DeckSummaryDto[] | undefined) {
  if (!decks) return null;
  const active = decks.filter((d) => d.status === 'approved');
  return { cards: active.reduce((s, d) => s + d.cardCount, 0), count: active.length };
}
