'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { FlashcardDto } from '@studyhub/contracts';

async function fetchQueue(slug: string): Promise<FlashcardDto[]> {
  const res = await fetch(`/api/subjects/${slug}/review/queue`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la coda di ripasso');
  return body.queue as FlashcardDto[];
}

async function rate(slug: string, cardId: string, rating: 1 | 2 | 3 | 4, elapsedMs: number) {
  const res = await fetch(`/api/subjects/${slug}/review/${cardId}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rating, elapsedMs }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Invio della valutazione fallito');
  }
}

async function suspend(slug: string, cardId: string) {
  const res = await fetch(`/api/subjects/${slug}/flashcards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ suspended: true }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Sospensione fallita');
  }
}

const RATING_LABELS: Record<1 | 2 | 3 | 4, string> = {
  1: 'Again',
  2: 'Hard',
  3: 'Good',
  4: 'Easy',
};

/**
 * Full-screen review session (docs/fasi/F4-flashcard.md "Modalità Review"):
 * `Space` reveals the back, `1-4` rates, `S` suspends and skips to the next
 * card. Each rating is its own request — closing the tab mid-session loses
 * nothing already answered (F4 acceptance criterion).
 */
export function ReviewSessionClient({ subjectSlug }: { subjectSlug: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({
    queryKey: ['review-queue', subjectSlug],
    queryFn: () => fetchQueue(subjectSlug),
  });
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const cardStartRef = useRef(Date.now());

  const queue = query.data ?? [];
  const current = queue[index];

  useEffect(() => {
    cardStartRef.current = Date.now();
    setRevealed(false);
  }, [current?.id]);

  const rateMutation = useMutation({
    mutationFn: ({ cardId, rating }: { cardId: string; rating: 1 | 2 | 3 | 4 }) =>
      rate(subjectSlug, cardId, rating, Date.now() - cardStartRef.current),
    onSuccess: () => setIndex((i) => i + 1),
  });

  const suspendMutation = useMutation({
    mutationFn: (cardId: string) => suspend(subjectSlug, cardId),
    onSuccess: () => setIndex((i) => i + 1),
  });

  const handleKey = useCallback(
    (e: KeyboardEvent) => {
      if (!current || rateMutation.isPending || suspendMutation.isPending) return;
      if (e.code === 'Space') {
        e.preventDefault();
        setRevealed(true);
        return;
      }
      if (revealed && ['Digit1', 'Digit2', 'Digit3', 'Digit4'].includes(e.code)) {
        const rating = Number(e.code.slice(-1)) as 1 | 2 | 3 | 4;
        rateMutation.mutate({ cardId: current.id, rating });
        return;
      }
      if (e.key === 's' || e.key === 'S') {
        suspendMutation.mutate(current.id);
      }
    },
    [current, revealed, rateMutation, suspendMutation],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [handleKey]);

  if (query.isLoading) {
    return (
      <div className="flex h-dvh items-center justify-center text-sm text-fg-muted">
        Caricamento…
      </div>
    );
  }

  if (query.isError) {
    return (
      <div className="flex h-dvh flex-col items-center justify-center gap-2 text-sm">
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
      <div className="flex h-dvh flex-col items-center justify-center gap-3 text-center">
        <p className="text-lg text-fg-primary">
          {queue.length === 0 ? 'Nessuna card da ripassare oggi.' : 'Sessione completata.'}
        </p>
        <button
          type="button"
          onClick={() => {
            setIndex(0);
            queryClient.invalidateQueries({ queryKey: ['review-queue', subjectSlug] });
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

  return (
    <div className="flex h-dvh flex-col bg-bg-base text-fg-primary">
      <div className="flex items-center justify-between px-6 py-3 text-xs text-fg-muted">
        <Link href={`/materie/${subjectSlug}`} className="hover:text-fg-secondary">
          Esci
        </Link>
        <span className="font-mono tabular-nums">
          {index + 1} / {queue.length}
        </span>
      </div>

      <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 text-center">
        <p className="text-[11px] uppercase tracking-wide text-fg-muted">{current.type}</p>
        <p className="max-w-2xl text-2xl">{current.front}</p>

        {revealed ? (
          <>
            <div className="h-px w-24 bg-border" />
            <p className="max-w-2xl text-xl text-fg-secondary">{current.back}</p>
            <p className="max-w-xl rounded-[var(--radius-control)] bg-bg-inset px-3 py-1.5 font-mono text-[11px] text-fg-muted">
              pag. {current.sourceRef.page} — &quot;{current.sourceRef.quote}&quot;
            </p>
            <div className="mt-2 flex gap-2">
              {([1, 2, 3, 4] as const).map((rating) => (
                <button
                  key={rating}
                  type="button"
                  onClick={() => rateMutation.mutate({ cardId: current.id, rating })}
                  disabled={rateMutation.isPending}
                  className="rounded-[var(--radius-control)] border border-border px-4 py-2 text-sm text-fg-secondary hover:border-accent hover:text-fg-primary"
                >
                  {rating} · {RATING_LABELS[rating]}
                </button>
              ))}
            </div>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setRevealed(true)}
            className="rounded-[var(--radius-control)] bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-accent-hover"
          >
            Mostra risposta (Space)
          </button>
        )}
      </div>

      <div className="flex items-center justify-center gap-4 px-6 py-3 text-[11px] text-fg-muted">
        <span>Space rivela</span>
        <span>1-4 valuta</span>
        <button
          type="button"
          onClick={() => suspendMutation.mutate(current.id)}
          disabled={suspendMutation.isPending}
          className="hover:text-danger"
        >
          S sospendi
        </button>
      </div>

      {(rateMutation.isError || suspendMutation.isError) && (
        <p role="alert" className="pb-2 text-center text-xs text-danger">
          {((rateMutation.error ?? suspendMutation.error) as Error).message}
        </p>
      )}
    </div>
  );
}
