'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { ExamDto } from '@studyhub/contracts';
import { formatDuration } from '@/lib/documentStatus';
import { formatExamCountdown } from '@/lib/format';
import { KIND_LABELS, fetchExams } from '../ExamsPanel';
import {
  MobileSection,
  SectionEmpty,
  SectionError,
  SkeletonRows,
} from '../subject-mobile/SectionState';
import { ExamDetailSheet } from './ExamDetailSheet';
import { ExamFormSheet } from './ExamFormSheet';

const MAX_SHOWN = 3;

function startOfToday(): number {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** "Esami in programma": the next three scheduled exams, add + detail sheets. */
export function ExamsSection({ slug }: { slug: string }) {
  const query = useQuery({ queryKey: ['exams', slug], queryFn: () => fetchExams(slug) });
  const [adding, setAdding] = useState(false);
  const [selected, setSelected] = useState<ExamDto | null>(null);
  const addRef = useRef<HTMLButtonElement>(null);
  const cardRef = useRef<HTMLElement | null>(null);

  const upcoming = (query.data ?? [])
    .filter((e) => e.status === 'scheduled' && new Date(e.date).getTime() >= startOfToday())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  const shown = upcoming.slice(0, MAX_SHOWN);

  return (
    <MobileSection
      title="Esami in programma"
      busy={query.isLoading}
      action={
        <button
          ref={addRef}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setAdding(true)}
          className="flex min-h-11 items-center px-2 text-sm text-accent"
        >
          Aggiungi
        </button>
      }
    >
      {query.isLoading && <SkeletonRows count={1} />}
      {query.isError && (
        <SectionError message={(query.error as Error).message} onRetry={() => query.refetch()} />
      )}
      {query.isSuccess && shown.length === 0 && (
        <SectionEmpty>Nessun esame in programma.</SectionEmpty>
      )}
      {query.isSuccess && shown.length > 0 && (
        <ul className="space-y-2">
          {shown.map((exam) => {
            const date = new Date(exam.date);
            const meta = [
              KIND_LABELS[exam.kind],
              exam.location,
              exam.durationMin !== null ? formatDuration(exam.durationMin) : null,
              formatExamCountdown(exam.date),
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <li key={exam.id}>
                <button
                  type="button"
                  aria-haspopup="dialog"
                  onClick={(e) => {
                    cardRef.current = e.currentTarget;
                    setSelected(exam);
                  }}
                  className="flex min-h-16 w-full items-center gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface px-3.5 py-2.5 text-left"
                >
                  <span className="flex w-11 shrink-0 flex-col items-center border-r border-border pr-3">
                    <span className="font-mono text-[22px] leading-none">{date.getDate()}</span>
                    <span className="text-xs uppercase text-fg-secondary">
                      {date.toLocaleDateString('it-IT', { month: 'short' }).replace('.', '')}
                    </span>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px] font-medium">{exam.title}</span>
                    <span className="block truncate text-[13px] text-fg-secondary">{meta}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {query.isSuccess && upcoming.length > MAX_SHOWN && (
        <Link
          href={`/materie/${slug}?tab=simulazioni`}
          className="mt-1 flex min-h-11 items-center text-sm text-accent"
        >
          Tutti gli esami
        </Link>
      )}

      <ExamFormSheet open={adding} onOpenChange={setAdding} slug={slug} returnFocusRef={addRef} />
      <ExamDetailSheet
        exam={selected}
        onOpenChange={(o) => !o && setSelected(null)}
        slug={slug}
        returnFocusRef={cardRef}
      />
    </MobileSection>
  );
}
