import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SessionItemDto, SprintDto, TaskDto } from '@studyhub/contracts';
import { PhaseStepper } from '@/components/lesson/PhaseStepper';
import { PhaseNav } from '@/components/lesson/PhaseNav';
import { SprintExercisesStep } from '@/components/lesson/SprintExercisesStep';
import { SprintRetryStep } from '@/components/lesson/SprintRetryStep';
import { SprintTheoryStep, conceptsOfExercise } from '@/components/lesson/SprintTheoryStep';
import { closingGroups } from '@/components/SessionClosing';
import { taskMeta } from '@/components/plan-mobile/TaskRow';
import {
  SPRINT_LESSON_PHASES,
  SPRINT_NEXT_ACTION,
  allRated,
  conceptsWithoutBlock,
  failedExercises,
  initialSprintViewPhase,
  lessonFlowKind,
  previousSprintPhase,
  ratedCount,
  retrySet,
  settledCount,
  shouldPollSprint,
  sprintPhaseDone,
  sprintRecallSummary,
  sprintStepStatus,
  theoryIsEmpty,
  toSprintView,
  usesLessonFlow,
  type SprintProgress,
  type SprintView,
} from '@/lib/lessonClient';
import {
  canSwitchMethod,
  lessonMetaLabel,
  methodAnnouncement,
  methodErrorMessage,
  otherMethod,
  runMethodSwitch,
  switchMethodLabel,
  taskMethod,
} from '@/lib/taskMethod';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const noop = () => {};

function item(over: Partial<SessionItemDto>): SessionItemDto {
  return {
    id: id(1),
    kind: 'exercise',
    orderIndex: 0,
    title: 'Calcola il limite.',
    body: '',
    difficulty: null,
    citations: [],
    topicId: null,
    state: 'open',
    answer: null,
    feedback: null,
    linkedBlockIds: [],
    concepts: [],
    solutionSteps: [],
    solutionVisible: false,
    parentItemId: null,
    ...over,
  };
}

/** Three exercises with a retry each; `states` is the self-assessment of each exercise. */
function sprintDto(
  states: SessionItemDto['state'][],
  over: Partial<SprintDto> = {},
  retryState: SessionItemDto['state'] = 'open',
): SprintDto {
  const exercises = states.map((state, i) => ({
    ...item({
      id: id(i + 1),
      orderIndex: i,
      title: `Esercizio testo ${i + 1}`,
      state,
      solutionVisible: state !== 'open',
      solutionSteps: state !== 'open' ? [{ text: 'Passo uno', formula: 'x^2' }] : [],
      concepts: [`Concetto ${i + 1}`],
    }),
    retryId: id(10 + i),
  }));
  const retries = states.map((_, i) =>
    item({
      id: id(10 + i),
      kind: 'retry_exercise',
      orderIndex: i,
      title: `Riprova testo ${i + 1}`,
      parentItemId: id(i + 1),
      state: retryState,
    }),
  );
  const failed = exercises.filter((e) => e.state === 'wrong' || e.state === 'unknown');
  return {
    exercises,
    retries:
      failed.length > 0 ? failed.map((e) => retries[exercises.indexOf(e)]!) : retries.slice(0, 1),
    theory: {
      state: states.length > 0 && states.every((s) => s === 'correct') ? 'empty' : 'idle',
      concepts: failed.map((e) => ({
        title: e.concepts[0]!,
        exerciseIds: [e.id],
        blockId: null,
      })),
      error: null,
    },
    job: null,
    costEur: 0,
    ...over,
  };
}

const view = (...args: Parameters<typeof sprintDto>): SprintView =>
  toSprintView(sprintDto(...args));

function progress(over: Partial<SprintProgress> = {}): SprintProgress {
  return { furthest: 0, view: undefined, blocks: [], ended: false, ...over };
}

describe('usesLessonFlow for sprint lessons', () => {
  const base = { kind: 'lesson' as const };

  it('mounts the flow in every sprint phase and in the old "Studia"', () => {
    for (const phase of ['exercises', 'theory', 'retry', 'recall', 'understand'] as const) {
      expect(usesLessonFlow({ ...base, method: 'sprint', phase })).toBe(true);
    }
  });

  it('keeps the shell off for a sprint with no phase and for the other sprint-less phases', () => {
    expect(usesLessonFlow({ ...base, method: 'sprint', phase: null })).toBe(false);
    expect(usesLessonFlow({ ...base, method: 'sprint', phase: 'rework' })).toBe(false);
    expect(usesLessonFlow({ ...base, method: 'sprint', phase: 'apply' })).toBe(false);
  });

  it('leaves standard lessons and other kinds as they were', () => {
    expect(usesLessonFlow({ ...base, method: 'standard', phase: 'explore' })).toBe(true);
    expect(usesLessonFlow({ ...base, method: 'standard', phase: 'recall' })).toBe(true);
    expect(usesLessonFlow({ ...base, method: 'standard', phase: null })).toBe(false);
    expect(usesLessonFlow({ ...base, method: 'standard', phase: 'exercises' })).toBe(false);
    expect(usesLessonFlow({ kind: 'verify', method: 'sprint', phase: 'exercises' })).toBe(false);
  });

  it('tells the three flows apart', () => {
    expect(lessonFlowKind({ method: 'sprint', phase: 'exercises' })).toBe('sprint');
    expect(lessonFlowKind({ method: 'sprint', phase: 'recall' })).toBe('sprint');
    expect(lessonFlowKind({ method: 'sprint', phase: 'understand' })).toBe('legacy');
    expect(lessonFlowKind({ method: 'standard', phase: 'understand' })).toBe('standard');
    expect(lessonFlowKind(undefined)).toBe('legacy');
  });

  it('opens on the saved phase, "Esercizi" for a new one and "Ricorda" when over', () => {
    expect(initialSprintViewPhase({ status: 'active', phase: 'retry' })).toBe('retry');
    expect(initialSprintViewPhase({ status: 'active', phase: null })).toBe('exercises');
    expect(initialSprintViewPhase({ status: 'active', phase: 'understand' })).toBe('exercises');
    expect(initialSprintViewPhase({ status: 'ended', phase: 'theory' })).toBe('recall');
  });

  it('has four phases with their way on', () => {
    expect(SPRINT_LESSON_PHASES.map((p) => p.label)).toEqual([
      'Esercizi',
      'Teoria',
      'Riprova',
      'Ricorda',
    ]);
    expect(SPRINT_NEXT_ACTION.exercises).toEqual({
      label: 'Vediamo cosa ti manca →',
      to: 'theory',
    });
    expect(SPRINT_NEXT_ACTION.theory?.to).toBe('retry');
    expect(SPRINT_NEXT_ACTION.retry?.to).toBe('recall');
    expect(SPRINT_NEXT_ACTION.recall).toBeNull();
    expect(previousSprintPhase('exercises')).toBeNull();
    expect(previousSprintPhase('retry')?.id).toBe('theory');
  });
});

describe('sprint view and what follows from the self-assessment', () => {
  it('hides the solution until the server shows it', () => {
    const v = view(['open', 'unknown', 'correct']);
    expect(v.exercises[0]!.solution).toBeNull();
    expect(v.exercises[1]!.solution?.steps).toEqual([{ text: 'Passo uno', formula: 'x^2' }]);
    expect(v.exercises[1]!.selfAssessment).toBe('unknown');
    expect(v.exercises[0]!.selfAssessment).toBeNull();
    expect(v.exercises.map((e) => e.n)).toEqual([1, 2, 3]);
  });

  it('counts failed, rated and complete', () => {
    const v = view(['wrong', 'open', 'unknown']);
    expect(failedExercises(v).map((e) => e.n)).toEqual([1, 3]);
    expect(ratedCount(v)).toBe(2);
    expect(allRated(v)).toBe(false);
    expect(allRated(view(['correct', 'wrong', 'unknown']))).toBe(true);
  });

  it('shows the retries of the failed exercises, in order', () => {
    const v = view(['wrong', 'correct', 'unknown']);
    expect(retrySet(v).map((r) => r.question)).toEqual(['Riprova testo 1', 'Riprova testo 3']);
  });

  it('shows only the first retry when everything is right', () => {
    const v = view(['correct', 'correct', 'correct']);
    expect(retrySet(v)).toHaveLength(1);
    expect(retrySet(v)[0]!.question).toBe('Riprova testo 1');
  });

  it('shows no retry before anything is rated', () => {
    expect(retrySet(view(['open', 'open', 'open']))).toEqual([]);
  });

  it('has no theory to review when what was rated is all right', () => {
    expect(theoryIsEmpty(view(['correct', 'correct', 'correct']))).toBe(true);
    expect(theoryIsEmpty(view(['correct', 'open', 'open']))).toBe(true);
    expect(theoryIsEmpty(view(['correct', 'wrong', 'open']))).toBe(false);
    expect(theoryIsEmpty(view(['open', 'open', 'open']))).toBe(false);
  });

  it('lists the concepts that still have no block', () => {
    const dto = sprintDto(['wrong', 'wrong', 'correct']);
    dto.theory.concepts[0]!.blockId = id(99);
    expect(conceptsWithoutBlock(toSprintView(dto)).map((c) => c.title)).toEqual(['Concetto 2']);
  });

  it('counts the exercises put right: self-assessed right, or whose retry is no longer open', () => {
    expect(settledCount(view(['correct', 'wrong', 'unknown']))).toBe(1);
    const dto = sprintDto(['correct', 'wrong', 'unknown']);
    dto.retries[0]!.state = 'correct';
    expect(settledCount(toSprintView(dto))).toBe(2);
  });

  it('maps the job: succeeded is done, cancelled counts as failed', () => {
    const job = { id: id(50), status: 'succeeded' as const, error: null };
    expect(toSprintView(sprintDto([], { job })).job?.status).toBe('done');
    expect(toSprintView(sprintDto([], { job: { ...job, status: 'cancelled' } })).job?.status).toBe(
      'failed',
    );
    expect(toSprintView(sprintDto([])).job).toBeNull();
  });

  it('polls while the exercises or the theory are being written, never on a finished lesson', () => {
    const running = { id: id(50), status: 'running' as const, error: null };
    expect(shouldPollSprint(sprintDto([], { job: running }), true)).toBe(true);
    expect(shouldPollSprint(sprintDto([], { job: running }), false)).toBe(false);
    const generating = sprintDto(['wrong']);
    generating.theory.state = 'generating';
    expect(shouldPollSprint(generating, true)).toBe(true);
    expect(shouldPollSprint(sprintDto(['wrong']), true)).toBe(false);
    expect(shouldPollSprint(undefined, true)).toBe(false);
  });
});

describe('sprint steps and their state', () => {
  it('Esercizi is done once every exercise is rated', () => {
    expect(
      sprintPhaseDone('exercises', progress({ view: view(['correct', 'wrong', 'open']) })),
    ).toBe(false);
    expect(
      sprintPhaseDone('exercises', progress({ view: view(['correct', 'wrong', 'unknown']) })),
    ).toBe(true);
    expect(sprintPhaseDone('exercises', progress())).toBe(false);
  });

  it('Teoria is done when all is right, or when every linked block is done', () => {
    expect(
      sprintPhaseDone('theory', progress({ view: view(['correct', 'correct', 'open']) })),
    ).toBe(true);
    const dto = sprintDto(['wrong', 'correct', 'correct']);
    expect(sprintPhaseDone('theory', progress({ view: toSprintView(dto) }))).toBe(false);
    dto.theory.concepts[0]!.blockId = id(70);
    expect(
      sprintPhaseDone(
        'theory',
        progress({ view: toSprintView(dto), blocks: [{ id: id(70), state: 'open' }] }),
      ),
    ).toBe(false);
    expect(
      sprintPhaseDone(
        'theory',
        progress({ view: toSprintView(dto), blocks: [{ id: id(70), state: 'done' }] }),
      ),
    ).toBe(true);
  });

  it('Riprova is done when no retry of the set is open', () => {
    const open = view(['wrong', 'correct', 'correct']);
    expect(sprintPhaseDone('retry', progress({ view: open }))).toBe(false);
    const graded = toSprintView(sprintDto(['wrong', 'correct', 'correct'], {}, 'correct'));
    expect(sprintPhaseDone('retry', progress({ view: graded }))).toBe(true);
    expect(sprintPhaseDone('retry', progress({ view: view(['open', 'open', 'open']) }))).toBe(
      false,
    );
  });

  it('Ricorda is done when the session is over; earlier steps are done once passed', () => {
    expect(sprintPhaseDone('recall', progress({ ended: true }))).toBe(true);
    expect(sprintPhaseDone('recall', progress())).toBe(false);
    expect(sprintPhaseDone('exercises', progress({ furthest: 2 }))).toBe(true);
    expect(sprintPhaseDone('retry', progress({ furthest: 2 }))).toBe(false);
  });

  it('the current phase wins over done', () => {
    expect(sprintStepStatus('theory', 'theory', progress({ furthest: 3 }))).toBe('current');
    expect(sprintStepStatus('exercises', 'theory', progress({ furthest: 1 }))).toBe('done');
    expect(sprintStepStatus('retry', 'theory', progress())).toBe('todo');
  });

  it('summarises the lesson, leaving out what is zero', () => {
    expect(sprintRecallSummary(0, undefined)).toBe('Appena chiudi, qui trovi il riepilogo.');
    expect(sprintRecallSummary(0, view(['open', 'open', 'open']))).toBe(
      'Appena chiudi, qui trovi il riepilogo.',
    );
    expect(sprintRecallSummary(35 * 60000, view(['correct', 'wrong', 'unknown']))).toBe(
      '35 min di studio reale · 1 esercizi su 3 sistemati',
    );
    const dto = sprintDto(['correct', 'wrong', 'unknown']);
    dto.retries[0]!.state = 'correct';
    expect(sprintRecallSummary(35 * 60000, toSprintView(dto))).toBe(
      '35 min di studio reale · 2 esercizi su 3 sistemati · 1 rifatti giusti',
    );
  });

  it('renders a four-step stepper with its own label and current step', () => {
    const html = renderToStaticMarkup(
      createElement(PhaseStepper<'exercises' | 'theory' | 'retry' | 'recall'>, {
        current: 'exercises',
        phases: SPRINT_LESSON_PHASES,
        statusOf: (p) => (p === 'exercises' ? 'current' : 'todo'),
        ariaLabel: 'Fasi della lezione sprint',
        onSelect: noop,
      }),
    );
    expect(html).toContain('aria-label="Fasi della lezione sprint"');
    expect(html.match(/<button/g)).toHaveLength(4);
    expect(html.match(/aria-current="step"/g)).toHaveLength(1);
    expect(html).toContain('Esercizi');
    expect(html).toContain('grid-cols-[repeat(4,');
    expect(html).not.toContain('Rielabora');
  });

  it('renders the sprint way on from the exercises', () => {
    const html = renderToStaticMarkup(
      createElement(PhaseNav<'exercises' | 'theory' | 'retry' | 'recall'>, {
        prev: previousSprintPhase('theory'),
        next: SPRINT_NEXT_ACTION.theory,
        onGo: noop,
      }),
    );
    expect(html).toContain('Indietro: Esercizi');
    expect(html).toContain('Riprova su esercizi simili →');
  });
});

describe('sprint step views', () => {
  const exercisesProps = {
    loading: false,
    loadError: null,
    active: true,
    hasDocuments: true,
    generating: false,
    generateError: null,
    ratingId: null,
    revealingId: null,
    actionError: null,
    onGenerate: noop,
    asked: { current: false },
    onRate: noop,
    onReveal: noop,
    onOpenCitation: noop,
  };

  it('lists the exercises with the three-way assessment, "Giusto" and "Sbagliato" disabled until the solution shows', () => {
    const html = renderToStaticMarkup(
      createElement(SprintExercisesStep, {
        ...exercisesProps,
        view: view(['open', 'open', 'open']),
      }),
    );
    expect(html).toContain('Esercizio 1');
    expect(html).toContain('Esercizio 3');
    expect(html).toContain('Mostra la soluzione');
    expect(html).toContain('role="radiogroup"');
    expect(html.match(/role="radio"/g)).toHaveLength(9);
    // 2 of the 3 radios of each exercise are disabled while the solution is hidden.
    expect(html.match(/aria-disabled="true"/g)).toHaveLength(6);
    expect(html).toContain('Guarda la soluzione per dire se era giusto.');
    expect(html).toContain('Non so da dove partire');
    expect(html).toContain('0 di 3 segnati');
    expect(html).toContain('Segna almeno un esercizio');
  });

  it('shows the steps and the concepts once rated, with the choice checked', () => {
    const html = renderToStaticMarkup(
      createElement(SprintExercisesStep, {
        ...exercisesProps,
        view: view(['unknown', 'open', 'open']),
      }),
    );
    expect(html).toContain('Passo uno');
    expect(html).toContain('Concetti: Concetto 1');
    expect(html).toContain('aria-checked="true"');
    expect(html).toContain('1 di 3 segnati');
  });

  it('shows the preparing state while the job runs, and the error with "Riprova" when it failed', () => {
    const running = toSprintView(
      sprintDto([], { job: { id: id(50), status: 'running', error: null } }),
    );
    expect(
      renderToStaticMarkup(
        createElement(SprintExercisesStep, { ...exercisesProps, view: running }),
      ),
    ).toContain('Sto preparando 3 esercizi dal materiale…');
    const failed = toSprintView(
      sprintDto([], { job: { id: id(50), status: 'failed', error: 'modello non disponibile' } }),
    );
    const html = renderToStaticMarkup(
      createElement(SprintExercisesStep, { ...exercisesProps, view: failed }),
    );
    expect(html).toContain('role="alert"');
    expect(html).toContain('modello non disponibile');
    expect(html).toContain('Riprova');
  });

  it('shows the budget message without "Riprova"', () => {
    const failed = toSprintView(
      sprintDto([], { job: { id: id(50), status: 'failed', error: 'Budget AI esaurito' } }),
    );
    const html = renderToStaticMarkup(
      createElement(SprintExercisesStep, { ...exercisesProps, view: failed }),
    );
    expect(html).toContain('budget AI di oggi');
    expect(html).not.toContain('>Riprova<');
  });

  it('says there is no document when there is none', () => {
    const html = renderToStaticMarkup(
      createElement(SprintExercisesStep, {
        ...exercisesProps,
        hasDocuments: false,
        view: view([]),
      }),
    );
    expect(html).toContain('Nessun documento in questa sessione');
  });

  const lessonStub = {
    data: { blocks: [], blockCount: null, job: null, costEur: 0 },
    check: { isPending: false, isError: false },
    regenerate: { isPending: false, isError: false },
    job: null,
    inFlight: false,
  } as never;
  const theoryProps = {
    loading: false,
    loadError: null,
    lesson: lessonStub,
    active: true,
    current: 0,
    focusNonce: 0,
    generating: false,
    generateError: null,
    onGenerate: noop,
    asked: { current: '' },
    onSelect: noop,
    onOpenCitation: noop,
    onPrefill: noop,
    onGo: noop,
  };

  it('says there is no theory to review when everything is right, with the way to the retry', () => {
    const html = renderToStaticMarkup(
      createElement(SprintTheoryStep, {
        ...theoryProps,
        view: view(['correct', 'correct', 'correct']),
      }),
    );
    expect(html).toContain('Nessuna teoria da rivedere');
    expect(html).toContain('Riprova su esercizi simili →');
    expect(html).not.toContain('aria-label="Teoria per esercizio"');
  });

  it('asks to rate the exercises first when none is rated', () => {
    const html = renderToStaticMarkup(
      createElement(SprintTheoryStep, { ...theoryProps, view: view(['open', 'open', 'open']) }),
    );
    expect(html).toContain('Segna come ti è andata negli esercizi');
    expect(html).toContain('Vai agli esercizi');
  });

  it('groups the theory by exercise: right ones have none, the failed ones show their concepts', () => {
    const html = renderToStaticMarkup(
      createElement(SprintTheoryStep, { ...theoryProps, view: view(['correct', 'wrong', 'open']) }),
    );
    expect(html).toContain('aria-label="Teoria per esercizio"');
    expect(html).toContain('Nessuna teoria da recuperare.');
    expect(html).toContain('Ti sei bloccato su: Concetto 2.');
    expect(html).toContain('non ancora segnato');
    expect(html).toContain('In preparazione…');
    expect(html).toContain('Sto preparando la teoria che ti serve…');
  });

  it('gives a concept shared by two exercises to the first one', () => {
    const dto = sprintDto(['wrong', 'wrong', 'correct']);
    dto.theory.concepts = [{ title: 'Comune', exerciseIds: [id(1), id(2)], blockId: id(70) }];
    const v = toSprintView(dto);
    expect(conceptsOfExercise({ id: id(1) }, v)[0]!.owner).toBe(true);
    expect(conceptsOfExercise({ id: id(2) }, v)[0]!.owner).toBe(false);
    expect(conceptsOfExercise({ id: id(3) }, v)).toEqual([]);
  });

  const retryProps = {
    loading: false,
    loadError: null,
    active: true,
    gradingId: null,
    gradeError: null,
    onPatch: noop,
    onGrade: noop,
    onOpenCitation: noop,
    onGoTheory: noop,
    onGo: noop,
  };

  it('shows one retry per failed exercise, similar to its exercise', () => {
    const dto = sprintDto(['wrong', 'correct', 'unknown']);
    const html = renderToStaticMarkup(
      createElement(SprintRetryStep, {
        ...retryProps,
        view: toSprintView(dto),
        items: dto.retries,
      }),
    );
    expect(html).toContain('Riprova 1');
    expect(html).toContain('simile all&#x27;esercizio 1');
    expect(html).toContain('Riprova 2');
    expect(html).toContain('simile all&#x27;esercizio 3');
    expect(html).not.toContain('Riprova 3');
    expect(html).toContain('Esercizi simili a quelli sbagliati');
    expect(html).toContain('>Correggi<');
  });

  it('shows a single retry when everything was right', () => {
    const dto = sprintDto(['correct', 'correct', 'correct']);
    const html = renderToStaticMarkup(
      createElement(SprintRetryStep, {
        ...retryProps,
        view: toSprintView(dto),
        items: dto.retries,
      }),
    );
    expect(html).toContain('Era tutto giusto');
    expect(html.match(/La tua risposta, riprova/g)).toHaveLength(1);
  });

  it('asks to rate first when nothing is rated', () => {
    const dto = sprintDto(['open', 'open', 'open']);
    const html = renderToStaticMarkup(
      createElement(SprintRetryStep, {
        ...retryProps,
        view: toSprintView(dto),
        items: dto.retries,
      }),
    );
    expect(html).toContain('Segna prima come è andata negli esercizi');
  });
});

describe('switching the method of a lesson in the plan', () => {
  function task(over: Partial<TaskDto>): TaskDto {
    return {
      id: id(1),
      planId: id(2),
      taskKey: 'k',
      date: '2026-02-20',
      kind: 'lesson',
      topicKey: null,
      topicId: null,
      minutes: 50,
      title: 'Limiti',
      description: '',
      payload: { action: 'lesson' } as TaskDto['payload'],
      pinned: false,
      origin: 'planner',
      status: 'todo',
      flashcardCount: 0,
      ...over,
    };
  }

  it('reads the method, standard when the plan does not say', () => {
    expect(taskMethod(task({}))).toBe('standard');
    expect(
      taskMethod(task({ payload: { action: 'lesson', method: 'sprint' } as TaskDto['payload'] })),
    ).toBe('sprint');
    expect(otherMethod('standard')).toBe('sprint');
    expect(switchMethodLabel('standard')).toBe('Passa a sprint');
    expect(switchMethodLabel('sprint')).toBe('Passa a standard');
  });

  it('offers the switch only on an open lesson', () => {
    expect(canSwitchMethod(task({ status: 'todo' }))).toBe(true);
    expect(canSwitchMethod(task({ status: 'proposed' }))).toBe(true);
    for (const status of ['doing', 'done', 'skipped', 'moved'] as const) {
      expect(canSwitchMethod(task({ status }))).toBe(false);
    }
    expect(canSwitchMethod(task({ kind: 'read' }))).toBe(false);
    expect(canSwitchMethod(task({ kind: 'verify' }))).toBe(false);
  });

  it('labels the lesson with its method and minutes, and announces the switch', () => {
    expect(lessonMetaLabel(task({}))).toBe('Lezione · Standard · 50 min');
    expect(
      lessonMetaLabel(
        task({
          minutes: 35,
          payload: { action: 'lesson', method: 'sprint' } as TaskDto['payload'],
        }),
      ),
    ).toBe('Lezione · Sprint · 35 min');
    expect(methodAnnouncement('sprint', 35)).toBe('Lezione passata a sprint: 35 min.');
    expect(methodAnnouncement('standard', 50)).toBe('Lezione passata a standard: 50 min.');
  });

  it('shows the server refusal as it is and prefixes any other error', () => {
    expect(methodErrorMessage('La lezione è già iniziata.')).toBe('La lezione è già iniziata.');
    expect(methodErrorMessage('Rete assente')).toBe(
      'Non sono riuscito a cambiare il metodo: Rete assente',
    );
  });

  it('the mobile meta ends with "sprint" only for sprint lessons', () => {
    expect(
      taskMeta(
        task({
          minutes: 35,
          payload: { action: 'lesson', method: 'sprint' } as TaskDto['payload'],
        }),
      ),
    ).toBe('35 min · sprint');
    expect(taskMeta(task({ minutes: 50 }))).toBe('50 min');
    expect(
      taskMeta(
        task({
          kind: 'read',
          minutes: 20,
          payload: { action: 'read', method: 'sprint' } as TaskDto['payload'],
        }),
      ),
    ).toBe('20 min');
  });
});

describe('closing and polling guards', () => {
  it('counts "non so da dove partire" as an exercise not done, and as answered', () => {
    const items = [
      { kind: 'exercise', state: 'correct' },
      { kind: 'exercise', state: 'wrong' },
      { kind: 'exercise', state: 'unknown' },
      { kind: 'exercise', state: 'open' },
      { kind: 'retry_exercise', state: 'wrong' },
      { kind: 'key_point', state: 'done' },
    ];
    const g = closingGroups(items);
    expect(g.wrongItems).toHaveLength(2);
    expect(g.answered).toHaveLength(3);
    expect(g.right).toBe(1);
    expect(g.keyPointItems).toHaveLength(1);
  });

  it('stops polling on failed, ready and empty theory, on a failed job, and when over', () => {
    const base = sprintDto(['wrong']);
    for (const state of ['failed', 'ready', 'empty', 'idle'] as const) {
      expect(shouldPollSprint({ ...base, theory: { ...base.theory, state } }, true)).toBe(false);
    }
    const failedJob = { id: id(50), status: 'failed' as const, error: 'x' };
    expect(shouldPollSprint({ ...base, job: failedJob }, true)).toBe(false);
    const queued = { id: id(50), status: 'queued' as const, error: null };
    expect(shouldPollSprint({ ...base, job: queued }, false)).toBe(false);
    expect(
      shouldPollSprint({ ...base, theory: { ...base.theory, state: 'generating' } }, false),
    ).toBe(false);
  });

  it('keeps the server refusal when the method cannot change, and announces the minutes otherwise', async () => {
    const refused = await runMethodSwitch(
      () => Promise.reject(new Error('La lezione è già iniziata.')),
      'sprint',
    );
    expect(refused).toEqual({ note: '', error: 'La lezione è già iniziata.' });
    const done = await runMethodSwitch(() => Promise.resolve({ minutes: 35 }), 'sprint');
    expect(done).toEqual({ note: 'Lezione passata a sprint: 35 min.', error: null });
  });
});
