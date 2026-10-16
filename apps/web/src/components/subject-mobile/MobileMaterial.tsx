'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { DocumentDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import { useSelection } from '@/lib/selection';
import {
  MATERIAL_FILTERS,
  MATERIAL_FILTER_LABELS,
  materialFilterForType,
  materialHref,
  type MaterialFilter,
} from '@/lib/subjectTabs';
import { AddMaterialCard } from '../document-mobile/AddMaterialCard';
import { DocumentRow } from '../document-mobile/DocumentRow';
import { ExamsSection } from '../document-mobile/ExamsSection';
import { TypeSuggestionChip } from '../document-mobile/TypeSuggestionChip';
import { MobileSection, SectionEmpty } from './SectionState';

/** Type a new upload gets for the current chip: the chip's own type, `appunti` for Tutti. */
function uploadTypeFor(filter: MaterialFilter): DocumentType {
  return filter === 'schemi' || filter === 'esami' || filter === 'altro' ? filter : 'appunti';
}

/** Materiale (docs/design/materia-mobile/Materiale.dc.html): upload card, type chips, documents, exams. */
export function MobileMaterial({
  slug,
  filter,
  documents,
}: {
  slug: string;
  filter: MaterialFilter;
  documents: DocumentDto[];
}) {
  const router = useRouter();
  const { docIds, setDocIds } = useSelection();
  const [selecting, setSelecting] = useState(false);
  const [statusMsg, setStatusMsg] = useState('');
  const listRef = useRef<HTMLUListElement>(null);
  const sectionRef = useRef<HTMLDivElement>(null);
  const focusAfterRefetch = useRef(false);

  // After Applica / Ignora the row may move or vanish with the refetch: put the focus on the list,
  // or on the section when the list is gone (the chip that had it is removed).
  useEffect(() => {
    if (!focusAfterRefetch.current) return;
    focusAfterRefetch.current = false;
    (listRef.current ?? sectionRef.current)?.focus();
  }, [documents]);

  const counts: Record<MaterialFilter, number> = {
    tutti: documents.length,
    appunti: documents.filter((d) => materialFilterForType(d.type) === 'appunti').length,
    schemi: documents.filter((d) => materialFilterForType(d.type) === 'schemi').length,
    esami: documents.filter((d) => materialFilterForType(d.type) === 'esami').length,
    altro: documents.filter((d) => materialFilterForType(d.type) === 'altro').length,
  };
  const visible = documents
    .filter((d) => filter === 'tutti' || materialFilterForType(d.type) === filter)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const toggle = (id: string) => {
    const next = new Set(docIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setDocIds(next);
  };

  return (
    <div className="min-w-0 space-y-4">
      <p role="status" aria-live="polite" className="sr-only">
        {statusMsg}
      </p>
      <AddMaterialCard slug={slug} type={uploadTypeFor(filter)} />

      <div
        role="group"
        aria-label="Filtra per tipo"
        className="-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none]"
      >
        {MATERIAL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={f === filter}
            onClick={() => router.replace(materialHref(slug, f), { scroll: false })}
            className={`flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-4 text-sm ${
              f === filter
                ? 'border-accent bg-accent-subtle text-fg-primary'
                : 'border-border text-fg-secondary'
            }`}
          >
            {MATERIAL_FILTER_LABELS[f]}
            <span className="font-mono text-[11px] text-fg-muted">{counts[f]}</span>
          </button>
        ))}
      </div>

      <div ref={sectionRef} tabIndex={-1} className="outline-none">
        <MobileSection
          title={`${visible.length} ${visible.length === 1 ? 'documento' : 'documenti'}`}
          action={
            <div className="flex items-center gap-1">
              <span className="text-[13px] text-fg-secondary">Più recenti</span>
              <button
                type="button"
                aria-pressed={selecting}
                onClick={() => setSelecting((v) => !v)}
                className="min-h-11 px-2 text-sm text-accent"
              >
                Seleziona
              </button>
            </div>
          }
        >
          {visible.length === 0 ? (
            <SectionEmpty>
              {filter === 'tutti'
                ? 'Nessun documento ancora. Scatta una foto o scegli un file.'
                : 'Nessun documento di questo tipo ancora.'}
            </SectionEmpty>
          ) : (
            <ul
              ref={listRef}
              tabIndex={-1}
              aria-label="Documenti"
              className="overflow-hidden rounded-[var(--radius-card)] border border-border bg-bg-surface outline-none"
            >
              {visible.map((doc, i) => (
                <li key={doc.id} className={i > 0 ? 'border-t border-border' : undefined}>
                  <DocumentRow
                    slug={slug}
                    doc={doc}
                    selecting={selecting}
                    selected={docIds.has(doc.id)}
                    onToggle={() => toggle(doc.id)}
                  />
                  {!selecting && doc.typeSuggested && doc.typeSuggested !== doc.type && (
                    <TypeSuggestionChip
                      slug={slug}
                      doc={doc}
                      onResolved={(message) => {
                        setStatusMsg(message);
                        focusAfterRefetch.current = true;
                      }}
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {docIds.size > 0 && (
            <div className="mt-2 flex items-center justify-between px-1 text-[13px] text-fg-secondary">
              <span>{docIds.size} selezionati</span>
              <button
                type="button"
                onClick={() => setDocIds(new Set())}
                className="min-h-11 px-2 text-accent"
              >
                Deseleziona tutti
              </button>
            </div>
          )}
        </MobileSection>
      </div>

      {(filter === 'tutti' || filter === 'esami') && <ExamsSection slug={slug} />}
    </div>
  );
}
