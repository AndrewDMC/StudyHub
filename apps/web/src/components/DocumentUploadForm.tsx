'use client';

import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Upload } from 'lucide-react';
import { DOCUMENT_TYPES, type DocumentType } from '@studyhub/core/browser';
import { BTN_PRIMARY, BTN_SECONDARY, FOCUS } from '@/components/subject-tabs/styles';
import { DOC_TYPE_LABELS } from '@/components/subject-tabs/documentMeta';

async function uploadOne(subjectSlug: string, type: DocumentType, file: File) {
  const form = new FormData();
  form.append('type', type);
  form.append('file', file);
  const res = await fetch(`/api/subjects/${subjectSlug}/documents`, { method: 'POST', body: form });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? `Upload fallito: ${file.name}`);
  return body as { duplicate: boolean };
}

/** Upload mutation shared by the desktop form and the mobile "Aggiungi materiale" card. */
export function useDocumentUpload(subjectSlug: string) {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: async ({ files, type }: { files: FileList | File[]; type: DocumentType }) => {
      const results = await Promise.allSettled(
        Array.from(files).map((file) => uploadOne(subjectSlug, type, file)),
      );
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length > 0) {
        throw new Error(`${failed.length} di ${files.length} upload falliti`);
      }
      return results;
    },
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: ['documents', subjectSlug] });
    },
  });
  return {
    upload: (files: FileList | File[], type: DocumentType, options?: { onSettled?: () => void }) =>
      mutation.mutate(
        { files, type },
        options?.onSettled ? { onSettled: options.onSettled } : undefined,
      ),
    isPending: mutation.isPending,
    isError: mutation.isError,
    error: mutation.error as Error | null,
    reset: mutation.reset,
  };
}

export function DocumentUploadForm({
  subjectSlug,
  defaultType = 'appunti',
  label = 'Carica',
  variant = 'primary',
}: {
  subjectSlug: string;
  defaultType?: DocumentType;
  label?: string;
  variant?: 'primary' | 'secondary';
}) {
  const [type, setType] = useState<DocumentType>(defaultType);
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = useDocumentUpload(subjectSlug);

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex items-center gap-2 text-[13px] text-fg-secondary">
          Tipo
          <select
            value={type}
            onChange={(e) => setType(e.target.value as DocumentType)}
            className={`h-10 rounded-[var(--radius-control)] border border-border-strong bg-bg-inset px-2 text-[13px] text-fg-primary ${FOCUS}`}
          >
            {DOCUMENT_TYPES.map((t) => (
              <option key={t} value={t}>
                {DOC_TYPE_LABELS[t]}
              </option>
            ))}
          </select>
        </label>

        <button
          type="button"
          disabled={mutation.isPending}
          onClick={() => inputRef.current?.click()}
          className={variant === 'primary' ? BTN_PRIMARY : BTN_SECONDARY}
        >
          <Upload aria-hidden="true" className="size-4" />
          {label}
        </button>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept="application/pdf,image/jpeg,image/png,image/webp,text/markdown,.md,.markdown"
          disabled={mutation.isPending}
          aria-label="File da caricare"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              mutation.upload(e.target.files, type, {
                onSettled: () => {
                  if (inputRef.current) inputRef.current.value = '';
                },
              });
            }
          }}
          className="sr-only"
        />

        {mutation.isPending && (
          <span role="status" className="text-xs text-fg-secondary">
            Caricamento…
          </span>
        )}
      </div>

      {mutation.isError && (
        <p role="alert" className="text-xs text-danger">
          {mutation.error?.message}
        </p>
      )}
    </div>
  );
}
