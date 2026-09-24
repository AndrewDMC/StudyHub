'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SUBJECT_COLORS, type SubjectColor } from '@studyhub/core/browser';
import type { CreateSubjectRequest, SubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';

async function postSubject(input: CreateSubjectRequest): Promise<SubjectDto> {
  const res = await fetch('/api/subjects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error?.message ?? 'Errore durante la creazione della materia');
  }
  return body.subject as SubjectDto;
}

export function CreateSubjectForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState('');
  const [color, setColor] = useState<SubjectColor>('blue');
  const [professor, setProfessor] = useState('');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: postSubject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      onDone();
    },
  });

  return (
    <form
      className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
      onSubmit={(e) => {
        e.preventDefault();
        mutation.mutate({
          name,
          color,
          professor: professor.trim() || undefined,
        });
      }}
    >
      <div className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Nome materia
          <input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Fisica 1"
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Docente (opzionale)
          <input
            value={professor}
            onChange={(e) => setProfessor(e.target.value)}
            className="rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 py-2 text-sm text-fg-primary outline-none focus:border-accent"
          />
        </label>

        <div className="flex flex-col gap-1">
          <span className="text-xs text-fg-secondary">Colore</span>
          <div className="flex flex-wrap gap-2">
            {SUBJECT_COLORS.map((c) => (
              <button
                key={c}
                type="button"
                aria-label={c}
                aria-pressed={color === c}
                onClick={() => setColor(c)}
                className="h-6 w-6 rounded-full"
                style={{
                  backgroundColor: SUBJECT_COLOR_HEX[c],
                  outline: color === c ? '2px solid var(--accent)' : 'none',
                  outlineOffset: '2px',
                }}
              />
            ))}
          </div>
        </div>

        {mutation.isError && (
          <p role="alert" className="text-xs text-danger">
            {(mutation.error as Error).message}
          </p>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            disabled={mutation.isPending}
            className="rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors duration-120 hover:bg-accent-hover disabled:opacity-60"
          >
            {mutation.isPending ? 'Creazione…' : 'Crea materia'}
          </button>
          <button
            type="button"
            onClick={onDone}
            className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
          >
            Annulla
          </button>
        </div>
      </div>
    </form>
  );
}
