'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Layers } from 'lucide-react';
import type { ArtifactDto } from '@studyhub/contracts';
import { deckCardsLabel, draftDecksLabel } from '@/lib/flashcardMobile';
import { fetchDeckCards, useDraftDecks } from './queries';

const MAX_DRAFTS = 3;

function DraftLink({ slug, deck, single }: { slug: string; deck: ArtifactDto; single: boolean }) {
  const cards = useQuery({
    queryKey: ['deck-cards', deck.id],
    queryFn: () => fetchDeckCards(slug, deck.id),
  });
  const count = cards.data?.length;
  const generated = count === undefined ? null : deckCardsLabel(count);
  return (
    <Link
      href={`/materie/${slug}/artifacts/${deck.id}`}
      className="flex min-h-16 items-center gap-3 rounded-[var(--radius-card)] border bg-bg-surface p-3.5"
      style={{ borderColor: 'color-mix(in srgb, var(--accent) 45%, var(--border))' }}
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-subtle text-accent"
      >
        <Layers className="size-[18px]" />
      </span>
      <span className="min-w-0 flex-1">
        {single ? (
          <>
            <span className="block text-[15px] font-medium text-fg-primary">
              {draftDecksLabel(1)}
            </span>
            <span className="block truncate text-[13px] text-fg-secondary">
              {deck.title}
              {generated && ` · ${generated}`}
            </span>
          </>
        ) : (
          <>
            <span className="block truncate text-[15px] font-medium text-fg-primary">
              {deck.title}
            </span>
            {generated && <span className="block text-[13px] text-fg-secondary">{generated}</span>}
          </>
        )}
      </span>
      <ChevronRight className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
    </Link>
  );
}

/** Decks generated but not yet approved: each one leads to the review screen. */
export function DraftDecksLink({ slug }: { slug: string }) {
  const { drafts } = useDraftDecks(slug);
  if (drafts.length === 0) return null;
  const single = drafts.length === 1;
  return (
    <section className="flex flex-col gap-2">
      {!single && (
        <h2 className="text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
          {draftDecksLabel(drafts.length)}
        </h2>
      )}
      {drafts.slice(0, MAX_DRAFTS).map((deck) => (
        <DraftLink key={deck.id} slug={slug} deck={deck} single={single} />
      ))}
    </section>
  );
}
