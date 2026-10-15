import type { FlashcardStatsDto } from '@studyhub/contracts';

export type FsrsCardState = keyof FlashcardStatsDto['countsByState'];
export type Tone = 'accent' | 'warn' | 'ok' | 'danger';

/** Label and colour token of each FSRS state; the colour is only ever a reinforcement of the label. */
export const CARD_STATE_VIEW: Record<FsrsCardState, { label: string; tone: Tone }> = {
  new: { label: 'Nuova', tone: 'accent' },
  learning: { label: 'In apprendimento', tone: 'warn' },
  review: { label: 'In ripasso', tone: 'ok' },
  relearning: { label: 'Da rinforzare', tone: 'danger' },
};

export const STAT_TILES: { state: FsrsCardState; label: string; tone: Tone }[] = [
  { state: 'new', label: 'Nuove', tone: 'accent' },
  { state: 'learning', label: 'In apprendimento', tone: 'warn' },
  { state: 'review', label: 'In ripasso', tone: 'ok' },
  { state: 'relearning', label: 'Da rinforzare', tone: 'danger' },
];

export const TONE_VAR: Record<Tone, string> = {
  accent: 'var(--accent)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  danger: 'var(--danger)',
};

/** Weighted means (by `count`) of actual and predicted retention, 0..1; null without buckets. */
export function retentionSummary(
  buckets: FlashcardStatsDto['retention']['buckets'],
): { actual: number; predicted: number } | null {
  const total = buckets.reduce((sum, b) => sum + b.count, 0);
  if (buckets.length === 0 || total === 0) return null;
  return {
    actual: buckets.reduce((sum, b) => sum + b.actual * b.count, 0) / total,
    predicted: buckets.reduce((sum, b) => sum + b.predicted * b.count, 0) / total,
  };
}

/** Neutral, verifiable sentence under the retention tiles. */
export function retentionMessage(actual: number, predicted: number): string {
  if (actual < predicted - 0.03) return 'Ricordi un po’ meno del previsto.';
  if (actual > predicted + 0.03) return 'Ricordi più del previsto.';
  return 'Ricordi quanto previsto.';
}

/** Tallest day of the forecast and its index (0 = today). */
export function forecastPeak(forecast: { count: number }[]): { max: number; dayIndex: number } {
  let max = 0;
  let dayIndex = 0;
  forecast.forEach((day, i) => {
    if (day.count > max) {
      max = day.count;
      dayIndex = i;
    }
  });
  return { max, dayIndex };
}

export function deckCardsLabel(n: number): string {
  return n === 1 ? '1 card generata' : `${n} card generate`;
}

export function draftDecksLabel(n: number): string {
  return n === 1 ? '1 mazzo da approvare' : `${n} mazzi da approvare`;
}

export type ReviewMark = 'keep' | 'drop';

/** Counters of the deck review: marks are local, `left` are the cards still unmarked. */
export function reviewProgress(
  marks: Record<string, ReviewMark>,
  total: number,
): { kept: number; dropped: number; left: number; reviewed: number } {
  const values = Object.values(marks);
  const kept = values.filter((m) => m === 'keep').length;
  const dropped = values.filter((m) => m === 'drop').length;
  return { kept, dropped, left: Math.max(0, total - kept - dropped), reviewed: kept + dropped };
}

/** Plain text of a card face (cloze markers resolved), for accessible names. */
export function plainCardText(text: string): string {
  return text
    .replace(/\{\{c\d+::([\s\S]*?)(?:::[\s\S]*?)?\}\}/g, '$1')
    .replace(/\{\{\.\.\.\}\}/g, '…')
    .replace(/!\[([^\]]*)\]\([^)\s]*\)/g, '$1')
    .replace(/\$+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}
