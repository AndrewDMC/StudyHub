'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import type { SearchResultDto } from '@studyhub/contracts';
import { Input } from '@/components/ui/input';

async function search(slug: string, query: string): Promise<SearchResultDto[]> {
  const res = await fetch(`/api/subjects/${slug}/search?q=${encodeURIComponent(query)}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Ricerca fallita');
  return body.results as SearchResultDto[];
}

/**
 * Hybrid FTS + vector search over the subject's material (docs/fasi/F1-ingest.md
 * acceptance: "Cerco 'entropia' e trovo il chunk con pagina esatta"). A result
 * opens the document at the exact page cited.
 */
export function SearchPanel({ subjectSlug }: { subjectSlug: string }) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  const results = useQuery({
    queryKey: ['search', subjectSlug, debounced],
    queryFn: () => search(subjectSlug, debounced),
    enabled: debounced.trim().length > 1,
  });

  return (
    <div className="relative mb-4">
      <Input
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          // Debounced manually via a plain timeout would need cleanup; a blur/Enter
          // trigger keeps this simple without an extra effect for a first version.
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') setDebounced(query);
        }}
        onBlur={() => setDebounced(query)}
        placeholder="Cerca nel materiale della materia…"
        aria-label="Cerca nel materiale"
      />
      {debounced.trim().length > 1 && (
        <div className="absolute z-20 mt-1 max-h-96 w-full overflow-y-auto rounded-[var(--radius-card)] border border-border bg-bg-surface shadow-lg">
          {results.isLoading && <p className="p-3 text-xs text-fg-muted">Ricerca…</p>}
          {results.isSuccess && results.data.length === 0 && (
            <p className="p-3 text-xs text-fg-muted">
              Nessun risultato per &laquo;{debounced}&raquo;.
            </p>
          )}
          {results.isSuccess &&
            results.data.map((r) => (
              <Link
                key={r.chunkId}
                href={`/materie/${subjectSlug}/documenti/${r.documentId}#p${r.pageFrom}`}
                className="block border-b border-border px-3 py-2 last:border-0 hover:bg-bg-raised"
                onClick={() => setDebounced('')}
              >
                <p className="truncate text-xs font-medium text-fg-primary">{r.documentName}</p>
                <p className="mt-0.5 line-clamp-2 text-[11px] text-fg-secondary">{r.excerpt}</p>
                <p className="mt-0.5 font-mono text-[10px] text-fg-muted">pag. {r.pageFrom}</p>
              </Link>
            ))}
        </div>
      )}
    </div>
  );
}
