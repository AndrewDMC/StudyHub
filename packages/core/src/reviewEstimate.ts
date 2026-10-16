// Stima dei minuti di ripasso ("~ N min", docs/09-ripasso-mobile.md): funzione pura, usata dal server
// (overview) e dal client (via '@studyhub/core/browser').

/** Tempo per card assunto finché non c'è abbastanza storico. */
export const REVIEW_DEFAULT_MS_PER_CARD = 20_000;
/** La media per card è limitata a questo intervallo: un'abitudine anomala non deve dare stime assurde. */
export const REVIEW_MIN_MS_PER_CARD = 3_000;
export const REVIEW_MAX_MS_PER_CARD = 120_000;
/** Quante review recenti entrano nella media. */
export const REVIEW_ESTIMATE_SAMPLE = 200;
/** Sotto questa soglia di campioni si usa il default. */
export const REVIEW_ESTIMATE_MIN_SAMPLES = 10;
/** Review più lunghe di così (tab lasciata aperta) sono outlier e non entrano nella media. */
export const REVIEW_ESTIMATE_MAX_ELAPSED_MS = 5 * 60_000;

export function clampMsPerCard(ms: number): number {
  if (!Number.isFinite(ms)) return REVIEW_DEFAULT_MS_PER_CARD;
  return Math.min(REVIEW_MAX_MS_PER_CARD, Math.max(REVIEW_MIN_MS_PER_CARD, ms));
}

/**
 * Media dei tempi di risposta (ms) dalle review più recenti, outlier esclusi; meno di
 * `REVIEW_ESTIMATE_MIN_SAMPLES` campioni validi = default. Il risultato è sempre dentro il clamp.
 */
export function averageMsPerCard(elapsedMs: readonly number[]): number {
  const valid = elapsedMs.filter(
    (ms) => Number.isFinite(ms) && ms > 0 && ms <= REVIEW_ESTIMATE_MAX_ELAPSED_MS,
  );
  if (valid.length < REVIEW_ESTIMATE_MIN_SAMPLES) return REVIEW_DEFAULT_MS_PER_CARD;
  return Math.round(clampMsPerCard(valid.reduce((a, b) => a + b, 0) / valid.length));
}

/** Minuti (interi, per eccesso) per ripassare `dueCount` card: 0 se non ce ne sono, almeno 1 altrimenti. */
export function estimateReviewMinutes(dueCount: number, avgMsPerCard: number): number {
  if (!(dueCount > 0)) return 0;
  return Math.max(1, Math.ceil((dueCount * clampMsPerCard(avgMsPerCard)) / 60_000));
}
