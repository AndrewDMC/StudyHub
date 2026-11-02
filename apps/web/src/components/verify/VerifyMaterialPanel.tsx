'use client';

import type { ReactNode } from 'react';
import type { SessionDocumentDto } from '@studyhub/contracts';
import { Button } from '@/components/ui/button';

export interface VerifyMaterialTarget {
  docId: string;
  page: number;
  nonce: number;
}

/**
 * The material, only after the student opens a citation of a key point: just the viewer, no tutor.
 * The viewer itself is injected (it lives in `SessionClient`).
 */
export function VerifyMaterialPanel({
  docs,
  target,
  onClose,
  renderDocument,
}: {
  docs: SessionDocumentDto[];
  target: VerifyMaterialTarget;
  onClose: () => void;
  renderDocument: (props: {
    doc: SessionDocumentDto;
    canAsk: boolean;
    onAsk: () => void;
    target: { page: number; nonce: number } | null;
  }) => ReactNode;
}) {
  const doc = docs.find((d) => d.id === target.docId) ?? null;
  return (
    <aside aria-label="Materiale" className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-sm text-fg-secondary">{doc?.name ?? 'Materiale'}</span>
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>
          Chiudi il materiale
        </Button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {doc ? (
          renderDocument({
            doc,
            canAsk: false,
            onAsk: () => {},
            target: { page: target.page, nonce: target.nonce },
          })
        ) : (
          <p className="rounded-[var(--radius-card)] border border-dashed border-border p-4 text-sm text-fg-secondary">
            Questo documento non è disponibile nella verifica.
          </p>
        )}
      </div>
    </aside>
  );
}
