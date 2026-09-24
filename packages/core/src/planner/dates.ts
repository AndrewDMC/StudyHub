/**
 * Calendar-day arithmetic on `YYYY-MM-DD` strings, UTC throughout. A plan is
 * a list of *days*, not instants: keeping dates as plain strings means a
 * task never drifts to the previous day because the server and the browser
 * disagree about the time zone (the F4 forecast bug, see
 * docs/fasi/F4-flashcard.md "Stato").
 */
export type IsoDate = string;

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDate(value: string): value is IsoDate {
  if (!ISO_DATE.test(value)) return false;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function toUtc(date: IsoDate): Date {
  if (!isIsoDate(date)) throw new Error(`data non valida (atteso YYYY-MM-DD): ${date}`);
  return new Date(`${date}T00:00:00.000Z`);
}

export function addDays(date: IsoDate, days: number): IsoDate {
  const d = toUtc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday (same convention as `Date#getUTCDay`). */
export function weekday(date: IsoDate): number {
  return toUtc(date).getUTCDay();
}

export function diffDays(from: IsoDate, to: IsoDate): number {
  return Math.round((toUtc(to).getTime() - toUtc(from).getTime()) / 86_400_000);
}

/** Days in [from, to) — the exam day itself is never a study day. */
export function eachDay(from: IsoDate, to: IsoDate): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = from; d < to; d = addDays(d, 1)) out.push(d);
  return out;
}

export function toIsoDate(instant: Date): IsoDate {
  return instant.toISOString().slice(0, 10);
}
