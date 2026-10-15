'use client';

import { useEffect, useState, type RefObject } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { MODEL_OPTIONS } from '../ModelPicker';
import { enqueue, fetchEstimate, formatCost, scopeKey, type ScopeInput } from '../GenerationPanel';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** Confirms flashcard generation scoped to one topic, with the estimated cost. */
export function TopicFlashcardsSheet({
  open,
  onOpenChange,
  slug,
  topicId,
  topicName,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  topicId: string;
  topicName: string;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const [model] = useState<string>(MODEL_OPTIONS[1].id); // same default routing as GenerationPanel
  const scope: ScopeInput = { topicIds: [topicId] };

  const estimate = useQuery({
    queryKey: ['generation-estimate', slug, model, scopeKey(scope)],
    queryFn: () => fetchEstimate(slug, scope, model),
    enabled: open,
  });
  const generate = useMutation({
    mutationFn: () => enqueue(slug, 'flashcards', scope, model),
    onSuccess: () => {
      setTimeout(() => queryClient.invalidateQueries({ queryKey: ['artifacts', slug] }), 3000);
    },
  });

  useEffect(() => {
    if (open) generate.reset();
  }, [open]);

  const cost = estimate.data?.perKind.flashcards;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Genera flashcard"
      description={`Argomento: ${topicName}`}
      returnFocusRef={returnFocusRef}
    >
      <p className="mt-3 text-[13px] text-fg-secondary">
        {estimate.isLoading
          ? 'Stima in corso…'
          : estimate.isError || !cost
            ? 'Stima costo non disponibile.'
            : `Costo stimato: ${formatCost(cost.costEur)}`}
      </p>
      <button
        type="button"
        disabled={generate.isPending || generate.isSuccess}
        onClick={() => generate.mutate()}
        className="mt-2 min-h-11 w-full rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
      >
        {generate.isPending ? 'Avvio…' : 'Genera flashcard'}
      </button>
      {generate.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {(generate.error as Error).message}
        </p>
      )}
      {generate.isSuccess && (
        <div role="status" className="mt-2 text-[13px] text-ok">
          Job avviato — l&apos;elenco si aggiorna a breve.{' '}
          <Link
            href={`/materie/${slug}?tab=flashcard`}
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            Vai alle flashcard
          </Link>
        </div>
      )}
    </BottomSheet>
  );
}
