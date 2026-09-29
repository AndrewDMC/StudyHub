'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { DocumentDto } from '@studyhub/contracts';
import { ObsidianMarkdown } from '@/components/ObsidianMarkdown';

async function fetchDocument(slug: string, documentId: string): Promise<DocumentDto> {
  const res = await fetch(`/api/subjects/${slug}/documents/${documentId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare il documento');
  return body.document as DocumentDto;
}

async function fetchText(url: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error('Impossibile caricare il file');
  return res.text();
}

function MarkdownFile({ url }: { url: string }) {
  const query = useQuery({ queryKey: ['documentFileText', url], queryFn: () => fetchText(url) });
  if (query.isLoading) return <p className="text-sm text-fg-muted">Caricamento…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {(query.error as Error).message}
      </p>
    );
  return (
    <div className="mx-auto max-w-3xl p-6">
      <ObsidianMarkdown source={query.data ?? ''} />
    </div>
  );
}

/**
 * Read-only viewer of the *original* uploaded file (PDF / image / Markdown), streamed from
 * `/documents/:id/file`. Distinct from `DocumentContentClient`, which edits the extracted
 * canonical `content.md`.
 */
export function DocumentViewerClient({
  subjectSlug,
  documentId,
}: {
  subjectSlug: string;
  documentId: string;
}) {
  const query = useQuery({
    queryKey: ['document', subjectSlug, documentId],
    queryFn: () => fetchDocument(subjectSlug, documentId),
  });
  const fileUrl = `/api/subjects/${subjectSlug}/documents/${documentId}/file`;
  const doc = query.data;

  return (
    <div className="mx-auto flex h-[calc(100vh-3rem)] max-w-5xl flex-col p-6">
      <div className="mb-4 flex items-center justify-between gap-3">
        <Link
          href={`/materie/${subjectSlug}`}
          className="text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
        >
          ← Torna alla materia
        </Link>
        {doc && (
          <div className="flex items-center gap-4 text-xs">
            {doc.mdPath && (
              <Link
                href={`/materie/${subjectSlug}/documenti/${documentId}`}
                className="text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
              >
                Vedi testo estratto
              </Link>
            )}
            <a
              href={fileUrl}
              download={doc.originalName}
              className="text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
            >
              Scarica
            </a>
          </div>
        )}
      </div>

      {query.isLoading && <p className="text-sm text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="text-sm text-danger">
          {(query.error as Error).message}
        </p>
      )}

      {doc && (
        <>
          <h1 className="mb-3 truncate text-sm font-medium text-fg-primary">{doc.originalName}</h1>
          <div className="min-h-0 flex-1 overflow-auto rounded-[var(--radius-card)] border border-border bg-bg-surface">
            {doc.mime === 'application/pdf' && (
              <iframe src={fileUrl} title={doc.originalName} className="h-full w-full border-0" />
            )}
            {doc.mime.startsWith('image/') && (
              <img
                src={fileUrl}
                alt={doc.originalName}
                className="mx-auto max-h-full max-w-full object-contain"
              />
            )}
            {doc.mime === 'text/markdown' && <MarkdownFile url={fileUrl} />}
          </div>
        </>
      )}
    </div>
  );
}
