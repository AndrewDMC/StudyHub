'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { DOCUMENT_TYPES, type DocumentType } from '@studyhub/core/browser';

async function uploadOne(subjectSlug: string, type: DocumentType, file: File) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file);
  const res = await fetch(`/api/subjects/${subjectSlug}/documents`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Upload fallito: ${file.name}`);
  return body as { duplicate: boolean };
}

const TYPE_LABELS: Record<DocumentType, string> = {
  appunti: 'Appunti',
  schemi: 'Schemi',
  esami: 'Esami',
  slide: 'Slide',
  altro: 'Altro',
};

export function DocumentUploadForm({
  subjectSlug,
  defaultType = 'appunti',
}: {
  subjectSlug: string;
  defaultType?: DocumentType;
}) {
  const [type, setType] = useState<DocumentType>(defaultType);
  const inputRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: async (files: FileList) => {
      const results = await Promise.allSettled(
        Array.from(files).map((file) => uploadOne(subjectSlug, type, file)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`${failed.length} di ${files.length} upload falliti`);
      }
      return results;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] });
      if (inputRef.current) inputRef.current.value = '';
    },
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4">
      <div className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-fg-secondary">
          Tipo
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-sm text-fg-primary"
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,text/markdown,.md,.markdown"
          disabled={mutation.isPending}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              mutation.mutate(e.target.files);
            }
          }}
          className="text-sm text-fg-secondary file:mr-3 file:rounded-[var(--radius-control)] file:border-0 file:bg-accent file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-white hover:file:bg-accent-hover"
        />

        {mutation.isPending && <span className="text-xs text-fg-muted">Caricamento…</span>}
      </div>

      {mutation.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {(mutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
