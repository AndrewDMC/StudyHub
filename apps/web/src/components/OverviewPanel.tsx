'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { JobType, RecentActivityItemDto, SubjectOverviewDto } from '@studyhub/contracts';

async function fetchOverview(slug: string): Promise<SubjectOverviewDto> {
  const res = await fetch(`/api/subjects/${slug}/overview`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la panoramica');
  return body.overview as SubjectOverviewDto;
}

/** Shared by every panel below — same `queryKey` means React Query dedupes the fetch to one call. */
function useOverview(subjectSlug: string) {
  return useQuery({
    queryKey: ['overview', subjectSlug],
    queryFn: () => fetchOverview(subjectSlug),
  });
}

const JOB_TYPE_LABELS: Partial<Record<JobType, string>> = {
  generate_flashcards: 'Generazione flashcard',
  generate_schema: 'Generazione schema',
  generate_summary: 'Generazione riassunto',
  generate_simulation: 'Generazione simulazione',
  generate_plan: 'Generazione piano',
  extract_topics: 'Suggerimento argomenti',
  extract_exam_profile: 'Estrazione profilo esame',
  extract_text: 'Estrazione testo',
  transcribe_schema: 'Trascrizione schema',
  classify_document_type: 'Classificazione documento',
  embed_chunks: 'Indicizzazione',
  grade_attempt: 'Correzione simulazione',
  grade_item_second_opinion: 'Seconda opinione',
  distill_handwriting_profile: 'Profilo calligrafia',
  reconcile: 'Sincronizzazione filesystem',
  ping: 'Ping',
};

const JOB_STATUS_LABELS: Record<string, string> = {
  queued: 'in coda',
  running: 'in corso',
  succeeded: 'completato',
  failed: 'fallito',
  cancelled: 'annullato',
};

const RATING_LABELS: Record<number, string> = { 1: 'Again', 2: 'Hard', 3: 'Good', 4: 'Easy' };

function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutes < 1) return 'ora';
  if (minutes < 60) return `${minutes} min fa`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h fa`;
  return `${Math.round(hours / 24)} g fa`;
}

function activityLabel(item: RecentActivityItemDto): string {
  if (item.kind === 'job') {
    return `${JOB_TYPE_LABELS[item.jobType] ?? item.jobType} — ${JOB_STATUS_LABELS[item.status] ?? item.status}`;
  }
  if (item.kind === 'review')
    return `Card ripassata (${RATING_LABELS[item.rating] ?? item.rating})`;
  return `Caricato "${item.documentName}"`;
}

const ACTION_STYLE: Record<string, string> = {
  review: 'bg-accent text-white hover:bg-accent-hover',
  drill: 'border border-warn/50 text-warn hover:bg-warn/10',
};
const DEFAULT_ACTION_STYLE = 'border border-border text-fg-secondary hover:text-fg-primary';

/** "3 azioni consigliate" — la Panoramica risponde da sola all'80% dei casi (docs/fasi/F2-materie.md "Rischi"). */
export function SuggestedActionsPanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useOverview(subjectSlug);

  if (query.isLoading) {
    return <p className="text-xs text-fg-muted">Caricamento…</p>;
  }
  if (query.isError) {
    return (
      <p role="alert" className="text-xs text-danger">
        {(query.error as Error).message}
      </p>
    );
  }
  const actions = query.data?.suggestedActions ?? [];
  if (actions.length === 0) {
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4 text-center text-xs text-fg-muted">
        Nessuna azione consigliata al momento — tutto in ordine.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
      {actions.map((action) => (
        <Link
          key={action.kind}
          href={action.href}
          className={`rounded-[var(--radius-card)] p-3 text-sm transition-colors duration-120 ${
            ACTION_STYLE[action.kind] ?? DEFAULT_ACTION_STYLE
          }`}
        >
          <p className="font-medium">{action.label}</p>
          <p className="mt-0.5 text-xs opacity-80">{action.description}</p>
        </Link>
      ))}
    </div>
  );
}

/** Argomenti senza documenti/flashcard, mastery bassa — non include il drift del piano, già mostrato da `DailyTasksPanel`. */
export function GapsPanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useOverview(subjectSlug);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Gap rilevati
      </h2>
      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.gaps.length === 0 && (
        <p className="px-1 text-xs text-fg-muted">Nessun gap rilevato.</p>
      )}
      {query.isSuccess && query.data.gaps.length > 0 && (
        <ul className="space-y-1 px-1 text-xs text-fg-secondary">
          {query.data.gaps.map((gap, i) => (
            <li key={`${gap.kind}-${gap.topicId}-${i}`}>{gap.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Job, review e upload degli ultimi 7 giorni, più recenti in cima. */
export function RecentActivityPanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useOverview(subjectSlug);

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Attività recente
      </h2>
      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.recentActivity.length === 0 && (
        <p className="px-1 text-xs text-fg-muted">Nessuna attività negli ultimi 7 giorni.</p>
      )}
      {query.isSuccess && query.data.recentActivity.length > 0 && (
        <ul className="divide-y divide-border">
          {query.data.recentActivity.map((item) => (
            <li
              key={`${item.kind}-${item.id}`}
              className="flex items-center justify-between gap-2 px-1 py-1.5"
            >
              <span className="min-w-0 truncate text-xs text-fg-secondary">
                {activityLabel(item)}
              </span>
              <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                {timeAgo(item.timestamp)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
