'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { SUBJECT_COLORS, type SubjectColor } from '@studyhub/core/browser';
import type { SubjectDto, UpdateSubjectRequest } from '@studyhub/contracts';
import { SUBJECT_COLOR_HEX } from '@/lib/subjectColors';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

async function patchSubject(slug: string, input: UpdateSubjectRequest): Promise<SubjectDto> {
  const res = await fetch(`/api/subjects/${slug}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(body.error?.message ?? 'Errore durante la modifica della materia');
  }
  return body.subject as SubjectDto;
}

/**
 * Edits name/color/professor/cfu of an existing subject (docs/fasi/F2-materie.md "Modifica").
 * Never touches the slug or the on-disk folder path — renaming here is purely cosmetic.
 */
export function EditSubjectForm({ subject, onDone }: { subject: SubjectDto; onDone: () => void }) {
  const [name, setName] = useState(subject.name);
  const [color, setColor] = useState<SubjectColor>(subject.color);
  const [professor, setProfessor] = useState(subject.professor ?? '');
  const [cfu, setCfu] = useState(subject.cfu !== null ? String(subject.cfu) : '');
  const queryClient = useQueryClient();

  const mutation = useMutation({
    mutationFn: (input: UpdateSubjectRequest) => patchSubject(subject.slug, input),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['subjects'] });
      queryClient.invalidateQueries({ queryKey: ['subject', subject.slug] });
      onDone();
    },
  });

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        const trimmedProfessor = professor.trim();
        const trimmedCfu = cfu.trim();
        mutation.mutate({
          name,
          color,
          professor: trimmedProfessor === '' ? null : trimmedProfessor,
          cfu: trimmedCfu === '' ? null : Number(trimmedCfu),
        });
      }}
    >
      <div className="flex flex-col gap-3">
        <Label className="flex flex-col gap-1">
          Nome materia
          <Input required autoFocus value={name} onChange={(e) => setName(e.target.value)} />
        </Label>

        <Label className="flex flex-col gap-1">
          Docente (opzionale)
          <Input value={professor} onChange={(e) => setProfessor(e.target.value)} />
        </Label>

        <Label className="flex flex-col gap-1">
          CFU (opzionale)
          <Input
            type="number"
            min={1}
            max={60}
            value={cfu}
            onChange={(e) => setCfu(e.target.value)}
          />
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
            {mutation.isPending ? 'Salvataggio…' : 'Salva modifiche'}
          </Button>
          <Button type="button" variant="secondary" onClick={onDone}>
            Annulla
          </Button>
        </div>
      </div>
    </form>
  );
}
