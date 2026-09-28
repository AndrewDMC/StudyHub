'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SubjectSummaryDto } from '@studyhub/contracts';
import { SubjectCard } from './SubjectCard';
import { CreateSubjectForm } from './CreateSubjectForm';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const EXAM_WINDOW_DAYS = 30;

async function fetchSubjects(includeArchived: boolean): Promise<SubjectSummaryDto[]> {
  const res = await fetch(`/api/subjects${includeArchived ? '?includeArchived=1' : ''}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le materie');
  return body.subjects as SubjectSummaryDto[];
}

async function reorderSubjects(slugs: string[]): Promise<void> {
  const res = await fetch('/api/subjects/order', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slugs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Impossibile riordinare le materie');
  }
}

function hasExamWithinDays(subject: SubjectSummaryDto, days: number): boolean {
  if (!subject.nextExamAt) return false;
  const msUntil = new Date(subject.nextExamAt).getTime() - Date.now();
  return msUntil >= 0 && msUntil <= days * 24 * 60 * 60 * 1000;
}

export function MaterieClient() {
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [search, setSearch] = useState('');
  const [examSoonOnly, setExamSoonOnly] = useState(false);
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['subjects', showArchived],
    queryFn: () => fetchSubjects(showArchived),
  });

  const reorderMutation = useMutation({
    mutationFn: reorderSubjects,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['subjects'] }),
  });

  const subjects = query.data ?? [];
  const isFiltered = search.trim() !== '' || examSoonOnly;
  // Reordering needs the full, unfiltered, non-archived list — it's rejected server-side
  // otherwise (docs/fasi/F2-materie.md "riordina" — a partial list would interleave siblings
  // confusingly), so the arrows only appear when nothing is hiding a subject from view.
  const canReorder = !isFiltered && !showArchived;

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return subjects.filter((s) => {
      if (examSoonOnly && !hasExamWithinDays(s, EXAM_WINDOW_DAYS)) return false;
      if (needle === '') return true;
      return (
        s.name.toLowerCase().includes(needle) ||
        (s.professor?.toLowerCase().includes(needle) ?? false)
      );
    });
  }, [subjects, search, examSoonOnly]);

  const moveSubject = (index: number, direction: -1 | 1) => {
    const next = subjects.slice();
    const target = index + direction;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    reorderMutation.mutate(next.map((s) => s.slug));
  };

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Materie</h1>
        <div className="flex flex-wrap items-center gap-4">
          <Input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cerca per nome o docente…"
            className="w-56"
          />
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={examSoonOnly}
              onChange={(e) => setExamSoonOnly(e.target.checked)}
            />
            Esame entro 30 giorni
          </label>
          <label className="flex items-center gap-1.5 whitespace-nowrap text-xs text-fg-secondary">
            <input
              type="checkbox"
              checked={showArchived}
              onChange={(e) => setShowArchived(e.target.checked)}
            />
            Mostra archiviate
          </label>
          <Button type="button" onClick={() => setCreating(true)}>
            Nuova materia
          </Button>
        </div>
      </div>

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova materia</DialogTitle>
          </DialogHeader>
          <CreateSubjectForm onDone={() => setCreating(false)} />
        </DialogContent>
      </Dialog>

      {query.isLoading && (
        <div
          data-testid="subjects-loading"
          className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
        >
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="h-24 animate-pulse rounded-[var(--radius-card)] border border-border bg-bg-surface"
            />
          ))}
        </div>
      )}

      {query.isError && (
        <div
          role="alert"
          className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-6 text-sm text-fg-secondary"
        >
          <p className="text-danger">Errore nel caricamento delle materie.</p>
          <p className="mt-1">{(query.error as Error).message}</p>
          <button
            type="button"
            onClick={() => query.refetch()}
            className="mt-3 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm hover:text-fg-primary"
          >
            Riprova
          </button>
        </div>
      )}

      {query.isSuccess && subjects.length === 0 && !creating && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-10 text-center">
          <p className="text-sm text-fg-secondary">Nessuna materia ancora.</p>
          <p className="mt-1 text-xs text-fg-muted">
            Crea la tua prima materia: verrà creata una cartella dedicata su disco.
          </p>
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="mt-4 rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Nuova materia
          </button>
        </div>
      )}

      {query.isSuccess && subjects.length > 0 && filtered.length === 0 && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-10 text-center">
          <p className="text-sm text-fg-secondary">Nessuna materia corrisponde ai filtri.</p>
        </div>
      )}

      {query.isSuccess && filtered.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((subject) => {
            const index = subjects.findIndex((s) => s.id === subject.id);
            return (
              <SubjectCard
                key={subject.id}
                subject={subject}
                reorder={
                  canReorder
                    ? {
                        onMoveUp: index > 0 ? () => moveSubject(index, -1) : undefined,
                        onMoveDown:
                          index < subjects.length - 1 ? () => moveSubject(index, 1) : undefined,
                      }
                    : undefined
                }
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
