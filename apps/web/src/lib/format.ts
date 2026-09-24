/** Mirrors the worker's WEAK_ITEM_THRESHOLD (apps/worker/src/processors/exam/gradeAttempt.ts) for highlighting. */
export const WEAK_RATIO_UI = 0.6;

export function formatExamCountdown(isoDate: string): string {
  const days = Math.ceil((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'oggi';
  if (days === 1) return 'domani';
  return `tra ${days} giorni`;
}
