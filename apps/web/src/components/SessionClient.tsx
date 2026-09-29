'use client';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentContentDto,
  SessionDocumentDto,
  StudySessionDto,
  TopicDto,
  UpdateSessionRequest,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';
import { formatClock, PomodoroPanel, usePomodoro } from '@/components/PomodoroTimer';

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

async function fetchSession(slug: string, id: string): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}`),
    'Impossibile caricare la sessione',
  );
  return body.session;
}

async function patchSession(
  slug: string,
  id: string,
  patch: UpdateSessionRequest,
): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'Aggiornamento della sessione fallito',
  );
  return body.session;
}

async function postEnd(
  slug: string,
  id: string,
  totals: { activeMs: number; pomodoros: number },
): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(totals),
    }),
    'Impossibile terminare la sessione',
  );
  return body.session;
}

async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const body = await readJson<{ topics: TopicDto[] }>(
    await fetch(`/api/subjects/${slug}/topics`),
    'Impossibile caricare gli argomenti',
  );
  return body.topics;
}

async function fetchContent(slug: string, documentId: string): Promise<DocumentContentDto> {
  return readJson<DocumentContentDto>(
    await fetch(`/api/subjects/${slug}/documents/${documentId}/content`),
    'Impossibile caricare il documento',
  );
}

function formatRanges(doc: SessionDocumentDto): string {
  return doc.pageRanges
    .map((r) => (r.pageFrom === r.pageTo ? `p. ${r.pageFrom}` : `pp. ${r.pageFrom}–${r.pageTo}`))
    .join(', ');
}

function DocumentViewer({ slug, doc }: { slug: string; doc: SessionDocumentDto }) {
  const query = useQuery({
    queryKey: ['documentContent', slug, doc.id],
    queryFn: () => fetchContent(slug, doc.id),
    enabled: doc.hasContent,
  });

  return (
    <article className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-6">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border pb-3">
        <h2 className="text-base font-semibold text-fg-primary">{doc.name}</h2>
        {doc.highlighted && (
          <span className="rounded-full bg-accent/15 px-2 py-0.5 text-xs text-accent">
            Da studiare oggi{doc.pageRanges.length > 0 ? ` · ${formatRanges(doc)}` : ''}
          </span>
        )}
        <span className="ml-auto flex gap-3 text-xs">
          <Link
            href={`/materie/${slug}/documenti/${doc.id}/originale`}
            className="text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
          >
            Originale
          </Link>
          <Link
            href={`/materie/${slug}/documenti/${doc.id}`}
            className="text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
          >
            Apri a pagina intera
          </Link>
        </span>
      </header>

      {!doc.hasContent && (
        <p className="text-sm text-fg-muted">
          Questo documento non ha ancora un testo leggibile (elaborazione in corso o non riuscita).
          Puoi aprire l&apos;originale.
        </p>
      )}
      {doc.hasContent && query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && <ObsidianMarkdown source={query.data.markdown} subjectSlug={slug} />}
    </article>
  );
}

function MaterialList({
  session,
  selectedId,
  onSelect,
  topicsById,
}: {
  session: StudySessionDto;
  selectedId: string | null;
  onSelect: (id: string) => void;
  topicsById: Map<string, string>;
}) {
  // Group by the session topic the document belongs to; task-only material has no topic.
  const groups = new Map<string, SessionDocumentDto[]>();
  for (const doc of session.documents) {
    const key = doc.topicIds[0] ?? '';
    groups.set(key, [...(groups.get(key) ?? []), doc]);
  }

  return (
    <div className="space-y-4">
      {[...groups.entries()].map(([topicId, docs]) => (
        <section key={topicId || 'none'}>
          <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {topicId ? (topicsById.get(topicId) ?? 'Argomento') : 'Dalla task'}
          </h3>
          <ul className="space-y-1">
            {docs.map((doc) => (
              <li key={doc.id}>
                <button
                  type="button"
                  onClick={() => onSelect(doc.id)}
                  aria-current={doc.id === selectedId}
                  className={`w-full rounded-[var(--radius-control)] border px-2 py-1.5 text-left text-sm ${
                    doc.id === selectedId
                      ? 'border-accent bg-bg-raised text-fg-primary'
                      : doc.highlighted
                        ? 'border-accent/40 text-fg-primary hover:bg-bg-raised'
                        : 'border-transparent text-fg-secondary hover:bg-bg-raised'
                  }`}
                >
                  <span className="block truncate">{doc.name}</span>
                  {doc.highlighted && doc.pageRanges.length > 0 && (
                    <span className="text-xs text-accent">{formatRanges(doc)}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function TopicPicker({
  topics,
  selected,
  disabled,
  onChange,
}: {
  topics: TopicDto[];
  selected: string[];
  disabled: boolean;
  onChange: (ids: string[]) => void;
}) {
  if (topics.length === 0) return null;
  return (
    <details className="rounded-[var(--radius-control)] border border-border p-2 text-sm">
      <summary className="cursor-pointer text-xs font-medium text-fg-muted">
        Argomenti della sessione ({selected.length})
      </summary>
      <ul className="mt-2 max-h-48 space-y-1 overflow-y-auto">
        {topics.map((t) => (
          <li key={t.id}>
            <label className="flex cursor-pointer items-center gap-2 text-fg-secondary">
              <input
                type="checkbox"
                disabled={disabled}
                checked={selected.includes(t.id)}
                onChange={(e) =>
                  onChange(
                    e.target.checked ? [...selected, t.id] : selected.filter((i) => i !== t.id),
                  )
                }
              />
              {t.name}
            </label>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The work page opened by "Inizia" on a task (docs/08-sessione-di-studio.md,
 * phase 1): the material of the task's topics at a glance, a real-time
 * timer, and "Termina". The AI briefing and chat land in later phases.
 */
export function SessionClient({ slug, sessionId }: { slug: string; sessionId: string }) {
  const queryClient = useQueryClient();
  const sessionKey = ['studySession', slug, sessionId];
  const query = useQuery({ queryKey: sessionKey, queryFn: () => fetchSession(slug, sessionId) });
  const topicsQuery = useQuery({ queryKey: ['topics', slug], queryFn: () => fetchTopics(slug) });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const session = query.data;
  const active = session?.status === 'active';

  const patchMutation = useMutation({
    mutationFn: (patch: UpdateSessionRequest) => patchSession(slug, sessionId, patch),
    onSuccess: (next) => queryClient.setQueryData(sessionKey, next),
  });
  const heartbeat = useCallback(
    (activeMs: number, pomodoros: number) => {
      patchSession(slug, sessionId, { activeMs, pomodoros }).catch(() => {
        /* a missed beat is recovered by the next one or by "Termina" */
      });
    },
    [slug, sessionId],
  );

  const timer = usePomodoro({
    savedActiveMs: session?.activeMs,
    savedPomodoros: session?.pomodoros,
    enabled: active,
    onBeat: heartbeat,
  });

  const endMutation = useMutation({
    mutationFn: () =>
      postEnd(slug, sessionId, {
        activeMs: timer.studyMsRef.current,
        pomodoros: timer.completedRef.current,
      }),
    onSuccess: (next) => {
      queryClient.setQueryData(sessionKey, next);
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['plan', slug] });
    },
  });

  const docs = session?.documents ?? [];
  const selected = docs.find((d) => d.id === selectedId) ?? docs[0] ?? null;
  const topicsById = new Map((topicsQuery.data ?? []).map((t) => [t.id, t.name]));
  const shownMs = active ? timer.studyMs : (session?.activeMs ?? 0);

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-6">
      <Link
        href={`/materie/${slug}`}
        className="text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
      >
        ← Torna alla materia
      </Link>

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}

      {session && (
        <>
          <header className="flex flex-wrap items-center gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4">
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-fg-muted">
                Sessione di studio
                {session.taskMinutes ? ` · ${session.taskMinutes} min previsti` : ''}
              </p>
              <h1 className="truncate text-lg font-semibold text-fg-primary">
                {session.taskTitle ??
                  (session.topics.map((t) => t.name).join(', ') || 'Studio libero')}
              </h1>
            </div>
            <span aria-label="Tempo di studio totale" className="text-right text-xs text-fg-muted">
              Studio
              <span className="block font-mono text-xl tabular-nums text-fg-primary">
                {formatClock(shownMs)}
              </span>
            </span>
            {active ? (
              <>
                <Button
                  type="button"
                  disabled={endMutation.isPending}
                  onClick={() => endMutation.mutate()}
                >
                  Termina
                </Button>
              </>
            ) : (
              <span className="rounded-full bg-ok/15 px-3 py-1 text-xs text-ok">
                Terminata · {session.pomodoros} {session.pomodoros === 1 ? 'pomodoro' : 'pomodori'}
                {session.taskId ? ' · task completata' : ''}
              </span>
            )}
          </header>
          {(endMutation.isError || patchMutation.isError) && (
            <p role="alert" className="text-sm text-danger">
              {((endMutation.error ?? patchMutation.error) as Error).message}
            </p>
          )}

          <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
            <aside className="space-y-3">
              <PomodoroPanel timer={timer} active={active} />
              <TopicPicker
                topics={topicsQuery.data ?? []}
                selected={session.topics.map((t) => t.id)}
                disabled={!active || patchMutation.isPending}
                onChange={(ids) => patchMutation.mutate({ topicIds: ids })}
              />
              {docs.length === 0 ? (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-sm text-fg-muted">
                  Nessun documento collegato a questa sessione. Scegli un argomento qui sopra,
                  oppure collega i documenti agli argomenti dalla scheda{' '}
                  <Link className="underline" href={`/materie/${slug}`}>
                    della materia
                  </Link>
                  .
                </div>
              ) : (
                <MaterialList
                  session={session}
                  selectedId={selected?.id ?? null}
                  onSelect={setSelectedId}
                  topicsById={topicsById}
                />
              )}
            </aside>

            <main className="min-w-0">
              {selected ? (
                <DocumentViewer key={selected.id} slug={slug} doc={selected} />
              ) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center text-sm text-fg-muted">
                  Seleziona un documento per leggerlo qui.
                </div>
              )}
            </main>
          </div>
        </>
      )}
    </div>
  );
}
