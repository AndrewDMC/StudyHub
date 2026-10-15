'use client';

import { useQuery } from '@tanstack/react-query';
import type {
  DocumentDto,
  SchemaBlockConfidence,
  SchemaBlockDto,
  SchemaNodeDto,
  SubjectDto,
  UpdateSchemaNodeRequest,
} from '@studyhub/contracts';

export async function fetchDocument(slug: string, id: string): Promise<DocumentDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${id}`);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Documento non trovato');
  return body.document as DocumentDto;
}

/** Same key as the desktop viewers; polls while the document is still being extracted. */
export function useDocument(slug: string, id: string) {
  return useQuery({
    queryKey: ['document', slug, id],
    queryFn: () => fetchDocument(slug, id),
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === 'uploaded' || status === 'parsing' ? 3000 : false;
    },
  });
}

/** Subject name for the header; shares the `['subject', slug]` cache with the subject page. */
export function useSubjectName(slug: string): string | undefined {
  const query = useQuery({
    queryKey: ['subject', slug],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${slug}`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Materia non trovata');
      return body.subject as SubjectDto;
    },
  });
  return query.data?.name;
}

export async function patchBlock(
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

export async function patchNode(
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
