'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import type { ExamDto, Intensity, PlanPreviewDto, TopicDto } from '@studyhub/contracts';
import {
  BTN_PRIMARY,
  BTN_SECONDARY,
  CARD_BOX,
  FOCUS,
  INPUT,
  LABEL,
  SECTION_TITLE,
  TEXTAREA,
} from '@/components/subject-tabs/styles';
import { INTENSITY_INFO, INTENSITY_ORDER, todayIso } from './planModel';
import { PhaseList } from './PhaseList';

async function send(url: string, payload: unknown) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Operazione fallita');
  return body;
}

async function getTopics(slug: string): Promise<TopicDto[]> {
  const res = await fetch(`/api/subjects/${slug}/topics`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body.topics as TopicDto[];
}

// perWeekday index 0 = Sunday … 6 = Saturday (packages/core/src/planner/dates.ts convention);
// the grid shows Monday first.
const WEEKDAYS = [
  { short: 'Dom', long: 'domenica' },
  { short: 'Lun', long: 'lunedì' },
  { short: 'Mar', long: 'martedì' },
  { short: 'Mer', long: 'mercoledì' },
  { short: 'Gio', long: 'giovedì' },
  { short: 'Ven', long: 'venerdì' },
  { short: 'Sab', long: 'sabato' },
];
const WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DAY_STEP = 15;
const DAY_MAX = 600;
const SESSION_OPTIONS = [25, 50, 75, 90];
const SIMULATION_OPTIONS = ['auto', '0', '1', '2', '3'];

export function formatMinutes(min: number): string {
  const m = Math.round(min);
  if (m < 60) return `${m} min`;
  const rest = m % 60;
  return `${Math.floor(m / 60)} h${rest ? ` ${String(rest).padStart(2, '0')}` : ''}`;
}

function shortDate(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('it-IT', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function dayMonth(iso: string): string {
  return new Date(`${iso.slice(0, 10)}T00:00:00Z`).toLocaleDateString('it-IT', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const SEGMENTED = 'grid gap-0.5 rounded-lg border border-border bg-bg-inset p-[3px]';
function segment(on: boolean) {
  return `h-9 rounded-[var(--radius-control)] text-[13px] font-medium transition-colors duration-120 ${FOCUS} ${
    on ? 'bg-bg-raised text-fg-primary' : 'text-fg-secondary hover:text-fg-primary'
  }`;
}

function Step({
  n,
  id,
  title,
  aside,
  children,
}: {
  n: number;
  id: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-labelledby={id} className={`${CARD_BOX} flex flex-col gap-4 p-6`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="inline-flex size-[22px] items-center justify-center rounded-[var(--radius-control)] bg-bg-raised font-mono text-[11px] text-fg-secondary"
          >
            {n}
          </span>
          <h3 id={id} className={SECTION_TITLE}>
            {title}
          </h3>
        </div>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * Plan generator, embedded in the subject's Piano tab: three steps on the left, the free
 * pre-flight on the right (docs/design canvas "Piano · generazione").
 */
export function WizardForm({
  slug,
  exams,
  onGenerated,
  defaultIntensity = 'standard',
}: {
  slug: string;
  exams: ExamDto[];
  onGenerated: () => void;
  /** Intensity preselected when the form opens (e.g. from the plan's intensity card). */
  defaultIntensity?: Intensity | undefined;
}) {
  const [startDate, setStartDate] = useState(todayIso());
  const [targetDate, setTargetDate] = useState('');
  const [examId, setExamId] = useState('');
  const [perWeekday, setPerWeekday] = useState<number[]>([0, 90, 90, 90, 90, 90, 60]);
  const [sessionLength, setSessionLength] = useState(50);
  const [intensity, setIntensity] = useState<Intensity>(defaultIntensity);
  const [simulationCount, setSimulationCount] = useState('auto');
  const [blackoutDates, setBlackoutDates] = useState<string[]>([]);
  const [newBlackout, setNewBlackout] = useState('');
  // A partial covers only some topics; `scoped` off = the whole subject.
  const [scoped, setScoped] = useState(false);
  const [pickedTopics, setPickedTopics] = useState<string[]>([]);
  const [notes, setNotes] = useState('');
  const topicsQuery = useQuery({ queryKey: ['topics', slug], queryFn: () => getTopics(slug) });
  const topicList = topicsQuery.data ?? [];

  const togglePicked = (id: string) =>
    setPickedTopics((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]));

  const pickExam = (id: string) => {
    setExamId(id);
    const exam = exams.find((x) => x.id === id);
    if (exam) {
      setTargetDate(exam.date.slice(0, 10));
      setNotes(exam.description ?? '');
    }
  };

  const requestBody = {
    startDate,
    targetDate,
    examId: examId || undefined,
    topicIds: scoped && pickedTopics.length > 0 ? pickedTopics : undefined,
    // With an exam linked an emptied box clears its description too; without one, empty means "no notes".
    notes: notes.trim() === '' && !examId ? undefined : notes.trim(),
    availability: { perWeekday, blackoutDates: [...blackoutDates].sort() },
    prefs: {
      sessionLength,
      intensity,
      simulationCount: simulationCount === 'auto' ? 'auto' : Number(simulationCount),
      simulationMinutes: 90,
      reviewMinutesPerCard: 0.5,
    },
    force: false,
  };

  const generate = useMutation({
    mutationFn: () => send(`/api/subjects/${slug}/plan`, requestBody),
    onSuccess: onGenerated,
  });

  // Free pre-flight (no AI call): re-run shortly after the form settles.
  const previewKey = JSON.stringify(requestBody);
  const [settledKey, setSettledKey] = useState(previewKey);
  useEffect(() => {
    const t = setTimeout(() => setSettledKey(previewKey), 500);
    return () => clearTimeout(t);
  }, [previewKey]);
  // An exam on or before the start (e.g. a linked exam already past) leaves the plan no days.
  const dateInvalid = !!targetDate && targetDate <= startDate;
  const previewReady = !!targetDate && !dateInvalid;
  const previewQuery = useQuery({
    queryKey: ['plan-preview', slug, settledKey],
    queryFn: async () => {
      const body = await send(`/api/subjects/${slug}/plan/preview`, JSON.parse(settledKey));
      return body.preview as PlanPreviewDto;
    },
    enabled: previewReady,
    retry: false,
  });

  const setDay = (i: number, minutes: number) =>
    setPerWeekday((prev) =>
      prev.map((v, idx) => (idx === i ? Math.max(0, Math.min(DAY_MAX, minutes)) : v)),
    );
  const addBlackout = () => {
    if (newBlackout && !blackoutDates.includes(newBlackout)) {
      setBlackoutDates((prev) => [...prev, newBlackout]);
    }
    setNewBlackout('');
  };

  const weekTotal = perWeekday.reduce((a, b) => a + b, 0);
  const scopeMissing = scoped && pickedTopics.length === 0;
  const canGenerate = previewReady && !scopeMissing && !generate.isPending;
  const linkedExam = exams.find((x) => x.id === examId);
  const info = INTENSITY_INFO[intensity];

  return (
    <form
      id="piano-wizard"
      onSubmit={(e) => {
        e.preventDefault();
        if (canGenerate) generate.mutate();
      }}
      className="flex flex-wrap items-start gap-5"
    >
      <div className="flex min-w-0 flex-[999_1_560px] flex-col gap-5">
        <Step n={1} id="piano-esame" title="Per quale esame">
          {exams.length > 0 && (
            <div role="radiogroup" aria-label="Esame collegato" className="flex flex-wrap gap-2">
              {[
                ...exams.map((x) => ({ id: x.id, title: x.title, sub: dayMonth(x.date) })),
                {
                  id: '',
                  title: 'Nessun esame',
                  sub: 'Piano generale, scegli tu la data',
                },
              ].map((x) => {
                const on = examId === x.id;
                return (
                  <button
                    key={x.id || 'none'}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => pickExam(x.id)}
                    className={`flex min-h-14 flex-[1_1_180px] flex-col items-start justify-center gap-0.5 rounded-[var(--radius-control)] border px-3.5 py-2.5 text-left transition-colors duration-120 ${FOCUS} ${
                      on
                        ? 'border-accent bg-accent-subtle'
                        : 'border-border bg-bg-inset hover:border-border-strong'
                    }`}
                  >
                    <span className="text-sm font-medium text-fg-primary">{x.title}</span>
                    <span className="text-xs text-fg-secondary">{x.sub}</span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="grid grid-cols-2 gap-x-4 gap-y-3">
            <label className={LABEL}>
              Inizio studio
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                required
                className={`${INPUT} [color-scheme:dark]`}
              />
            </label>
            <label className={LABEL}>
              Data esame
              <input
                type="date"
                value={targetDate}
                onChange={(e) => setTargetDate(e.target.value)}
                required
                aria-invalid={dateInvalid}
                className={`${INPUT} [color-scheme:dark] ${dateInvalid ? 'border-danger' : ''}`}
              />
            </label>
          </div>
          {dateInvalid && (
            <p role="alert" className="-mt-1.5 text-[13px] text-danger">
              L&apos;esame deve venire dopo l&apos;inizio dello studio: scegli un&apos;altra data.
            </p>
          )}

          <div className="flex flex-col gap-2.5">
            <span className="text-[13px] text-fg-secondary">Cosa copre</span>
            <div
              role="radiogroup"
              aria-label="Cosa copre"
              className={`${SEGMENTED} max-w-[420px] grid-cols-2`}
            >
              {[
                { value: false, label: 'Tutta la materia' },
                { value: true, label: 'Solo alcuni argomenti' },
              ].map((s) => (
                <button
                  key={s.label}
                  type="button"
                  role="radio"
                  aria-checked={scoped === s.value}
                  disabled={s.value && topicList.length === 0}
                  onClick={() => setScoped(s.value)}
                  className={`${segment(scoped === s.value)} disabled:opacity-50`}
                >
                  {s.label}
                </button>
              ))}
            </div>
            {topicList.length === 0 && topicsQuery.isSuccess && (
              <span className="text-xs text-fg-muted">La materia non ha ancora argomenti.</span>
            )}
            {scoped && (
              <>
                <div className="flex flex-wrap gap-1.5">
                  {topicList.map((t) => {
                    const on = pickedTopics.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => togglePicked(t.id)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-[var(--radius-control)] border px-2.5 text-[13px] transition-colors duration-120 ${FOCUS} ${
                          on
                            ? 'border-accent bg-accent-subtle text-fg-primary'
                            : 'border-border-strong text-fg-secondary hover:text-fg-primary'
                        }`}
                      >
                        <span aria-hidden="true" className="font-mono text-[11px]">
                          {on ? '✓' : '+'}
                        </span>
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                <span className={`text-xs ${scopeMissing ? 'text-warn' : 'text-fg-secondary'}`}>
                  {scopeMissing
                    ? 'Scegli almeno un argomento per un piano parziale.'
                    : `${pickedTopics.length} di ${topicList.length} argomenti nel piano`}
                </span>
              </>
            )}
          </div>

          <label className={LABEL}>
            Note sull&apos;esame
            <span className="text-xs text-fg-muted">
              Le legge l&apos;AI: cosa copre, com&apos;è fatto, su cosa insiste il docente.
            </span>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              maxLength={2000}
              rows={3}
              placeholder="Es. Primo parziale: capitoli 1–4, scritto con 3 esercizi sugli integrali, niente formulario."
              className={TEXTAREA}
            />
          </label>
          <p className="-mt-2 text-xs text-fg-muted">
            {linkedExam ? (
              <>
                Restano salvate su <span className="text-fg-secondary">{linkedExam.title}</span>.
              </>
            ) : (
              'Collega un esame per salvarle.'
            )}
          </p>
        </Step>

        <Step
          n={2}
          id="piano-tempo"
          title="Quanto tempo hai"
          aside={
            <span className="text-[13px] text-fg-secondary">
              a settimana{' '}
              <span className="font-mono tabular-nums text-fg-primary">
                {formatMinutes(weekTotal)}
              </span>
            </span>
          }
        >
          <div className="overflow-x-auto">
            <div className="grid min-w-[560px] grid-cols-7 gap-2">
              {WEEKDAY_ORDER.map((i) => {
                const v = perWeekday[i] ?? 0;
                const day = WEEKDAYS[i]!;
                return (
                  <div
                    key={day.short}
                    className={`flex flex-col gap-2 rounded-lg border border-border px-2 py-2.5 ${v ? 'bg-bg-inset' : ''}`}
                  >
                    <span className="text-center text-xs font-medium text-fg-secondary">
                      {day.short}
                    </span>
                    <span
                      className={`text-center font-mono text-base tabular-nums ${v ? 'text-fg-primary' : 'text-fg-muted'}`}
                    >
                      {v ? formatMinutes(v) : 'riposo'}
                    </span>
                    <span aria-hidden="true" className="h-1 rounded-sm bg-border">
                      <span
                        className="block h-1 rounded-sm bg-accent"
                        style={{ width: `${(v / DAY_MAX) * 100}%` }}
                      />
                    </span>
                    <div className="grid grid-cols-2 gap-1">
                      <button
                        type="button"
                        aria-label={`Meno ${DAY_STEP} minuti ${day.long}`}
                        disabled={v === 0}
                        onClick={() => setDay(i, v - DAY_STEP)}
                        className={`h-8 rounded-[var(--radius-control)] border border-border-strong text-fg-primary hover:bg-bg-raised disabled:opacity-40 ${FOCUS}`}
                      >
                        −
                      </button>
                      <button
                        type="button"
                        aria-label={`Più ${DAY_STEP} minuti ${day.long}`}
                        disabled={v >= DAY_MAX}
                        onClick={() => setDay(i, v + DAY_STEP)}
                        className={`h-8 rounded-[var(--radius-control)] border border-border-strong text-fg-primary hover:bg-bg-raised disabled:opacity-40 ${FOCUS}`}
                      >
                        +
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-[13px] text-fg-secondary">Giorni non disponibili</span>
            <ul className="flex flex-wrap items-center gap-1.5">
              {[...blackoutDates].sort().map((d) => (
                <li
                  key={d}
                  className="inline-flex h-8 items-center gap-1 rounded-[var(--radius-control)] border border-border bg-bg-raised pl-2.5 pr-1 text-[13px] text-fg-primary"
                >
                  {shortDate(d)}
                  <button
                    type="button"
                    aria-label={`Togli ${shortDate(d)}`}
                    onClick={() => setBlackoutDates((prev) => prev.filter((x) => x !== d))}
                    className={`inline-flex size-6 items-center justify-center rounded text-fg-secondary hover:text-fg-primary ${FOCUS}`}
                  >
                    <svg
                      aria-hidden="true"
                      width="12"
                      height="12"
                      viewBox="0 0 20 20"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2"
                      strokeLinecap="round"
                    >
                      <path d="M5 5l10 10M15 5L5 15" />
                    </svg>
                  </button>
                </li>
              ))}
              {blackoutDates.length === 0 && <li className="text-[13px] text-fg-muted">Nessuno</li>}
            </ul>
            <div className="flex flex-wrap gap-2">
              <label className="flex-[0_1_200px]">
                <span className="sr-only">Data da escludere</span>
                <input
                  type="date"
                  value={newBlackout}
                  min={startDate}
                  max={targetDate || undefined}
                  onChange={(e) => setNewBlackout(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addBlackout();
                    }
                  }}
                  className={`${INPUT} h-9 text-[13px] [color-scheme:dark]`}
                />
              </label>
              <button
                type="button"
                onClick={addBlackout}
                disabled={!newBlackout}
                className={`${BTN_SECONDARY} h-9`}
              >
                Escludi giorno
              </button>
            </div>
          </div>
        </Step>

        <Step n={3} id="piano-metodo" title="Come vuoi studiare">
          <div className="flex flex-wrap gap-x-8 gap-y-4">
            <div className="flex flex-[1_1_300px] flex-col gap-2.5">
              <span className="text-[13px] text-fg-secondary">Intensità</span>
              <div role="radiogroup" aria-label="Intensità" className={`${SEGMENTED} grid-cols-3`}>
                {INTENSITY_ORDER.map((i) => (
                  <button
                    key={i}
                    type="button"
                    role="radio"
                    aria-checked={i === intensity}
                    onClick={() => setIntensity(i)}
                    className={`${segment(i === intensity)} h-10`}
                  >
                    {INTENSITY_INFO[i].label}
                  </button>
                ))}
              </div>
              <p className="text-[13px] text-fg-secondary">{info.capacity}</p>
            </div>
            <div className="flex flex-[1.4_1_340px] flex-col gap-2.5">
              <p className="font-medium text-fg-primary">{info.title}</p>
              <PhaseList
                method={info.sprint ? 'sprint' : 'standard'}
                label="Fasi di ogni lezione"
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-x-8 gap-y-4 border-t border-border pt-4">
            <div className="flex flex-[1_1_260px] flex-col gap-2">
              <span className="text-[13px] text-fg-secondary">Durata di una sessione</span>
              <div
                role="radiogroup"
                aria-label="Durata di una sessione"
                className={`${SEGMENTED} grid-cols-4`}
              >
                {SESSION_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === sessionLength}
                    onClick={() => setSessionLength(v)}
                    className={`${segment(v === sessionLength)} font-mono text-xs`}
                  >
                    {v} min
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-[1_1_260px] flex-col gap-2">
              <span className="text-[13px] text-fg-secondary">Simulazioni d&apos;esame</span>
              <div
                role="radiogroup"
                aria-label="Simulazioni d’esame"
                className={`${SEGMENTED} grid-cols-5`}
              >
                {SIMULATION_OPTIONS.map((v) => (
                  <button
                    key={v}
                    type="button"
                    role="radio"
                    aria-checked={v === simulationCount}
                    onClick={() => setSimulationCount(v)}
                    className={segment(v === simulationCount)}
                  >
                    {v === 'auto' ? 'Auto' : v}
                  </button>
                ))}
              </div>
              <span className="text-xs text-fg-muted">
                {simulationCount === 'auto'
                  ? 'Le decide il planner in base ai giorni che hai.'
                  : simulationCount === '0'
                    ? 'Nessuna simulazione.'
                    : `${simulationCount} × 90 min, a tempo.`}
              </span>
            </div>
          </div>
        </Step>
      </div>

      <aside
        aria-labelledby="piano-anteprima"
        className={`${CARD_BOX} flex min-w-0 flex-[1_1_320px] flex-col gap-4 p-5`}
      >
        <div className="flex items-center justify-between gap-2">
          <h3 id="piano-anteprima" className={SECTION_TITLE}>
            Anteprima
          </h3>
          <span className="text-xs text-fg-muted">gratis · senza AI</span>
        </div>

        {!previewReady && (
          <p className="rounded-lg border border-dashed border-border-strong p-4 text-[13px] text-fg-secondary">
            Scegli la data dell&apos;esame: qui vedi subito se il tempo basta, settimana per
            settimana.
          </p>
        )}
        {previewReady && previewQuery.isPending && (
          <div aria-hidden="true" className="flex flex-col gap-3">
            <div className="h-16 animate-pulse rounded-lg bg-bg-raised motion-reduce:animate-none" />
            <div className="h-24 animate-pulse rounded-lg bg-bg-raised motion-reduce:animate-none" />
          </div>
        )}
        {previewReady && previewQuery.isError && (
          <p role="alert" className="text-[13px] text-danger">
            Anteprima non disponibile: {(previewQuery.error as Error).message}
          </p>
        )}
        {previewReady && previewQuery.data && (
          <PreviewPanel
            preview={previewQuery.data}
            startDate={startDate}
            intensity={intensity}
            onSprint={() => setIntensity('sprint')}
            onMoreTime={() =>
              setPerWeekday((prev) => prev.map((v) => (v ? Math.min(DAY_MAX, v + 30) : 0)))
            }
            onScope={topicList.length > 0 && !scoped ? () => setScoped(true) : undefined}
          />
        )}

        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <button type="submit" disabled={!canGenerate} className={`${BTN_PRIMARY} h-11 text-sm`}>
            {generate.isPending
              ? 'Avvio la generazione…'
              : previewReady && previewQuery.data && !previewQuery.data.feasibility.feasible
                ? 'Genera comunque'
                : 'Genera piano'}
          </button>
          <span className="text-center text-xs text-fg-muted">
            {!previewReady
              ? 'Manca una data d’esame valida.'
              : scopeMissing
                ? 'Scegli almeno un argomento.'
                : 'Circa un minuto. Ricevi una bozza da approvare, il piano attuale non cambia.'}
          </span>
          {generate.isError && (
            <p role="alert" className="text-[13px] text-danger">
              {(generate.error as Error).message}
            </p>
          )}
        </div>
      </aside>
    </form>
  );
}

/** What the wizard tells you before it spends the AI call: is there enough time, week by week. */
function PreviewPanel({
  preview,
  startDate,
  intensity,
  onSprint,
  onMoreTime,
  onScope,
}: {
  preview: PlanPreviewDto;
  startDate: string;
  intensity: Intensity;
  onSprint: () => void;
  onMoreTime: () => void;
  onScope: (() => void) | undefined;
}) {
  const { feasibility } = preview;
  const peak = Math.max(1, ...preview.loadPerWeek.map((w) => Math.max(w.available, w.planned)));
  const fixes = [
    intensity !== 'sprint' && {
      label: 'Passa a Sprint',
      desc: 'Esercizi prima, solo la teoria che serve',
      run: onSprint,
    },
    {
      label: 'Aggiungi 30 min nei giorni di studio',
      desc: 'Su tutti i giorni che non sono riposo',
      run: onMoreTime,
    },
    onScope && {
      label: 'Scegli solo alcuni argomenti',
      desc: 'Un piano parziale, per un esame o un parziale',
      run: onScope,
    },
  ].filter((f): f is { label: string; desc: string; run: () => void } => !!f);

  return (
    <div data-testid="plan-preview" className="flex flex-col gap-4">
      <div
        role="status"
        className={`flex gap-3 rounded-lg border px-3.5 py-3 ${
          feasibility.feasible ? 'border-ok/35 bg-ok/5' : 'border-warn/40 bg-warn/5'
        }`}
      >
        <span
          aria-hidden="true"
          className={`inline-flex size-7 flex-none items-center justify-center rounded-[var(--radius-control)] bg-bg-base/40 ${feasibility.feasible ? 'text-ok' : 'text-warn'}`}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 20 20"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.6"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d={feasibility.feasible ? 'M4 10l4 4 8-8' : 'M10 4v7M10 14.5v.1'} />
          </svg>
        </span>
        <div className="flex flex-col gap-0.5">
          <strong className="text-sm font-semibold text-fg-primary">
            {feasibility.feasible
              ? 'Il tempo basta'
              : `Mancano circa ${formatMinutes(feasibility.shortfallMinutes)}`}
          </strong>
          <span className="text-[13px] text-fg-secondary">
            {feasibility.feasible
              ? `Servono ${formatMinutes(feasibility.requiredMinutes)} su ${formatMinutes(feasibility.availableMinutes)} disponibili.`
              : `Servono ${formatMinutes(feasibility.requiredMinutes)}, ne hai ${formatMinutes(feasibility.availableMinutes)}. Puoi generare lo stesso: il planner lascia fuori ciò che pesa meno.`}
          </span>
        </div>
      </div>

      <dl className="grid grid-cols-3 gap-2">
        {[
          ['Argomenti', preview.topicCount],
          ['Attività', preview.taskCount],
          ['Settimane', preview.loadPerWeek.length],
        ].map(([label, value]) => (
          <div
            key={label}
            className="flex flex-col gap-0.5 rounded-[var(--radius-control)] border border-border bg-bg-inset p-2.5"
          >
            <dt className="text-[11px] text-fg-secondary">{label}</dt>
            <dd className="font-mono text-base tabular-nums text-fg-primary">{value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-col gap-2.5">
        <span className="text-xs text-fg-secondary">
          Carico per settimana · serve / disponibile
        </span>
        <ul className="flex flex-col gap-2.5">
          {preview.loadPerWeek.map((w) => {
            const over = w.planned > w.available;
            const from = w.weekStart < startDate ? startDate : w.weekStart;
            return (
              <li key={w.weekStart} className="flex flex-col gap-1">
                <span className="flex justify-between gap-2 text-xs">
                  <span className="text-fg-secondary">
                    {dayMonth(from)} – {dayMonth(addDays(w.weekStart, 6))}
                  </span>
                  <span
                    className={`font-mono tabular-nums ${over ? 'text-danger' : 'text-fg-secondary'}`}
                  >
                    {formatMinutes(w.planned)} / {formatMinutes(w.available)}
                  </span>
                </span>
                <span className="relative block h-2 overflow-hidden rounded bg-border">
                  <span
                    className="absolute inset-y-0 left-0 bg-border-strong"
                    style={{ width: `${(w.available / peak) * 100}%` }}
                  />
                  <span
                    className={`absolute inset-y-0 left-0 ${over ? 'bg-danger' : 'bg-accent'}`}
                    style={{ width: `${(Math.min(w.planned, peak) / peak) * 100}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <p className="text-xs text-fg-muted">
        Stima dalle pagine, non ancora dall&apos;AI.
        {preview.busyMinutes > 0 &&
          ` ${formatMinutes(preview.busyMinutes)} già occupati da altri impegni.`}
        {preview.timeFactor.note &&
          ` Tempi corretti sui tuoi dati: ${preview.timeFactor.note} (×${preview.timeFactor.factor}, da ${preview.timeFactor.sampleCount} sessioni).`}
      </p>

      {!feasibility.feasible && (
        <div className="flex flex-col gap-2 border-t border-border pt-3.5">
          <span className="text-xs text-fg-secondary">Per farlo entrare</span>
          {fixes.map((f) => (
            <button
              key={f.label}
              type="button"
              onClick={f.run}
              className={`flex min-h-11 flex-col items-start rounded-[var(--radius-control)] border border-border-strong px-3 py-2 text-left transition-colors duration-120 hover:bg-bg-raised ${FOCUS}`}
            >
              <span className="text-[13px] font-medium text-fg-primary">{f.label}</span>
              <span className="text-xs text-fg-secondary">{f.desc}</span>
            </button>
          ))}
          {feasibility.strategies.length > 0 && (
            <ul className="mt-1 flex flex-col gap-1 text-xs text-fg-muted">
              {feasibility.strategies.map((st) => (
                <li key={st.id}>
                  <span className="text-fg-secondary">{st.label}:</span> {st.description}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
