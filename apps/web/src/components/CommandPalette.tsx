'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import type { SubjectSummaryDto } from '@studyhub/contracts';

async function fetchSubjects(): Promise<SubjectSummaryDto[]> {
  const res = await fetch('/api/subjects');
  const body = await res.json();
  if (!res.ok) return [];
  return body.subjects as SubjectSummaryDto[];
}

interface Entry {
  id: string;
  label: string;
  hint?: string;
  href: string;
}

/**
 * ⌘K / Ctrl+K (docs/fasi/F7-dashboard-polish.md "Polish": "command palette
 * completa con azioni AI, navigazione e ricerca globale"). **Navigation and
 * subject search only in this slice** — no AI actions (generate flashcards,
 * extract profile…) are exposed here; those stay on their subject pages.
 * See docs/fasi/F7-dashboard-polish.md "Stato".
 */
export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  const subjectsQuery = useQuery({
    queryKey: ['command-palette-subjects'],
    queryFn: fetchSubjects,
    enabled: open,
    staleTime: 30_000,
  });

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      } else if (e.key === 'Escape') {
        setOpen(false);
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setActiveIndex(0);
    const id = requestAnimationFrame(() => inputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [open]);

  const staticEntries: Entry[] = [
    { id: 'nav-dashboard', label: 'Dashboard', href: '/' },
    { id: 'nav-materie', label: 'Materie', href: '/materie' },
    { id: 'nav-calendario', label: 'Calendario', href: '/calendario' },
  ];
  const subjects = subjectsQuery.data ?? [];
  const subjectEntries: Entry[] = subjects.map((s) => ({
    id: `subject-${s.slug}`,
    label: s.name,
    hint: 'Materia',
    href: `/materie/${s.slug}`,
  }));
  const planEntries: Entry[] = subjects.map((s) => ({
    id: `plan-${s.slug}`,
    label: `Piano — ${s.name}`,
    hint: 'Planner',
    href: `/materie/${s.slug}/piano`,
  }));
  const reviewEntries: Entry[] = subjects.map((s) => ({
    id: `review-${s.slug}`,
    label: `Ripassa — ${s.name}`,
    hint: 'Flashcard',
    href: `/materie/${s.slug}/review`,
  }));

  const all = [...staticEntries, ...subjectEntries, ...planEntries, ...reviewEntries];
  const needle = query.trim().toLowerCase();
  const filtered =
    needle === ''
      ? staticEntries.concat(subjectEntries)
      : all.filter((e) => e.label.toLowerCase().includes(needle));

  function go(entry: Entry) {
    setOpen(false);
    router.push(entry.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2.5 py-1 text-xs text-fg-muted"
        aria-label="Apri command palette"
      >
        Cerca
        <kbd className="font-mono">⌘K</kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 pt-[15vh]"
          onClick={() => setOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            className="w-full max-w-lg rounded-[var(--radius-card)] border border-border bg-bg-surface shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              ref={inputRef}
              autoFocus
              value={query}
              onChange={(e) => {
                setQuery(e.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActiveIndex((i) => Math.min(i + 1, Math.max(0, filtered.length - 1)));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActiveIndex((i) => Math.max(i - 1, 0));
                } else if (e.key === 'Enter' && filtered[activeIndex]) {
                  go(filtered[activeIndex]);
                }
              }}
              placeholder="Vai a… (materie, piano, ripasso, calendario)"
              className="w-full border-b border-border bg-transparent px-4 py-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted"
            />
            <ul className="max-h-80 overflow-y-auto p-1.5">
              {filtered.length === 0 && (
                <li className="px-3 py-2 text-sm text-fg-muted">Nessun risultato.</li>
              )}
              {filtered.map((entry, i) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => go(entry)}
                    onMouseEnter={() => setActiveIndex(i)}
                    className={`flex w-full items-center justify-between rounded-[var(--radius-control)] px-3 py-2 text-left text-sm ${
                      i === activeIndex ? 'bg-bg-raised text-fg-primary' : 'text-fg-secondary'
                    }`}
                  >
                    <span>{entry.label}</span>
                    {entry.hint && <span className="text-xs text-fg-muted">{entry.hint}</span>}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
