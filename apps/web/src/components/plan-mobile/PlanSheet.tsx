'use client';

import { useEffect, useState, type RefObject } from 'react';
import type { ExamDto, GeneratePlanRequest, Intensity, PlanDto } from '@studyhub/contracts';
import {
  INTENSITY_LABELS,
  INTENSITY_ORDER,
  addDaysIso,
  averageMinutes,
  scaleAvailability,
} from '@/lib/planMobile';
import { fieldClass, primaryButton } from '../simulation-mobile/styles';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { todayIso } from '../subject-mobile/queries';
import { usePlanPreview } from './usePlanData';

// Index 0 = Sunday, like the desktop wizard.
const DEFAULT_WEEK = [0, 90, 90, 90, 90, 90, 60];
const DEFAULT_PREFS: PlanDto['prefs'] = {
  sessionLength: 50,
  intensity: 'standard',
  simulationCount: 'auto',
  simulationMinutes: 90,
  reviewMinutesPerCard: 0.5,
};

/** "Genera il piano" / "Rigenera bozza": date, pace and minutes per day; always creates a draft. */
export function PlanSheet({
  open,
  onOpenChange,
  slug,
  plan,
  exams,
  returnFocusRef,
  pending,
  error,
  hasDraft,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  slug: string;
  plan: PlanDto | null;
  exams: ExamDto[];
  returnFocusRef: RefObject<HTMLElement | null>;
  pending: boolean;
  error: string | null;
  hasDraft: boolean;
  onSubmit: (req: GeneratePlanRequest) => void;
}) {
  const [targetDate, setTargetDate] = useState('');
  const [examId, setExamId] = useState('');
  const [intensity, setIntensity] = useState<Intensity>('standard');
  const [minutes, setMinutes] = useState(90);

  const baseWeek = plan?.availability.perWeekday ?? DEFAULT_WEEK;
  const baseMinutes = averageMinutes(baseWeek) || 90;

  // Every time the sheet opens the fields restart from the current plan (or the defaults).
  useEffect(() => {
    if (!open) return;
    setTargetDate(plan?.targetDate ?? '');
    setExamId('');
    setIntensity(plan?.prefs.intensity ?? 'standard');
    setMinutes(baseMinutes);
  }, [open]);

  const today = todayIso();
  const lockedExam = plan?.examId ?? null;
  const resolvedExam = lockedExam ?? (examId || undefined);
  const perWeekday =
    minutes === baseMinutes && plan ? baseWeek : scaleAvailability(baseWeek, minutes);

  const request: GeneratePlanRequest = {
    startDate: today,
    targetDate,
    ...(resolvedExam ? { examId: resolvedExam } : {}),
    availability: { perWeekday, blackoutDates: plan?.availability.blackoutDates ?? [] },
    prefs: { ...(plan?.prefs ?? DEFAULT_PREFS), intensity },
    force: false,
  };

  // Free pre-flight (no AI call), re-run shortly after the form settles.
  const key = JSON.stringify(request);
  const [settledKey, setSettledKey] = useState(key);
  useEffect(() => {
    const t = setTimeout(() => setSettledKey(key), 500);
    return () => clearTimeout(t);
  }, [key]);
  const ready = open && !!targetDate && targetDate > today;
  const preview = usePlanPreview(slug, settledKey, ready && settledKey === key);

  const valid = !!targetDate && targetDate > today && minutes >= 15 && minutes <= 480;
  const editing = plan?.status === 'active';
  const title = editing ? 'Modifica ritmo' : plan ? 'Rigenera bozza' : 'Genera il piano';

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={
        editing
          ? 'Imposta ritmo e minuti al giorno: crei una nuova bozza e il piano attuale resta attivo finché non la confermi.'
          : plan
            ? 'Crea una nuova bozza: il piano attuale resta com’è finché non la confermi. La bozza copre tutta la materia.'
            : 'Crea una bozza: la rivedi e la confermi prima che entri nel calendario.'
      }
      returnFocusRef={returnFocusRef}
    >
      <form
        className="mt-3 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (valid) onSubmit(request);
        }}
      >
        <label className="flex flex-col gap-1 text-sm font-medium">
          Data esame
          <input
            type="date"
            required
            min={addDaysIso(today, 1)}
            value={targetDate}
            onChange={(e) => setTargetDate(e.target.value)}
            className={fieldClass}
          />
          {editing && plan.targetDate <= today && (
            <p className="text-xs font-normal text-fg-muted">
              Scegli una nuova data: quella attuale è passata.
            </p>
          )}
        </label>

        {exams.length > 0 && !lockedExam && (
          <label className="flex flex-col gap-1 text-sm font-medium">
            Esame collegato (opzionale)
            <select
              value={examId}
              onChange={(e) => {
                setExamId(e.target.value);
                const exam = exams.find((x) => x.id === e.target.value);
                if (exam) setTargetDate(exam.date.slice(0, 10));
              }}
              className={fieldClass}
            >
              <option value="">Nessuno</option>
              {exams.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.title}
                </option>
              ))}
            </select>
          </label>
        )}

        <div role="group" aria-label="Ritmo del piano" className="flex flex-col gap-1">
          <span className="text-sm font-medium">Ritmo</span>
          <div className="grid grid-cols-3 gap-1.5">
            {INTENSITY_ORDER.map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={intensity === value}
                onClick={() => setIntensity(value)}
                className={`min-h-11 rounded-[var(--radius-control)] border px-1 text-[13px] font-medium ${
                  intensity === value
                    ? 'border-accent bg-accent-subtle text-fg-primary'
                    : 'border-border bg-bg-raised text-fg-secondary'
                }`}
              >
                {INTENSITY_LABELS[value]}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1 text-sm font-medium">
          Minuti al giorno
          <input
            type="number"
            inputMode="numeric"
            min={15}
            max={480}
            step={5}
            value={minutes}
            onChange={(e) => setMinutes(Number(e.target.value))}
            className={`${fieldClass} font-mono`}
          />
        </label>

        {ready && (
          <p role="status" className="text-[13px]">
            {preview.isError ? (
              <span className="text-fg-muted">Anteprima non disponibile.</span>
            ) : preview.data && settledKey === key ? (
              preview.data.feasibility.feasible ? (
                <span className="text-ok">Tempo sufficiente</span>
              ) : (
                <span className="text-warn">
                  Tempo insufficiente: mancano ~{preview.data.feasibility.shortfallMinutes} min su{' '}
                  {preview.data.feasibility.requiredMinutes} richiesti
                </span>
              )
            ) : (
              <span className="text-fg-muted">Calcolo l’anteprima…</span>
            )}
          </p>
        )}

        {editing && (
          <p className="text-xs text-fg-muted" data-testid="plan-edit-note">
            La bozza riparte da oggi e non tiene conto delle lezioni già fatte.
            {hasDraft && ' Sostituisce la bozza già in attesa.'}
          </p>
        )}

        <button
          type="submit"
          disabled={pending || !valid}
          data-testid="plan-sheet-submit"
          className={`${primaryButton} min-h-12 text-sm`}
        >
          {pending ? 'Generazione…' : 'Genera bozza'}
        </button>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </form>
    </BottomSheet>
  );
}
