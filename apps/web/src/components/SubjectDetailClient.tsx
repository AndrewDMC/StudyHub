'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type {
  DocumentDto,
  ExamDto,
  FlashcardStatsDto,
  SubjectDto,
  TopicDto,
} from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { formatExamCountdown } from '@/lib/format';
import { SelectionProvider, useSelection } from '@/lib/selection';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentList } from './DocumentList';
import { TopicsPanel } from './TopicsPanel';
import { ExamsPanel } from './ExamsPanel';
import { SubjectActions } from './SubjectActions';
import { AiPanel } from './AiPanel';
import { StatsPanel } from './StatsPanel';
import { ExamPrepPanel } from './ExamPrepPanel';
import { DailyTasksPanel } from './DailyTasksPanel';
import { SearchPanel } from './SearchPanel';
import { GapsPanel, RecentActivityPanel, SuggestedActionsPanel } from './OverviewPanel';
import { FlashcardListPanel } from './FlashcardListPanel';
import { CalibrationPanel } from './CalibrationPanel';
import { CoveragePanel } from './CoveragePanel';

const TABS = [
  { key: 'panoramica', label: 'Panoramica' },
  { key: 'appunti', label: 'Appunti' },
  { key: 'schemi', label: 'Schemi' },
  { key: 'esami', label: 'Esami' },
  { key: 'flashcard', label: 'Flashcard' },
  { key: 'simulazioni', label: 'Simulazioni' },
  { key: 'lacune', label: 'Lacune' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

// Persisted across visits (docs/fasi/F2-materie.md "Destra ... collassabile") — a viewer who
// collapses the AI panel once shouldn't have to redo it on every subject/reload.
const AI_PANEL_STORAGE_KEY = 'studyhub:ai-panel-open';

async function fetchSubject(slug: string): Promise<SubjectDto> {
  const res = await fetch(`/api/subjects/${slug}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Materia non trovata');
  return body.subject as SubjectDto;
}

async function fetchDocuments(slug: string): Promise<DocumentDto[]> {
  const res = await fetch(`/api/subjects/${slug}/documents`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i documenti');
  return body.documents as DocumentDto[];
}

async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const res = await fetch(`/api/subjects/${slug}/topics`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli argomenti');
  return body.topics as TopicDto[];
}

async function fetchExams(slug: string): Promise<ExamDto[]> {
  const res = await fetch(`/api/subjects/${slug}/exams`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli esami');
  return body.exams as ExamDto[];
}

async function fetchStats(slug: string): Promise<FlashcardStatsDto> {
  const res = await fetch(`/api/subjects/${slug}/stats/flashcards`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le statistiche');
  return body.stats as FlashcardStatsDto;
}

async function fetchAiProvider(): Promise<string> {
  const res = await fetch('/api/settings/ai-provider');
  const body = await res.json();
  return body.provider as string;
}

/**
 * A document-type tab (Appunti/Schemi/Esami): filtered upload + list. When one or more topics
 * are selected in the left tree, the list also filters down to documents tagged to them
 * (docs/fasi/F2-materie.md "Sinistra ... filtro globale della pagina", via `document_topics`).
 * The AI panel lives once at the page level now (see `SubjectDetailClientInner`), not per-tab.
 */
function DocumentTypeTab({
  subjectSlug,
  type,
  documents,
  extra,
}: {
  subjectSlug: string;
  type: DocumentType;
  documents: DocumentDto[];
  extra?: React.ReactNode;
}) {
  const { docIds, setDocIds, topicIds } = useSelection();
  const filtered = documents
    .filter((d) => d.type === type)
    .filter((d) => topicIds.size === 0 || d.topicIds.some((id) => topicIds.has(id)));

  return (
    <div className="min-w-0 space-y-6">
      {extra}
      <section>
        <h2 className="mb-2 text-sm font-medium text-fg-secondary">Carica materiale</h2>
        <DocumentUploadForm subjectSlug={subjectSlug} defaultType={type} />
      </section>
      <section>
        <h2 className="mb-2 text-sm font-medium text-fg-secondary">
          {filtered.length} documenti
          {topicIds.size > 0 && ' (filtrati per argomento)'}
        </h2>
        {filtered.length === 0 ? (
          <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
            {topicIds.size > 0
              ? 'Nessun documento di questo tipo taggato agli argomenti selezionati.'
              : 'Nessun documento di questo tipo ancora.'}
          </div>
        ) : (
          <DocumentList
            subjectSlug={subjectSlug}
            documents={filtered}
            selectedDocIds={docIds}
            onSelectionChange={setDocIds}
          />
        )}
      </section>
    </div>
  );
}

function SubjectDetailClientInner({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab: TabKey = TABS.some((t) => t.key === searchParams.get('tab'))
    ? (searchParams.get('tab') as TabKey)
    : 'panoramica';

  const { docIds: selectedDocIds, topicIds: selectedTopicIds, toggleTopic } = useSelection();

  // Defaults to open on first visit/SSR; a stored choice overrides it once mounted (browser
  // storage can throw or come back empty — private windows, cleared site data — so this only
  // ever narrows the always-open default, never breaks the panel).
  const [aiPanelOpen, setAiPanelOpen] = useState(true);
  useEffect(() => {
    try {
      const stored = window.localStorage.getItem(AI_PANEL_STORAGE_KEY);
      if (stored !== null) setAiPanelOpen(stored === '1');
    } catch {
      // ignore — panel just stays at its default
    }
  }, []);
  const toggleAiPanel = () => {
    setAiPanelOpen((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(AI_PANEL_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore — the toggle still works for the rest of this session
      }
      return next;
    });
  };

  const subjectQuery = useQuery({ queryKey: ['subject', slug], queryFn: () => fetchSubject(slug) });
  const documentsQuery = useQuery({
    queryKey: ['documents', slug],
    queryFn: () => fetchDocuments(slug),
    refetchInterval: 4000, // cheap way to reflect worker progress without SSE (deferred to a later phase)
  });
  const topicsQuery = useQuery({ queryKey: ['topics', slug], queryFn: () => fetchTopics(slug) });
  const examsQuery = useQuery({ queryKey: ['exams', slug], queryFn: () => fetchExams(slug) });
  const statsQuery = useQuery({ queryKey: ['stats', slug], queryFn: () => fetchStats(slug) });
  const aiProviderQuery = useQuery({
    queryKey: ['ai-provider'],
    queryFn: fetchAiProvider,
    staleTime: 30_000, // can change at runtime: the in-app Claude login on /admin switches it
  });

  if (subjectQuery.isLoading) {
    return <div className="mx-auto max-w-[1440px] p-6 text-sm text-fg-muted">Caricamento…</div>;
  }

  if (subjectQuery.isError || !subjectQuery.data) {
    return (
      <div className="mx-auto max-w-[1440px] p-6">
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 text-sm"
        >
          <p className="text-danger">Materia non trovata.</p>
          <Link href="/materie" className="mt-3 inline-block text-fg-secondary underline">
            Torna a Materie
          </Link>
        </div>
      </div>
    );
  }

  const subject = subjectQuery.data;
  const documents = documentsQuery.data ?? [];
  const topics = topicsQuery.data ?? [];
  const flashcardTotal = statsQuery.data
    ? Object.values(statsQuery.data.countsByState).reduce((s, n) => s + n, 0) +
      statsQuery.data.suspendedCount
    : null;
  const nextExam = (examsQuery.data ?? [])
    .filter((e) => e.status === 'scheduled' && new Date(e.date).getTime() > Date.now())
    .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())[0];

  const setTab = (tab: TabKey) => {
    const params = new URLSearchParams(searchParams.toString());
    if (tab === 'panoramica') params.delete('tab');
    else params.set('tab', tab);
    const qs = params.toString();
    router.replace(`/materie/${slug}${qs ? `?${qs}` : ''}`, { scroll: false });
  };

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: SUBJECT_COLOR_HEX[subject.color] }}
            />
            <h1 className="text-xl font-semibold tracking-[-0.02em]">{subject.name}</h1>
            {subject.archivedAt && (
              <span className="rounded-full border border-warn px-2 py-0.5 text-[11px] text-warn">
                Archiviata
              </span>
            )}
          </div>
          <p className="mt-1 pl-[22px] text-xs text-fg-muted">
            {documents.length} documenti
            {topicsQuery.isSuccess && ` · ${topics.length} argomenti`}
            {flashcardTotal !== null && ` · ${flashcardTotal} flashcard`}
          </p>
        </div>
        <div className="flex items-start gap-4">
          {nextExam && (
            <div className="shrink-0 text-right text-[11px] text-fg-muted">
              esame{' '}
              {new Date(nextExam.date).toLocaleDateString('it-IT', {
                day: 'numeric',
                month: 'long',
              })}
              <b className="block font-mono text-[15px] font-semibold text-fg-primary">
                {formatExamCountdown(nextExam.date)}
              </b>
            </div>
          )}
          <SubjectActions subject={subject} />
        </div>
      </div>

      <SearchPanel subjectSlug={subject.slug} />

      <div className="mb-6 flex items-center gap-1 border-b border-border">
        {TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setTab(tab.key)}
            className={`-mb-px border-b-[1.5px] px-1 py-2.5 text-sm font-medium transition-colors duration-120 ${
              activeTab === tab.key
                ? 'border-accent text-fg-primary'
                : 'border-transparent text-fg-secondary hover:text-fg-primary'
            }`}
          >
            {tab.label}
          </button>
        ))}
        <Link
          href={`/materie/${slug}/piano`}
          className="-mb-px border-b-[1.5px] border-transparent px-1 py-2.5 text-sm font-medium text-fg-secondary transition-colors duration-120 hover:text-fg-primary"
        >
          Piano
        </Link>
        <button
          type="button"
          onClick={toggleAiPanel}
          className="-mb-px ml-auto border-b-[1.5px] border-transparent px-1 py-2.5 text-xs font-medium text-fg-muted transition-colors duration-120 hover:text-fg-primary"
        >
          {aiPanelOpen ? 'Nascondi pannello AI ▸' : '◂ Mostra pannello AI'}
        </button>
      </div>

      <div
        className={`grid grid-cols-1 gap-6 ${
          aiPanelOpen ? 'lg:grid-cols-[240px_1fr_320px]' : 'lg:grid-cols-[240px_1fr]'
        }`}
      >
        <aside className="lg:sticky lg:top-6 lg:h-fit">
          <TopicsPanel
            subjectSlug={slug}
            documents={documents}
            selectedDocIds={selectedDocIds}
            selectedTopicIds={selectedTopicIds}
            onToggleTopic={toggleTopic}
          />
        </aside>

        <main className="min-w-0">
          {activeTab === 'panoramica' && (
            <div className="space-y-4">
              <SuggestedActionsPanel subjectSlug={slug} />
              <DailyTasksPanel subjectSlug={slug} />
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                <GapsPanel subjectSlug={slug} />
                <RecentActivityPanel subjectSlug={slug} />
              </div>
              {aiProviderQuery.data === 'fake' && (
                <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-3 text-xs text-fg-muted">
                  Generazione simulata (nessun provider AI configurato): le flashcard/riassunti sono
                  creati per estrazione deterministica dal testo, non da un modello reale — vedi
                  docs/fasi/F3-ai-core.md &quot;Stato&quot;.
                </div>
              )}
            </div>
          )}

          {activeTab === 'appunti' && (
            <DocumentTypeTab subjectSlug={slug} type="appunti" documents={documents} />
          )}

          {activeTab === 'schemi' && (
            <DocumentTypeTab subjectSlug={slug} type="schemi" documents={documents} />
          )}

          {activeTab === 'esami' && (
            <DocumentTypeTab
              subjectSlug={slug}
              type="esami"
              documents={documents}
              extra={<ExamsPanel subjectSlug={slug} />}
            />
          )}

          {activeTab === 'flashcard' && (
            <div className="space-y-4">
              <div className="max-w-md">
                <StatsPanel subjectSlug={slug} />
                <div className="mt-4">
                  <CalibrationPanel subjectSlug={slug} />
                </div>
              </div>
              <FlashcardListPanel subjectSlug={slug} topics={topics} />
            </div>
          )}

          {activeTab === 'lacune' && <CoveragePanel subjectSlug={slug} />}

          {activeTab === 'simulazioni' && (
            <div className="max-w-md">
              <ExamPrepPanel subjectSlug={slug} documents={documents} />
            </div>
          )}
        </main>

        {aiPanelOpen && (
          <aside className="lg:sticky lg:top-6 lg:h-fit">
            <AiPanel subjectSlug={slug} documents={documents} topics={topics} />
          </aside>
        )}
      </div>
    </div>
  );
}

/** Selection (documents + topics) is shared page-wide, above the tabs (docs/fasi/F2-materie.md
 * "Decisioni" — `SelectionContext`) — switching tabs never loses it. */
export function SubjectDetailClient({ slug }: { slug: string }) {
  return (
    <SelectionProvider>
      <SubjectDetailClientInner slug={slug} />
    </SelectionProvider>
  );
}
