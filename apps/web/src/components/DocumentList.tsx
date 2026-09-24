import type { DocumentDto } from '@studyhub/contracts';

const STATUS_LABEL: Record<DocumentDto['status'], string> = {
  uploaded: 'Caricato',
  parsing: 'Estrazione…',
  parsed: 'Pronto',
  failed: 'Errore',
  missing: 'Mancante',
};

const STATUS_COLOR: Record<DocumentDto['status'], string> = {
  uploaded: 'var(--fg-muted)',
  parsing: 'var(--info)',
  parsed: 'var(--ok)',
  failed: 'var(--danger)',
  missing: 'var(--warn)',
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentList({ documents }: { documents: DocumentDto[] }) {
  return (
    <ul className="divide-y divide-border rounded-[var(--radius-card)] border border-border bg-bg-surface">
      {documents.map((doc) => (
        <li key={doc.id} className="flex items-center justify-between gap-3 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-sm text-fg-primary">{doc.originalName}</p>
            <p className="mt-0.5 font-mono text-[11px] text-fg-muted">
              {doc.type} · {formatBytes(doc.bytes)}
              {doc.pages !== null ? ` · ${doc.pages} pag.` : ''}
            </p>
          </div>
          <span
            className="shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium"
            style={{ color: STATUS_COLOR[doc.status], borderColor: STATUS_COLOR[doc.status] }}
          >
            {STATUS_LABEL[doc.status]}
          </span>
        </li>
      ))}
    </ul>
  );
}
