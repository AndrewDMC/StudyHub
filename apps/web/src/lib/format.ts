import { PASS_RATIO } from '@studyhub/core/browser';

/** Below this ratio an exercise is highlighted as weak: the shared pass bar `PASS_RATIO` of @studyhub/core. */
export const WEAK_RATIO_UI = PASS_RATIO;

/** Recurring-topic label of the exam profile: "Integrali ×6", or just the name without a count. */
export function formatRecurringTopic(t: { name: string; count: number | null }): string {
  return t.count === null ? t.name : `${t.name} ×${t.count}`;
}

export function formatExamCountdown(isoDate: string): string {
  const days = Math.ceil((new Date(isoDate).getTime() - Date.now()) / (24 * 60 * 60 * 1000));
  if (days <= 0) return 'oggi';
  if (days === 1) return 'domani';
  return `tra ${days} giorni`;
}

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

/**
 * Interval under a rating button (docs/09-ripasso-mobile.md §B4): "<1 min", "8 min", "3 h", "1 g",
 * "4 g", "2 mesi", "1 anno". Rounded to the nearest unit, never "0".
 */
export function formatInterval(ms: number): string {
  if (ms < MINUTE) return '<1 min';
  if (ms < HOUR) return `${Math.round(ms / MINUTE)} min`;
  if (ms < DAY) return `${Math.round(ms / HOUR)} h`;
  const days = Math.round(ms / DAY);
  if (days < 30) return `${days} g`;
  if (days < 365) {
    const months = Math.round(days / 30);
    return months === 1 ? '1 mese' : `${months} mesi`;
  }
  const years = Math.round((days / 365) * 10) / 10;
  return years === 1 ? '1 anno' : `${String(years).replace('.', ',')} anni`;
}
