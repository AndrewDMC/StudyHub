'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { SubmitReviewResponse } from '@studyhub/contracts';
import { enqueueUndo, type OutboxOp } from '@/lib/quickReview';

/** A 4xx other than timeout/rate-limit: retrying would get the same answer. */
class PermanentError extends Error {}

const MAX_ATTEMPTS = 3;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function errorFrom(res: Response, fallback: string): Promise<Error> {
  const body = await res.json().catch(() => null);
  const message: string = body?.error?.message ?? fallback;
  const permanent = res.status >= 400 && res.status < 500 && ![408, 429].includes(res.status);
  return permanent ? new PermanentError(message) : new Error(message);
}

export interface OutboxStatus {
  /** Requests not yet confirmed by the server. */
  pending: number;
  /** Set when a request failed `MAX_ATTEMPTS` times: the outbox is paused until `retry()`. */
  error: string | null;
  /** A request the server refused for good (e.g. an undo of a card reviewed elsewhere): dropped. */
  rejected: string | null;
}

/**
 * Optimistic rating (docs/09-ripasso-mobile.md §C2): the session moves on at once and the requests
 * go out here, one at a time and in order, with exponential backoff. After three failures the
 * outbox pauses with the failed request still at its head, so nothing is lost or reordered.
 */
export function useReviewOutbox({
  onRated,
  onDrained,
}: {
  onRated: (key: string, result: SubmitReviewResponse) => void;
  onDrained: () => void;
}) {
  const opsRef = useRef<OutboxOp[]>([]);
  const reviewIdsRef = useRef(new Map<string, string>());
  const inFlightRef = useRef<string | null>(null);
  const runningRef = useRef(false);
  const callbacksRef = useRef({ onRated, onDrained });
  callbacksRef.current = { onRated, onDrained };
  const [status, setStatus] = useState<OutboxStatus>({ pending: 0, error: null, rejected: null });

  const sync = useCallback(
    (patch: Partial<OutboxStatus> = {}) =>
      setStatus((s) => ({ ...s, pending: opsRef.current.length, ...patch })),
    [],
  );

  const send = useCallback(async (op: OutboxOp) => {
    if (op.kind === 'rate') {
      const res = await fetch(`/api/subjects/${op.subjectSlug}/review/${op.cardId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rating: op.rating,
          elapsedMs: op.elapsedMs,
          ...(op.confidence ? { confidence: op.confidence } : {}),
        }),
        // Survives leaving the page right after the last rating.
        keepalive: true,
      });
      if (!res.ok) throw await errorFrom(res, 'Valutazione non salvata');
      const result = (await res.json()) as SubmitReviewResponse;
      reviewIdsRef.current.set(op.key, result.reviewId);
      callbacksRef.current.onRated(op.key, result);
      return;
    }
    const reviewId = reviewIdsRef.current.get(op.key);
    if (!reviewId) return; // its rating was never saved: nothing to undo
    const res = await fetch(`/api/review/${reviewId}`, { method: 'DELETE', keepalive: true });
    // 404: already gone, which is what the undo wanted.
    if (!res.ok && res.status !== 404) throw await errorFrom(res, 'Annullamento non salvato');
    reviewIdsRef.current.delete(op.key);
  }, []);

  const pump = useCallback(async () => {
    if (runningRef.current) return;
    runningRef.current = true;
    try {
      while (opsRef.current.length > 0) {
        const op = opsRef.current[0]!;
        inFlightRef.current = op.key;
        for (let attempt = 1; ; attempt += 1) {
          try {
            await send(op);
            break;
          } catch (err) {
            if (err instanceof PermanentError) {
              sync({ rejected: err.message });
              break;
            }
            if (attempt >= MAX_ATTEMPTS) {
              sync({ error: (err as Error).message });
              return;
            }
            await sleep(1000 * 2 ** (attempt - 1));
          }
        }
        opsRef.current = opsRef.current.slice(1);
        inFlightRef.current = null;
        sync();
      }
      callbacksRef.current.onDrained();
    } finally {
      runningRef.current = false;
      inFlightRef.current = null;
    }
  }, [send, sync]);

  const rate = useCallback(
    (op: Extract<OutboxOp, { kind: 'rate' }>) => {
      opsRef.current = [...opsRef.current, op];
      sync();
      if (!status.error) void pump();
    },
    [pump, sync, status.error],
  );

  const undo = useCallback(
    (key: string) => {
      opsRef.current = enqueueUndo(opsRef.current, key, inFlightRef.current);
      // Undoing the one rating that kept failing leaves nothing to retry.
      if (opsRef.current.length === 0) sync({ error: null });
      else sync();
      if (!status.error) void pump();
    },
    [pump, sync, status.error],
  );

  const retry = useCallback(() => {
    sync({ error: null });
    void pump();
  }, [pump, sync]);

  const dismissRejected = useCallback(() => sync({ rejected: null }), [sync]);

  // Leaving with ratings still queued would lose them: let the browser ask first.
  useEffect(() => {
    if (status.pending === 0) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [status.pending]);

  return { status, rate, undo, retry, dismissRejected };
}
