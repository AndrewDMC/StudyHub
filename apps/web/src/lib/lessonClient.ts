import { useEffect, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CheckLessonBlockResponse,
  LessonBlockDto,
  LessonDto,
  LessonHint,
} from '@studyhub/contracts';

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
