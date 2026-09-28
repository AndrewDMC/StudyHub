import Link from 'next/link';
import type { SubjectSummaryDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { formatExamCountdown } from '@/lib/format';

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between text-xs text-fg-secondary">
      <span>{label}</span>
      <span className="font-mono tabular-nums text-fg-primary">{children}</span>
    </div>
  );
}

export function SubjectCard({
  subject,
  reorder,
}: {
  subject: SubjectSummaryDto;
  /** Present only when the grid is showing every non-archived subject, unfiltered — reordering
   * a filtered/partial view would not map cleanly onto `reorderSubjects`' "full list" contract. */
  reorder?:
    { onMoveUp?: (() => void) | undefined; onMoveDown?: (() => void) | undefined } | undefined;
}) {
  const archived = subject.archivedAt !== null;
  return (
    <Link
      href={`/materie/${subject.slug}`}
      className="group relative flex flex-col gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4 transition-colors duration-120 hover:border-border-strong"
      style={{
        borderLeft: `2px solid ${archived ? 'var(--border-strong)' : SUBJECT_COLOR_HEX[subject.color]}`,
      }}
    >
      {reorder && (reorder.onMoveUp || reorder.onMoveDown) && (
        <div className="absolute right-2 top-2 z-10 flex flex-col gap-0.5 opacity-0 transition-opacity duration-120 group-hover:opacity-100">
          <button
            type="button"
            aria-label="Sposta su"
            disabled={!reorder.onMoveUp}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              reorder.onMoveUp?.();
            }}
            className="rounded-[var(--radius-control)] border border-border bg-bg-raised px-1 text-[10px] leading-4 text-fg-secondary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-30"
          >
            ▲
          </button>
          <button
            type="button"
            aria-label="Sposta giù"
            disabled={!reorder.onMoveDown}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              reorder.onMoveDown?.();
            }}
            className="rounded-[var(--radius-control)] border border-border bg-bg-raised px-1 text-[10px] leading-4 text-fg-secondary hover:text-fg-primary disabled:pointer-events-none disabled:opacity-30"
          >
            ▼
          </button>
        </div>
      )}
      <div className="flex items-start justify-between gap-2">
        <h3 className="text-base font-semibold tracking-[-0.02em] text-fg-primary">
          {subject.name}
        </h3>
        {archived ? (
          <span className="rounded-[var(--radius-control)] border border-border-strong bg-bg-raised px-1.5 py-0.5 text-[11px] font-medium text-fg-secondary">
            Archiviata
          </span>
        ) : (
          subject.nextExamAt && (
            <div className="shrink-0 text-right text-[11px] text-fg-muted">
              al{' '}
              {new Date(subject.nextExamAt).toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'short',
              })}
              <b className="block font-mono text-[13px] font-semibold text-fg-primary">
                {formatExamCountdown(subject.nextExamAt)}
              </b>
            </div>
          )
        )}
      </div>

      <div className="space-y-1">
        <Row label={archived ? 'Mastery finale' : 'Mastery media'}>
          {subject.averageMastery !== null ? `${Math.round(subject.averageMastery * 100)}%` : 'N/D'}
        </Row>
        {!archived && subject.dueCardsToday > 0 && (
          <Row label="Card in scadenza oggi">
            <span className="text-warn">{subject.dueCardsToday}</span>
          </Row>
        )}
        <Row label="Documenti">{subject.documentCount}</Row>
      </div>

      {!archived && subject.topicCoverage !== null && (
        <div className="space-y-1">
          <Row label="Copertura argomenti">{Math.round(subject.topicCoverage * 100)}%</Row>
          <div className="h-1 overflow-hidden rounded-full bg-bg-inset">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round(subject.topicCoverage * 100)}%` }}
            />
          </div>
        </div>
      )}
    </Link>
  );
}
