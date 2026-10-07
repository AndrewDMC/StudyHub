'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlashcardDto, UpdateFlashcardRequest } from '@studyhub/contracts';
import { revealPlan } from '@/lib/cardText';
import { CardText } from './CardText';

interface QueueParams {
  topicId: string | null;
  cap: string | null;
  newLimit: string | null;
}

async function fetchQueue(slug: string, params: QueueParams): Promise<FlashcardDto[]> {
  const qs = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value) qs.set(key, value);
  const res = await fetch(`/api/subjects/${slug}/review/queue?${qs.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la coda di ripasso');
  return body.queue as FlashcardDto[];
}

type Confidence = 1 | 2 | 3;

async function rate(
  slug: string,
  cardId: string,
  rating: 1 | 2 | 3 | 4,
  elapsedMs: number,
  confidence: Confidence | null,
) {
  const res = await fetch(`/api/subjects/${slug}/review/${cardId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, elapsedMs, ...(confidence ? { confidence } : {}) }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Invio della valutazione fallito');
  }
}

async function patchCard(
  slug: string,
  cardId: string,
  patch: UpdateFlashcardRequest,
): Promise<FlashcardDto> {
  const res = await fetch(`/api/subjects/${slug}/flashcards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Aggiornamento fallito');
  return body.flashcard as FlashcardDto;
}

const RATING_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

const CONFIDENCE_LABELS: Record<Confidence, string> = {
  1: 'Non lo so',
  2: 'Forse',
  3: 'Lo so',
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
}

/**
 * 1-4 from either the typed character (numpad, or any layout that types digits) or the physical
 * top-row key — on AZERTY the unshifted top row types "&é\"'" but is still the "1-4" position.
 */
function ratingFromEvent(e: KeyboardEvent): 1 | 2 | 3 | 4 | null {
  const digit = /^[1-4]$/.test(e.key) ? e.key : /^(?:Digit|Numpad)([1-4])$/.exec(e.code)?.[1];
  return digit ? (Number(digit) as 1 | 2 | 3 | 4) : null;
}

/** Where the citation lives: a PDF opens in the browser viewer at the cited page. */
function sourceHref(slug: string, card: FlashcardDto): string | null {
  if (!card.sourceRef) return null;
  const { docId, page } = card.sourceRef;
  return `/api/subjects/${slug}/documents/${docId}/file#page=${page}`;
}

/**
 * Full-screen review session (docs/fasi/F4-flashcard.md "Modalità Review"): `Space` reveals the
 * back, `1-4` rates, `E` edits the card in place, `S` suspends, `X` flags it as low quality
 * ("segnala card scadente": out of the queue, collected to improve the prompt), `F` opens the
 * source at the cited page. Each action is its own request — closing the tab mid-session loses
 * nothing already answered (F4 acceptance criterion).
 */
export function ReviewSessionClient({ subjectSlug }: { subjectSlug: string }) {
  const queryClient = useQueryClient();
  // ?topicId=... (docs/fasi/F2-materie.md "drill su questo argomento", linked from AiPanel.tsx)
  // scopes the session to one topic's cards instead of the whole subject's due queue;
  // ?cap=N&newLimit=M size the day's queue (docs/fasi/F4-flashcard.md "cap configurabile").
  const searchParams = useSearchParams();
  const params: QueueParams = {
    topicId: searchParams.get('topicId'),
    cap: searchParams.get('cap'),
    newLimit: searchParams.get('newLimit'),
  };
  const queueKey = ['review-queue', subjectSlug, params] as const;
  const query = useQuery({
    queryKey: queueKey,
    queryFn: () => fetchQueue(subjectSlug, params),
    // The session walks a fixed snapshot by index: a background refetch would shift cards under
    // the pointer and skip or repeat one.
    staleTime: Infinity,
    refetchOnWindowFocus: false,
  });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState<{ front: string; back: string } | null>(null);
  const cardStartRef = useRef(Date.now());
  // Declared *before* the answer is shown (docs/06-miglioramenti.md #4); null when skipped with Space.
  const [confidence, setConfidence] = useState<Confidence | null>(null);
  const [tally, setTally] = useState({ reviewed: 0, again: 0 });

  const queue = query.data ?? [];
  const current = queue[index];

  useEffect(() => {
    cardStartRef.current = Date.now();
    setRevealed(false);
    setConfidence(null);
    setEditing(null);
  }, [current?.id]);

  const rateMutation = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: string; rating: 1 | 2 | 3 | 4 }) =>
      rate(subjectSlug, cardId, rating, Date.now() - cardStartRef.current, confidence),
    onSuccess: (_data, { rating }) => {
      setTally((t) => ({ reviewed: t.reviewed + 1, again: t.again + (rating === 1 ? 1 : 0) }));
      setIndex((i) => i + 1);
    },
  });

  // Suspend and flag both take the card out of today's queue: same request shape, same "next".
  const removeMutation = useMutation({
    mutationFn: ({ cardId, patch }: { cardId: string; patch: UpdateFlashcardRequest }) =>
      patchCard(subjectSlug, cardId, patch),
    onSuccess: () => setIndex((i) => i + 1),
  });

  const editMutation = useMutation({
    mutationFn: ({ cardId, front, back }: { cardId: string; front: string; back: string }) =>
      patchCard(subjectSlug, cardId, { front, back }),
    onSuccess: (updated) => {
      queryClient.setQueryData<FlashcardDto[]>(queueKey, (old) =>
        old?.map((c) => (c.id === updated.id ? updated : c)),
      );
      setEditing(null);
    },
  });

  const busy = rateMutation.isPending || removeMutation.isPending || editMutation.isPending;

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!current || busy || e.ctrlKey || e.metaKey || e.altKey) return;
      if (editing) return; // the edit form owns the keyboard (its own Esc / Ctrl+Enter)
      if (isTypingTarget(e.target)) return;

      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      const rating = ratingFromEvent(e);
      if (!revealed && rating && rating <= 3) {
        // 1-3 before the flip = "how sure am I"; it also reveals, so it costs no extra keystroke.
        e.preventDefault();
        setConfidence(rating as Confidence);
        setRevealed(true);
        return;
      }
      if (revealed && rating) {
        rateMutation.mutate({ cardId: current.id, rating });
        return;
      }
      switch (e.key.toLowerCase()) {
        case 's':
          removeMutation.mutate({ cardId: current.id, patch: { suspended: true } });
          break;
        case 'x':
          removeMutation.mutate({ cardId: current.id, patch: { flagged: true } });
          break;
        case 'e':
          e.preventDefault(); // don't type the "e" into the textarea that is about to focus
          setEditing({ front: current.front, back: current.back });
          break;
        case 'f': {
          const href = sourceHref(subjectSlug, current);
          if (href) window.open(href, '_blank', 'noopener');
          break;
        }
      }
    },
    [current, busy, editing, revealed, rateMutation, removeMutation, subjectSlug],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (query.isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-fg-muted">
        Caricamento…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm">
        <p role="alert" className="text-danger">
          {(query.error as Error).message}
        </p>
        <Link href={`/materie/${subjectSlug}`} className="text-fg-secondary underline">
          Torna alla materia
        </Link>
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg text-fg-primary">
          {queue.length === 0 ? 'Nessuna card da ripassare oggi.' : 'Sessione completata.'}
        </p>
        {tally.reviewed > 0 && (
          <p className="text-sm text-fg-muted">
            {tally.reviewed} ripassate · {tally.again} da rivedere presto
          </p>
        )}
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            setTally({ reviewed: 0, again: 0 });
            void query.refetch();
          }}
          className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-sm text-fg-secondary hover:text-fg-primary"
        >
          Aggiorna coda
        </button>
        <Link href={`/materie/${subjectSlug}`} className="text-xs text-fg-muted underline">
          Torna alla materia
        </Link>
      </div>
    );
  }

  const href = sourceHref(subjectSlug, current);
  const plan = revealPlan(current, revealed);
  const mutationError = (rateMutation.error ?? removeMutation.error) as Error | null;

  return (
    <div className="flex h-full flex-col bg-bg-base text-fg-primary">
      <div className="flex items-center justify-between px-4 py-3 text-xs text-fg-muted md:px-6">
        <Link
          href={`/materie/${subjectSlug}`}
          className="hover:text-fg-secondary max-md:-m-3 max-md:p-3"
        >
          Esci
        </Link>
        <span className="font-mono tabular-nums">
          {index + 1} / {queue.length}
        </span>
      </div>

      {editing ? (
        <form
          className="flex flex-1 flex-col items-center justify-center gap-3 px-6"
          onSubmit={(e) => {
            e.preventDefault();
            editMutation.mutate({ cardId: current.id, ...editing });
          }}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setEditing(null);
            if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) e.currentTarget.requestSubmit();
          }}
        >
          <label className="w-full max-w-2xl text-xs text-fg-muted">
            Fronte
            <textarea
              autoFocus
              value={editing.front}
              onChange={(e) => setEditing({ ...editing, front: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-2 text-base text-fg-primary"
            />
          </label>
          <label className="w-full max-w-2xl text-xs text-fg-muted">
            Retro
            <textarea
              value={editing.back}
              onChange={(e) => setEditing({ ...editing, back: e.target.value })}
              rows={3}
              className="mt-1 w-full rounded-[var(--radius-control)] border border-border bg-bg-inset p-2 text-base text-fg-primary"
            />
          </label>
          <div className="flex items-center gap-3">
            <button
              type="submit"
              disabled={editMutation.isPending || !editing.front.trim() || !editing.back.trim()}
              className="rounded-[var(--radius-control)] bg-accent px-4 py-1.5 text-sm font-medium text-white hover:bg-accent-hover disabled:opacity-50"
            >
              Salva (Ctrl+Invio)
            </button>
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="text-sm text-fg-muted hover:text-fg-primary"
            >
              Annulla (Esc)
            </button>
          </div>
          {editMutation.isError && (
            <p role="alert" className="text-xs text-danger">
              {(editMutation.error as Error).message}
            </p>
          )}
        </form>
      ) : (
        <div className="flex flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-4 text-center md:px-6">
          <p className="text-[11px] uppercase tracking-wide text-fg-muted">{current.type}</p>
          <CardText
            text={current.front}
            side={plan.frontSide}
            className="max-w-2xl text-xl md:text-2xl"
          />

          {revealed ? (
            <>
              {plan.showBack && (
                <>
                  <div className="h-px w-24 bg-border" />
                  <CardText
                    text={current.back}
                    side="back"
                    className="max-w-2xl text-lg text-fg-secondary md:text-xl"
                  />
                </>
              )}
              {current.hint && (
                <p className="max-w-xl text-xs italic text-fg-muted">{current.hint}</p>
              )}
              {current.sourceRef && (
                <p className="max-w-xl rounded-[var(--radius-control)] bg-bg-inset px-3 py-1.5 font-mono text-[11px] text-fg-muted">
                  pag. {current.sourceRef.page} — &quot;{current.sourceRef.quote}&quot;
                </p>
              )}
              <div className="mt-2 grid w-full grid-cols-4 gap-2 md:flex md:w-auto">
                {([1, 2, 3, 4] as const).map((rating) => (
                  <button
                    key={rating}
                    type="button"
                    onClick={() => rateMutation.mutate({ cardId: current.id, rating })}
                    disabled={busy}
                    className="rounded-[var(--radius-control)] border border-border px-2 py-2 text-sm text-fg-secondary hover:border-accent hover:text-fg-primary max-md:min-h-11 md:px-4"
                  >
                    {rating} · {RATING_LABELS[rating]}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <div className="flex flex-col items-center gap-3">
              <div
                role="group"
                aria-label="Quanto sei sicuro?"
                className="flex flex-wrap items-center justify-center gap-2"
              >
                <span className="text-xs text-fg-muted max-md:w-full">Quanto sei sicuro?</span>
                {([1, 2, 3] as const).map((level) => (
                  <button
                    key={level}
                    type="button"
                    onClick={() => {
                      setConfidence(level);
                      setRevealed(true);
                    }}
                    className="rounded-[var(--radius-control)] border border-border px-3 py-1.5 text-xs text-fg-secondary hover:border-accent hover:text-fg-primary max-md:min-h-11"
                  >
                    {level} · {CONFIDENCE_LABELS[level]}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => setRevealed(true)}
                className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover max-md:min-h-11"
              >
                Mostra risposta <span className="max-md:hidden">(Space)</span>
              </button>
            </div>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-center gap-x-4 px-4 py-1 text-[11px] text-fg-muted md:gap-y-4 md:px-6 md:py-3 max-md:[&>*]:py-3">
        <span className="max-md:hidden">Space rivela</span>
        <span className="max-md:hidden">1-4 valuta</span>
        <button
          type="button"
          onClick={() => setEditing({ front: current.front, back: current.back })}
          disabled={busy}
          className="hover:text-fg-primary"
        >
          E modifica
        </button>
        <button
          type="button"
          onClick={() => removeMutation.mutate({ cardId: current.id, patch: { suspended: true } })}
          disabled={busy}
          className="hover:text-danger"
        >
          S sospendi
        </button>
        <button
          type="button"
          onClick={() => removeMutation.mutate({ cardId: current.id, patch: { flagged: true } })}
          disabled={busy}
          title="Segnala card scadente: esclusa dal ripasso"
          className="hover:text-danger"
        >
          X segnala
        </button>
        {href ? (
          <a href={href} target="_blank" rel="noopener" className="hover:text-fg-primary">
            F fonte
          </a>
        ) : (
          <span className="opacity-50">F fonte (nessuna)</span>
        )}
      </div>

      {mutationError && (
        <p role="alert" className="pb-2 text-center text-xs text-danger">
          {mutationError.message}
        </p>
      )}
    </div>
  );
}
