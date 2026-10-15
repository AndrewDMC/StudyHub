'use client';

import { useEffect, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExamDto } from '@studyhub/contracts';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { KIND_LABELS, createExam } from '../ExamsPanel';

const fieldClass =
  'min-h-11 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset px-3 text-[15px] text-fg-primary outline-none focus:border-accent';
const labelClass = 'mb-1 block text-[13px] text-fg-secondary';

/** "Aggiungi" esame: same payload as the desktop panel plus `location`. */
export function ExamFormSheet({
  open,
  onOpenChange,
  slug,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const [title, setTitle] = useState('');
  const [kind, setKind] = useState<ExamDto['kind']>('scritto');
  const [date, setDate] = useState('');
  const [durationMin, setDurationMin] = useState('');
  const [location, setLocation] = useState('');
  const [allowedMaterials, setAllowedMaterials] = useState('');

  const mutation = useMutation({
    mutationFn: () =>
      createExam(slug, {
        title: title.trim(),
        kind,
        date: new Date(date).toISOString(),
        ...(durationMin ? { durationMin: Number(durationMin) } : {}),
        ...(location.trim() ? { location: location.trim() } : {}),
        ...(allowedMaterials.trim() ? { allowedMaterials: allowedMaterials.trim() } : {}),
      }),
    onSuccess: () => {
      setTitle('');
      setDate('');
      setDurationMin('');
      setLocation('');
      setAllowedMaterials('');
      queryClient.invalidateQueries({ queryKey: ['exams', slug] });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (open) mutation.reset();
  }, [open]);

  const canSubmit = title.trim() !== '' && date !== '' && !mutation.isPending;

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Aggiungi esame"
      returnFocusRef={returnFocusRef}
    >
      <form
        className="mt-3 space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSubmit) mutation.mutate();
        }}
      >
        <div>
          <label htmlFor="exam-title" className={labelClass}>
            Titolo
          </label>
          <input
            id="exam-title"
            required
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="exam-kind" className={labelClass}>
            Tipo
          </label>
          <select
            id="exam-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as ExamDto['kind'])}
            className={fieldClass}
          >
            {Object.entries(KIND_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="exam-date" className={labelClass}>
            Data
          </label>
          <input
            id="exam-date"
            type="date"
            required
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="exam-duration" className={labelClass}>
            Durata in minuti
          </label>
          <input
            id="exam-duration"
            inputMode="numeric"
            pattern="[0-9]*"
            value={durationMin}
            onChange={(e) => setDurationMin(e.target.value.replace(/\D/g, ''))}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="exam-location" className={labelClass}>
            Luogo
          </label>
          <input
            id="exam-location"
            value={location}
            onChange={(e) => setLocation(e.target.value)}
            className={fieldClass}
          />
        </div>
        <div>
          <label htmlFor="exam-materials" className={labelClass}>
            Materiale ammesso
          </label>
          <input
            id="exam-materials"
            value={allowedMaterials}
            onChange={(e) => setAllowedMaterials(e.target.value)}
            className={fieldClass}
          />
        </div>
        {mutation.isError && (
          <p role="alert" className="text-[13px] text-danger">
            {(mutation.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={!canSubmit}
          className="min-h-11 w-full rounded-[var(--radius-control)] bg-accent text-sm font-semibold text-bg-base disabled:opacity-50"
        >
          {mutation.isPending ? 'Aggiungo…' : 'Aggiungi esame'}
        </button>
      </form>
    </BottomSheet>
  );
}
