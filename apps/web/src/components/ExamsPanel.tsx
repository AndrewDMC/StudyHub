'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ExamDto } from '@studyhub/contracts';
import { formatExamCountdown } from '@/lib/format';

const KIND_LABELS: Record<ExamDto['kind'], string> = {
  scritto: 'Scritto',
  orale: 'Orale',
  parziale: 'Parziale',
  progetto: 'Progetto',
};

async function fetchExams(slug: string): Promise<ExamDto[]> {
  const res = await fetch(`/api/subjects/${slug}/exams`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare gli esami');
  return body.exams as ExamDto[];
}

export function ExamsPanel({ subjectSlug }: { subjectSlug: string }) {
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExamDto['kind']>('scritto');
  const [date, setDate] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [allowedMaterials, setAllowedMaterials] = useState('');
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['exams', subjectSlug],
    queryFn: () => fetchExams(subjectSlug),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['exams', subjectSlug] });

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/subjects/${subjectSlug}/exams`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title,
          kind,
          date: new Date(date).toISOString(),
          ...(durationMin ? { durationMin: Number(durationMin) } : {}),
          ...(allowedMaterials.trim() ? { allowedMaterials: allowedMaterials.trim() } : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Creazione fallita');
      return body.exam as ExamDto;
    },
    onSuccess: () => {
      setTitle('');
      setDate('');
      setDurationMin('');
      setAllowedMaterials('');
      invalidate();
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/subjects/${subjectSlug}/exams/${id}`, { method: 'DELETE' });
      if (!res.ok && res.status !== 204) {
        const body = await res.json().catch(() => null);
        throw new Error(body?.error?.message ?? 'Eliminazione fallita');
      }
    },
    onSuccess: invalidate,
  });

  return (
    <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <h2 className="mb-2 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">Esami</h2>

      {query.isLoading && <p className="px-1 text-xs text-fg-muted">Caricamento…</p>}
      {query.isError && (
        <p role="alert" className="px-1 text-xs text-danger">
          {(query.error as Error).message}
        </p>
      )}
      {query.isSuccess && query.data.length === 0 && (
        <p className="px-1 text-xs text-fg-muted">Nessun esame in programma.</p>
      )}
      {query.isSuccess && query.data.length > 0 && (
        <ul className="space-y-1">
          {query.data.map((exam) => (
            <li
              key={exam.id}
              className="group flex items-center justify-between rounded-[var(--radius-control)] px-2 py-1 hover:bg-bg-raised"
            >
              <div className="min-w-0">
                <p className="truncate text-sm text-fg-primary">{exam.title}</p>
                <p className="font-mono text-[11px] text-fg-muted">
                  {KIND_LABELS[exam.kind]} · {formatExamCountdown(exam.date)}
                  {exam.durationMin ? ` · ${exam.durationMin} min` : ''}
                </p>
                {exam.allowedMaterials && (
                  <p className="truncate text-[11px] text-fg-muted">
                    Ammesso: {exam.allowedMaterials}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(exam.id)}
                className="hidden text-xs text-fg-muted hover:text-danger group-hover:inline"
                aria-label={`Elimina ${exam.title}`}
              >
                Elimina
              </button>
            </li>
          ))}
        </ul>
      )}

      <form
        className="mt-2 flex flex-wrap gap-1.5 px-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (title.trim() && date) createMutation.mutate();
        }}
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titolo esame"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary outline-none focus:border-accent"
        />
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ExamDto['kind'])}
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
        >
          {Object.entries(KIND_LABELS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
        />
        <input
          type="number"
          min={1}
          value={durationMin}
          onChange={(e) => setDurationMin(e.target.value)}
          placeholder="Durata (min)"
          aria-label="Durata in minuti"
          className="w-24 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
        />
        <input
          value={allowedMaterials}
          onChange={(e) => setAllowedMaterials(e.target.value)}
          placeholder="Materiale ammesso"
          aria-label="Materiale ammesso"
          className="min-w-0 flex-1 rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1 text-xs text-fg-primary"
        />
        <button
          type="submit"
          disabled={createMutation.isPending}
          className="rounded-[var(--radius-control)] border border-border px-2 py-1 text-xs text-fg-secondary hover:text-fg-primary"
        >
          +
        </button>
      </form>
      {createMutation.isError && (
        <p role="alert" className="mt-1 px-1 text-xs text-danger">
          {(createMutation.error as Error).message}
        </p>
      )}
    </div>
  );
}
