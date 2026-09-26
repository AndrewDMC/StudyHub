'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { SubjectSummaryDto } from '@studyhub/contracts';
import { SubjectCard } from './SubjectCard';
import { CreateSubjectForm } from './CreateSubjectForm';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';

async function fetchSubjects(includeArchived: boolean): Promise<SubjectSummaryDto[]> {
  const res = await fetch(`/api/subjects${includeArchived ? '?includeArchived=1' : ''}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le materie');
  return body.subjects as SubjectSummaryDto[];
}

export function MaterieClient() {
  const [creating, setCreating] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const query = useQuery({
    queryKey: ['subjects', showArchived],
    queryFn: () => fetchSubjects(showArchived),
  });

  return (
    <div className="mx-auto max-w-[1440px] p-6">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-xl font-semibold tracking-[-0.02em]">Materie</h1>
        <div className="flex items-center gap-4">
          <label className="flex items-center gap-1.5 text-xs text-fg-secondary">
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

      {query.isSuccess && query.data.length === 0 && !creating && (
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

      {query.isSuccess && query.data.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {query.data.map((subject) => (
            <SubjectCard key={subject.id} subject={subject} />
          ))}
        </div>
      )}
    </div>
  );
}
