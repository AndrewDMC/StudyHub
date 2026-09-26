'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { DocumentDto, SchemaBlockConfidence, SchemaBlockDto } from '@studyhub/contracts';

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

async function patchBlock(
  slug: string,
  documentId: string,
  blockId: string,
  patch: { text?: string; confidence?: SchemaBlockConfidence; verified?: boolean },
): Promise<SchemaBlockDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}/schema-blocks/${blockId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Aggiornamento fallito');
  return body.block as SchemaBlockDto;
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
        <button
          type="button"
          onClick={() => onSave({ text, verified: true })}
          className="mt-2 rounded-[var(--radius-control)] bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-hover"
        >
          Conferma
        </button>
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
  const documentQuery = useQuery({
    queryKey: ['document', subjectSlug, documentId],
    queryFn: () => fetchDocument(subjectSlug, documentId),
  });
  const blocksQuery = useQuery({
    queryKey: ['schema-blocks', subjectSlug, documentId],
    queryFn: () => fetchBlocks(subjectSlug, documentId),
    refetchInterval: (query) => (query.state.data === undefined ? 2000 : false), // poll until the transcription job lands
  });

  const invalidate = () => {
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

  const retranscribeMutation = useMutation({
    mutationFn: () => retranscribe(subjectSlug, documentId),
    onSuccess: invalidate,
  });

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
  const blocks = blocksQuery.data ?? [];
  const blockedCount = blocks.filter((b) => !b.verified).length;
  const total = blocks.length;
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
        <button
          type="button"
          onClick={() => retranscribeMutation.mutate()}
          disabled={retranscribeMutation.isPending}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary disabled:opacity-50"
        >
          Ritrascrivi
        </button>
      </div>

      {total > 0 && (
        <div className="mb-4 flex items-center gap-3 text-xs text-fg-secondary">
          {blockedCount > 0 ? (
            <span>
              <b className="font-mono text-fg-primary">{blockedCount}</b> blocchi da verificare su{' '}
              <span className="font-mono">{total}</span>
            </span>
          ) : (
            <span className="text-ok">Tutti i blocchi verificati</span>
          )}
          <div className="h-1 flex-1 max-w-xs overflow-hidden rounded-full bg-bg-inset">
            <div
              className={`h-full rounded-full ${blockedCount === 0 ? 'bg-ok' : 'bg-warn'}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="flex items-start justify-center rounded-[var(--radius-card)] border border-border bg-bg-inset p-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- local/private document bytes, not an optimizable remote asset */}
          <img
            src={`/api/subjects/${subjectSlug}/documents/${documentId}/file`}
            alt={document.originalName}
            className="max-h-[80vh] max-w-full rounded-[var(--radius-control)] shadow-lg"
          />
        </div>

        <div className="space-y-3">
          {blocksQuery.isLoading && <p className="text-sm text-fg-muted">Caricamento blocchi…</p>}
          {blocksQuery.isError && (
            <p role="alert" className="text-sm text-danger">
              {(blocksQuery.error as Error).message}
            </p>
          )}
          {blocksQuery.isSuccess && blocks.length === 0 && document.status === 'parsing' && (
            <p className="text-sm text-fg-muted">Trascrizione in corso…</p>
          )}
          {blocksQuery.isSuccess && blocks.length === 0 && document.status !== 'parsing' && (
            <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-6 text-center text-sm text-fg-muted">
              Nessun blocco trascritto.
            </div>
          )}
          {blocks.map((block, i) => (
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
