/**
 * Exam-mode timer (docs/fasi/F5-esami-simulazioni.md acceptance: "chiudo la
 * tab per errore, riapro, le risposte ci sono e il timer è corretto"). The
 * server owns the clock: remaining time is always derived from the
 * persisted `startedAt`, never from a countdown kept in the browser — so a
 * reload, a closed tab or a second device all see the same number.
 */
export function remainingSeconds(
  startedAt: Date,
  durationMin: number,
  now: Date = new Date(),
): number {
  const endsAt = startedAt.getTime() + durationMin * 60_000;
  return Math.max(0, Math.floor((endsAt - now.getTime()) / 1000));
}

export function isExpired(startedAt: Date, durationMin: number, now: Date = new Date()): boolean {
  return remainingSeconds(startedAt, durationMin, now) === 0;
}
