'use client';

import { useEffect, useId, useRef, useState, type RefObject } from 'react';
import {
  formatClock,
  PHASE_LABELS,
  type TimerMode,
  type UsePomodoro,
} from '@/components/PomodoroTimer';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { fieldClass, primaryButton, secondaryButton } from '../simulation-mobile/styles';

type FieldKey = 'focusMin' | 'shortBreakMin' | 'longBreakMin' | 'cyclesBeforeLong';

const FIELDS: {
  key: FieldKey;
  label: string;
  unit: string | null;
  min: number;
  max: number;
  testId: string;
}[] = [
  {
    key: 'focusMin',
    label: 'Focus (min)',
    unit: 'min',
    min: 1,
    max: 180,
    testId: 'timer-focus-min',
  },
  {
    key: 'shortBreakMin',
    label: 'Pausa breve (min)',
    unit: 'min',
    min: 1,
    max: 60,
    testId: 'timer-short-min',
  },
  {
    key: 'longBreakMin',
    label: 'Pausa lunga (min)',
    unit: 'min',
    min: 1,
    max: 120,
    testId: 'timer-long-min',
  },
  {
    key: 'cyclesBeforeLong',
    label: 'Focus prima della lunga',
    unit: null,
    min: 1,
    max: 12,
    testId: 'timer-cycles',
  },
];

const MODES: { id: TimerMode; label: string; hint: string; testId: string }[] = [
  {
    id: 'pomodoro',
    label: 'Pomodoro',
    hint: 'Alterna focus e pause; conta come studio solo il focus.',
    testId: 'timer-mode-pomodoro',
  },
  {
    id: 'free',
    label: 'Libero',
    hint: 'Cronometro semplice: tutto il tempo conta come studio.',
    testId: 'timer-mode-free',
  },
];

const toDraft = (config: UsePomodoro['config']): Record<FieldKey, string> => ({
  focusMin: String(config.focusMin),
  shortBreakMin: String(config.shortBreakMin),
  longBreakMin: String(config.longBreakMin),
  cyclesBeforeLong: String(config.cyclesBeforeLong),
});

function parseField(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const n = Number(value);
  return n >= min && n <= max ? n : null;
}

/** Pomodoro controls of the study timer for mobile: mode, skip phase, durations (same prefs as the desktop). */
export function TimerSheet({
  open,
  onOpenChange,
  timer,
  returnFocusRef,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timer: UsePomodoro;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const helpId = useId();
  const { mode, config, state } = timer;
  const [draft, setDraft] = useState(() => toDraft(config));
  const [applied, setApplied] = useState(false);
  const [phaseNote, setPhaseNote] = useState('');
  const lastPhase = useRef(state.phase);

  // Realign the fields when the stored config changes or the sheet is (re)opened.
  useEffect(() => {
    setDraft(toDraft(config));
  }, [config, open]);
  useEffect(() => {
    if (open) setApplied(false);
  }, [open]);

  // Announces the phase after "Salta" (the clock itself is deliberately not live).
  useEffect(() => {
    if (lastPhase.current !== state.phase) {
      lastPhase.current = state.phase;
      setPhaseNote(`Ora: ${PHASE_LABELS[state.phase]}`);
    }
  }, [state.phase]);

  const parsed = FIELDS.map((f) => parseField(draft[f.key], f.min, f.max));
  const valid = parsed.every((n) => n !== null);
  const dirty = FIELDS.some((f) => draft[f.key] !== String(config[f.key]));

  const apply = () => {
    if (!valid) return;
    timer.applyConfig({
      focusMin: parsed[0]!,
      shortBreakMin: parsed[1]!,
      longBreakMin: parsed[2]!,
      cyclesBeforeLong: parsed[3]!,
    });
    setApplied(true);
  };

  const isFocus = state.phase === 'focus';

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Timer"
      description="Modalità e durate del timer di studio."
      returnFocusRef={returnFocusRef}
    >
      <div className="mt-4 flex flex-col gap-4">
        <div>
          <div
            role="group"
            aria-label="Modalità"
            className="grid grid-cols-2 gap-1 rounded-[10px] border border-border bg-bg-inset p-1"
          >
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mode === m.id}
                data-testid={m.testId}
                onClick={() => timer.setMode(m.id)}
                className={`min-h-11 rounded-[var(--radius-control)] text-sm font-semibold ${
                  mode === m.id
                    ? 'bg-bg-raised text-fg-primary shadow-[0_0_0_1px_var(--border-strong)]'
                    : 'text-fg-secondary'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-xs text-fg-muted">{MODES.find((m) => m.id === mode)?.hint}</p>
        </div>

        {mode === 'pomodoro' ? (
          <>
            <div className="flex items-baseline justify-between gap-3">
              <span
                className={`text-sm font-semibold ${isFocus ? 'text-accent' : 'text-ok'}`}
                data-testid="timer-phase"
              >
                {PHASE_LABELS[state.phase]}
              </span>
              <span className="font-mono text-lg tabular-nums">
                {formatClock(state.remainingMs)}
              </span>
              <span className="text-xs text-fg-secondary">
                {state.completed} {state.completed === 1 ? 'pomodoro' : 'pomodori'}
              </span>
            </div>
            <button
              type="button"
              data-testid="timer-skip"
              onClick={timer.skip}
              className={`${secondaryButton} min-h-12`}
            >
              {isFocus ? 'Salta al riposo' : 'Salta la pausa'}
            </button>
            <p role="status" className="sr-only">
              {phaseNote}
            </p>

            <fieldset className="flex flex-col gap-3">
              <legend className="mb-1 text-xs font-medium uppercase tracking-[0.06em] text-fg-muted">
                Durate
              </legend>
              {FIELDS.map((f, i) => {
                const invalid = parsed[i] === null;
                const id = `${helpId}-${f.key}`;
                return (
                  <div key={f.key}>
                    <div className="flex items-center justify-between gap-3">
                      <label htmlFor={id} className="text-sm text-fg-secondary">
                        {f.label}
                      </label>
                      <div className="flex items-center gap-2">
                        <input
                          id={id}
                          type="number"
                          inputMode="numeric"
                          min={f.min}
                          max={f.max}
                          step={1}
                          value={draft[f.key]}
                          data-testid={f.testId}
                          aria-invalid={invalid ? 'true' : undefined}
                          aria-describedby={helpId}
                          onChange={(e) => {
                            setApplied(false);
                            setDraft((d) => ({ ...d, [f.key]: e.target.value }));
                          }}
                          className={`${fieldClass} w-20 text-right`}
                        />
                        {f.unit && <span className="w-7 text-xs text-fg-muted">{f.unit}</span>}
                      </div>
                    </div>
                    {invalid && (
                      <p className="mt-1 text-xs text-danger">
                        Inserisci un numero tra {f.min} e {f.max}
                      </p>
                    )}
                  </div>
                );
              })}
              <p id={helpId} className="text-xs text-fg-muted">
                Cambiare una durata riparte da un nuovo focus.
              </p>
              <button
                type="button"
                data-testid="timer-apply-durations"
                disabled={!dirty || !valid}
                onClick={apply}
                className={`${primaryButton} min-h-12`}
              >
                Applica durate
              </button>
              {applied && (
                <p role="status" className="text-[13px] text-ok">
                  Durate aggiornate. Riparte un nuovo focus.
                </p>
              )}
            </fieldset>
          </>
        ) : (
          <p className="text-sm text-fg-secondary">
            In modalità libera il tempo scorre senza fasi: non ci sono durate da impostare.
          </p>
        )}

        <button
          type="button"
          onClick={() => onOpenChange(false)}
          className={`${secondaryButton} min-h-12`}
        >
          Fatto
        </button>
      </div>
    </BottomSheet>
  );
}
