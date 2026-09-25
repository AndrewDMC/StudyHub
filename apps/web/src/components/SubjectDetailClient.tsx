'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { DocumentDto, ExamDto, FlashcardStatsDto, SubjectDto, TopicDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { formatExamCountdown } from '@/lib/format';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentList } from './DocumentList';
import { TopicsPanel } from './TopicsPanel';
import { ExamsPanel } from './ExamsPanel';
import { SubjectActions } from './SubjectActions';
import { GenerationPanel } from './GenerationPanel';
import { StatsPanel } from './StatsPanel';
import { ExamPrepPanel } from './ExamPrepPanel';
import { DailyTasksPanel } from './DailyTasksPanel';

const TABS = [
  { key: 'panoramica', label: 'Panoramica' },
  { key: 'appunti', label: 'Appunti' },
  { key: 'schemi', label: 'Schemi' },
  { key: 'esami', label: 'Esami' },
  { key: 'flashcard', label: 'Flashcard' },
  { key: 'simulazioni', label: 'Simulazioni' },
] as const;
type TabKey = (typeof TABS)[number]['key'];

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

/** A document-type tab (Appunti/Schemi/Esami): filtered upload + list, generation panel alongside. */
function DocumentTypeTab({
  subjectSlug,
  type,
  documents,
  selectedDocIds,
  onSelectionChange,
  extra,
}: {
  subjectSlug: string;
  type: DocumentType;
  documents: DocumentDto[];
  selectedDocIds: Set<string>;
  onSelectionChange: (next: Set<string>) => void;
  extra?: React.ReactNode;
}) {
  const filtered = documents.filter((d) => d.type === type);
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_320px]">
      <div className="min-w-0 space-y-6">
        {extra}
        <section>
          <h2 className="mb-2 text-sm font-medium text-fg-secondary">Carica materiale</h2>
          <DocumentUploadForm subjectSlug={subjectSlug} defaultType={type} />
        </section>
        <section>
          <h2 className="mb-2 text-sm font-medium text-fg-secondary">{filtered.length} documenti</h2>
          {filtered.length === 0 ? (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
              Nessun documento di questo tipo ancora.
            </div>
          ) : (
            <DocumentList
              subjectSlug={subjectSlug}
              documents={filtered}
              selectedDocIds={selectedDocIds}
              onSelectionChange={onSelectionChange}
            />
          )}
        </section>
      </div>
      <aside>
        <GenerationPanel subjectSlug={subjectSlug} documents={documents} selectedDocIds={selectedDocIds} />
      </aside>
    </div>
  );
}

export function SubjectDetailClient({ slug }: { slug: string }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const activeTab: TabKey = TABS.some((t) => t.key === searchParams.get('tab'))
    ? (searchParams.get('tab') as TabKey)
    : 'panoramica';

  // Empty = "no explicit selection", every panel below falls back to all parsed documents
  // (docs/fasi/F2-materie.md "Seleziono 3 documenti e il pannello destro offre le azioni giuste"
  // — selecting is opt-in, not required, so nothing changes for someone who never touches it).
  const [selectedDocIds, setSelectedDocIds] = useState<Set<string>>(new Set());
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
    staleTime: Infinity, // fixed by env at container start — never changes without a restart
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
            {topicsQuery.isSuccess && ` · ${topicsQuery.data.length} argomenti`}
            {flashcardTotal !== null && ` · ${flashcardTotal} flashcard`}
          </p>
        </div>
        <div className="flex items-start gap-4">
          {nextExam && (
            <div className="shrink-0 text-right text-[11px] text-fg-muted">
              esame{' '}
              {new Date(nextExam.date).toLocaleDateString('it-IT', { day: 'numeric', month: 'long' })}
              <b className="block font-mono text-[15px] font-semibold text-fg-primary">
                {formatExamCountdown(nextExam.date)}
              </b>
            </div>
          )}
          <SubjectActions subject={subject} />
        </div>
      </div>

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
      </div>

      {activeTab === 'panoramica' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr]">
          <aside>
            <TopicsPanel subjectSlug={slug} documents={documents} selectedDocIds={selectedDocIds} />
          </aside>
          <main className="min-w-0 space-y-4">
            <DailyTasksPanel subjectSlug={slug} />
            {aiProviderQuery.data === 'fake' && (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-3 text-xs text-fg-muted">
                Generazione simulata (nessun provider AI configurato): le flashcard/riassunti sono
                creati per estrazione deterministica dal testo, non da un modello reale — vedi
                docs/fasi/F3-ai-core.md &quot;Stato&quot;.
              </div>
            )}
          </main>
        </div>
      )}

      {activeTab === 'appunti' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="appunti"
          documents={documents}
          selectedDocIds={selectedDocIds}
          onSelectionChange={setSelectedDocIds}
        />
      )}

      {activeTab === 'schemi' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="schemi"
          documents={documents}
          selectedDocIds={selectedDocIds}
          onSelectionChange={setSelectedDocIds}
        />
      )}

      {activeTab === 'esami' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="esami"
          documents={documents}
          selectedDocIds={selectedDocIds}
          onSelectionChange={setSelectedDocIds}
          extra={<ExamsPanel subjectSlug={slug} />}
        />
      )}

      {activeTab === 'flashcard' && (
        <div className="max-w-md">
          <StatsPanel subjectSlug={slug} />
        </div>
      )}

      {activeTab === 'simulazioni' && (
        <div className="max-w-md">
          <ExamPrepPanel subjectSlug={slug} />
        </div>
      )}
    </div>
  );
}
