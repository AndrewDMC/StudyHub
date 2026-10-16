'use client';

import { Sparkles } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { DocumentDto } from '@studyhub/contracts';
import { documentTypeLabel } from '@/lib/documentStatus';
import { resolveDocumentType } from '../DocumentList';

/**
 * "Suggerito: <tipo>" with Applica / Ignora for a document whose `classify_document_type` suggestion
 * differs from its type. Sits next to (not inside) the row link: a button in a link is invalid HTML.
 */
export function TypeSuggestionChip({
  slug,
  doc,
  onResolved,
}: {
  slug: string;
  doc: DocumentDto;
  onResolved: (message: string, accepted: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const label = documentTypeLabel({ type: doc.typeSuggested ?? doc.type, mime: doc.mime });
  const m = useMutation({
    mutationFn: (accept: boolean) => resolveDocumentType(slug, doc.id, accept),
    onSuccess: (_d, accept) => {
      void queryClient.invalidateQueries({ queryKey: ['documents', slug] });
      onResolved(accept ? `Tipo aggiornato: ${label}` : 'Suggerimento ignorato', accept);
    },
  });

  return (
    <div
      role="group"
      aria-label={`Tipo suggerito per ${doc.originalName}`}
      data-testid="type-suggestion"
      className="flex flex-wrap items-center gap-x-2 pb-2 pl-[4.125rem] pr-3.5"
    >
      <span className="inline-flex min-h-8 items-center gap-1 rounded-full border border-accent bg-accent-subtle px-3 text-[13px] text-fg-primary">
        <Sparkles className="size-3.5 text-accent" aria-hidden="true" />
        Suggerito: {label}
      </span>
      <button
        type="button"
        data-testid="type-suggestion-apply"
        disabled={m.isPending}
        onClick={() => m.mutate(true)}
        className="min-h-11 px-2 text-[13px] font-semibold text-accent disabled:opacity-50"
      >
        {m.isPending ? 'Applico…' : 'Applica'}
      </button>
      <button
        type="button"
        data-testid="type-suggestion-dismiss"
        disabled={m.isPending}
        onClick={() => m.mutate(false)}
        className="min-h-11 px-2 text-[13px] text-fg-muted disabled:opacity-50"
      >
        Ignora
      </button>
      {m.isError && (
        <p role="alert" className="basis-full text-[13px] text-danger">
          {(m.error as Error).message}
        </p>
      )}
    </div>
  );
}
