'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { DocumentDto, TaskDto } from '@studyhub/contracts';
import { LESSON_PHASES, SPRINT_LESSON_PHASES } from '@/lib/lessonClient';
import {
  canSwitchMethod,
  methodLabel,
  otherMethod,
  runMethodSwitch,
  switchMethodLabel,
  taskMethod,
} from '@/lib/taskMethod';
import { StartTaskButton } from '../StartTaskButton';
import { MethodBadge } from '../plan/MethodBadge';
import { KIND_LABELS, stripPartSuffix } from '../plan/planModel';
import { formatDayLong, lessonMeta, type TodayModel } from '../overview/model';
import { cardClass } from '../simulation-mobile/styles';
import { patchMethod, postStatus } from './todayActions';

const ACTION =
  'flex h-11 items-center justify-center rounded-[var(--radius-control)] border border-border-strong px-2 text-[13px] disabled:opacity-60';
const LINK_ROW = 'flex min-h-11 items-center text-[13px] text-fg-secondary underline';
const SMALL_TITLE = 'text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary';
const GRID_COLS: Record<number, string> = { 1: 'grid-cols-1', 2: 'grid-cols-2', 3: 'grid-cols-3' };

function startLabel(task: TaskDto): string {
  if (task.kind === 'flashcards') return 'Vai al piano';
  const resume = task.status === 'doing';
  if (task.kind === 'lesson') return resume ? 'Riprendi la lezione' : 'Inizia la lezione';
  if (task.kind === 'verify') return resume ? 'Riprendi la verifica' : 'Inizia la verifica';
  return resume ? 'Riprendi la sessione' : 'Inizia la sessione';
}

function otherMeta(task: TaskDto): string {
  if (task.kind === 'lesson') {
    const part = task.payload.part
      ? `parte ${task.payload.part.n} di ${task.payload.part.of}`
      : null;
    return [part, `${task.minutes} min`].filter(Boolean).join(' · ');
  }
  return `${task.kind === 'verify' ? 'Verifica' : 'Flashcard'} · ${task.minutes} min`;
}

function Empty({
  title,
  text,
  link,
}: {
  title: string;
  text?: string;
  link?: { href: string; label: string; primary?: boolean };
}) {
  return (
    <div className="flex flex-col gap-1.5 rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-4">
      <p className="text-base font-semibold">{title}</p>
      {text && <p className="text-[13px] text-fg-secondary">{text}</p>}
      {link && (
        <Link
          href={link.href}
          className={
            link.primary
              ? 'mt-2 flex h-12 items-center justify-center rounded-[var(--radius-control)] bg-accent text-[15px] font-semibold text-bg-base'
              : LINK_ROW
          }
        >
          {link.label}
        </Link>
      )}
    </div>
  );
}

/** Hero of the mobile Panoramica: the lesson of today, method switch, Inizia / Fatta / Salta. */
export function MobileTodayLesson({
  slug,
  model,
  documents,
}: {
  slug: string;
  model: TodayModel;
  documents: DocumentDto[];
}) {
  const queryClient = useQueryClient();
  const [pickedId, setPickedId] = useState<string | null>(null);
  const [busy, setBusy] = useState<'method' | 'status' | null>(null);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const titleRef = useRef<HTMLParagraphElement>(null);
  const planHref = `/materie/${slug}/piano`;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['daily-tasks', slug] }),
      queryClient.invalidateQueries({ queryKey: ['plans', slug] }),
      queryClient.invalidateQueries({ queryKey: ['plan-drift', slug] }),
    ]);

  const noCandidate =
    model.state === 'no-plan' ||
    model.state === 'draft' ||
    model.state === 'done' ||
    model.state === 'idle';

  if (noCandidate) {
    return (
      <section
        data-testid="lesson-today"
        aria-labelledby="m-oggi"
        className="flex min-w-0 flex-col gap-3"
      >
        <h2 id="m-oggi" className="sr-only">
          Lezione di oggi
        </h2>
        {model.state === 'no-plan' && (
          <Empty
            title="Nessun piano di studio"
            text="Genera un piano e qui trovi la lezione di oggi, con le fasi e il tempo che serve."
            link={{ href: planHref, label: 'Genera il piano', primary: true }}
          />
        )}
        {model.state === 'draft' && (
          <Empty
            title="Il piano è ancora in bozza"
            text="Confermalo per trovare qui la lezione di oggi."
            link={{ href: planHref, label: 'Rivedi la bozza' }}
          />
        )}
        {model.state === 'done' && (
          <Empty
            title="Hai finito tutte le lezioni del piano"
            text="Restano le verifiche e il ripasso delle flashcard."
          />
        )}
        {model.state === 'idle' && (
          <Empty
            title="Oggi nessuna lezione da fare"
            text="Ci sono altre attività aperte: le trovi qui sotto o nel piano."
            link={{ href: planHref, label: 'Apri il piano' }}
          />
        )}
        {model.others.length > 0 && <OtherActivities slug={slug} tasks={model.others} />}
      </section>
    );
  }

  const picked = model.candidates.find((t) => t.id === pickedId) ?? model.candidates[0]!;
  const others = model.state === 'lesson' ? model.candidates.filter((t) => t.id !== picked.id) : [];
  const method = taskMethod(picked);
  const isLesson = picked.kind === 'lesson';
  const upcoming = model.state !== 'lesson';
  const showSwitch = canSwitchMethod(picked);
  const started = isLesson && picked.status === 'doing';
  const phases = method === 'sprint' ? SPRINT_LESSON_PHASES : LESSON_PHASES;
  const phaseNames = phases.map((p) => p.label);

  const choose = (task: TaskDto) => {
    setPickedId(task.id);
    setNote(`Lezione scelta: ${stripPartSuffix(task.title)}`);
    setError(null);
    queueMicrotask(() => titleRef.current?.focus());
  };

  const switchMethod = async () => {
    const next = otherMethod(method);
    setBusy('method');
    setError(null);
    setNote('');
    const result = await runMethodSwitch(() => patchMethod(slug, picked.id, next), next);
    if (result.error) setError(result.error);
    else setNote(result.note);
    // Also after a refusal (409): the refetch shows the lesson as started.
    await refresh();
    setBusy(null);
  };

  const mark = async (status: 'done' | 'skipped') => {
    setBusy('status');
    setError(null);
    setNote('');
    try {
      await postStatus(slug, picked.id, status);
      setNote(status === 'done' ? 'Lezione segnata come fatta.' : 'Lezione saltata.');
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
    setBusy(null);
  };

  const columns = (showSwitch ? 1 : 0) + (upcoming ? 0 : 2);

  return (
    <section
      data-testid="lesson-today"
      aria-labelledby="m-oggi"
      className={`${cardClass} flex min-w-0 flex-col gap-3 p-[18px]`}
    >
      <div className="flex items-center justify-between gap-2">
        <h2 id="m-oggi" className={SMALL_TITLE}>
          Lezione di oggi
        </h2>
        {isLesson && <MethodBadge method={method} />}
      </div>
      {upcoming && model.nextDate && (
        <p className="text-xs text-fg-secondary">
          Prossima lezione · {formatDayLong(model.nextDate)}
        </p>
      )}
      {upcoming && (
        <p className="text-[13px] text-fg-secondary">
          {model.state === 'rest'
            ? 'Oggi è un giorno di riposo'
            : 'Oggi non è prevista nessuna lezione'}
        </p>
      )}
      <p
        ref={titleRef}
        tabIndex={-1}
        id="m-oggi-titolo"
        className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-fg-primary outline-none"
      >
        {isLesson ? stripPartSuffix(picked.title) : picked.title}
      </p>
      <p className="text-[13px] text-fg-secondary">
        {isLesson
          ? lessonMeta(picked, documents)
          : `${picked.kind === 'verify' ? 'Verifica' : KIND_LABELS[picked.kind]} · circa ${picked.minutes} min`}
      </p>
      {isLesson && (
        <p
          aria-label={`Fasi della lezione: ${phaseNames.join(', ')}`}
          className="text-[13px] text-fg-secondary"
        >
          {phaseNames.join(' → ')}
        </p>
      )}
      <StartTaskButton
        subjectSlug={slug}
        taskId={picked.id}
        kind={picked.kind}
        label={startLabel(picked)}
        className="flex h-12 w-full items-center justify-center rounded-[var(--radius-control)] bg-accent text-[15px] font-semibold text-bg-base disabled:opacity-60"
      />
      {columns > 0 && (
        <div className={`grid gap-1.5 ${GRID_COLS[columns]}`}>
          {showSwitch && (
            <button
              type="button"
              data-testid="lesson-today-switch"
              onClick={switchMethod}
              disabled={busy !== null}
              aria-busy={busy === 'method'}
              aria-label={`${switchMethodLabel(method)}: ${picked.title}`}
              className={ACTION}
            >
              {busy === 'method' ? 'Cambio…' : methodLabel(otherMethod(method))}
            </button>
          )}
          {!upcoming && (
            <>
              <button
                type="button"
                onClick={() => mark('done')}
                disabled={busy !== null}
                className={ACTION}
              >
                Fatta
              </button>
              <button
                type="button"
                onClick={() => mark('skipped')}
                disabled={busy !== null}
                className={`${ACTION} text-fg-secondary`}
              >
                Salta
              </button>
            </>
          )}
        </div>
      )}
      {started && (
        <p className="text-xs text-fg-secondary">
          La lezione è iniziata: il metodo non si cambia più.
        </p>
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {note}
      </p>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}

      {others.length > 0 && (
        <div className="flex flex-col gap-2 border-t border-border pt-2">
          <h3 className="text-xs text-fg-secondary">Altre di oggi · tocca per partire da quella</h3>
          <ul className="flex flex-col gap-1.5">
            {others.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  onClick={() => choose(task)}
                  aria-label={`Parti da questa: ${task.title}, ${task.minutes} min`}
                  className="flex min-h-[52px] w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-left"
                >
                  <span className="flex min-w-0 flex-col">
                    <span className="line-clamp-2 text-sm font-medium text-fg-primary">
                      {task.kind === 'lesson' ? stripPartSuffix(task.title) : task.title}
                    </span>
                    <span className="text-xs text-fg-secondary">{otherMeta(task)}</span>
                  </span>
                  {task.kind === 'lesson' && (
                    <span
                      className={`shrink-0 text-xs ${taskMethod(task) === 'sprint' ? 'text-info' : 'text-accent-hover'}`}
                    >
                      {methodLabel(taskMethod(task))}
                    </span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {model.others.length > 0 && (
        <div className="border-t border-border pt-2">
          <OtherActivities slug={slug} tasks={model.others} />
        </div>
      )}
      {upcoming && (
        <Link href={planHref} className={LINK_ROW}>
          Apri il piano
        </Link>
      )}
    </section>
  );
}

/** Open tasks of today that are not lessons (reading, schemas, drills, simulations…). */
function OtherActivities({ slug, tasks }: { slug: string; tasks: TaskDto[] }) {
  const queryClient = useQueryClient();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mark = async (task: TaskDto, status: 'done' | 'skipped') => {
    setBusyId(task.id);
    setError(null);
    try {
      await postStatus(slug, task.id, status);
      await queryClient.invalidateQueries({ queryKey: ['daily-tasks', slug] });
      await queryClient.invalidateQueries({ queryKey: ['plans', slug] });
    } catch (err) {
      setError((err as Error).message);
    }
    setBusyId(null);
  };

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-xs text-fg-secondary">Altre attività di oggi</h3>
      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-col gap-2 rounded-[var(--radius-control)] border border-border bg-bg-surface px-3 py-2"
          >
            <span className="flex min-w-0 flex-col">
              <span className="text-sm font-medium text-fg-primary">{task.title}</span>
              <span className="text-xs text-fg-secondary">
                {KIND_LABELS[task.kind]} · {task.minutes} min
              </span>
            </span>
            <span className="grid grid-cols-3 gap-1.5">
              <StartTaskButton
                subjectSlug={slug}
                taskId={task.id}
                kind={task.kind}
                label={task.status === 'doing' ? 'Riprendi' : 'Inizia'}
                aria-label={`${task.status === 'doing' ? 'Riprendi' : 'Inizia'}: ${task.title}`}
                className={`${ACTION} w-full`}
              />
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => mark(task, 'done')}
                aria-label={`Fatta: ${task.title}`}
                className={ACTION}
              >
                Fatta
              </button>
              <button
                type="button"
                disabled={busyId !== null}
                onClick={() => mark(task, 'skipped')}
                aria-label={`Salta: ${task.title}`}
                className={`${ACTION} text-fg-secondary`}
              >
                Salta
              </button>
            </span>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
