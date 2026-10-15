'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExamDto } from '@studyhub/contracts';
import { formatDuration } from '@/lib/documentStatus';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { KIND_LABELS, deleteExam } from '../ExamsPanel';

/** Exam detail with inline-confirmed delete (the desktop hover "X" does not exist on touch). */
export function ExamDetailSheet({
  exam,
  onOpenChange,
  slug,
  returnFocusRef,
}: {
  exam: ExamDto | null;
  onOpenChange: (open: boolean) => void;
  slug: string;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const cancelRef = useRef<HTMLButtonElement>(null);

  const mutation = useMutation({
    mutationFn: (id: string) => deleteExam(slug, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['exams', slug] });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    setConfirming(false);
    mutation.reset();
  }, [exam?.id]);

  useEffect(() => {
    if (confirming) cancelRef.current?.focus();
  }, [confirming]);

  return (
    <BottomSheet
      open={exam !== null}
      onOpenChange={onOpenChange}
      title={exam?.title ?? 'Esame'}
      description={exam ? KIND_LABELS[exam.kind] : undefined}
      returnFocusRef={returnFocusRef}
    >
      {exam && (
        <div className="mt-3">
          <dl className="space-y-2 text-[15px]">
            <div>
              <dt className="text-[13px] text-fg-muted">Data</dt>
              <dd>
                {new Date(exam.date).toLocaleDateString('it-IT', {
                  weekday: 'long',
                  day: 'numeric',
                  month: 'long',
                  year: 'numeric',
                })}
              </dd>
            </div>
            {exam.durationMin !== null && (
              <div>
                <dt className="text-[13px] text-fg-muted">Durata</dt>
                <dd>{formatDuration(exam.durationMin)}</dd>
              </div>
            )}
            {exam.location && (
              <div>
                <dt className="text-[13px] text-fg-muted">Luogo</dt>
                <dd>{exam.location}</dd>
              </div>
            )}
            {exam.allowedMaterials && (
              <div>
                <dt className="text-[13px] text-fg-muted">Materiale</dt>
                <dd>Ammesso: {exam.allowedMaterials}</dd>
              </div>
            )}
            {exam.description && (
              <div>
                <dt className="text-[13px] text-fg-muted">Note</dt>
                <dd className="whitespace-pre-wrap break-words">{exam.description}</dd>
              </div>
            )}
          </dl>

          {confirming ? (
            <div className="mt-4">
              <p className="break-words text-sm">Eliminare «{exam.title}»?</p>
              <div className="mt-2 flex gap-2">
                <button
                  ref={cancelRef}
                  type="button"
                  onClick={() => setConfirming(false)}
                  className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-sm"
                >
                  Annulla
                </button>
                <button
                  type="button"
                  disabled={mutation.isPending}
                  onClick={() => mutation.mutate(exam.id)}
                  className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-danger text-sm font-medium text-danger disabled:opacity-50"
                >
                  {mutation.isPending ? 'Elimino…' : 'Sì, elimina'}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setConfirming(true)}
              className="mt-4 min-h-11 w-full rounded-[var(--radius-control)] border border-border text-sm font-medium text-danger"
            >
              Elimina esame
            </button>
          )}
          {mutation.isError && (
            <p role="alert" className="mt-2 text-[13px] text-danger">
              {(mutation.error as Error).message}
            </p>
          )}
        </div>
      )}
    </BottomSheet>
  );
}
