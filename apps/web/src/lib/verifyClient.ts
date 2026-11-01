import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SessionItemCitationDto, VerifyItemDto, VerifyStateDto } from '@studyhub/contracts';

const base = (slug: string, sessionId: string) => `/api/subjects/${slug}/sessions/${sessionId}`;

export const verifyKey = (slug: string, sessionId: string) => ['verify', slug, sessionId] as const;

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

async function send<T>(url: string, method: 'POST' | 'PATCH', body: unknown, fallback: string) {
  return readJson<T>(
    await fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    fallback,
  );
}

// ---- pure helpers (tested in test/verifyClient.test.ts) ----

/** The state of a question as the student sees it: `partial` is a wrong grade that scored half. */
export type VerifyOutcomeKind = 'open' | 'correct' | 'partial' | 'wrong' | 'unknown';

export function outcomeOf(item: Pick<VerifyItemDto, 'state' | 'feedback'>): VerifyOutcomeKind {
  if (item.state === 'wrong' && item.feedback?.verdict === 'partial') return 'partial';
  return item.state;
}

export const isAnswered = (item: Pick<VerifyItemDto, 'state'>): boolean => item.state !== 'open';

/** Index of the first question still open; `items.length` when all have an outcome. */
export function currentIndex(items: Pick<VerifyItemDto, 'state'>[]): number {
  const i = items.findIndex((it) => it.state === 'open');
  return i < 0 ? items.length : i;
}

export function allAnswered(items: Pick<VerifyItemDto, 'state'>[]): boolean {
  return items.length > 0 && items.every(isAnswered);
}

/** The server decides when the final outcome exists (it has to compute the mastery too). */
export function showSummary(
  data: Pick<VerifyStateDto, 'items' | 'summary'> & { job?: VerifyStateDto['job'] },
): boolean {
  // Never before the generation has finished: more questions may still arrive.
  return (
    allAnswered(data.items) && data.summary !== null && !jobInFlight({ job: data.job ?? null })
  );
}

/** "Rifalla" only makes sense with something that was not right, on a session still open. */
export function canRetry(data: Pick<VerifyStateDto, 'ended' | 'summary'>): boolean {
  return !data.ended && !!data.summary && data.summary.correct < data.summary.total;
}

export type VerifyMode =
  /** Before the first answer of the server. */
  | 'loading'
  /** A session from before this feature: the page of old stays. */
  | 'legacy'
  /** Nothing to show yet: the new questions are being written. */
  | 'preparing'
  /** The generation failed and there is not enough to start. */
  | 'failed'
  /** No question and nothing coming (no document, no origin). */
  | 'empty'
  | 'ready';

export function jobInFlight(data: Pick<VerifyStateDto, 'job'> | undefined): boolean {
  return data?.job?.status === 'queued' || data?.job?.status === 'running';
}

export function verifyMode(data: VerifyStateDto | undefined): VerifyMode {
  if (!data) return 'loading';
  if (!data.prepared) return 'legacy';
  if (data.items.length >= 2) return 'ready';
  if (jobInFlight(data)) return data.items.length > 0 ? 'ready' : 'preparing';
  if (data.job?.status === 'failed') return data.items.length > 0 ? 'ready' : 'failed';
  return data.items.length > 0 ? 'ready' : 'empty';
}

export function shouldPollVerify(data: VerifyStateDto | undefined): boolean {
  return jobInFlight(data);
}

/** Mastery arrives as 0..1 (as `topics.mastery`); the page shows whole percents. */
export function masteryPercent(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null;
  return Math.round(Math.min(1, Math.max(0, value)) * 100);
}

/** "2 nov" from `YYYY-MM-DD`, without going through the time zone. */
export function formatVerifyDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return new Intl.DateTimeFormat('it-IT', { day: 'numeric', month: 'short', timeZone: 'UTC' })
    .format(date)
    .replace(/\.$/, '');
}

export const OUTCOME_UI: Record<
  Exclude<VerifyOutcomeKind, 'open'>,
  { label: string; sign: string; tone: string; text: string; bar: string }
> = {
  correct: {
    label: 'Giusto',
    sign: '✓',
    tone: 'border-ok/30 bg-ok/5',
    text: 'text-ok',
    bar: 'bg-ok',
  },
  partial: {
    label: 'Quasi',
    sign: '!',
    tone: 'border-warn/30 bg-warn/5',
    text: 'text-warn',
    bar: 'bg-warn',
  },
  wrong: {
    label: 'Sbagliato',
    sign: '✕',
    tone: 'border-danger/30 bg-danger/5',
    text: 'text-danger',
    bar: 'bg-danger',
  },
  unknown: {
    label: 'Non te lo ricordavi',
    sign: '?',
    tone: 'border-warn/30 bg-warn/5',
    text: 'text-warn',
    bar: 'bg-fg-muted',
  },
};

export const UNKNOWN_FALLBACK =
  'Va bene non ricordarlo: è proprio questo che la verifica serve a trovare.';

/** Static class map: Tailwind cannot see interpolated class names. */
export function progressGridClass(total: number): string {
  return total === 2 ? 'grid-cols-2' : 'grid-cols-3';
}

export function questionTypeLabel(kind: VerifyItemDto['kind']): string {
  return kind === 'guide_question' ? 'Teoria' : 'Esercizio';
}

export function draftKey(sessionId: string, itemId: string): string {
  return `verify-draft:${sessionId}:${itemId}`;
}

export type VerifyCitation = Pick<
  SessionItemCitationDto,
  'docId' | 'page' | 'documentName' | 'quote'
>;

// ---- data ----

/**
 * The closed-book check of a topic: questions, the generation job and the final outcome, plus the
 * mutations. Polls while new questions are being written. The answer is saved, then corrected, then
 * the state is read again: the verdict and the key point only exist on the server side.
 */
export function useVerify({
  slug,
  sessionId,
  enabled = true,
}: {
  slug: string;
  sessionId: string;
  enabled?: boolean;
}) {
  const queryClient = useQueryClient();
  const key = verifyKey(slug, sessionId);
  const url = `${base(slug, sessionId)}/verify`;
  const scope = { id: `verify-${sessionId}` };

  const query = useQuery({
    queryKey: key,
    enabled,
    queryFn: async () =>
      readJson<VerifyStateDto>(await fetch(url), 'Impossibile caricare la verifica'),
    refetchInterval: (q) => (shouldPollVerify(q.state.data) ? 2000 : false),
  });
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: key });
    queryClient.invalidateQueries({ queryKey: ['topics', slug] });
  };

  const grade = useMutation({
    scope,
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      await send(
        `${base(slug, sessionId)}/items/${id}`,
        'PATCH',
        { answer },
        'Salvataggio non riuscito',
      );
      return send(
        `${base(slug, sessionId)}/items/${id}/grade`,
        'POST',
        {},
        'Correzione non riuscita',
      );
    },
    onSettled: invalidate,
  });

  const markUnknown = useMutation({
    scope,
    mutationFn: ({ id }: { id: string }) =>
      send<VerifyStateDto>(`${url}/items/${id}/unknown`, 'POST', {}, 'Operazione non riuscita'),
    onSuccess: (state) => queryClient.setQueryData(key, state),
    onSettled: invalidate,
  });

  const retry = useMutation({
    scope,
    mutationFn: () => send<VerifyStateDto>(`${url}/retry`, 'POST', {}, 'Operazione non riuscita'),
    onSuccess: (state) => queryClient.setQueryData(key, state),
    onSettled: invalidate,
  });

  /** "Riprova" after a failed generation. */
  const prepare = useMutation({
    scope,
    mutationFn: (opts: { model?: string; force?: boolean } = {}) =>
      send<{ jobId: string | null }>(url, 'POST', opts, 'Impossibile preparare la verifica'),
    onSettled: invalidate,
  });

  return { query, data: query.data, grade, markUnknown, retry, prepare };
}

// ---- mobile action bar (below 768 px) ----

/**
 * What the fixed bar of the mobile verify shows: the open question (Correggi / Non me lo ricordo), the
 * way on once it has an outcome, the two arrows of a finished check, or nothing (outcome page, no question).
 */
export type VerifyBarState = 'none' | 'open' | 'next' | 'review';

export function verifyBarState(input: {
  /** A question is on screen (not the outcome page). */
  hasItem: boolean;
  ended: boolean;
  answered: boolean;
}): VerifyBarState {
  if (!input.hasItem) return 'none';
  if (input.ended) return 'review';
  return input.answered ? 'next' : 'open';
}
