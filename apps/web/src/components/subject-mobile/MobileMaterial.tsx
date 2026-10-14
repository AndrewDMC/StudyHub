'use client';

import { useRouter } from 'next/navigation';
import type { DocumentDto } from '@studyhub/contracts';
import type { DocumentType } from '@studyhub/core/browser';
import {
  MATERIAL_FILTERS,
  MATERIAL_FILTER_LABELS,
  materialHref,
  type MaterialFilter,
} from '@/lib/subjectTabs';
import { DocumentTypeTab } from '../DocumentTypeTab';
import { ExamsPanel } from '../ExamsPanel';

const ALL_TYPES: DocumentType[] = ['appunti', 'schemi', 'esami', 'altro', 'slide'];

/** Materiale: type filter chips over the existing document tab (redesigned in slice 2). */
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

  return (
    <div className="min-w-0 space-y-4">
      <div
        role="group"
        aria-label="Filtra per tipo"
        className="flex gap-2 overflow-x-auto [scrollbar-width:none]"
      >
        {MATERIAL_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={f === filter}
            onClick={() => router.replace(materialHref(slug, f), { scroll: false })}
            className={`min-h-11 shrink-0 rounded-full border px-4 text-sm ${
              f === filter
                ? 'border-accent bg-accent-subtle text-fg-primary'
                : 'border-border text-fg-secondary'
            }`}
          >
            {MATERIAL_FILTER_LABELS[f]}
          </button>
        ))}
      </div>
      {filter === 'tutti' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="appunti"
          includeTypes={ALL_TYPES}
          documents={documents}
        />
      )}
      {filter === 'appunti' && (
        <DocumentTypeTab subjectSlug={slug} type="appunti" documents={documents} />
      )}
      {filter === 'schemi' && (
        <DocumentTypeTab subjectSlug={slug} type="schemi" documents={documents} />
      )}
      {filter === 'altro' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="altro"
          includeTypes={['altro', 'slide']}
          documents={documents}
        />
      )}
      {filter === 'esami' && (
        <DocumentTypeTab
          subjectSlug={slug}
          type="esami"
          documents={documents}
          extra={<ExamsPanel subjectSlug={slug} />}
        />
      )}
    </div>
  );
}
