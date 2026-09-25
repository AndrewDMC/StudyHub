'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtifactDto, DocumentDto } from '@studyhub/contracts';

const KIND_LABELS: Record<ArtifactDto['kind'], string> = {
  flashcard_deck: 'Flashcard',
  schema: 'Schema',
  summary: 'Riassunto',
  simulation: 'Simulazione',
  drill: 'Drill',
};

const STATUS_LABELS: Record<ArtifactDto['status'], string> = {
  draft: 'Bozza',
  approved: 'Approvato',
  archived: 'Archiviato',
};

async function fetchArtifacts(slug: string): Promise<ArtifactDto[]> {
  const res = await fetch(`/api/subjects/${slug}/artifacts`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli artefatti');
  return body.artifacts as ArtifactDto[];
}

async function enqueue(slug: string, kind: 'flashcards' | 'schema' | 'summary', docIds: string[]) {
  const requestBody =
    kind === 'flashcards'
      ? { scope: { docIds }, count: 'auto', types: ['basic', 'cloze'], difficulty: 2, lang: 'it' }
      : kind === 'schema'
        ? { scope: { docIds }, depth: 2, style: 'gerarchico' }
        : { scope: { docIds }, length: 'standard' };
  const res = await fetch(`/api/subjects/${slug}/artifacts/${kind}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(requestBody),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Avvio generazione fallito');
  return body as { jobId: string };
}

export function GenerationPanel({
  subjectSlug,
  documents,
}: {
  subjectSlug: string;
  documents: DocumentDto[];
}) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['artifacts', subjectSlug],
    queryFn: () => fetchArtifacts(subjectSlug),
  });
  const readyDocIds = documents.filter((d) => d.status === 'parsed').map((d) => d.id);

  const generateMutation = useMutation({
    mutationFn: (kind: 'flashcards' | 'schema' | 'summary') =>
      enqueue(subjectSlug, kind, readyDocIds),
    onSuccess: () => {
      // The job runs asynchronously in the worker; give it a moment then refresh.
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ['artifacts', subjectSlug] }),
        3000,
      );
    },
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Genera
      </h2>

      <div className="flex flex-col gap-2 px-1">
        <button
          type="button"
          disabled={readyDocIds.length === 0 || generateMutation.isPending}
          onClick={() => generateMutation.mutate('flashcards')}
          className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-120 hover:bg-accent-hover disabled:opacity-50"
        >
          Genera flashcard ({readyDocIds.length} doc. pronti)
        </button>
        <button
          type="button"
          disabled={readyDocIds.length === 0 || generateMutation.isPending}
          onClick={() => generateMutation.mutate('summary')}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Genera riassunto
        </button>
        <button
          type="button"
          disabled={readyDocIds.length === 0 || generateMutation.isPending}
          onClick={() => generateMutation.mutate('schema')}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Genera schema
        </button>
        {readyDocIds.length === 0 && (
          <p className="text-[11px] text-fg-muted">
            Nessun documento con testo estratto. Carica un PDF e attendi lo stato
            &quot;Pronto&quot;.
          </p>
        )}
        {generateMutation.isError && (
          <p role="alert" className="text-xs text-danger">
            {(generateMutation.error as Error).message}
          </p>
        )}
        {generateMutation.isSuccess && (
          <p className="text-[11px] text-ok">Job avviato — l&apos;elenco si aggiorna a breve.</p>
        )}
      </div>

      <div className="mt-3 border-t border-border pt-2">
        {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
        {query.isError && (
          <p role="alert" className="px-1 text-xs text-danger">
            {(query.error as Error).message}
          </p>
        )}
        {query.isSuccess && query.data.length === 0 && (
          <p className="px-1 text-xs text-fg-muted">Nessun artefatto ancora.</p>
        )}
        {query.isSuccess && query.data.length > 0 && (
          <ul className="space-y-1">
            {query.data.map((artifact) => (
              <li
                key={artifact.id}
                className="flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1 hover:bg-bg-raised"
              >
                {artifact.kind === 'flashcard_deck' ? (
                  <Link
                    href={`/materie/${subjectSlug}/artifacts/${artifact.id}`}
                    className="min-w-0 truncate text-sm text-fg-primary underline-offset-2 hover:underline"
                  >
                    {artifact.title}
                  </Link>
                ) : (
                  <span className="min-w-0 truncate text-sm text-fg-primary">{artifact.title}</span>
                )}
                <span className="shrink-0 font-mono text-[11px] text-fg-muted">
                  {KIND_LABELS[artifact.kind]} · {STATUS_LABELS[artifact.status]}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
