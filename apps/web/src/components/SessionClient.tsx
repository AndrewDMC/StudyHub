'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentContentDto,
  SessionCitationDto,
  SessionDocumentDto,
  SessionFocus,
  SessionItemCitationDto,
  StudySessionDto,
  TopicDto,
  UpdateSessionRequest,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';
import { formatClock, PomodoroPanel, usePomodoro } from '@/components/PomodoroTimer';
import { SessionBriefing } from '@/components/SessionBriefing';
import { SessionClosing } from '@/components/SessionClosing';
import { SessionChat } from '@/components/SessionChat';

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

/** The page a node sits on, from the `## Pagina N` headings the ingest writes into every content.md. */
function pageOfNode(node: Node, root: HTMLElement): number | null {
  let page: number | null = null;
  for (const heading of root.querySelectorAll('h2')) {
    const match = /^Pagina\s+(\d+)/.exec(heading.textContent ?? '');
    if (!match) continue;
    if (heading.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING) {
      page = Number(match[1]);
    } else {
      break;
    }
  }
  return page;
}

interface PendingAsk {
  x: number;
  y: number;
  text: string;
  page: number | null;
}

function DocumentViewer({
  slug,
  doc,
  canAsk,
  onAsk,
  target,
}: {
  slug: string;
  doc: SessionDocumentDto;
  /** The chat is only interactive while the session is active. */
  canAsk: boolean;
  onAsk: (focus: SessionFocus) => void;
  /** A cited page to scroll to once the document is rendered. */
  target: { page: number; nonce: number } | null;
}) {
  const query = useQuery({
    queryKey: ['documentContent', slug, doc.id],
    queryFn: () => fetchContent(slug, doc.id),
    enabled: doc.hasContent,
  });
  const bodyRef = useRef<HTMLDivElement>(null);
  const [ask, setAsk] = useState<PendingAsk | null>(null);

  // A cited page: scroll the matching "Pagina N" heading into view once the text is on screen.
  useEffect(() => {
    if (!target || !query.isSuccess) return;
    const wanted = new RegExp(`^Pagina\\s+${target.page}\\b`);
    const heading = [...(bodyRef.current?.querySelectorAll('h2') ?? [])].find((h) =>
      wanted.test(h.textContent ?? ''),
    );
    heading?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [target, query.isSuccess]);

  // The floating button is positioned from the selection: drop it when the selection goes away.
  useEffect(() => {
    if (!ask) return;
    const dismiss = () => setAsk(null);
    const onSelectionChange = () => {
      if (window.getSelection()?.isCollapsed) dismiss();
    };
    document.addEventListener('selectionchange', onSelectionChange);
    window.addEventListener('scroll', dismiss, true);
    return () => {
      document.removeEventListener('selectionchange', onSelectionChange);
      window.removeEventListener('scroll', dismiss, true);
    };
  }, [ask]);

  function readSelection() {
    const root = bodyRef.current;
    const selection = window.getSelection();
    const text = selection?.toString().trim();
    if (
      !canAsk ||
      !root ||
      !selection ||
      !text ||
      !selection.anchorNode ||
      !selection.focusNode ||
      !root.contains(selection.anchorNode) ||
      !root.contains(selection.focusNode)
    ) {
      setAsk(null);
      return;
    }
    const rect = selection.getRangeAt(0).getBoundingClientRect();
    setAsk({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text: text.slice(0, 4000),
      page: pageOfNode(selection.anchorNode, root),
    });
  }

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
      {query.isSuccess && (
        <div ref={bodyRef} onMouseUp={readSelection} onKeyUp={readSelection}>
          <ObsidianMarkdown source={query.data.markdown} subjectSlug={slug} />
        </div>
      )}

      {ask && (
        <button
          type="button"
          // Keep the selection alive: a normal click would collapse it before the handler runs.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            onAsk({ docId: doc.id, page: ask.page, text: ask.text });
            window.getSelection()?.removeAllRanges();
            setAsk(null);
          }}
          style={{ left: ask.x, top: ask.y - 8, transform: 'translate(-50%, -100%)' }}
          className="fixed z-20 rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-medium text-white shadow-lg hover:bg-accent-hover"
        >
          Chiedi all&apos;AI
        </button>
      )}
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
 * The work page opened by "Inizia" on a task (docs/08-sessione-di-studio.md):
 * the material of the task's topics at a glance, a real-time timer, "Termina"
 * (phase 2) a tutor chat that answers only from that material and cites it and
 * (phase 3) key points and exercises generated on request.
 */
export function SessionClient({ slug, sessionId }: { slug: string; sessionId: string }) {
  const queryClient = useQueryClient();
  const sessionKey = ['studySession', slug, sessionId];
  const query = useQuery({ queryKey: sessionKey, queryFn: () => fetchSession(slug, sessionId) });
  const topicsQuery = useQuery({ queryKey: ['topics', slug], queryFn: () => fetchTopics(slug) });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Below `lg` the columns become two tabs; on desktop everything is side by side.
  const [tab, setTab] = useState<'material' | 'chat'>('material');
  // The middle column shows either the document or the key points / exercises.
  const [center, setCenter] = useState<'document' | 'study'>('document');
  const [focus, setFocus] = useState<SessionFocus | null>(null);
  const [target, setTarget] = useState<{ docId: string; page: number; nonce: number } | null>(null);

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
  const documentNames = new Map(docs.map((d) => [d.id, d.name]));

  const openCitation = (
    citation: Pick<SessionCitationDto | SessionItemCitationDto, 'docId' | 'page'>,
  ) => {
    setSelectedId(citation.docId);
    setTarget({ docId: citation.docId, page: citation.page, nonce: Date.now() });
    setCenter('document');
    setTab('material');
  };
  const askAboutSelection = (next: SessionFocus) => {
    setFocus(next);
    setTab('chat');
  };

  return (
    <div className="mx-auto flex max-w-[100rem] flex-col gap-4 p-6">
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
          {!active && (
            <SessionClosing
              slug={slug}
              sessionId={sessionId}
              session={session}
              sessionKey={sessionKey}
            />
          )}
          {(endMutation.isError || patchMutation.isError) && (
            <p role="alert" className="text-sm text-danger">
              {((endMutation.error ?? patchMutation.error) as Error).message}
            </p>
          )}

          <div role="tablist" aria-label="Sezioni" className="flex gap-1 lg:hidden">
            {(['material', 'chat'] as const).map((id) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`rounded-[var(--radius-control)] border px-3 py-1 text-sm ${
                  tab === id
                    ? 'border-accent bg-bg-raised text-fg-primary'
                    : 'border-border text-fg-secondary'
                }`}
              >
                {id === 'material' ? 'Materiale' : 'Chat'}
              </button>
            ))}
          </div>

          <div className="grid gap-4 lg:grid-cols-[16rem_minmax(0,1fr)_24rem]">
            <aside className={`space-y-3 ${tab === 'chat' ? 'hidden lg:block' : ''}`}>
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
                  onSelect={(id) => {
                    setSelectedId(id);
                    setCenter('document');
                  }}
                  topicsById={topicsById}
                />
              )}
            </aside>

            <main className={`min-w-0 space-y-3 ${tab === 'chat' ? 'hidden lg:block' : ''}`}>
              <div role="tablist" aria-label="Centro della pagina" className="flex gap-1">
                {(
                  [
                    ['document', 'Documento'],
                    ['study', 'Punti chiave ed esercizi'],
                  ] as const
                ).map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={center === id}
                    onClick={() => setCenter(id)}
                    className={`rounded-[var(--radius-control)] border px-3 py-1 text-sm ${
                      center === id
                        ? 'border-accent bg-bg-raised text-fg-primary'
                        : 'border-border text-fg-secondary'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {center === 'study' ? (
                <SessionBriefing
                  slug={slug}
                  sessionId={sessionId}
                  active={active}
                  hasDocuments={docs.length > 0}
                  onOpenCitation={openCitation}
                  onAsk={askAboutSelection}
                />
              ) : selected ? (
                <DocumentViewer
                  key={selected.id}
                  slug={slug}
                  doc={selected}
                  canAsk={active}
                  onAsk={askAboutSelection}
                  target={target?.docId === selected.id ? target : null}
                />
              ) : (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border p-8 text-center text-sm text-fg-muted">
                  Seleziona un documento per leggerlo qui.
                </div>
              )}
            </main>

            <div
              className={`h-[75vh] min-h-0 flex-col lg:sticky lg:top-4 lg:flex lg:h-[calc(100vh-2rem)] ${
                tab === 'material' ? 'hidden' : 'flex'
              }`}
            >
              <SessionChat
                slug={slug}
                sessionId={sessionId}
                active={active}
                documentNames={documentNames}
                focus={focus}
                onClearFocus={() => setFocus(null)}
                onOpenCitation={openCitation}
              />
            </div>
          </div>
        </>
      )}
    </div>
  );
}
