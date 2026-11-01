'use client';

import Link from 'next/link';
import { materialHref } from '@/lib/subjectTabs';
import { methodLabel } from '@/lib/taskMethod';
import {
  statusCountsLabel,
  topicDotTone,
  type ProgressCounts,
  type TopicRow,
} from '../overview/model';
import { cardClass } from '../simulation-mobile/styles';
import { SectionEmpty, SkeletonRows } from './SectionState';

const DOT = {
  ok: 'bg-ok',
  accent: 'bg-accent',
  danger: 'bg-danger',
  neutral: 'bg-border-strong',
} as const;

function planText(row: TopicRow): string {
  if (!row.method || row.method === 'mixed') return row.planLabel;
  const word = methodLabel(row.method).toLowerCase();
  return row.planLabel.toLowerCase().includes(word) ? row.planLabel : `${row.planLabel} · ${word}`;
}

/** "Argomenti": state of every topic in the plan, with the four counts of the plan in the header. */
export function MobileTopics({
  slug,
  rows,
  counts,
  hasPlan,
  loading,
}: {
  slug: string;
  rows: TopicRow[];
  counts: ProgressCounts;
  hasPlan: boolean;
  loading: boolean;
}) {
  const segments = [
    { n: counts.studied, text: `${counts.studied} studiati`, cls: 'bg-ok' },
    { n: counts.inProgress, text: `${counts.inProgress} in corso`, cls: 'bg-accent' },
    { n: counts.todo, text: `${counts.todo} da fare`, cls: 'bg-border-strong' },
    { n: counts.out, text: `${counts.out} fuori`, cls: 'bg-danger' },
  ];
  const countsText = statusCountsLabel(counts);
  return (
    <section
      data-testid="overview-topics"
      aria-labelledby="m-arg"
      aria-busy={loading || undefined}
      className="flex min-w-0 flex-col gap-2"
    >
      <div className="flex min-h-11 items-center justify-between gap-3">
        <h2 id="m-arg" className="text-base font-semibold">
          Argomenti
        </h2>
        <div className="flex items-center gap-3">
          {hasPlan && countsText && (
            <div
              role="img"
              aria-label={segments.map((s) => s.text).join(', ')}
              className="flex h-1.5 w-[120px] gap-0.5 overflow-hidden rounded-full bg-border"
            >
              {segments
                .filter((s) => s.n > 0)
                .map((s) => (
                  <span key={s.text} className={s.cls} style={{ flexGrow: s.n }} />
                ))}
            </div>
          )}
          <Link
            href={`/materie/${slug}?tab=lacune`}
            className="flex min-h-11 items-center text-[13px] text-fg-secondary underline"
          >
            Lacune
          </Link>
        </div>
      </div>
      {hasPlan && countsText && <p className="text-xs text-fg-secondary">{countsText}</p>}
      {loading && rows.length === 0 ? (
        <SkeletonRows count={3} />
      ) : rows.length === 0 ? (
        <SectionEmpty>
          Nessun argomento. Carica del materiale e assegna gli argomenti: poi qui trovi lo stato di
          ciascuno.
          <Link
            href={materialHref(slug, 'tutti')}
            className="mx-auto mt-2 flex min-h-11 items-center justify-center text-fg-secondary underline"
          >
            Vai agli appunti
          </Link>
        </SectionEmpty>
      ) : (
        <ul className={cardClass}>
          {rows.map((row) => (
            <li
              key={row.key}
              className="flex min-h-14 items-center gap-3 border-b border-border px-4 py-1.5 last:border-b-0"
            >
              <span
                aria-hidden="true"
                className={`size-2 shrink-0 rounded-full ${DOT[topicDotTone(row.kind)]}`}
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-sm font-medium text-fg-primary">{row.name}</span>
                <span className="text-xs text-fg-secondary">{planText(row)}</span>
              </span>
              <span className="shrink-0 font-mono text-xs tabular-nums text-fg-secondary">
                {row.mastery === null ? '—' : `${Math.round(row.mastery * 100)}%`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
