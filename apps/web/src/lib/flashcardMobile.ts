import type { FlashcardStatsDto } from '@studyhub/contracts';

export type FsrsCardState = keyof FlashcardStatsDto['countsByState'];
export type Tone = 'accent' | 'warn' | 'ok' | 'danger' | 'info';

/**
 * Label and colour token of each FSRS state; the colour is only ever a reinforcement of the label.
 * `danger` is reserved for "Segnalata" and errors.
 */
export const CARD_STATE_VIEW: Record<FsrsCardState, { label: string; tone: Tone }> = {
  new: { label: 'Nuova', tone: 'info' },
  learning: { label: 'In apprendimento', tone: 'accent' },
  review: { label: 'In ripasso', tone: 'ok' },
  relearning: { label: 'Da rinforzare', tone: 'warn' },
};

export const STAT_TILES: { state: FsrsCardState; label: string; tone: Tone }[] = [
  { state: 'new', label: 'Nuove', tone: 'info' },
  { state: 'learning', label: 'In apprendimento', tone: 'accent' },
  { state: 'review', label: 'In ripasso', tone: 'ok' },
  { state: 'relearning', label: 'Da rinforzare', tone: 'warn' },
];

export const TONE_VAR: Record<Tone, string> = {
  accent: 'var(--accent)',
  warn: 'var(--warn)',
  ok: 'var(--ok)',
  danger: 'var(--danger)',
  info: 'var(--info)',
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

/**
 * Short due label of a card row: "oggi", "domani", "tra N g"; "—" for new or suspended cards.
 * Day boundaries follow the server queue (`endOfDay` in `lib/review.ts`): the end of the UTC day.
 */
export function formatCardDue(dueAt: string | null | undefined, now = Date.now()): string {
  if (!dueAt) return '—';
  const at = Date.parse(dueAt);
  if (Number.isNaN(at)) return '—';
  const dayMs = 86_400_000;
  const endOfToday = new Date(
    `${new Date(now).toISOString().slice(0, 10)}T23:59:59.999Z`,
  ).getTime();
  if (at <= endOfToday) return 'oggi';
  const days = Math.ceil((at - endOfToday) / dayMs);
  return days === 1 ? 'domani' : `tra ${days} g`;
}

/**
 * Long due label of the card list and detail: "oggi", "domani", "tra N giorni"; "in coda" for a
 * card never reviewed; "—" when nothing is scheduled. Same day boundary as `formatCardDue`.
 */
export function formatCardDueLong(
  card: { state: FsrsCardState; dueAt?: string | null },
  now = Date.now(),
): string {
  if (!card.dueAt) return card.state === 'new' ? 'in coda' : '—';
  const short = formatCardDue(card.dueAt, now);
  return short.startsWith('tra ') ? short.replace(/ g$/, ' giorni') : short;
}

/** "1 ripasso" / "3 ripassi" and "1 errore" / "2 errori"; "Mai ripassata" without reviews. */
export function cardHistoryLabel(reps: number, lapses: number): string {
  if (reps === 0) return 'Mai ripassata';
  const r = reps === 1 ? '1 ripasso' : `${reps} ripassi`;
  const l = lapses === 1 ? '1 errore' : `${lapses} errori`;
  return `${r} · ${l}`;
}
