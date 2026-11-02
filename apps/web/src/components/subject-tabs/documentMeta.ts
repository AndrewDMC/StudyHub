import type { DocumentDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';

export const DOC_TYPE_LABELS: Record<DocumentType, string> = {
  appunti: 'Appunti',
  schemi: 'Schemi',
  esami: 'Esami',
  slide: 'Slide',
  altro: 'Altro',
};

export const DOC_STATUS: Record<
  DocumentDto['status'],
  { label: string; tone: 'ok' | 'warn' | 'danger' | 'info' | 'muted' }
> = {
  uploaded: { label: 'Caricato', tone: 'muted' },
  parsing: { label: 'Estrazione…', tone: 'info' },
  parsed: { label: 'Pronto', tone: 'ok' },
  failed: { label: 'Errore', tone: 'danger' },
  missing: { label: 'Mancante', tone: 'warn' },
};

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Upper-case extension (max 4 chars) for the file badge; "DOC" when there is none. */
export function docExt(name: string): string {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return 'DOC';
  return name.slice(dot + 1, dot + 5).toUpperCase();
}
