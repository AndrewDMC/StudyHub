'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Image as ImageIcon } from 'lucide-react';
import type { SchemaBlockDto, SchemaNodeDto } from '@studyhub/contracts';
import { materialFilterForType, materialHref } from '@/lib/subjectTabs';
import { fetchBlocks, fetchGraph, retranscribe } from '../VerifySchemaClient';
import { SectionEmpty, SectionError } from '../subject-mobile/SectionState';
import { DocHeader, iconButton } from './DocHeader';
import { VerifyEdges } from './VerifyEdges';
import {
  VerifyItemCard,
  type ChosenState,
  type VerifyItem,
  type VerifyState,
} from './VerifyItemCard';
import { patchBlock, patchNode, useDocument } from './queries';

function blockState(b: SchemaBlockDto): VerifyState {
  if (b.verified) return 'verified';
  if (b.confidence === 'uncertain') return 'uncertain';
  if (b.confidence === 'illegible') return 'illegible';
  return 'pending';
}

function nodeState(n: SchemaNodeDto): VerifyState {
  if (n.verifiedAt !== null) return 'verified';
  if (n.confidence === 'uncertain') return 'uncertain';
  if (n.confidence === 'unreadable') return 'illegible';
  return 'pending';
}

/** Verifica (docs/design/materia-mobile/Verifica.dc.html): progress, one card per block, bulk confirm. */
export function VerifyMobile({
  subjectSlug: slug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const queryClient = useQueryClient();
  const docQuery = useDocument(slug, documentId);
  const doc = docQuery.data;

  const graphQuery = useQuery({
    queryKey: ['schema-graph', slug, documentId],
    queryFn: () => fetchGraph(slug, documentId),
    refetchInterval: (query) =>
      query.state.data === undefined || query.state.data.nodes.length === 0 ? 2000 : false,
  });
  const graph = graphQuery.data;
  const hasGraph = (graph?.nodes.length ?? 0) > 0;
  const blocksQuery = useQuery({
    queryKey: ['schema-blocks', slug, documentId],
    queryFn: () => fetchBlocks(slug, documentId),
    enabled: graphQuery.isSuccess && !hasGraph,
    refetchInterval: (query) => (query.state.data === undefined ? 2000 : false),
  });

  const [confirmingAll, setConfirmingAll] = useState(false);
  const [failedCount, setFailedCount] = useState(0);
  const [failedTotal, setFailedTotal] = useState(0);

  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['schema-graph', slug, documentId] }),
      queryClient.invalidateQueries({ queryKey: ['schema-blocks', slug, documentId] }),
      queryClient.invalidateQueries({ queryKey: ['document', slug, documentId] }),
      queryClient.invalidateQueries({ queryKey: ['documents', slug] }),
    ]);

  const imageUrl = `/api/subjects/${slug}/documents/${documentId}/file`;
  const backHref = materialHref(slug, doc ? materialFilterForType(doc.type) : 'tutti');

  // Block / node updates. Each one refreshes the lists even when it fails half-way.
  const setBlockState = async (b: SchemaBlockDto, state: ChosenState, text: string) => {
    const base = text !== b.text && text.trim() !== '' ? { text } : {};
    try {
      if (state === 'verified')
        await patchBlock(slug, documentId, b.id, { ...base, verified: true });
      else
        await patchBlock(slug, documentId, b.id, {
          ...base,
          verified: false,
          confidence: state === 'uncertain' ? 'uncertain' : 'illegible',
        });
    } finally {
      await invalidate();
    }
  };
  const setNodeState = async (n: SchemaNodeDto, state: ChosenState, text: string) => {
    const base = text !== n.label && text.trim() !== '' ? { label: text } : {};
    try {
      if (state === 'verified') {
        await patchNode(slug, documentId, n.id, { ...base, verified: true });
      } else {
        await patchNode(slug, documentId, n.id, {
          ...base,
          verified: false,
          confidence: state === 'uncertain' ? 'uncertain' : 'unreadable',
        });
      }
    } finally {
      await invalidate();
    }
  };

  const items: { item: VerifyItem; confirm: () => Promise<unknown> }[] = hasGraph
    ? graph!.nodes.map((n) => ({
        item: { id: n.id, state: nodeState(n), text: n.label, kind: n.kind, crop: n.crop },
        confirm: () => patchNode(slug, documentId, n.id, { verified: true }),
      }))
    : (blocksQuery.data ?? []).map((b) => ({
        item: { id: b.id, state: blockState(b), text: b.text, note: b.note },
        confirm: () => patchBlock(slug, documentId, b.id, { verified: true }),
      }));

  const total = items.length;
  const unresolved = items.filter((i) => i.item.state !== 'verified');
  const illegibleCount = unresolved.filter((i) => i.item.state === 'illegible').length;
  const done = total - unresolved.length;
  const pct = total === 0 ? 0 : Math.round((done / total) * 100);

  // Sequential on purpose: each PATCH recomputes blockedBlocks/verificationStatus without a
  // transaction, so parallel requests could leave the document stuck on "partial".
  const confirmAll = useMutation({
    mutationFn: async () => {
      const todo = unresolved;
      let failed = 0;
      try {
        for (const i of todo) {
          try {
            await i.confirm();
          } catch {
            failed += 1;
          }
        }
      } finally {
        setFailedCount(failed);
        setFailedTotal(todo.length);
        await invalidate();
      }
    },
    onSettled: () => setConfirmingAll(false),
  });

  const retranscribeMutation = useMutation({
    mutationFn: () => retranscribe(slug, documentId),
    onSuccess: invalidate,
  });

  const header = (
    <DocHeader
      backHref={backHref}
      title="Verifica trascrizione"
      subtitle={doc?.originalName}
      actions={
        <Link
          href={`/materie/${slug}/documenti/${documentId}/originale`}
          aria-label="Vedi l'immagine originale"
          className={iconButton}
        >
          <ImageIcon className="h-5 w-5" aria-hidden="true" />
        </Link>
      }
    />
  );

  if (docQuery.isError || (!docQuery.isLoading && !doc)) {
    return (
      <div className="flex min-h-full min-w-0 flex-col">
        {header}
        <div className="p-4">
          <SectionError message="Documento non trovato." onRetry={() => docQuery.refetch()} />
        </div>
      </div>
    );
  }

  const loading =
    docQuery.isLoading || graphQuery.isLoading || (blocksQuery.isLoading && !hasGraph);
  const parsing = doc?.status === 'parsing';

  return (
    <div className="flex min-h-full min-w-0 flex-col overflow-x-clip">
      {header}
      <main className="flex min-w-0 flex-col gap-4 p-4">
        {loading && (
          <div aria-busy="true" aria-hidden="true" className="space-y-3">
            <div className="h-24 animate-pulse rounded-[var(--radius-card)] bg-bg-raised" />
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="h-40 animate-pulse rounded-[var(--radius-card)] bg-bg-raised"
              />
            ))}
          </div>
        )}

        {graphQuery.isError && (
          <SectionError
            message={(graphQuery.error as Error).message}
            onRetry={() => graphQuery.refetch()}
          />
        )}
        {blocksQuery.isError && (
          <SectionError
            message={(blocksQuery.error as Error).message}
            onRetry={() => blocksQuery.refetch()}
          />
        )}

        {total > 0 && (
          <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-[15px] font-medium">
                {done} di {total} blocchi verificati
              </p>
              <span className="font-mono text-xs text-fg-muted">{pct}%</span>
            </div>
            <div
              role="progressbar"
              aria-label="Blocchi verificati"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={pct}
              className="mt-2 h-1.5 overflow-hidden rounded-full bg-bg-raised"
            >
              <div className="h-full rounded-full bg-ok" style={{ width: `${pct}%` }} />
            </div>
            <p className="mt-2 text-[13px] text-fg-secondary">
              Controlla il testo letto dall&apos;AI: i blocchi incerti finiscono nelle flashcard
              solo dopo la tua conferma.
            </p>
          </div>
        )}

        {!loading &&
          total === 0 &&
          !graphQuery.isError &&
          !blocksQuery.isError &&
          (parsing ? (
            <p role="status" className="text-sm text-fg-muted">
              Trascrizione in corso…
            </p>
          ) : (
            <SectionEmpty>Nessun blocco trascritto.</SectionEmpty>
          ))}

        {total > 0 && (
          <section>
            <h2 className="mb-2 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
              Blocchi
            </h2>
            <div className="space-y-3">
              {hasGraph
                ? graph!.nodes.map((n, i) => (
                    <VerifyItemCard
                      key={n.id}
                      n={i + 1}
                      item={items[i]!.item}
                      imageUrl={imageUrl}
                      onSetState={(state, text) => setNodeState(n, state, text)}
                      onSetText={(text) =>
                        patchNode(slug, documentId, n.id, { label: text }).then(invalidate)
                      }
                      onSetKind={(kind) =>
                        patchNode(slug, documentId, n.id, {
                          kind: kind as SchemaNodeDto['kind'],
                        }).then(invalidate)
                      }
                    />
                  ))
                : (blocksQuery.data ?? []).map((b, i) => (
                    <VerifyItemCard
                      key={b.id}
                      n={i + 1}
                      item={items[i]!.item}
                      imageUrl={imageUrl}
                      onSetState={(state, text) => setBlockState(b, state, text)}
                      onSetText={(text) =>
                        patchBlock(slug, documentId, b.id, { text }).then(invalidate)
                      }
                    />
                  ))}
            </div>
          </section>
        )}

        {hasGraph && graph && <VerifyEdges graph={graph} />}

        {total > 0 && (
          <div className="space-y-2">
            {confirmingAll ? (
              <div className="rounded-[var(--radius-card)] border border-warn bg-bg-surface p-3.5">
                <p className="text-sm">
                  {illegibleCount}{' '}
                  {illegibleCount === 1
                    ? 'blocco illeggibile sarà segnato come verificato'
                    : 'blocchi illeggibili saranno segnati come verificati'}
                  . Confermi?
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    type="button"
                    autoFocus
                    onClick={() => setConfirmingAll(false)}
                    className="min-h-11 flex-1 rounded-[var(--radius-control)] border border-border-strong text-sm"
                  >
                    Annulla
                  </button>
                  <button
                    type="button"
                    disabled={confirmAll.isPending}
                    onClick={() => confirmAll.mutate()}
                    className="min-h-11 flex-1 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
                  >
                    {confirmAll.isPending ? 'Aggiorno…' : 'Sì, segna tutto'}
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                disabled={unresolved.length === 0 || confirmAll.isPending}
                onClick={() => {
                  setFailedCount(0);
                  if (illegibleCount > 0) setConfirmingAll(true);
                  else confirmAll.mutate();
                }}
                className="min-h-11 w-full rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
              >
                {confirmAll.isPending ? 'Aggiorno…' : 'Segna tutto verificato'}
              </button>
            )}
            {unresolved.length === 0 && (
              <p role="status" className="text-center text-[13px] text-ok">
                Tutto verificato
              </p>
            )}
            {failedCount > 0 && (
              <p role="alert" className="text-[13px] text-danger">
                {failedCount} di {failedTotal} non salvati
              </p>
            )}
          </div>
        )}

        {!loading && (
          <button
            type="button"
            disabled={retranscribeMutation.isPending}
            onClick={() => retranscribeMutation.mutate()}
            className="min-h-11 w-full rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-sm font-medium disabled:opacity-50"
          >
            {retranscribeMutation.isPending ? 'Avvio…' : 'Ritrascrivi'}
          </button>
        )}
        {retranscribeMutation.isError && (
          <p role="alert" className="text-[13px] text-danger">
            {(retranscribeMutation.error as Error).message}
          </p>
        )}
      </main>
    </div>
  );
}
