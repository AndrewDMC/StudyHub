'use client';

import { useEffect, useId, useState, type RefObject } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { ExamProfileDto } from '@studyhub/contracts';
import { postJson } from '../ExamPrepPanel';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { fieldClass, primaryButton, secondaryButton } from './styles';

type Draft = {
  itemCount: string;
  durationMin: string;
  totalPoints: string;
  avgMinutesPerItem: string;
  notes: string;
};

function toDraft(p: ExamProfileDto['profile']): Draft {
  return {
    itemCount: String(p.itemCount),
    durationMin: String(p.durationMin),
    totalPoints: String(p.totalPoints),
    avgMinutesPerItem: String(p.avgMinutesPerItem),
    notes: p.notes,
  };
}

/** Parses the draft; null when any number is invalid (integers ≥ 1 / positive decimals). */
function parseDraft(
  d: Draft,
): Pick<
  ExamProfileDto['profile'],
  'itemCount' | 'durationMin' | 'totalPoints' | 'avgMinutesPerItem' | 'notes'
> | null {
  const itemCount = Number(d.itemCount);
  const durationMin = Number(d.durationMin);
  const totalPoints = Number(d.totalPoints);
  const avgMinutesPerItem = Number(d.avgMinutesPerItem);
  if (!d.itemCount.trim() || !Number.isInteger(itemCount) || itemCount < 1) return null;
  if (!d.durationMin.trim() || !Number.isInteger(durationMin) || durationMin < 1) return null;
  if (!d.totalPoints.trim() || !(totalPoints > 0)) return null;
  if (!d.avgMinutesPerItem.trim() || !(avgMinutesPerItem > 0)) return null;
  return { itemCount, durationMin, totalPoints, avgMinutesPerItem, notes: d.notes };
}

/** Edits the four numbers and the notes; the rest of the profile is sent back unchanged. */
export function ProfileEditSheet({
  slug,
  profile,
  open,
  onOpenChange,
  returnFocusRef,
}: {
  slug: string;
  profile: ExamProfileDto | null | undefined;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const queryClient = useQueryClient();
  const formId = useId();
  const [draft, setDraft] = useState<Draft | null>(null);

  const save = useMutation({
    mutationFn: (next: ExamProfileDto['profile']) =>
      postJson(`/api/subjects/${slug}/exam-profile`, next, 'PATCH'),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['exam-profile', slug] });
      onOpenChange(false);
    },
  });

  useEffect(() => {
    if (open && profile) {
      setDraft(toDraft(profile.profile));
      save.reset();
    }
    // Reset only when the sheet opens.
  }, [open]);

  if (!profile || !draft) return null;

  const original = toDraft(profile.profile);
  const parsed = parseDraft(draft);
  const parsedProfile = parsed ? { ...profile.profile, ...parsed } : null;
  const changed = (Object.keys(original) as (keyof Draft)[]).some((k) => original[k] !== draft[k]);

  const num = (key: Exclude<keyof Draft, 'notes'>, label: string, integer: boolean) => (
    <label className="flex flex-col gap-1 text-xs text-fg-secondary">
      {label}
      <input
        type="number"
        inputMode={integer ? 'numeric' : 'decimal'}
        min={integer ? 1 : 0}
        step={integer ? 1 : 'any'}
        value={draft[key]}
        onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
        className={`${fieldClass} font-mono`}
      />
    </label>
  );

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Modifica profilo"
      description="Le simulazioni copiano questo formato."
      returnFocusRef={returnFocusRef}
    >
      <form
        id={formId}
        className="mt-4 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (parsedProfile) save.mutate(parsedProfile);
        }}
      >
        <div className="grid grid-cols-2 gap-3">
          {num('itemCount', 'Esercizi', true)}
          {num('durationMin', 'Durata (min)', true)}
          {num('totalPoints', 'Punti totali', false)}
          {num('avgMinutesPerItem', 'Min per esercizio', false)}
        </div>
        <label className="flex flex-col gap-1 text-xs text-fg-secondary">
          Note
          <textarea
            value={draft.notes}
            onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
            rows={3}
            className={`${fieldClass} py-2`}
          />
        </label>
        {!parsed && (
          <p className="text-xs text-warn">
            Controlla i valori: esercizi e durata sono interi, punti e minuti maggiori di zero.
          </p>
        )}
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {(save.error as Error).message}
          </p>
        )}
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className={`${secondaryButton} min-h-12`}
          >
            Annulla
          </button>
          <button
            type="submit"
            disabled={!parsed || !changed || save.isPending}
            className={`${primaryButton} min-h-12 text-sm`}
          >
            {save.isPending ? 'Salvo…' : 'Salva'}
          </button>
        </div>
      </form>
    </BottomSheet>
  );
}
