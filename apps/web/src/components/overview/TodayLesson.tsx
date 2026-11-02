'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQueryClient } from '@tanstack/react-query';
import type { DocumentDto, TaskDto } from '@studyhub/contracts';
import { StartTaskButton } from '../StartTaskButton';
import { TabCard } from '../subject-tabs/TabCard';
import { TabEmptyState } from '../subject-tabs/TabEmptyState';
import { BTN_GHOST, BTN_PRIMARY, BTN_SECONDARY, CARD_BOX, LINK_TEXT } from '../subject-tabs/styles';
import { formatExamDuration } from '../subject-tabs/format';
import {
  canSwitchMethod,
  otherMethod,
  runMethodSwitch,
  switchMethodLabel,
  taskMethod,
} from '@/lib/taskMethod';
import { patchMethod, postStatus } from '../subject-mobile/todayActions';
import { MethodBadge } from '../plan/MethodBadge';
import { PhaseList } from '../plan/PhaseList';
import { KIND_LABELS, stripPartSuffix } from '../plan/planModel';
import { formatDayLong, lessonMeta, plural, type TodayModel } from './model';

const KIND_WORD: Partial<Record<TaskDto['kind'], string>> = {
  lesson: 'la lezione',
  verify: 'la verifica',
};

function startLabel(task: TaskDto): string {
  if (task.kind === 'flashcards') return 'Vai al piano';
  const word = KIND_WORD[task.kind] ?? 'la sessione';
  return `${task.status === 'doing' ? 'Riprendi' : 'Inizia'} ${word}`;
}

function summaryLabel(model: TodayModel): string {
  if (model.state === 'rest') return 'Oggi è un giorno di riposo';
  if (model.state === 'next') return 'Oggi non è prevista nessuna lezione';
  if (model.state !== 'lesson' || model.summary.lessons === 0) return '';
  return `${plural(model.summary.lessons, 'lezione', 'lezioni')} · circa ${formatExamDuration(model.summary.minutes)}`;
}

/** Hero of the Panoramica: the lesson to do today, with the Standard/Sprint switch and "Inizia". */
export function TodayLesson({
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

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['daily-tasks', slug] }),
      queryClient.invalidateQueries({ queryKey: ['plans', slug] }),
      queryClient.invalidateQueries({ queryKey: ['plan-drift', slug] }),
    ]);

  if (
    model.state === 'no-plan' ||
    model.state === 'draft' ||
    model.state === 'done' ||
    model.state === 'idle'
  ) {
    return (
      <section
        data-testid="lesson-today"
        aria-labelledby="oggi"
        className="flex min-w-0 flex-col gap-5"
      >
        <h2 id="oggi" className="sr-only">
          Lezione di oggi
        </h2>
        {model.state === 'no-plan' && (
          <TabEmptyState
            title="Nessun piano di studio"
            text="Genera un piano e qui trovi la lezione di oggi, con le fasi e il tempo che serve."
            action={
              <Link href={`/materie/${slug}/piano`} className={BTN_PRIMARY}>
                Genera il piano
              </Link>
            }
          />
        )}
        {model.state === 'draft' && (
          <TabEmptyState
            title="Il piano è ancora in bozza"
            text="Confermalo per trovare qui la lezione di oggi."
            action={
              <Link href={`/materie/${slug}/piano`} className={BTN_SECONDARY}>
                Rivedi la bozza
              </Link>
            }
          />
        )}
        {model.state === 'done' && (
          <TabEmptyState
            title="Hai finito tutte le lezioni del piano"
            text="Restano le verifiche e il ripasso delle flashcard."
          />
        )}
        {model.state === 'idle' && (
          <TabEmptyState
            title="Oggi nessuna lezione da fare"
            text="Ci sono altre attività aperte: le trovi qui sotto o nel piano."
            action={
              <Link href={`/materie/${slug}/piano`} className={BTN_SECONDARY}>
                Apri il piano
              </Link>
            }
          />
        )}
        {model.others.length > 0 && (
          <div className={`${CARD_BOX} p-5`}>
            <OtherActivities slug={slug} tasks={model.others} />
          </div>
        )}
      </section>
    );
  }

  const picked = model.candidates.find((t) => t.id === pickedId) ?? model.candidates[0]!;
  const others = model.state === 'lesson' ? model.candidates.filter((t) => t.id !== picked.id) : [];
  const method = taskMethod(picked);
  const isLesson = picked.kind === 'lesson';
  const upcoming = model.state !== 'lesson';

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

  const right = summaryLabel(model);

  return (
    <TabCard aria-label="Lezione di oggi" className="gap-4 p-6">
      <div data-testid="lesson-today" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2
            id="oggi"
            className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary"
          >
            Lezione di oggi
          </h2>
          {right && <span className="text-[13px] text-fg-secondary">{right}</span>}
        </div>

        <div className="flex flex-col gap-2.5">
          {upcoming && model.nextDate && (
            <p className="text-xs text-fg-secondary">
              Prossima lezione · {formatDayLong(model.nextDate)}
            </p>
          )}
          {isLesson && (
            <div className="flex flex-wrap items-center gap-2">
              <MethodBadge method={method} />
              <span className="text-[13px] text-fg-secondary">{lessonMeta(picked, documents)}</span>
            </div>
          )}
          {!isLesson && (
            <p className="text-[13px] text-fg-secondary">
              {picked.kind === 'verify' ? 'Verifica' : 'Flashcard'} · circa {picked.minutes} min
            </p>
          )}
          <p
            ref={titleRef}
            tabIndex={-1}
            id="oggi-titolo"
            className="text-[26px] font-semibold leading-tight tracking-[-0.02em] text-fg-primary outline-none"
          >
            {isLesson ? stripPartSuffix(picked.title) : picked.title}
          </p>
        </div>

        {isLesson && <PhaseList method={method} />}

        <div className="flex flex-wrap items-center gap-2.5">
          <StartTaskButton
            subjectSlug={slug}
            taskId={picked.id}
            kind={picked.kind}
            label={startLabel(picked)}
            className={`${BTN_PRIMARY} h-11 px-5`}
          />
          {canSwitchMethod(picked) && (
            <button
              type="button"
              data-testid="lesson-today-switch"
              onClick={switchMethod}
              disabled={busy !== null}
              aria-busy={busy === 'method'}
              aria-label={`${switchMethodLabel(method)}: ${picked.title}`}
              className={BTN_SECONDARY}
            >
              {busy === 'method' ? 'Cambio…' : switchMethodLabel(method)}
            </button>
          )}
          {isLesson && picked.status === 'doing' && (
            <p className="text-xs text-fg-muted">
              La lezione è iniziata: il metodo non si cambia più.
            </p>
          )}
          {!upcoming && (
            <>
              <button
                type="button"
                onClick={() => mark('done')}
                disabled={busy !== null}
                className={BTN_GHOST}
              >
                Fatta
              </button>
              <button
                type="button"
                onClick={() => mark('skipped')}
                disabled={busy !== null}
                className={BTN_GHOST}
              >
                Salta
              </button>
            </>
          )}
          <p role="status" aria-live="polite" className="sr-only">
            {note}
          </p>
          {error && (
            <p role="alert" className="basis-full text-xs text-danger">
              {error}
            </p>
          )}
        </div>

        {others.length > 0 && (
          <div className="flex flex-col gap-2.5 border-t border-border pt-4">
            <h3 className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary">
              Altre lezioni di oggi · tocca per partire da quella
            </h3>
            <ul className="flex flex-col gap-1.5">
              {others.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    onClick={() => choose(task)}
                    aria-label={`Parti da questa: ${task.title}, ${task.minutes} min`}
                    className="flex min-h-12 w-full items-center justify-between gap-3 rounded-[var(--radius-control)] border border-border px-3.5 py-2 text-left transition-colors duration-120 hover:bg-bg-raised outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className="truncate text-sm font-medium text-fg-primary">
                        {task.kind === 'lesson' ? stripPartSuffix(task.title) : task.title}
                      </span>
                      <span className="text-xs text-fg-secondary">
                        {task.kind === 'lesson'
                          ? [
                              task.payload.part
                                ? `parte ${task.payload.part.n} di ${task.payload.part.of}`
                                : null,
                              `${task.minutes} min`,
                            ]
                              .filter(Boolean)
                              .join(' · ')
                          : `${task.kind === 'verify' ? 'Verifica' : 'Flashcard'} · ${task.minutes} min`}
                      </span>
                    </span>
                    {task.kind === 'lesson' && <MethodBadge method={taskMethod(task)} size="sm" />}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {model.others.length > 0 && (
          <div className="border-t border-border pt-4">
            <OtherActivities slug={slug} tasks={model.others} />
          </div>
        )}
        {upcoming && (
          <Link href={`/materie/${slug}/piano`} className={LINK_TEXT}>
            Apri il piano
          </Link>
        )}
      </div>
    </TabCard>
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
    <div className="flex flex-col gap-2.5">
      <h3 className="text-xs font-medium uppercase tracking-[0.05em] text-fg-secondary">
        Altre attività di oggi
      </h3>
      <ul className="flex flex-col gap-1.5">
        {tasks.map((task) => (
          <li
            key={task.id}
            className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-[var(--radius-control)] border border-border px-3.5 py-2"
          >
            <span className="flex min-w-0 flex-1 basis-48 flex-col">
              <span className="text-sm font-medium text-fg-primary">{task.title}</span>
              <span className="text-xs text-fg-secondary">
                {KIND_LABELS[task.kind]} · {task.minutes} min
              </span>
            </span>
            <StartTaskButton
              subjectSlug={slug}
              taskId={task.id}
              kind={task.kind}
              label={task.status === 'doing' ? 'Riprendi' : 'Inizia'}
              aria-label={`${task.status === 'doing' ? 'Riprendi' : 'Inizia'}: ${task.title}`}
              className={`${BTN_SECONDARY} h-9`}
            />
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => mark(task, 'done')}
              aria-label={`Fatta: ${task.title}`}
              className={BTN_GHOST}
            >
              Fatta
            </button>
            <button
              type="button"
              disabled={busyId !== null}
              onClick={() => mark(task, 'skipped')}
              aria-label={`Salta: ${task.title}`}
              className={BTN_GHOST}
            >
              Salta
            </button>
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
