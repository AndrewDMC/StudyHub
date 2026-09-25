'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { DocumentDto, SubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { DocumentUploadForm } from './DocumentUploadForm';
import { DocumentList } from './DocumentList';
import { TopicsPanel } from './TopicsPanel';
import { ExamsPanel } from './ExamsPanel';
import { SubjectActions } from './SubjectActions';
import { GenerationPanel } from './GenerationPanel';
import { StatsPanel } from './StatsPanel';
import { ExamPrepPanel } from './ExamPrepPanel';
import { DailyTasksPanel } from './DailyTasksPanel';

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

async function fetchAiProvider(): Promise<string> {
  const res = await fetch('/api/settings/ai-provider');
  const body = await res.json();
  return body.provider as string;
}

export function SubjectDetailClient({ slug }: { slug: string }) {
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

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <div className="mb-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span
            className="h-3 w-3 rounded-full"
            style={{ backgroundColor: SUBJECT_COLOR_HEX[subject.color] }}
          />
          <h1 className="text-xl font-semibold tracking-[-0.02em]">{subject.name}</h1>
          {subject.archivedAt && (
            <span className="rounded-full border border-warn px-2 py-0.5 text-[11px] text-warn">
              Archiviata
            </span>
          )}
        </div>
        <SubjectActions subject={subject} />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[240px_1fr_320px]">
        <aside>
          <TopicsPanel
            subjectSlug={slug}
            documents={documentsQuery.data ?? []}
            selectedDocIds={selectedDocIds}
          />
        </aside>

        <main className="min-w-0">
          <section className="mb-6">
            <h2 className="mb-2 text-sm font-medium text-fg-secondary">Carica materiale</h2>
            <DocumentUploadForm subjectSlug={slug} />
          </section>

          <section>
            <h2 className="mb-2 text-sm font-medium text-fg-secondary">Documenti</h2>
            {documentsQuery.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
            {documentsQuery.isError && (
              <p role="alert" className="text-sm text-danger">
                {(documentsQuery.error as Error).message}
              </p>
            )}
            {documentsQuery.isSuccess && documentsQuery.data.length === 0 && (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
                Nessun documento ancora. Carica un PDF per iniziare.
              </div>
            )}
            {documentsQuery.isSuccess && documentsQuery.data.length > 0 && (
              <DocumentList
                subjectSlug={slug}
                documents={documentsQuery.data}
                selectedDocIds={selectedDocIds}
                onSelectionChange={setSelectedDocIds}
              />
            )}
          </section>
        </main>

        <aside className="space-y-4">
          <DailyTasksPanel subjectSlug={slug} />
          <StatsPanel subjectSlug={slug} />
          <ExamsPanel subjectSlug={slug} />
          <ExamPrepPanel subjectSlug={slug} />
          <GenerationPanel
            subjectSlug={slug}
            documents={documentsQuery.data ?? []}
            selectedDocIds={selectedDocIds}
          />
          {aiProviderQuery.data === 'fake' && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-3 text-xs text-fg-muted">
              Generazione simulata (nessun provider AI configurato): le flashcard/riassunti sono
              creati per estrazione deterministica dal testo, non da un modello reale — vedi
              docs/fasi/F3-ai-core.md &quot;Stato&quot;.
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
