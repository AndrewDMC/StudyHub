'use client';

import { useRef } from 'react';
import { Camera, FileText, Upload } from 'lucide-react';
import type { DocumentType } from '@studyhub/core/browser';
import { useDocumentUpload } from '../DocumentUploadForm';

const ACCEPT = 'application/pdf,image/jpeg,image/png,image/webp,text/markdown,.md,.markdown';

/** "Aggiungi materiale": camera capture or file picker, on top of the shared upload mutation. */
export function AddMaterialCard({ slug, type }: { slug: string; type: DocumentType }) {
  const cameraRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const uploader = useDocumentUpload(slug);

  const onPicked = (input: HTMLInputElement) => {
    const files = input.files;
    if (!files || files.length === 0) return;
    uploader.upload(files, type, {
      onSettled: () => {
        input.value = '';
      },
    });
  };

  return (
    <div className="rounded-[var(--radius-card)] border border-dashed border-border-strong bg-bg-surface p-4">
      <div className="flex items-center gap-3">
        <span
          aria-hidden="true"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--radius-control)] bg-accent-subtle text-accent"
        >
          <Upload className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[15px] font-medium">Aggiungi materiale</p>
          <p className="text-[13px] text-fg-secondary">PDF, foto di appunti o schemi a mano</p>
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={uploader.isPending}
          onClick={() => cameraRef.current?.click()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
        >
          <Camera className="h-4 w-4" aria-hidden="true" />
          Scatta
        </button>
        <button
          type="button"
          disabled={uploader.isPending}
          onClick={() => fileRef.current?.click()}
          className="flex min-h-11 items-center justify-center gap-2 rounded-[var(--radius-control)] border border-border-strong bg-bg-raised text-sm font-medium disabled:opacity-50"
        >
          <FileText className="h-4 w-4" aria-hidden="true" />
          Scegli file
        </button>
      </div>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        tabIndex={-1}
        onChange={(e) => onPicked(e.currentTarget)}
      />
      <input
        ref={fileRef}
        type="file"
        multiple
        accept={ACCEPT}
        hidden
        tabIndex={-1}
        onChange={(e) => onPicked(e.currentTarget)}
      />
      {uploader.isPending && (
        <p role="status" className="mt-2 text-[13px] text-fg-muted">
          Caricamento…
        </p>
      )}
      {uploader.isError && (
        <p role="alert" className="mt-2 text-[13px] text-danger">
          {uploader.error?.message}
        </p>
      )}
    </div>
  );
}
