'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentDto,
  SchemaBlockConfidence,
  SchemaBlockDto,
  SchemaGraphDto,
  SchemaNodeDto,
  UpdateSchemaNodeRequest,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';

const NODE_KINDS = [
  'concetto',
  'definizione',
  'formula',
  'principio',
  'grandezza',
  'caso',
  'esempio',
  'condizione',
  'conseguenza',
  'domanda',
] as const;

async function fetchDocument(slug: string, documentId: string): Promise<DocumentDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Documento non trovato');
  return body.document as DocumentDto;
}

async function fetchBlocks(slug: string, documentId: string): Promise<SchemaBlockDto[]> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/schema-blocks`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i blocchi');
  return body.blocks as SchemaBlockDto[];
}

async function fetchGraph(slug: string, documentId: string): Promise<SchemaGraphDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/schema-graph`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare il grafo');
  return body as SchemaGraphDto;
}

async function patchBlock(
  slug: string,
  documentId: string,
  blockId: string,
  patch: { text?: string; confidence?: SchemaBlockConfidence; verified?: boolean },
): Promise<SchemaBlockDto> {
  const res = await fetch(
    `/api/subjects/${slug}/documents/${documentId}/schema-blocks/${blockId}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    },
  );
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Aggiornamento fallito');
  return body.block as SchemaBlockDto;
}

async function patchNode(
  slug: string,
  documentId: string,
  nodeId: string,
  patch: UpdateSchemaNodeRequest,
): Promise<SchemaNodeDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/schema-nodes/${nodeId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Aggiornamento fallito');
  return body.node as SchemaNodeDto;
}

async function retranscribe(slug: string, documentId: string): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/transcribe`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Avvio trascrizione fallito');
  }
}

const CONFIDENCE_LABEL: Record<SchemaBlockConfidence, string> = {
  ok: 'Verificato',
  uncertain: 'Incerto',
  illegible: 'Illeggibile',
};

const CONFIDENCE_COLOR: Record<SchemaBlockConfidence, string> = {
  ok: 'var(--ok)',
  uncertain: 'var(--warn)',
  illegible: 'var(--danger)',
};

const NODE_CONFIDENCE_COLOR: Record<SchemaNodeDto['confidence'], string> = {
  ok: 'var(--ok)',
  uncertain: 'var(--warn)',
  unreadable: 'var(--danger)',
};

function BlockRow({
  block,
  index,
  onSave,
}: {
  block: SchemaBlockDto;
  index: number;
  onSave: (patch: { text?: string; verified?: boolean }) => void;
}) {
  const [text, setText] = useState(block.text);

  return (
    <div
      className="rounded-[var(--radius-card)] border p-3"
      style={{
        borderColor: block.verified ? 'var(--border)' : CONFIDENCE_COLOR[block.confidence],
        background: 'var(--bg-surface)',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="text-xs text-fg-muted">Blocco {index + 1}</span>
        <span
          className="flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: block.verified ? 'var(--ok)' : CONFIDENCE_COLOR[block.confidence],
            borderColor: block.verified ? 'var(--ok)' : CONFIDENCE_COLOR[block.confidence],
          }}
        >
          {block.verified ? 'Verificato' : CONFIDENCE_LABEL[block.confidence]}
        </span>
      </div>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => {
          if (text !== block.text) onSave({ text });
        }}
        className="w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-sm text-fg-primary"
      />
      {block.note && !block.verified && (
        <p className="mt-1.5 text-[11px] italic text-fg-muted">⟨{block.note}⟩</p>
      )}
      {!block.verified && (
        <Button
          type="button"
          size="sm"
          className="mt-2"
          onClick={() => onSave({ text, verified: true })}
        >
          Conferma
        </Button>
      )}
    </div>
  );
}

function NodeRow({
  node,
  index,
  active,
  onSelect,
  onSave,
}: {
  node: SchemaNodeDto;
  index: number;
  active: boolean;
  onSelect: () => void;
  onSave: (patch: UpdateSchemaNodeRequest) => void;
}) {
  const [label, setLabel] = useState(node.label);
  const verified = node.verifiedAt !== null;

  return (
    <div
      onClick={onSelect}
      className="cursor-pointer rounded-[var(--radius-card)] border p-3"
      style={{
        borderColor: active
          ? 'var(--accent)'
          : verified
            ? 'var(--border)'
            : NODE_CONFIDENCE_COLOR[node.confidence],
        background: 'var(--bg-surface)',
      }}
    >
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-fg-muted">
          {node.nodeKey} · #{index + 1}
        </span>
        <span
          className="rounded-full border px-2 py-0.5 text-[11px] font-medium"
          style={{
            color: verified ? 'var(--ok)' : NODE_CONFIDENCE_COLOR[node.confidence],
            borderColor: verified ? 'var(--ok)' : NODE_CONFIDENCE_COLOR[node.confidence],
          }}
        >
          {verified ? 'Verificato' : node.confidence === 'uncertain' ? 'Incerto' : 'Illeggibile'}
        </span>
      </div>
      <div className="flex gap-2">
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onBlur={() => {
            if (label !== node.label) onSave({ label });
          }}
          className="flex-1 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-sm text-fg-primary"
        />
        <select
          value={node.kind}
          onClick={(e) => e.stopPropagation()}
          onChange={(e) => onSave({ kind: e.target.value as SchemaNodeDto['kind'] })}
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-xs text-fg-primary"
        >
          {NODE_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </div>
      {!verified && (
        <Button type="button" size="sm" className="mt-2" onClick={() => onSave({ verified: true })}>
          Conferma
        </Button>
      )}
    </div>
  );
}

export function VerifySchemaClient({
  subjectSlug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const queryClient = useQueryClient();
  const [activeNodeKey, setActiveNodeKey] = useState<string | null>(null);

  const documentQuery = useQuery({
    queryKey: ['document', subjectSlug, documentId],
    queryFn: () => fetchDocument(subjectSlug, documentId),
  });
  const graphQuery = useQuery({
    queryKey: ['schema-graph', subjectSlug, documentId],
    queryFn: () => fetchGraph(subjectSlug, documentId),
    refetchInterval: (query) =>
      query.state.data === undefined || query.state.data.nodes.length === 0 ? 2000 : false,
  });
  const hasGraph = (graphQuery.data?.nodes.length ?? 0) > 0;
  const blocksQuery = useQuery({
    queryKey: ['schema-blocks', subjectSlug, documentId],
    queryFn: () => fetchBlocks(subjectSlug, documentId),
    enabled: graphQuery.isSuccess && !hasGraph,
    refetchInterval: (query) => (query.state.data === undefined ? 2000 : false),
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['schema-graph', subjectSlug, documentId] });
    queryClient.invalidateQueries({ queryKey: ['schema-blocks', subjectSlug, documentId] });
    queryClient.invalidateQueries({ queryKey: ['document', subjectSlug, documentId] });
    queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] });
  };

  const saveBlock = useMutation({
    mutationFn: ({
      blockId,
      patch,
    }: {
      blockId: string;
      patch: { text?: string; verified?: boolean };
    }) => patchBlock(subjectSlug, documentId, blockId, patch),
    onSuccess: invalidate,
  });
  const saveNode = useMutation({
    mutationFn: ({ nodeId, patch }: { nodeId: string; patch: UpdateSchemaNodeRequest }) =>
      patchNode(subjectSlug, documentId, nodeId, patch),
    onSuccess: invalidate,
  });
  const retranscribeMutation = useMutation({
    mutationFn: () => retranscribe(subjectSlug, documentId),
    onSuccess: invalidate,
  });

  const unresolvedNodeKeys = useMemo(
    () => (graphQuery.data?.nodes ?? []).filter((n) => n.verifiedAt === null).map((n) => n.nodeKey),
    [graphQuery.data],
  );

  const goToNextUnresolved = () => {
    if (unresolvedNodeKeys.length === 0) return;
    const currentIndex = activeNodeKey ? unresolvedNodeKeys.indexOf(activeNodeKey) : -1;
    setActiveNodeKey(unresolvedNodeKeys[(currentIndex + 1) % unresolvedNodeKeys.length]!);
  };

  if (documentQuery.isLoading) {
    return <div className="mx-auto max-w-[1440px] p-6 text-sm text-fg-muted">Caricamento…</div>;
  }
  if (documentQuery.isError || !documentQuery.data) {
    return (
      <div className="mx-auto max-w-[1440px] p-6">
        <p role="alert" className="text-sm text-danger">
          {(documentQuery.error as Error)?.message ?? 'Documento non trovato.'}
        </p>
      </div>
    );
  }

  const document = documentQuery.data;
  const graph = graphQuery.data;
  const blocks = blocksQuery.data ?? [];
  const total = hasGraph ? (graph?.nodes.length ?? 0) : blocks.length;
  const blockedCount = hasGraph
    ? unresolvedNodeKeys.length
    : blocks.filter((b) => !b.verified).length;
  const pct = total === 0 ? 0 : Math.round(((total - blockedCount) / total) * 100);

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <Link
            href={`/materie/${subjectSlug}?tab=schemi`}
            className="text-xs text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline"
          >
            ← Torna a Schemi
          </Link>
          <h1 className="mt-1 text-lg font-semibold tracking-[-0.02em] text-fg-primary">
            Verifica trascrizione — {document.originalName}
          </h1>
        </div>
        <div className="flex gap-2">
          {hasGraph && (
            <>
              <a
                href={`/api/subjects/${subjectSlug}/documents/${documentId}/schema-graph/canvas`}
                className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
              >
                Esporta .canvas
              </a>
              {blockedCount > 0 && (
                <Button type="button" variant="secondary" onClick={goToNextUnresolved}>
                  Prossimo incerto
                </Button>
              )}
            </>
          )}
          <Button
            type="button"
            variant="secondary"
            onClick={() => retranscribeMutation.mutate()}
            disabled={retranscribeMutation.isPending}
          >
            Ritrascrivi
          </Button>
        </div>
      </div>

      {total > 0 && (
        <div className="mb-4 flex items-center gap-3 text-xs text-fg-secondary">
          {blockedCount > 0 ? (
            <span>
              <b className="font-mono text-fg-primary">{blockedCount}</b> da verificare su{' '}
              <span className="font-mono">{total}</span>
            </span>
          ) : (
            <span className="text-ok">Tutto verificato</span>
          )}
          <div className="h-1 max-w-xs flex-1 overflow-hidden rounded-full bg-bg-inset">
            <div
              className={`h-full rounded-full ${blockedCount === 0 ? 'bg-ok' : 'bg-warn'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="relative flex items-start justify-center rounded-[var(--radius-card)] border border-border bg-bg-inset p-4">
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element -- local/private document bytes, not an optimizable remote asset */}
            <img
              src={`/api/subjects/${subjectSlug}/documents/${documentId}/file`}
              alt={document.originalName}
              className="max-h-[80vh] max-w-full rounded-[var(--radius-control)] shadow-lg"
            />
            {hasGraph &&
              graph!.nodes
                .filter((n) => n.crop)
                .map((n) => (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => setActiveNodeKey(n.nodeKey)}
                    className="absolute border-2 transition-colors"
                    style={{
                      left: `${n.crop!.x * 100}%`,
                      top: `${n.crop!.y * 100}%`,
                      width: `${n.crop!.w * 100}%`,
                      height: `${n.crop!.h * 100}%`,
                      borderColor:
                        n.nodeKey === activeNodeKey
                          ? 'var(--accent)'
                          : NODE_CONFIDENCE_COLOR[n.confidence],
                      background:
                        n.nodeKey === activeNodeKey ? 'var(--accent-subtle)' : 'transparent',
                    }}
                    aria-label={`Nodo ${n.label}`}
                  />
                ))}
          </div>
        </div>

        <div className="space-y-3">
          {graphQuery.isError && (
            <p role="alert" className="text-sm text-danger">
              {(graphQuery.error as Error).message}
            </p>
          )}

          {hasGraph &&
            graph!.nodes.map((node, i) => (
              <NodeRow
                key={node.id}
                node={node}
                index={i}
                active={node.nodeKey === activeNodeKey}
                onSelect={() => setActiveNodeKey(node.nodeKey)}
                onSave={(patch) => saveNode.mutate({ nodeId: node.id, patch })}
              />
            ))}

          {hasGraph && graph!.edges.length > 0 && (
            <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
              <p className="mb-2 text-xs text-fg-muted">Archi</p>
              <ul className="space-y-1 text-xs text-fg-secondary">
                {graph!.edges.map((e) => (
                  <li key={e.id} className="font-mono">
                    {e.from} —{e.type}→ {e.to}
                    {e.label ? ` (${e.label})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {!hasGraph && blocksQuery.isLoading && (
            <p className="text-sm text-fg-muted">Caricamento blocchi…</p>
          )}
          {!hasGraph && blocksQuery.isError && (
            <p role="alert" className="text-sm text-danger">
              {(blocksQuery.error as Error).message}
            </p>
          )}
          {!hasGraph &&
            graphQuery.isSuccess &&
            blocks.length === 0 &&
            document.status === 'parsing' && (
              <p className="text-sm text-fg-muted">Trascrizione in corso…</p>
            )}
          {!hasGraph &&
            graphQuery.isSuccess &&
            blocks.length === 0 &&
            document.status !== 'parsing' && (
              <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-6 text-center text-sm text-fg-muted">
                Nessun blocco trascritto.
              </div>
            )}
          {!hasGraph &&
            blocks.map((block, i) => (
              <BlockRow
                key={block.id}
                block={block}
                index={i}
                onSave={(patch) => saveBlock.mutate({ blockId: block.id, patch })}
              />
            ))}
        </div>
      </div>
    </div>
  );
}
