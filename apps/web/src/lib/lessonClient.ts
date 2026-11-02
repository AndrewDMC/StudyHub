import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckLessonBlockResponse,
  ExplanationDto,
  ExplanationStateDto,
  LessonBlockDto,
  LessonDto,
  LessonHint,
  LessonPhase,
  SessionItemCitationDto,
  SessionItemDto,
  SolutionStep,
  SprintDto,
  StartSprintTheoryResponse,
  StudySessionDto,
  SubmitExplanationRequest,
  UpdateSessionItemRequest,
} from '@studyhub/contracts';
import { patchSession } from '@/lib/sessionApi';

/**
 * Mirror of `STANDARD_PHASES` from `@studyhub/contracts`: a value import of the contracts would drag
 * server-only code into the client bundle, so the list is repeated here and checked against the type.
 */
export const STANDARD_PHASES = ['explore', 'understand', 'rework', 'apply', 'recall'] as const;
export type StandardPhase = (typeof STANDARD_PHASES)[number] & LessonPhase;

const base = (slug: string, sessionId: string) =>
  `/api/subjects/${slug}/sessions/${sessionId}/lesson`;

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

async function post<T>(url: string, body: unknown, fallback: string): Promise<T> {
  return readJson<T>(
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    fallback,
  );
}

export function lessonKey(slug: string, sessionId: string) {
  return ['lesson', slug, sessionId] as const;
}

// ---- pure helpers (tested in test/lessonClient.test.ts) ----

/** The daily AI budget is used up (HTTP 429 or a job error that says so): no "Riprova", it would fail again. */
export function isBudgetMessage(message: string | null | undefined): boolean {
  return !!message && /budget/i.test(message);
}

export type LessonInterruption = 'not_understood' | 'another_example' | 'simpler' | 'why';

export const INTERRUPTIONS: { kind: LessonInterruption; label: string }[] = [
  { kind: 'not_understood', label: 'Non ho capito questo passaggio' },
  { kind: 'another_example', label: 'Fammi un altro esempio' },
  { kind: 'simpler', label: 'Spiegalo più semplice' },
  { kind: 'why', label: 'Perché?' },
];

/** The question the tutor box is pre-filled with: it cites the current block and is never sent by itself. */
export function interruptionText(
  kind: LessonInterruption,
  block: Pick<LessonBlockDto, 'orderIndex' | 'title'>,
): string {
  const where = `Nel blocco ${block.orderIndex + 1} («${block.title}»)`;
  switch (kind) {
    case 'not_understood':
      return `${where} non ho capito questo passaggio: `;
    case 'another_example':
      return `${where} fammi un altro esempio.`;
    case 'simpler':
      return `${where} spiegalo in modo più semplice.`;
    case 'why':
      return `${where} perché vale quello che dice la spiegazione?`;
  }
}

/** The block to open on arrival: the saved one if it exists, else the first one still to do. */
export function initialBlockIndex(blocks: LessonBlockDto[], savedIndex: number): number {
  if (blocks.length === 0) return 0;
  const saved = blocks.find((b) => b.orderIndex === savedIndex && b.state !== 'locked');
  if (saved) return saved.orderIndex;
  const open = blocks.find((b) => b.state === 'open');
  if (open) return open.orderIndex;
  return blocks[blocks.length - 1]!.orderIndex;
}

/** `$$…$$` for a LaTeX formula, whatever delimiters the model left on it. */
export function toDisplayMath(latex: string): string {
  return `$$\n${stripMathDelimiters(latex)}\n$$`;
}
export function toInlineMath(latex: string): string {
  return `$${stripMathDelimiters(latex)}$`;
}
function stripMathDelimiters(latex: string): string {
  return latex
    .trim()
    .replace(/^\$\$?/, '')
    .replace(/\$\$?$/, '')
    .trim();
}

/** Pick the citation the formula comes from: the one whose quote contains it, else the first. */
export function formulaSource(block: Pick<LessonBlockDto, 'formula' | 'citations'>) {
  if (block.citations.length === 0) return null;
  const f = block.formula ? stripMathDelimiters(block.formula).replace(/\s+/g, '') : '';
  const hit = f ? block.citations.find((c) => c.quote.replace(/\s+/g, '').includes(f)) : undefined;
  return hit ?? block.citations[0]!;
}

/** Merge a block into the cached list, keeping it ordered. */
export function upsertBlock(blocks: LessonBlockDto[], next: LessonBlockDto): LessonBlockDto[] {
  const rest = blocks.filter((b) => b.orderIndex !== next.orderIndex);
  return [...rest, next].sort((a, b) => a.orderIndex - b.orderIndex);
}

/**
 * Poll while a job is queued/running, or while the block right after the last finished one has not
 * appeared yet (generated one ahead) and its job did not fail. Never on a finished session.
 */
export function shouldPollLesson(
  data: Pick<LessonDto, 'blocks' | 'blockCount' | 'job'> | undefined,
  active: boolean,
): boolean {
  if (!data || !active) return false;
  const status = data.job?.status;
  if (status === 'queued' || status === 'running') return true;
  if (status === 'failed' || status === 'cancelled') return false;
  if (data.blockCount === null) return false;
  const done = data.blocks.filter((b) => b.state === 'done').map((b) => b.orderIndex);
  if (done.length === 0) return false;
  const next = Math.max(...done) + 1;
  return next < data.blockCount && !data.blocks.some((b) => b.orderIndex === next);
}

// ---- phases of the standard lesson ----

export const LESSON_PHASES: { id: StandardPhase; label: string; sub: string }[] = [
  { id: 'explore', label: 'Esplora', sub: 'Struttura e domande' },
  { id: 'understand', label: 'Studia', sub: 'Lezione guidata' },
  { id: 'rework', label: 'Rielabora', sub: 'Spiegalo o schema' },
  { id: 'apply', label: 'Applica', sub: 'Esercizi' },
  { id: 'recall', label: 'Ricorda', sub: 'Flashcard e ripassi' },
];

export function isStandardPhase(phase: LessonPhase | null | undefined): phase is StandardPhase {
  return !!phase && (STANDARD_PHASES as readonly string[]).includes(phase);
}

/**
 * Sessions that open the lesson shell: a standard lesson in any of its phases, a sprint lesson in
 * any of its phases, and an older sprint lesson (created before the sprint phases) only in "Studia":
 * that one gets the shell without stepper.
 */
export function usesLessonFlow(
  session: Pick<StudySessionDto, 'kind' | 'method' | 'phase'>,
): boolean {
  if (session.kind !== 'lesson') return false;
  if (session.method === 'sprint')
    return isSprintPhase(session.phase) || session.phase === 'understand';
  return isStandardPhase(session.phase);
}

/** Position of a phase in the stepper; -1 when it is not a standard one. */
export function phaseIndex(phase: LessonPhase | null | undefined): number {
  return phase ? (STANDARD_PHASES as readonly string[]).indexOf(phase) : -1;
}

/** The phase to open on arrival: the saved one; a finished session opens on "Ricorda" (the closing). */
export function initialViewPhase(
  session: Pick<StudySessionDto, 'status' | 'phase'>,
): StandardPhase {
  if (session.status === 'ended') return 'recall';
  return isStandardPhase(session.phase) ? session.phase : 'explore';
}

/** Label and target of the "next" button of each step (none after the last one). */
export const NEXT_ACTION: Record<StandardPhase, { label: string; to: StandardPhase } | null> = {
  explore: { label: 'Inizia a studiare →', to: 'understand' },
  understand: { label: 'Passa a Rielabora →', to: 'rework' },
  rework: { label: 'Passa agli esercizi →', to: 'apply' },
  apply: { label: 'Ho finito · chiudi la lezione →', to: 'recall' },
  recall: null,
};

export function previousPhase(phase: StandardPhase): (typeof LESSON_PHASES)[number] | null {
  return LESSON_PHASES[phaseIndex(phase) - 1] ?? null;
}

/** What the stepper needs to know to tell "fatta" from "da fare" besides how far the student went. */
export type PhaseProgress = {
  furthest: number;
  blocks: Pick<LessonBlockDto, 'state'>[];
  blockCount: number | null;
  explanationGraded: boolean;
  exercisesAnswered: number;
  ended: boolean;
};

export type StepStatus = 'done' | 'current' | 'todo';

export function phaseDone(phase: StandardPhase, p: PhaseProgress): boolean {
  if (phaseIndex(phase) < p.furthest) return true;
  switch (phase) {
    case 'explore':
      return p.furthest >= 1;
    case 'understand':
      return (
        p.blockCount !== null &&
        p.blocks.length >= p.blockCount &&
        p.blocks.every((b) => b.state === 'done')
      );
    case 'rework':
      return p.explanationGraded;
    case 'apply':
      return p.exercisesAnswered > 0;
    case 'recall':
      return p.ended;
  }
}

/** The current phase wins over "done". */
export function stepStatus(
  phase: StandardPhase,
  current: StandardPhase,
  p: PhaseProgress,
): StepStatus {
  if (phase === current) return 'current';
  return phaseDone(phase, p) ? 'done' : 'todo';
}

const furthestKey = (sessionId: string) => `lesson-furthest:${sessionId}`;

/** The furthest phase index seen on this device (a comfort: storage may fail); the saved phase is the floor. */
export function readFurthest(
  sessionId: string,
  savedPhase: LessonPhase | null | undefined,
  phases: readonly string[] = STANDARD_PHASES,
): number {
  const fromServer = Math.max(savedPhase ? phases.indexOf(savedPhase) : -1, 0);
  try {
    const raw = window.localStorage.getItem(furthestKey(sessionId));
    const n = raw === null ? NaN : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < phases.length) return Math.max(n, fromServer);
  } catch {
    /* private window or blocked storage */
  }
  return fromServer;
}

export function writeFurthest(sessionId: string, index: number): void {
  try {
    window.localStorage.setItem(furthestKey(sessionId), String(index));
  } catch {
    /* ignore */
  }
}

// ---- phases of the sprint lesson ----

/** Mirror of `SPRINT_PHASES` from `@studyhub/contracts` (see `STANDARD_PHASES` above). */
export const SPRINT_PHASES = ['exercises', 'theory', 'retry', 'recall'] as const;
export type SprintPhase = (typeof SPRINT_PHASES)[number] & LessonPhase;

export const SPRINT_LESSON_PHASES: { id: SprintPhase; label: string; sub: string }[] = [
  { id: 'exercises', label: 'Esercizi', sub: 'Prova subito' },
  { id: 'theory', label: 'Teoria', sub: 'Solo quella che serve' },
  { id: 'retry', label: 'Riprova', sub: 'Esercizi simili' },
  { id: 'recall', label: 'Ricorda', sub: 'Formule e verifiche' },
];

export function isSprintPhase(phase: LessonPhase | null | undefined): phase is SprintPhase {
  return !!phase && (SPRINT_PHASES as readonly string[]).includes(phase);
}

/** Position of a phase in the sprint stepper; -1 when it is not a sprint one. */
export function sprintPhaseIndex(phase: LessonPhase | null | undefined): number {
  return phase ? (SPRINT_PHASES as readonly string[]).indexOf(phase) : -1;
}

/** Which phase list a lesson session follows: sprint phases, standard ones, or none (older sprint, no phase). */
export type LessonFlowKind = 'standard' | 'sprint' | 'legacy';

export function lessonFlowKind(
  session: Pick<StudySessionDto, 'method' | 'phase'> | undefined,
): LessonFlowKind {
  if (!session) return 'legacy';
  if (session.method === 'sprint') return isSprintPhase(session.phase) ? 'sprint' : 'legacy';
  return 'standard';
}

/** The phase to open on arrival: the saved one, else "Esercizi"; a finished session opens on "Ricorda". */
export function initialSprintViewPhase(
  session: Pick<StudySessionDto, 'status' | 'phase'>,
): SprintPhase {
  if (session.status === 'ended') return 'recall';
  return isSprintPhase(session.phase) ? session.phase : 'exercises';
}

export const SPRINT_NEXT_ACTION: Record<SprintPhase, { label: string; to: SprintPhase } | null> = {
  exercises: { label: 'Vediamo cosa ti manca →', to: 'theory' },
  theory: { label: 'Riprova su esercizi simili →', to: 'retry' },
  retry: { label: 'Ho finito · chiudi la lezione →', to: 'recall' },
  recall: null,
};

export function previousSprintPhase(
  phase: SprintPhase,
): (typeof SPRINT_LESSON_PHASES)[number] | null {
  return SPRINT_LESSON_PHASES[sprintPhaseIndex(phase) - 1] ?? null;
}

// ---- sprint view model: the only place that knows the shape of `GET .../sprint` ----

export type SelfAssessment = 'correct' | 'wrong' | 'unknown';

export type SprintSolution = { steps: SolutionStep[]; citations: SessionItemCitationDto[] };

export type SprintExerciseView = {
  id: string;
  /** 1-based position. */
  n: number;
  question: string;
  /** "Tema del 18 luglio · 9 punti" when the backend knows it (it does not yet). */
  origin: string | null;
  /** `null` = not visible yet: the student has not self-assessed or asked for it. */
  solution: SprintSolution | null;
  concepts: string[];
  selfAssessment: SelfAssessment | null;
  linkedBlockIds: string[];
  retryId: string | null;
};

export type SprintRetryView = {
  id: string;
  forExerciseId: string | null;
  question: string;
  solution: SprintSolution | null;
  answer: string | null;
  feedback: SessionItemDto['feedback'];
  state: 'open' | 'correct' | 'wrong';
};

export type SprintConceptView = { title: string; exerciseIds: string[]; blockId: string | null };

export type SprintView = {
  exercises: SprintExerciseView[];
  retries: SprintRetryView[];
  theory: {
    state: SprintDto['theory']['state'];
    concepts: SprintConceptView[];
    error: string | null;
  };
  job: { status: 'queued' | 'running' | 'failed' | 'done'; error: string | null } | null;
  costEur: number;
};

function solutionOf(item: SessionItemDto): SprintSolution | null {
  if (!item.solutionVisible) return null;
  const steps =
    item.solutionSteps.length > 0 ? item.solutionSteps : item.body ? [{ text: item.body }] : [];
  return { steps, citations: item.citations };
}

function assessmentOf(state: SessionItemDto['state']): SelfAssessment | null {
  return state === 'correct' || state === 'wrong' || state === 'unknown' ? state : null;
}

export function toSprintView(dto: SprintDto): SprintView {
  const job = dto.job;
  return {
    exercises: dto.exercises.map((e, i) => ({
      id: e.id,
      n: i + 1,
      question: e.title,
      origin: null,
      solution: solutionOf(e),
      concepts: e.concepts,
      selfAssessment: assessmentOf(e.state),
      linkedBlockIds: e.linkedBlockIds,
      retryId: e.retryId,
    })),
    retries: dto.retries.map((r) => ({
      id: r.id,
      forExerciseId: r.parentItemId,
      question: r.title,
      solution: solutionOf(r),
      answer: r.answer,
      feedback: r.feedback,
      state: r.state === 'correct' ? 'correct' : r.state === 'wrong' ? 'wrong' : 'open',
    })),
    theory: {
      state: dto.theory.state,
      concepts: dto.theory.concepts,
      error: dto.theory.error,
    },
    job: job
      ? {
          status:
            job.status === 'succeeded'
              ? 'done'
              : job.status === 'cancelled'
                ? 'failed'
                : job.status,
          error: job.error,
        }
      : null,
    costEur: dto.costEur,
  };
}

/** Exercises marked wrong or "non so da dove partire". */
export function failedExercises(view: Pick<SprintView, 'exercises'>): SprintExerciseView[] {
  return view.exercises.filter(
    (e) => e.selfAssessment === 'wrong' || e.selfAssessment === 'unknown',
  );
}

export function ratedCount(view: Pick<SprintView, 'exercises'>): number {
  return view.exercises.filter((e) => e.selfAssessment !== null).length;
}

export function allRated(view: Pick<SprintView, 'exercises'>): boolean {
  return view.exercises.length > 0 && ratedCount(view) === view.exercises.length;
}

/** Something rated and nothing to review: "Nessuna teoria da rivedere". */
export function theoryIsEmpty(view: Pick<SprintView, 'exercises'>): boolean {
  return ratedCount(view) > 0 && failedExercises(view).length === 0;
}

/** Concepts of the failed exercises whose block has not been written yet. */
export function conceptsWithoutBlock(view: Pick<SprintView, 'theory'>): SprintConceptView[] {
  return view.theory.concepts.filter((c) => c.blockId === null);
}

/**
 * The retries to do: those of the failed exercises, in the order of the exercises; when everything
 * was right, only the first one; before anything is rated, none.
 */
export function retrySet(view: Pick<SprintView, 'exercises' | 'retries'>): SprintRetryView[] {
  if (ratedCount(view) === 0) return [];
  const failed = failedExercises(view);
  if (failed.length === 0) return view.retries.slice(0, 1);
  const byParent = new Map(view.retries.map((r) => [r.forExerciseId, r]));
  return failed.flatMap((e) => {
    const retry = byParent.get(e.id);
    return retry ? [retry] : [];
  });
}

/** "Sistemati": exercises right at once, plus failed ones whose retry is no longer open. */
export function settledCount(view: Pick<SprintView, 'exercises' | 'retries'>): number {
  const byParent = new Map(view.retries.map((r) => [r.forExerciseId, r]));
  return view.exercises.filter((e) => {
    if (e.selfAssessment === 'correct') return true;
    if (e.selfAssessment === null) return false;
    const retry = byParent.get(e.id);
    return !!retry && retry.state !== 'open';
  }).length;
}

/** What the sprint stepper needs besides how far the student went. */
export type SprintProgress = {
  furthest: number;
  view: SprintView | undefined;
  blocks: Pick<LessonBlockDto, 'id' | 'state'>[];
  ended: boolean;
};

export function sprintPhaseDone(phase: SprintPhase, p: SprintProgress): boolean {
  if (sprintPhaseIndex(phase) < p.furthest) return true;
  const view = p.view;
  switch (phase) {
    case 'exercises':
      return !!view && allRated(view);
    case 'theory': {
      if (!view) return false;
      if (theoryIsEmpty(view)) return true;
      const ids = view.theory.concepts.map((c) => c.blockId);
      if (ids.length === 0 || ids.some((id) => id === null)) return false;
      const state = new Map(p.blocks.map((b) => [b.id, b.state]));
      return ids.every((id) => state.get(id!) === 'done');
    }
    case 'retry': {
      if (!view) return false;
      const set = retrySet(view);
      return set.length > 0 && set.every((r) => r.state !== 'open');
    }
    case 'recall':
      return p.ended;
  }
}

/** The current phase wins over "done". */
export function sprintStepStatus(
  phase: SprintPhase,
  current: SprintPhase,
  p: SprintProgress,
): StepStatus {
  if (phase === current) return 'current';
  return sprintPhaseDone(phase, p) ? 'done' : 'todo';
}

/** Poll while the exercises or the theory blocks are being written. Never on a finished session. */
export function shouldPollSprint(
  data: Pick<SprintDto, 'job' | 'theory'> | undefined,
  active: boolean,
): boolean {
  if (!data || !active) return false;
  const status = data.job?.status;
  return status === 'queued' || status === 'running' || data.theory.state === 'generating';
}

/** The line under "Ricorda" in a sprint lesson: only the pieces that are not zero. */
export function sprintRecallSummary(
  activeMs: number,
  view: Pick<SprintView, 'exercises' | 'retries'> | undefined,
): string {
  const parts: string[] = [];
  const min = Math.round(activeMs / 60000);
  if (min > 0) parts.push(`${min} min di studio reale`);
  if (view && view.exercises.length > 0) {
    const settled = settledCount(view);
    if (settled > 0) parts.push(`${settled} esercizi su ${view.exercises.length} sistemati`);
    const redone = view.retries.filter((r) => r.state === 'correct').length;
    if (redone > 0) parts.push(`${redone} rifatti giusti`);
  }
  return parts.length > 0 ? parts.join(' · ') : 'Appena chiudi, qui trovi il riepilogo.';
}

// ---- Esplora ----

/** The guide questions of a lesson, in order. The briefing GET returns every kind of item. */
export function guideQuestionsOf(items: SessionItemDto[]): SessionItemDto[] {
  return items
    .filter((i) => i.kind === 'guide_question')
    .sort((a, b) => a.orderIndex - b.orderIndex);
}

/** "p. 3–7", "p. 4", "p. 1–2, 9"; empty without ranges. */
export function formatPageRanges(ranges: { pageFrom: number; pageTo: number }[]): string {
  if (ranges.length === 0) return '';
  return `p. ${ranges
    .map((r) => (r.pageFrom === r.pageTo ? `${r.pageFrom}` : `${r.pageFrom}–${r.pageTo}`))
    .join(', ')}`;
}

// ---- Rielabora ----

export const MIN_EXPLANATION_CHARS = 20;

export type ExplanationUiState =
  'empty' | 'pending' | 'done' | 'budget' | 'failed' | 'nofeedback' | 'ended';

/** Which state of the "Rielabora" step applies (spec §4.2); the order of the checks matters. */
export function explanationUiState(
  state: ExplanationStateDto | undefined,
  opts: { active: boolean; submitError?: string | null },
): ExplanationUiState {
  const latest = state?.latest ?? null;
  const job = state?.job ?? null;
  if (!opts.active) return 'ended';
  if (job?.status === 'queued' || job?.status === 'running') return 'pending';
  if (opts.submitError) return isBudgetMessage(opts.submitError) ? 'budget' : 'failed';
  if (job?.status === 'failed') return isBudgetMessage(job.error) ? 'budget' : 'failed';
  if (!latest) return 'empty';
  return latest.feedback ? 'done' : 'nofeedback';
}

/** "Confronta" is enabled with enough text, and not for the text that was already compared. */
export function canSubmitExplanation(
  text: string,
  latest: Pick<ExplanationDto, 'text'> | null,
  opts: { busy: boolean; active: boolean },
): boolean {
  if (!opts.active || opts.busy) return false;
  const t = text.trim();
  if (t.length < MIN_EXPLANATION_CHARS) return false;
  return !latest || t !== latest.text.trim();
}

// ---- data ----

/**
 * The guided lesson: the blocks, the generation job and the mutations. Polls while a job is running
 * or a block that must exist (up to `blockCount`) is still missing. The first block is requested
 * on its own the first time the lesson is opened (the POST is idempotent).
 */
export function useLesson({
  slug,
  sessionId,
  active,
  autoStart = true,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  /** false in a sprint lesson: its blocks are asked for by the exercises, never block 0 on its own. */
  autoStart?: boolean;
}) {
  const queryClient = useQueryClient();
  const key = lessonKey(slug, sessionId);

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      readJson<LessonDto>(await fetch(base(slug, sessionId)), 'Impossibile caricare la lezione'),
    refetchInterval: (q) => (shouldPollLesson(q.state.data, active) ? 3000 : false),
  });
  const data = query.data;

  const start = useMutation({
    mutationFn: (opts: { model?: string; force?: boolean } = {}) =>
      post<{ jobId: string | null }>(base(slug, sessionId), opts, 'Impossibile avviare la lezione'),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  // Opening the lesson asks for block 0 by itself, once.
  const autoStarted = useRef(false);
  useEffect(() => {
    if (!autoStart || autoStarted.current || !active || !data) return;
    if (data.blocks.length === 0 && !data.job) {
      autoStarted.current = true;
      start.mutate({});
    }
  }, [autoStart, active, data]);

  const check = useMutation({
    mutationFn: ({ index, answer }: { index: number; answer: string }) =>
      post<CheckLessonBlockResponse>(
        `${base(slug, sessionId)}/blocks/${index}/check`,
        { answer },
        'Impossibile controllare la risposta',
      ),
    onSuccess: (res) => {
      queryClient.setQueryData<LessonDto>(key, (prev) => {
        if (!prev) return prev;
        let blocks = upsertBlock(prev.blocks, res.block);
        if (res.nextBlock) blocks = upsertBlock(blocks, res.nextBlock);
        return { ...prev, blocks };
      });
    },
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const regenerate = useMutation({
    mutationFn: ({ index, hint, model }: { index: number; hint?: LessonHint; model?: string }) =>
      post<{ jobId: string }>(
        `${base(slug, sessionId)}/blocks/${index}/regenerate`,
        { ...(hint ? { hint } : {}), ...(model ? { model } : {}) },
        'Impossibile riscrivere il blocco',
      ),
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const job = data?.job ?? null;
  const inFlight = job?.status === 'queued' || job?.status === 'running';
  return { query, data, start, check, regenerate, job, inFlight };
}

const explanationKey = (slug: string, sessionId: string) =>
  ['explanation', slug, sessionId] as const;

/** Save the phase the student is in; the cached session follows at once and is rolled back on failure. */
export function useLessonPhase({ slug, sessionId }: { slug: string; sessionId: string }) {
  const queryClient = useQueryClient();
  const key = ['studySession', slug, sessionId];
  return useMutation({
    // One save at a time, in click order: the last click is the one that stays.
    scope: { id: `lesson-phase-${sessionId}` },
    mutationFn: (phase: LessonPhase) => patchSession(slug, sessionId, { phase }),
    onMutate: (phase) => {
      const previous = queryClient.getQueryData<StudySessionDto>(key)?.phase ?? null;
      queryClient.setQueryData<StudySessionDto>(key, (prev) => (prev ? { ...prev, phase } : prev));
      return { previous };
    },
    onError: (_err, _phase, ctx) => {
      queryClient.setQueryData<StudySessionDto>(key, (prev) =>
        prev ? { ...prev, phase: ctx?.previous ?? null } : prev,
      );
    },
  });
}

/** The explanation of "Rielabora": the last one with its comparison, and the job that writes it. */
export function useExplanation({
  slug,
  sessionId,
  active,
  enabled = true,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  /** false in a sprint lesson, which has no "Rielabora". */
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const key = explanationKey(slug, sessionId);
  const url = `/api/subjects/${slug}/sessions/${sessionId}/explanation`;

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      readJson<ExplanationStateDto>(await fetch(url), 'Impossibile caricare la spiegazione'),
    enabled,
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return active && (status === 'queued' || status === 'running') ? 2000 : false;
    },
  });
  const submit = useMutation({
    mutationFn: (body: SubmitExplanationRequest) =>
      post<{ itemId: string; jobId: string }>(url, body, 'Impossibile inviare la spiegazione'),
    onSettled: () => {
      queryClient.invalidateQueries({ queryKey: key });
      queryClient.invalidateQueries({ queryKey: ['sessionBriefing', slug, sessionId] });
    },
  });

  const latest = query.data?.latest ?? null;
  const job = query.data?.job ?? null;
  const inFlight = job?.status === 'queued' || job?.status === 'running';
  return { query, latest, job, inFlight, submit };
}

// ---- sprint lesson data ----

export const sprintKey = (slug: string, sessionId: string) => ['sprint', slug, sessionId] as const;

const sprintBase = (slug: string, sessionId: string) =>
  `/api/subjects/${slug}/sessions/${sessionId}/sprint`;

async function patchItem(
  slug: string,
  sessionId: string,
  itemId: string,
  patch: UpdateSessionItemRequest,
): Promise<SessionItemDto> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  return (await readJson<{ item: SessionItemDto }>(res, 'Salvataggio non riuscito')).item;
}

async function postGrade(slug: string, sessionId: string, itemId: string): Promise<SessionItemDto> {
  const res = await fetch(`/api/subjects/${slug}/sessions/${sessionId}/items/${itemId}/grade`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return (await readJson<{ item: SessionItemDto }>(res, 'Correzione non riuscita')).item;
}

/** Put a returned item into the cached sprint, whether it is an exercise (keeps its `retryId`) or a retry. */
export function mergeSprintItem(prev: SprintDto, item: SessionItemDto): SprintDto {
  return {
    ...prev,
    exercises: prev.exercises.map((e) => (e.id === item.id ? { ...e, ...item } : e)),
    retries: prev.retries.map((r) => (r.id === item.id ? item : r)),
  };
}

/**
 * The sprint lesson: exercises, the retries to do, the theory concepts and the generation job, as the
 * `SprintView` the components read, plus the mutations. Polls while something is being written.
 */
export function useSprint({
  slug,
  sessionId,
  active,
  enabled = true,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const key = sprintKey(slug, sessionId);
  const url = sprintBase(slug, sessionId);

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () => readJson<SprintDto>(await fetch(url), 'Impossibile caricare la lezione'),
    refetchInterval: (q) => (shouldPollSprint(q.state.data, active) ? 2000 : false),
  });
  const view = query.data ? toSprintView(query.data) : undefined;
  const invalidate = () => queryClient.invalidateQueries({ queryKey: key });

  const generateExercises = useMutation({
    mutationFn: (opts: { model?: string; force?: boolean } = {}) =>
      post<{ jobId: string | null }>(url, opts, 'Impossibile preparare gli esercizi'),
    onSettled: invalidate,
  });

  const generateTheory = useMutation({
    mutationFn: (opts: { model?: string; force?: boolean } = {}) =>
      post<StartSprintTheoryResponse>(`${url}/theory`, opts, 'Impossibile preparare la teoria'),
    onSettled: () => {
      invalidate();
      queryClient.invalidateQueries({ queryKey: lessonKey(slug, sessionId) });
    },
  });

  // The choice shows at once and goes back if the server refuses it; the server then releases the solution.
  const rate = useMutation({
    mutationFn: ({ id, state }: { id: string; state: SelfAssessment }) =>
      patchItem(slug, sessionId, id, { state }),
    onMutate: async ({ id, state }) => {
      await queryClient.cancelQueries({ queryKey: key });
      const previous = queryClient.getQueryData<SprintDto>(key);
      queryClient.setQueryData<SprintDto>(key, (prev) =>
        prev
          ? { ...prev, exercises: prev.exercises.map((e) => (e.id === id ? { ...e, state } : e)) }
          : prev,
      );
      return { previous };
    },
    onError: (_err, _vars, ctx) => {
      if (ctx?.previous) queryClient.setQueryData(key, ctx.previous);
    },
    onSuccess: (item) =>
      queryClient.setQueryData<SprintDto>(key, (p) => p && mergeSprintItem(p, item)),
    // Rating changes which retries are shown and which concepts need a block.
    onSettled: invalidate,
  });

  const reveal = useMutation({
    mutationFn: ({ id }: { id: string }) =>
      patchItem(slug, sessionId, id, { revealSolution: true }),
    onSuccess: (item) =>
      queryClient.setQueryData<SprintDto>(key, (p) => p && mergeSprintItem(p, item)),
  });

  const saveAnswer = useMutation({
    mutationFn: ({ id, answer }: { id: string; answer: string }) =>
      patchItem(slug, sessionId, id, { answer }),
    onSuccess: (item) =>
      queryClient.setQueryData<SprintDto>(key, (p) => p && mergeSprintItem(p, item)),
  });

  // The textarea saves on blur; the correction must see what is on screen, so save it first.
  const grade = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const current = query.data?.retries.find((r) => r.id === id);
      if (current && answer !== (current.answer ?? ''))
        await patchItem(slug, sessionId, id, { answer });
      return postGrade(slug, sessionId, id);
    },
    onSuccess: (item) =>
      queryClient.setQueryData<SprintDto>(key, (p) => p && mergeSprintItem(p, item)),
    // The paid call also moved the cost.
    onSettled: invalidate,
  });

  // Kept here, not in the steps: leaving and coming back to a phase must not ask again.
  const askedExercises = useRef(false);
  const askedTheory = useRef('');

  const job = view?.job ?? null;
  const inFlight =
    job?.status === 'queued' || job?.status === 'running' || view?.theory.state === 'generating';
  return {
    query,
    view,
    generateExercises,
    generateTheory,
    rate,
    reveal,
    saveAnswer,
    grade,
    askedExercises,
    askedTheory,
    job,
    inFlight,
  };
}

// ---- mobile shell (below 768 px): stepper labels and the fixed action bar ----

const STEP_STATUS_LABEL: Record<StepStatus, string> = {
  done: 'fatta',
  current: 'fase corrente',
  todo: 'da fare',
};

/** The status of a phase as the compact stepper says it: "fatta", "fase corrente", "da fare". */
export function phaseStatusLabel(status: StepStatus): string {
  return STEP_STATUS_LABEL[status];
}

/** What fills the main slot of the mobile action bar. */
export type BarPrimary =
  /** Nothing: the step carries its own button (Ricorda closes the lesson in the page). */
  | { kind: 'none' }
  /** The block being studied fills the slot (Controlla, then the way on). */
  | { kind: 'block' }
  | { kind: 'phase'; label: string; to: LessonPhase; quiet: boolean };

/**
 * The primary button of the mobile bar for the current phase. The labels are the ones of the buttons
 * in the page (`NEXT_ACTION`, `SPRINT_NEXT_ACTION`): the bar replaces them, it does not rename them.
 */
export function barPrimaryFor(input: {
  flow: LessonFlowKind;
  phase: LessonPhase;
  active: boolean;
  /** Sprint "Esercizi": every exercise is rated, so forward is the loud kind. */
  sprintDone?: boolean;
}): BarPrimary {
  const { flow, phase, active } = input;
  if (!active) {
    if (flow === 'legacy' || phase === 'recall') return { kind: 'none' };
    return { kind: 'phase', label: 'Vai a Ricorda', to: 'recall', quiet: false };
  }
  if (flow === 'legacy') return { kind: 'block' };
  if (phase === 'recall') return { kind: 'none' };
  if (flow === 'sprint') {
    if (!isSprintPhase(phase)) return { kind: 'none' };
    if (phase === 'theory') return { kind: 'block' };
    const next = SPRINT_NEXT_ACTION[phase];
    if (!next) return { kind: 'none' };
    return {
      kind: 'phase',
      label: next.label,
      to: next.to,
      quiet: phase === 'exercises' && !input.sprintDone,
    };
  }
  if (!isStandardPhase(phase)) return { kind: 'none' };
  if (phase === 'understand') return { kind: 'block' };
  const next = NEXT_ACTION[phase];
  return next ? { kind: 'phase', label: next.label, to: next.to, quiet: false } : { kind: 'none' };
}

/** Where the back button of the mobile bar goes: the previous block while studying, else the previous phase. */
export type BarBack =
  { kind: 'block'; label: string } | { kind: 'phase'; label: string; to: LessonPhase };

export function barBackFor(input: {
  flow: LessonFlowKind;
  phase: LessonPhase;
  /** Index of the block shown. */
  current: number;
}): BarBack | null {
  const { flow, phase } = input;
  if (flow === 'legacy') return null;
  const studying = flow === 'sprint' ? phase === 'theory' : phase === 'understand';
  if (studying && input.current > 0) return { kind: 'block', label: 'Blocco precedente' };
  const prev =
    flow === 'sprint'
      ? isSprintPhase(phase)
        ? previousSprintPhase(phase)
        : null
      : isStandardPhase(phase)
        ? previousPhase(phase)
        : null;
  return prev ? { kind: 'phase', label: `Fase precedente: ${prev.label}`, to: prev.id } : null;
}

/** The bar only has a slot for the block while it is the block's turn: elsewhere the buttons stay in the page. */
export function barHasSlot(primary: BarPrimary): boolean {
  return primary.kind === 'block';
}
