'use client';

import { useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import rehypeKatex from 'rehype-katex';
import type {
  EstimateBriefingResponse,
  SessionBriefingDto,
  SessionBriefingMode,
  SessionFocus,
  SessionItemCitationDto,
  SessionItemDto,
  UpdateSessionItemRequest,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';
import { MODEL_OPTIONS, ModelPicker } from '@/components/ModelPicker';
import { toInlineMath } from '@/lib/lessonClient';

export const DIFFICULTY_LABELS: Record<number, string> = {
  1: 'Facile',
  2: 'Media',
  3: 'Difficile',
};

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

const base = (slug: string, sessionId: string) => `/api/subjects/${slug}/sessions/${sessionId}`;

export async function fetchBriefing(slug: string, sessionId: string): Promise<SessionBriefingDto> {
  return readJson(
    await fetch(`${base(slug, sessionId)}/briefing`),
    'Impossibile caricare punti chiave ed esercizi',
  );
}

async function fetchEstimate(
  slug: string,
  sessionId: string,
  mode: SessionBriefingMode,
  model: string,
): Promise<EstimateBriefingResponse> {
  return readJson(
    await fetch(`${base(slug, sessionId)}/briefing/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, model }),
    }),
    'Stima costo fallita',
  );
}

async function postStart(
  slug: string,
  sessionId: string,
  mode: SessionBriefingMode,
  model: string,
): Promise<{ jobId: string }> {
  return readJson(
    await fetch(`${base(slug, sessionId)}/briefing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode, model }),
    }),
    'Avvio della generazione fallito',
  );
}

async function patchItem(
  slug: string,
  sessionId: string,
  itemId: string,
  patch: UpdateSessionItemRequest,
): Promise<SessionItemDto> {
  const body = await readJson<{ item: SessionItemDto }>(
    await fetch(`${base(slug, sessionId)}/items/${itemId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'Salvataggio non riuscito',
  );
  return body.item;
}

async function postGrade(slug: string, sessionId: string, itemId: string): Promise<SessionItemDto> {
  const body = await readJson<{ item: SessionItemDto }>(
    await fetch(`${base(slug, sessionId)}/items/${itemId}/grade`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}',
    }),
    'Correzione non riuscita',
  );
  return body.item;
}

/** €0 → "gratis" (FakeProvider, nessuna chiave configurata). */
export function formatCost(costEur: number): string {
  return costEur === 0 ? 'gratis' : `~€${costEur.toFixed(4)}`;
}

export function Markdown({ source }: { source: string }) {
  return (
    <div className="md-obsidian text-sm">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, [remarkMath, { singleDollarTextMath: true }]]}
        rehypePlugins={[rehypeKatex]}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}

export function CitationChips({
  citations,
  onOpen,
}: {
  citations: SessionItemCitationDto[];
  onOpen: (citation: SessionItemCitationDto) => void;
}) {
  return (
    <span className="flex flex-wrap gap-1">
      {citations.map((c) => (
        <button
          key={`${c.docId}:${c.page}:${c.quote}`}
          type="button"
          onClick={() => onOpen(c)}
          title={`«${c.quote}»`}
          className="rounded bg-accent/15 px-1.5 py-0.5 text-xs font-medium text-accent hover:bg-accent/25"
        >
          ↗ {c.documentName} · p. {c.page}
        </button>
      ))}
    </span>
  );
}

function KeyPointRow({
  item,
  active,
  onToggle,
  onOpenCitation,
  onAsk,
}: {
  item: SessionItemDto;
  active: boolean;
  onToggle: (done: boolean) => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  onAsk: (focus: SessionFocus) => void;
}) {
  const done = item.state === 'done';
  const first = item.citations[0];
  return (
    <li className="flex gap-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <input
        type="checkbox"
        aria-label={`Capito: ${item.title}`}
        checked={done}
        disabled={!active}
        onChange={(e) => onToggle(e.target.checked)}
        className="mt-1 h-4 w-4 shrink-0"
      />
      <div className="min-w-0 flex-1 space-y-1.5">
        <p
          className={`text-sm font-medium ${done ? 'text-fg-muted line-through' : 'text-fg-primary'}`}
        >
          {item.title}
        </p>
        <div className="text-fg-secondary">
          <Markdown source={item.body} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <CitationChips citations={item.citations} onOpen={onOpenCitation} />
          {active && first && (
            <button
              type="button"
              onClick={() => onAsk({ docId: first.docId, page: first.page, text: first.quote })}
              className="text-xs text-fg-muted underline-offset-2 hover:text-fg-primary hover:underline"
            >
              Spiegami meglio
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

/**
 * An exercise, or (`variant="guide"`) a guide question: same answer box and AI correction, but no
 * difficulty, no solution to reveal and no self-assessment (a guide question has no model answer).
 * `variant="retry"` is the similar exercise of a sprint lesson: the AI correction decides, the
 * solution shows after it (or when the student gives up), and the theory can be reviewed.
 */
export function ExerciseCard({
  item,
  index,
  variant = 'exercise',
  active,
  grading,
  gradeError,
  onPatch,
  onGrade,
  onOpenCitation,
  similarTo,
  onReviewTheory,
}: {
  item: SessionItemDto;
  index: number;
  variant?: 'exercise' | 'guide' | 'retry';
  active: boolean;
  grading: boolean;
  gradeError: string | null;
  onPatch: (patch: UpdateSessionItemRequest) => void;
  /** Receives the answer as typed, so it is saved before it is graded. */
  onGrade: (answer: string) => void;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  /** Retry: the number of the exercise it is similar to. */
  similarTo?: number | undefined;
  /** Retry: open the theory of the original exercise (omitted when it has none). */
  onReviewTheory?: (() => void) | undefined;
}) {
  const [answer, setAnswer] = useState(item.answer ?? '');
  const [showSolution, setShowSolution] = useState(item.state !== 'open');
  const assess = (state: 'correct' | 'wrong') =>
    onPatch({ state: item.state === state ? 'open' : state });
  const guide = variant === 'guide';
  const retry = variant === 'retry';

  return (
    <li className="space-y-2 rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span className="font-medium text-fg-primary">
          {retry ? 'Riprova' : guide ? 'Domanda guida' : 'Esercizio'} {index + 1}
        </span>
        {retry && similarTo !== undefined && <span>· simile all&apos;esercizio {similarTo}</span>}
        {!guide && !retry && item.difficulty && <span>· {DIFFICULTY_LABELS[item.difficulty]}</span>}
        {!guide && !retry && item.state === 'correct' && (
          <span className="ml-auto text-ok">Giusto</span>
        )}
        {!guide && !retry && item.state === 'wrong' && (
          <span className="ml-auto text-danger">Da rivedere</span>
        )}
        {retry && item.state === 'correct' && (
          <span className="ml-auto text-ok">
            <span aria-hidden="true">✓ </span>Rifatto giusto.
          </span>
        )}
        {retry && item.state === 'wrong' && (
          <span className="ml-auto text-danger">
            <span aria-hidden="true">! </span>Da rivedere.
          </span>
        )}
      </div>
      <Markdown source={item.title} />

      <textarea
        value={answer}
        disabled={!active}
        onChange={(e) => setAnswer(e.target.value)}
        onBlur={() => {
          if (answer !== (item.answer ?? '')) onPatch({ answer });
        }}
        rows={retry ? 5 : 3}
        placeholder={
          retry
            ? 'Scrivi i passaggi…'
            : guide
              ? 'Rispondi con parole tue…'
              : 'Scrivi qui il tuo svolgimento…'
        }
        aria-label={
          retry
            ? `La tua risposta, riprova ${index + 1}`
            : guide
              ? `Risposta alla domanda guida ${index + 1}`
              : `Risposta all'esercizio ${index + 1}`
        }
        className="w-full resize-y rounded-[var(--radius-control)] border border-border bg-bg-inset px-2 py-1.5 text-sm text-fg-primary outline-none focus:border-accent disabled:opacity-60"
      />

      {active && (guide || retry || !showSolution) && (
        <div className="flex flex-wrap items-center gap-2 max-md:[&>button]:flex-1">
          <Button
            type="button"
            size="sm"
            variant={retry ? 'primary' : 'secondary'}
            aria-busy={grading}
            disabled={grading || !answer.trim()}
            onClick={() => onGrade(answer)}
          >
            {grading ? 'Correggo…' : retry ? 'Correggi' : 'Correggi con l’AI'}
          </Button>
          {retry && onReviewTheory && (
            <Button type="button" size="sm" variant="secondary" onClick={onReviewTheory}>
              Rivedi la teoria
            </Button>
          )}
          {retry && !item.solutionVisible && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => onPatch({ revealSolution: true })}
            >
              Mostra la soluzione
            </Button>
          )}
          {!answer.trim() && (
            <span className="text-xs text-fg-muted">Scrivi prima una risposta.</span>
          )}
        </div>
      )}
      {gradeError && (
        <p role="alert" className="text-xs text-danger">
          {gradeError}
        </p>
      )}
      {item.feedback && (
        <div
          role="status"
          className="space-y-1 rounded-[var(--radius-control)] border border-border bg-bg-inset p-2 text-sm"
        >
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">
            Correzione dell&apos;AI · {Math.round(item.feedback.score * 100)}%
          </p>
          <Markdown source={item.feedback.feedback} />
          {item.feedback.missing.length > 0 && (
            <ul className="list-disc pl-5 text-fg-secondary">
              {item.feedback.missing.map((m) => (
                <li key={m}>Manca: {m}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      {retry ? (
        item.solutionVisible && (
          <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-2">
            <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Soluzione</p>
            {item.solutionSteps.length > 0 ? (
              <ol className="list-decimal space-y-2 pl-5 text-fg-secondary">
                {item.solutionSteps.map((step, i) => (
                  <li key={i}>
                    <Markdown source={step.text} />
                    {step.formula && <Markdown source={toInlineMath(step.formula)} />}
                  </li>
                ))}
              </ol>
            ) : (
              <Markdown source={item.body} />
            )}
            <CitationChips citations={item.citations} onOpen={onOpenCitation} />
          </div>
        )
      ) : guide ? null : showSolution || item.feedback ? (
        <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-2">
          <p className="text-xs font-medium uppercase tracking-wide text-fg-muted">Soluzione</p>
          <Markdown source={item.body} />
          <CitationChips citations={item.citations} onOpen={onOpenCitation} />
          {active && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <span className="text-xs text-fg-muted">Com&apos;è andata?</span>
              <Button
                type="button"
                size="sm"
                variant={item.state === 'correct' ? 'primary' : 'secondary'}
                aria-pressed={item.state === 'correct'}
                onClick={() => assess('correct')}
              >
                Ho risposto bene
              </Button>
              <Button
                type="button"
                size="sm"
                variant={item.state === 'wrong' ? 'danger' : 'secondary'}
                aria-pressed={item.state === 'wrong'}
                onClick={() => assess('wrong')}
              >
                Ho sbagliato
              </Button>
            </div>
          )}
        </div>
      ) : (
        <Button type="button" size="sm" variant="secondary" onClick={() => setShowSolution(true)}>
          Mostra la soluzione
        </Button>
      )}
    </li>
  );
}

/** Briefing queries and mutations, shared by the desktop panel and the mobile one. */
export function useSessionBriefing({
  slug,
  sessionId,
  active,
  hasDocuments,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  hasDocuments: boolean;
}) {
  const queryClient = useQueryClient();
  const key = ['sessionBriefing', slug, sessionId];
  const [model, setModel] = useState<string>(MODEL_OPTIONS[1].id); // sonnet: default routing (docs/03 §4)

  const query = useQuery({
    queryKey: key,
    queryFn: () => fetchBriefing(slug, sessionId),
    // The worker runs the job: follow it until it is done or has failed.
    refetchInterval: (q) => {
      const status = q.state.data?.job?.status;
      return status === 'queued' || status === 'running' ? 2000 : false;
    },
  });
  const data = query.data;
  const items = data?.items ?? [];
  const keyPoints = items.filter((i) => i.kind === 'key_point');
  const exercises = items.filter((i) => i.kind === 'exercise');
  // The guide questions of a lesson share the list: they are answered elsewhere, not generated here.
  const guideQuestions = items.filter((i) => i.kind === 'guide_question');
  const inFlight = data?.job?.status === 'queued' || data?.job?.status === 'running';
  const failed = data?.job?.status === 'failed' ? data.job : null;
  const mode: SessionBriefingMode = keyPoints.length + exercises.length === 0 ? 'all' : 'exercises';

  const estimate = useQuery({
    queryKey: ['sessionBriefingEstimate', slug, sessionId, mode, model],
    queryFn: () => fetchEstimate(slug, sessionId, mode, model),
    enabled: active && hasDocuments && !inFlight,
  });

  const start = useMutation({
    mutationFn: () => postStart(slug, sessionId, mode, model),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: key }),
  });
  const patch = useMutation({
    mutationFn: ({ id, ...body }: UpdateSessionItemRequest & { id: string }) =>
      patchItem(slug, sessionId, id, body),
    onSuccess: (item) =>
      queryClient.setQueryData<SessionBriefingDto>(key, (prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? item : i)) } : prev,
      ),
  });

  const grade = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      // The textarea saves on blur; the correction must see what is on screen, so save it first.
      const current = query.data?.items.find((i) => i.id === id);
      if (current && answer !== (current.answer ?? ''))
        await patchItem(slug, sessionId, id, { answer });
      return postGrade(slug, sessionId, id);
    },
    onSuccess: (item) =>
      queryClient.setQueryData<SessionBriefingDto>(key, (prev) =>
        prev ? { ...prev, items: prev.items.map((i) => (i.id === item.id ? item : i)) } : prev,
      ),
    // The paid call also moved the costs: refetch so the header total follows.
    onSettled: () => queryClient.invalidateQueries({ queryKey: key }),
  });

  const costLabel = estimate.data ? ` · ${formatCost(estimate.data.costEur)}` : '';

  return {
    query,
    data,
    items,
    keyPoints,
    exercises,
    guideQuestions,
    inFlight,
    failed,
    mode,
    model,
    setModel,
    estimate,
    start,
    patch,
    grade,
    costLabel,
  };
}

/**
 * Key points and exercises of a study session (docs/08-sessione-di-studio.md §5.2, decision 3):
 * nothing is generated until the student asks, with the model and the estimated cost in plain sight.
 * An exercise is either self-assessed after "Mostra la soluzione" (free) or graded by the AI (paid).
 */
export function SessionBriefing({
  slug,
  sessionId,
  active,
  hasDocuments,
  onOpenCitation,
  onAsk,
  only,
  footer,
}: {
  slug: string;
  sessionId: string;
  active: boolean;
  hasDocuments: boolean;
  onOpenCitation: (citation: SessionItemCitationDto) => void;
  onAsk: (focus: SessionFocus) => void;
  /** `exercise`: show the exercises only (no "Punti chiave / Esercizi" tabs). Generation is unchanged. */
  only?: 'exercise';
  /** Rendered under the list and under the empty state (the lesson puts its guide questions there). */
  footer?: (api: ReturnType<typeof useSessionBriefing>) => ReactNode;
}) {
  const [view, setView] = useState<'key_point' | 'exercise'>('key_point');
  const api = useSessionBriefing({ slug, sessionId, active, hasDocuments });
  const {
    query,
    data,
    keyPoints,
    exercises,
    inFlight,
    failed,
    mode,
    model,
    setModel,
    estimate,
    start,
    patch,
    grade,
    costLabel,
  } = api;
  const shownView = only ?? view;

  if (query.isLoading) return <p className="text-sm text-fg-muted">Caricamento…</p>;
  if (query.isError) {
    return (
      <p role="alert" className="text-sm text-danger">
        {(query.error as Error).message}
      </p>
    );
  }

  const generateControls = (
    <div className="space-y-2">
      <ModelPicker
        value={model}
        onChange={setModel}
        disabled={start.isPending || inFlight}
        defaultId={MODEL_OPTIONS[1].id}
      />
      <Button
        type="button"
        disabled={!active || !hasDocuments || start.isPending || inFlight}
        onClick={() => start.mutate()}
      >
        {mode === 'all'
          ? `Genera punti chiave ed esercizi${costLabel}`
          : `Altri esercizi${costLabel}`}
      </Button>
      {estimate.isError && <p className="text-xs text-fg-muted">Stima costo non disponibile.</p>}
      {start.isError && (
        <p role="alert" className="text-xs text-danger">
          {(start.error as Error).message}
        </p>
      )}
    </div>
  );

  if (keyPoints.length + exercises.length === 0) {
    const empty = (
      <div className="mx-auto max-w-md space-y-4 rounded-[var(--radius-card)] border border-dashed border-border p-6 text-center">
        {inFlight ? (
          <div role="status" aria-live="polite" className="space-y-3">
            <div className="space-y-2" aria-hidden>
              <div className="h-3 animate-pulse rounded bg-bg-raised" />
              <div className="mx-auto h-3 w-4/5 animate-pulse rounded bg-bg-raised" />
              <div className="mx-auto h-3 w-3/5 animate-pulse rounded bg-bg-raised" />
            </div>
            <p className="text-sm text-fg-secondary">
              Sto preparando i punti chiave e gli esercizi dal materiale…
            </p>
          </div>
        ) : (
          <>
            <div className="space-y-1">
              <h2 className="text-base font-semibold text-fg-primary">Punti chiave ed esercizi</h2>
              <p className="text-sm text-fg-muted">
                Una checklist di ciò che devi aver capito e qualche esercizio, ricavati solo dal
                materiale di questa sessione, ognuno con la citazione da cui nasce.
              </p>
            </div>
            {failed && (
              <p role="alert" className="text-left text-sm text-danger">
                Generazione non riuscita: {failed.error ?? 'errore sconosciuto'}. Puoi riprovare.
              </p>
            )}
            {!hasDocuments ? (
              <p className="text-sm text-fg-muted">
                {only
                  ? 'Nessun documento in questa sessione.'
                  : 'Nessun documento in questa sessione: scegli un argomento nella colonna a sinistra.'}
              </p>
            ) : (
              <div className="text-left">{generateControls}</div>
            )}
            {!active && <p className="text-xs text-fg-muted">La sessione è terminata.</p>}
          </>
        )}
      </div>
    );
    if (!footer) return empty;
    return (
      <div className="space-y-6">
        {empty}
        {footer(api)}
      </div>
    );
  }

  const doneCount = keyPoints.filter((k) => k.state === 'done').length;
  const visible = shownView === 'key_point' ? keyPoints : exercises;

  return (
    <div className="space-y-4">
      <div
        {...(only ? {} : { role: 'tablist', 'aria-label': 'Studio' })}
        className="flex flex-wrap items-center gap-1"
      >
        {!only &&
          (
            [
              ['key_point', `Punti chiave ${doneCount}/${keyPoints.length}`],
              ['exercise', `Esercizi (${exercises.length})`],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded-[var(--radius-control)] border px-3 py-1 text-sm ${
                view === id
                  ? 'border-accent bg-bg-raised text-fg-primary'
                  : 'border-border text-fg-secondary'
              }`}
            >
              {label}
            </button>
          ))}
        {data && data.costEur > 0 && (
          <span className="ml-auto text-xs text-fg-muted">
            Costo AI: €{data.costEur.toFixed(4)}
          </span>
        )}
      </div>

      {(patch.isError || failed) && (
        <p role="alert" className="text-sm text-danger">
          {patch.isError
            ? (patch.error as Error).message
            : `Generazione non riuscita: ${failed?.error ?? 'errore sconosciuto'}.`}
        </p>
      )}

      {visible.length === 0 ? (
        <p className="text-sm text-fg-muted">
          {shownView === 'key_point' ? 'Nessun punto chiave.' : 'Nessun esercizio.'}
        </p>
      ) : (
        <ul className="space-y-3">
          {visible.map((item, i) =>
            item.kind === 'key_point' ? (
              <KeyPointRow
                key={item.id}
                item={item}
                active={active}
                onToggle={(done) => patch.mutate({ id: item.id, state: done ? 'done' : 'open' })}
                onOpenCitation={onOpenCitation}
                onAsk={onAsk}
              />
            ) : (
              <ExerciseCard
                key={item.id}
                item={item}
                index={i}
                active={active}
                grading={grade.isPending && grade.variables?.id === item.id}
                gradeError={
                  grade.isError && grade.variables?.id === item.id
                    ? (grade.error as Error).message
                    : null
                }
                onPatch={(body) => patch.mutate({ id: item.id, ...body })}
                onGrade={(answer) => grade.mutate({ id: item.id, answer })}
                onOpenCitation={onOpenCitation}
              />
            ),
          )}
        </ul>
      )}

      {shownView === 'exercise' && active && (
        <div className="space-y-2 border-t border-border pt-3">
          {inFlight ? (
            <p role="status" className="text-sm text-fg-secondary">
              Sto preparando altri esercizi…
            </p>
          ) : (
            generateControls
          )}
        </div>
      )}
      {footer?.(api)}
    </div>
  );
}
