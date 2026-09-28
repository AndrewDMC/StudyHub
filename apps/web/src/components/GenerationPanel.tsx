'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ArtifactDto, DocumentDto, EstimateGenerationCostResponse } from '@studyhub/contracts';
import { ModelPicker, MODEL_OPTIONS } from './ModelPicker';

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

/** €0.0001 → "€0.0001"; €0 → "gratis" (FakeProvider, nessuna chiave configurata). */
function formatCost(costEur: number): string {
  return costEur === 0 ? 'gratis' : `~€${costEur.toFixed(4)}`;
}

async function fetchArtifacts(slug: string): Promise<ArtifactDto[]> {
  const res = await fetch(`/api/subjects/${slug}/artifacts`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli artefatti');
  return body.artifacts as ArtifactDto[];
}

/** Mirrors `GenerationScope` (packages/contracts/src/generation.ts): exactly one of the two. */
export type ScopeInput = { docIds: string[] } | { topicIds: string[] };

function scopeKey(scope: ScopeInput): string {
  return 'docIds' in scope ? `d:${scope.docIds.join(',')}` : `t:${scope.topicIds.join(',')}`;
}

function scopeIsEmpty(scope: ScopeInput): boolean {
  return 'docIds' in scope ? scope.docIds.length === 0 : scope.topicIds.length === 0;
}

async function fetchEstimate(
  slug: string,
  scope: ScopeInput,
  model: string,
): Promise<EstimateGenerationCostResponse> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/estimate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scope, model }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Stima costo fallita');
  return body as EstimateGenerationCostResponse;
}

async function enqueue(
  slug: string,
  kind: 'flashcards' | 'schema' | 'summary',
  scope: ScopeInput,
  model: string,
) {
  const requestBody =
    kind === 'flashcards'
      ? { scope, count: 'auto', types: ['basic', 'cloze'], difficulty: 2, lang: 'it', model }
      : kind === 'schema'
        ? { scope, depth: 2, style: 'gerarchico', model }
        : { scope, length: 'standard', model };
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
  selectedDocIds,
  selectedTopicIds,
}: {
  subjectSlug: string;
  documents: DocumentDto[];
  /** Non-empty = scope to this subset (docs/fasi/F2-materie.md "Stato"); empty/omitted = every ready document. */
  selectedDocIds?: Set<string>;
  /** Non-empty *and* no document explicitly selected = scope to these topics instead (`generate_*`
   * already resolves a `topicIds`-only scope via `document_topics`, docs/fasi/F3-ai-core.md "Stato"). */
  selectedTopicIds?: Set<string>;
}) {
  const [model, setModel] = useState<string>(MODEL_OPTIONS[1].id); // sonnet: default routing for flashcards/schema/summary (docs/03 §4)
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['artifacts', subjectSlug],
    queryFn: () => fetchArtifacts(subjectSlug),
  });
  const parsedDocIds = documents.filter((d) => d.status === 'parsed').map((d) => d.id);
  const explicitDocIds =
    selectedDocIds && selectedDocIds.size > 0
      ? parsedDocIds.filter((id) => selectedDocIds.has(id))
      : [];
  const useTopicScope = explicitDocIds.length === 0 && (selectedTopicIds?.size ?? 0) > 0;
  const readyDocIds =
    explicitDocIds.length > 0 ? explicitDocIds : useTopicScope ? [] : parsedDocIds;
  const scope: ScopeInput = useTopicScope
    ? { topicIds: [...(selectedTopicIds ?? [])] }
    : { docIds: readyDocIds };
  const scopeEmpty = scopeIsEmpty(scope);

  const estimateQuery = useQuery({
    queryKey: ['generation-estimate', subjectSlug, model, scopeKey(scope)],
    queryFn: () => fetchEstimate(subjectSlug, scope, model),
    enabled: !scopeEmpty,
  });

  const generateMutation = useMutation({
    mutationFn: (kind: 'flashcards' | 'schema' | 'summary') =>
      enqueue(subjectSlug, kind, scope, model),
    onSuccess: () => {
      // The job runs asynchronously in the worker; give it a moment then refresh.
      setTimeout(
        () => queryClient.invalidateQueries({ queryKey: ['artifacts', subjectSlug] }),
        3000,
      );
    },
  });

  const costLabel = (kind: 'flashcards' | 'schema' | 'summary'): string | null => {
    const entry = estimateQuery.data?.perKind[kind];
    return entry ? formatCost(entry.costEur) : null;
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
        Genera
      </h2>

      <div className="flex flex-col gap-2 px-1">
        <ModelPicker value={model} onChange={setModel} disabled={generateMutation.isPending} />
        {estimateQuery.isError && (
          <p className="text-[11px] text-fg-muted">Stima costo non disponibile.</p>
        )}

        <button
          type="button"
          disabled={scopeEmpty || generateMutation.isPending}
          onClick={() => generateMutation.mutate('flashcards')}
          className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-xs font-medium text-white transition-colors duration-120 hover:bg-accent-hover disabled:opacity-50"
        >
          Genera flashcard (
          {useTopicScope
            ? `${selectedTopicIds?.size ?? 0} argoment${(selectedTopicIds?.size ?? 0) === 1 ? 'o' : 'i'}`
            : `${readyDocIds.length} ${explicitDocIds.length > 0 ? 'selezionati' : 'doc. pronti'}`}
          ){costLabel('flashcards') && ` · ${costLabel('flashcards')}`}
        </button>
        <button
          type="button"
          disabled={scopeEmpty || generateMutation.isPending}
          onClick={() => generateMutation.mutate('summary')}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Genera riassunto{costLabel('summary') && ` · ${costLabel('summary')}`}
        </button>
        <button
          type="button"
          disabled={scopeEmpty || generateMutation.isPending}
          onClick={() => generateMutation.mutate('schema')}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Genera schema{costLabel('schema') && ` · ${costLabel('schema')}`}
        </button>
        {scopeEmpty && (
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
