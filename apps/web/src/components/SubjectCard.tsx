import Link from 'next/link';
import type { SubjectSummaryDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { formatExamCountdown } from '@/lib/format';

export function SubjectCard({ subject }: { subject: SubjectSummaryDto }) {
  return (
    <Link
      href={`/materie/${subject.slug}`}
      className="block rounded-[var(--radius-card)] border border-border bg-bg-surface p-4 transition-colors duration-120 hover:border-border-strong"
      style={{ borderLeft: `3px solid ${SUBJECT_COLOR_HEX[subject.color]}` }}
    >
      <h3 className="text-base font-medium tracking-[-0.02em] text-fg-primary">{subject.name}</h3>
      <dl className="mt-2 space-y-1 text-xs text-fg-secondary">
        {subject.professor && (
          <div className="flex gap-1">
            <dt className="text-fg-muted">Docente</dt>
            <dd>{subject.professor}</dd>
          </div>
        )}
        {subject.cfu !== null && (
          <div className="flex gap-1">
            <dt className="text-fg-muted">CFU</dt>
            <dd className="font-mono tabular-nums">{subject.cfu}</dd>
          </div>
        )}
        <div className="flex gap-1">
          <dt className="text-fg-muted">Documenti</dt>
          <dd className="font-mono tabular-nums">{subject.documentCount}</dd>
        </div>
        {subject.nextExamAt && (
          <div className="flex gap-1">
            <dt className="text-fg-muted">Prossimo esame</dt>
            <dd className="text-info">{formatExamCountdown(subject.nextExamAt)}</dd>
          </div>
        )}
      </dl>
      <p className="mt-3 font-mono text-[11px] text-fg-muted">{subject.slug}</p>
    </Link>
  );
}
