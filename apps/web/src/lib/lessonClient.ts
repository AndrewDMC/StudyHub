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
  SessionItemDto,
  StudySessionDto,
  SubmitExplanationRequest,
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
 * Sessions that open the lesson shell: a standard lesson in any of its phases, and a sprint lesson
 * only in "Studia" (the sprint phases are not built yet: it gets the shell without stepper).
 */
export function usesLessonFlow(
  session: Pick<StudySessionDto, 'kind' | 'method' | 'phase'>,
): boolean {
  if (session.kind !== 'lesson' || !isStandardPhase(session.phase)) return false;
  return session.method === 'standard' || session.phase === 'understand';
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
): number {
  const fromServer = Math.max(phaseIndex(savedPhase), 0);
  try {
    const raw = window.localStorage.getItem(furthestKey(sessionId));
    const n = raw === null ? NaN : Number(raw);
    if (Number.isInteger(n) && n >= 0 && n < STANDARD_PHASES.length) return Math.max(n, fromServer);
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
}: {
  slug: string;
  sessionId: string;
  active: boolean;
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
    if (autoStarted.current || !active || !data) return;
    if (data.blocks.length === 0 && !data.job) {
      autoStarted.current = true;
      start.mutate({});
    }
  }, [active, data]);

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
    mutationFn: (phase: StandardPhase) => patchSession(slug, sessionId, { phase }),
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
}: {
  slug: string;
  sessionId: string;
  active: boolean;
}) {
  const queryClient = useQueryClient();
  const key = explanationKey(slug, sessionId);
  const url = `/api/subjects/${slug}/sessions/${sessionId}/explanation`;

  const query = useQuery({
    queryKey: key,
    queryFn: async () =>
      readJson<ExplanationStateDto>(await fetch(url), 'Impossibile caricare la spiegazione'),
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
