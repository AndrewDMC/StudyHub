'use client';

import { type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { setDocumentTopics } from '../DocumentList';
import { BottomSheet } from '../subject-mobile/BottomSheet';

/** "Argomenti": toggle which topics the document belongs to (PUT replaces the full set). */
export function TopicPickerSheet({
  open,
  onOpenChange,
  slug,
  doc,
  topics,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  doc: DocumentDto;
  topics: TopicDto[];
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (topicIds: string[]) => setDocumentTopics(slug, doc.id, topicIds),
    // Returned so `isPending` lasts until the refetch: the next tap then starts from fresh topicIds.
    onSuccess: () =>
      Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents', slug] }),
        queryClient.invalidateQueries({ queryKey: ['document', slug, doc.id] }),
      ]),
  });

  const toggle = (topicId: string) => {
    mutation.mutate(
      doc.topicIds.includes(topicId)
        ? doc.topicIds.filter((id) => id !== topicId)
        : [...doc.topicIds, topicId],
    );
  };

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Argomenti"
      description="A cosa è collegato questo documento"
      returnFocusRef={returnFocusRef}
    >
      {topics.length === 0 ? (
        <p className="mt-3 text-sm text-fg-muted">Nessun argomento nella materia ancora.</p>
      ) : (
        <ul className="mt-2">
          {topics.map((topic) => {
            const linked = doc.topicIds.includes(topic.id);
            return (
              <li key={topic.id}>
                <button
                  type="button"
                  aria-pressed={linked}
                  disabled={mutation.isPending}
                  onClick={() => toggle(topic.id)}
                  className="flex min-h-11 w-full items-center gap-3 rounded-[var(--radius-control)] px-3 text-left text-[15px] hover:bg-bg-raised disabled:opacity-60"
                >
                  <span
                    aria-hidden="true"
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border ${
                      linked ? 'border-accent bg-accent text-bg-base' : 'border-border-strong'
                    }`}
                  >
                    {linked && <Check className="h-3.5 w-3.5" />}
                  </span>
                  <span className="min-w-0 flex-1 truncate">{topic.name}</span>
                  <span className="text-xs text-fg-muted">
                    {linked ? 'collegato' : 'non collegato'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mutation.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {(mutation.error as Error).message}
        </p>
      )}
    </BottomSheet>
  );
}
