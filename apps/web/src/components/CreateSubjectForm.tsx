'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SUBJECT_COLORS, type SubjectColor } from '@studyhub/core/browser';
import type { CreateSubjectRequest, SubjectDto } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

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
        <Label className="flex flex-col gap-1">
          Nome materia
          <Input
            required
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="es. Fisica 1"
          />
        </Label>

        <Label className="flex flex-col gap-1">
          Docente (opzionale)
          <Input value={professor} onChange={(e) => setProfessor(e.target.value)} />
        </Label>

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
          <Button type="submit" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creazione…' : 'Crea materia'}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Annulla
          </Button>
        </div>
      </div>
    </form>
  );
}
