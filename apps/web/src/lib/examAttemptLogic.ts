/** Pure pieces of `useExamAttempt`, kept apart so they can be unit tested. */

/** A failed save goes back in the queue; answers typed meanwhile (`pending`) win over the batch. */
export function requeueAnswers(
  batch: Record<string, string>,
  pending: Record<string, string>,
): Record<string, string> {
  return { ...batch, ...pending };
}

/** Whole seconds left until an absolute deadline (ms epoch), never negative. */
export function remainingFrom(deadlineMs: number, nowMs: number): number {
  return Math.max(0, Math.ceil((deadlineMs - nowMs) / 1000));
}

export type SubmitOutcome = { ok: true } | { ok: false; error: string };

/**
 * Save the last answers, then hand in. A failed save blocks the hand-in (unless `force`, i.e. the
 * time is up and the server closes the exam anyway); a network error on the hand-in is reported
 * so the caller can reset and let the user retry.
 */
export async function performSubmit({
  flush,
  post,
  force = false,
}: {
  flush: () => Promise<boolean>;
  post: () => Promise<unknown>;
  force?: boolean;
}): Promise<SubmitOutcome> {
  const saved = await flush();
  if (!saved && !force) {
    return { ok: false, error: 'Impossibile salvare le ultime risposte. Riprova.' };
  }
  try {
    await post();
  } catch {
    return { ok: false, error: 'Consegna non riuscita: controlla la connessione e riprova.' };
  }
  return { ok: true };
}
