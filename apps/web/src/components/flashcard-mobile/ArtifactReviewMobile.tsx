'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { FlashcardDto } from '@studyhub/contracts';
import { REVIEW_OVERVIEW_KEY } from '@/lib/reviewOverview';
import { reviewProgress, type ReviewMark } from '@/lib/flashcardMobile';
import { DocHeader } from '../document-mobile/DocHeader';
import { useDocument } from '../document-mobile/queries';
import { SectionEmpty, SectionError } from '../subject-mobile/SectionState';
import { ReviewCard } from './ReviewCard';
import { ReviewCardEditSheet } from './ReviewCardEditSheet';
import { ReviewFooter } from './ReviewFooter';
import { approveDeck, reviewDeckCard, useArtifacts, useDeckCards } from './queries';

const backLink = 'inline-flex min-h-11 items-center font-medium text-accent';

function GeneratedFrom({ slug, docId }: { slug: string; docId: string }) {
  const doc = useDocument(slug, docId);
  if (!doc.data) return null;
  return (
    <>
      {' '}
      Generate da{' '}
      <Link href={`/materie/${slug}/documenti/${docId}`} className="text-accent underline">
        {doc.data.originalName}
      </Link>
      .
    </>
  );
}

/** Deck review below md: keep / edit / drop each generated card, then approve the deck. */
export function ArtifactReviewMobile({
  subjectSlug: slug,
  artifactId,
}: {
  subjectSlug: string;
  artifactId: string;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const artifacts = useArtifacts(slug);
  const query = useDeckCards(slug, artifactId);
  const [marks, setMarks] = useState<Record<string, ReviewMark>>({});
  const [editing, setEditing] = useState<FlashcardDto | null>(null);
  const [approveError, setApproveError] = useState<string | null>(null);
  const editTriggerRef = useRef<HTMLElement | null>(null);

  // The footer has the call to action: the tab bar goes.
  useEffect(() => {
    document.documentElement.dataset.fullscreen = '';
    return () => {
      delete document.documentElement.dataset.fullscreen;
    };
  }, []);

  const backHref = `/materie/${slug}?tab=flashcard`;
  const artifact = artifacts.data?.find((a) => a.id === artifactId);
  const cards = query.data ?? [];
  const progress = reviewProgress(marks, cards.length);

  const docIds = [...new Set(cards.flatMap((c) => (c.sourceRef ? [c.sourceRef.docId] : [])))];

  const toggleMark = (id: string, mark: ReviewMark) =>
    setMarks((prev) => {
      const next = { ...prev };
      if (next[id] === mark) delete next[id];
      else next[id] = mark;
      return next;
    });

  // Marks of cards that are no longer in the deck (discarded) are forgotten.
  useEffect(() => {
    if (!query.data) return;
    const ids = new Set(query.data.map((c) => c.id));
    setMarks((prev) => {
      const stale = Object.keys(prev).filter((id) => !ids.has(id));
      if (stale.length === 0) return prev;
      const next = { ...prev };
      for (const id of stale) delete next[id];
      return next;
    });
  }, [query.data]);

  const approve = useMutation({
    mutationFn: async () => {
      const drops = cards.filter((c) => marks[c.id] === 'drop');
      const results = await Promise.allSettled(
        drops.map((c) => reviewDeckCard(slug, artifactId, c.id, { action: 'discard' })),
      );
      const failed = results.filter((r) => r.status === 'rejected').length;
      // Always refetch: a card that failed because it was already gone must not block the retry.
      // Marks of cards that left the deck are pruned by the effect above.
      await queryClient.invalidateQueries({ queryKey: ['deck-cards', artifactId] });
      if (failed > 0) {
        throw new Error(
          failed === 1
            ? '1 card non è stata scartata. Riprova.'
            : `${failed} card non sono state scartate. Riprova.`,
        );
      }
      await approveDeck(slug, artifactId);
    },
    onMutate: () => setApproveError(null),
    onSuccess: () => {
      for (const key of [
        ['deck-cards', artifactId],
        ['artifacts', slug],
        ['decks', slug],
        ['flashcard-list', slug],
        ['flashcard-stats', slug],
        ['stats', slug],
        REVIEW_OVERVIEW_KEY,
      ]) {
        void queryClient.invalidateQueries({ queryKey: key });
      }
      router.replace(backHref);
    },
    onError: (err) => setApproveError((err as Error).message),
  });

  // Marks and edits are frozen while the approval runs and once the deck is approved.
  const locked = approve.isPending || artifact?.status === 'approved';

  const saved = (updated: FlashcardDto | null) => {
    if (!updated) {
      void queryClient.invalidateQueries({ queryKey: ['deck-cards', artifactId] });
      return;
    }
    queryClient.setQueryData<FlashcardDto[]>(['deck-cards', artifactId], (old) =>
      old?.map((c) => (c.id === updated.id ? updated : c)),
    );
  };

  return (
    <div className="flex min-h-full flex-col bg-bg-base">
      <DocHeader
        backHref={backHref}
        backLabel="Chiudi la revisione"
        backIcon="close"
        subtitle="Revisione flashcard"
        title={artifact?.title}
        actions={
          cards.length > 0 ? (
            <span
              aria-label={`${progress.reviewed} card esaminate su ${cards.length}`}
              className="shrink-0 pr-3 font-mono text-xs text-fg-secondary"
            >
              {progress.reviewed}/{cards.length}
            </span>
          ) : undefined
        }
      />

      <main
        className="flex min-w-0 flex-1 flex-col gap-3 p-4"
        aria-busy={query.isLoading || undefined}
      >
        {query.isLoading ? (
          <div aria-hidden="true" className="space-y-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-36 animate-pulse rounded-[var(--radius-card)] bg-bg-raised"
              />
            ))}
          </div>
        ) : query.isError ? (
          <>
            <SectionError
              message={(query.error as Error).message}
              onRetry={() => void query.refetch()}
            />
            <Link href={backHref} className={backLink}>
              Torna alle flashcard
            </Link>
          </>
        ) : cards.length === 0 ? (
          <>
            <SectionEmpty>
              Nessuna card da revisionare (tutte scartate, o il mazzo è vuoto).
            </SectionEmpty>
            <Link href={backHref} className={backLink}>
              Torna alle flashcard
            </Link>
          </>
        ) : (
          <>
            <p className="text-[13px] text-fg-secondary">
              Tieni, modifica o scarta: le card scartate vengono eliminate quando approvi il mazzo.
              {docIds.length === 1 ? (
                <GeneratedFrom slug={slug} docId={docIds[0]!} />
              ) : docIds.length > 1 ? (
                ` Generate da ${docIds.length} documenti.`
              ) : null}
            </p>
            <ul className="flex flex-col gap-3">
              {cards.map((card) => (
                <li key={card.id}>
                  <ReviewCard
                    card={card}
                    mark={marks[card.id]}
                    disabled={locked}
                    onMark={(mark) => toggleMark(card.id, mark)}
                    onEdit={(trigger) => {
                      editTriggerRef.current = trigger;
                      setEditing(card);
                    }}
                  />
                </li>
              ))}
            </ul>
          </>
        )}
      </main>

      {query.isSuccess && cards.length > 0 && (
        <ReviewFooter
          kept={progress.kept}
          dropped={progress.dropped}
          left={progress.left}
          approved={artifact?.status === 'approved'}
          pending={approve.isPending}
          error={approveError}
          backHref={backHref}
          onApprove={() => approve.mutate()}
        />
      )}

      <ReviewCardEditSheet
        slug={slug}
        artifactId={artifactId}
        card={locked ? null : editing}
        onClose={() => setEditing(null)}
        onSaved={saved}
        returnFocusRef={editTriggerRef}
      />
    </div>
  );
}
