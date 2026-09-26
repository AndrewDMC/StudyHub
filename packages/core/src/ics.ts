/**
 * Minimal RFC 5545 (iCalendar) writer for the Planner's subscribable feed
 * (docs/fasi/F6-planner-calendario.md scope: "Export ICS (feed
 * sottoscrivibile)"). All-day events only — tasks and exams have a `date`,
 * not a time range (docs/fasi/F6-planner-calendario.md "Stato": "niente
 * starts_at/ends_at").
 */
export interface IcsEvent {
  /** Stable across regenerations — the same task/exam must always produce the same UID. */
  uid: string;
  /** `YYYY-MM-DD`. */
  dateStart: string;
  summary: string;
  description?: string;
  categories?: string[];
}

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newline must be escaped in TEXT values. */
function escapeIcsText(text: string): string {
  return text
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * RFC 5545 §3.1 line folding: no content line may exceed 75 octets: continuation lines start
 * with a single space. Folds at 75 *characters*, not octets — fine here since every string this
 * module writes is already ASCII (task/exam titles) or has gone through `escapeIcsText`, so
 * chars and UTF-8 octets coincide for the values in practice.
 */
function foldLine(line: string): string {
  const CHUNK = 75;
  if (line.length <= CHUNK) return line;
  let folded = line.slice(0, CHUNK);
  let rest = line.slice(CHUNK);
  while (rest.length > 0) {
    folded += `\r\n ${rest.slice(0, CHUNK - 1)}`;
    rest = rest.slice(CHUNK - 1);
  }
  return folded;
}

function toDtstamp(date: Date): string {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

/** One VCALENDAR with one VEVENT per item, CRLF line endings as the spec requires. */
export function buildIcsCalendar(events: IcsEvent[], now: Date = new Date()): string {
  const dtstamp = toDtstamp(now);
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//StudyHub//Planner//IT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];

  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(foldLine(`UID:${event.uid}`));
    lines.push(`DTSTAMP:${dtstamp}`);
    lines.push(`DTSTART;VALUE=DATE:${event.dateStart.replaceAll('-', '')}`);
    lines.push(foldLine(`SUMMARY:${escapeIcsText(event.summary)}`));
    if (event.description) {
      lines.push(foldLine(`DESCRIPTION:${escapeIcsText(event.description)}`));
    }
    if (event.categories && event.categories.length > 0) {
      lines.push(foldLine(`CATEGORIES:${event.categories.map(escapeIcsText).join(',')}`));
    }
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

/** One parsed VEVENT — always reduced to a plain date, matching the rest of the app's model (docs/fasi/F6-planner-calendario.md "Stato": "niente starts_at/ends_at"). */
export interface ParsedIcsEvent {
  uid: string;
  /** `YYYY-MM-DD`, taken from `DTSTART` (a full datetime is truncated to its date). */
  date: string;
  summary: string;
  description: string | null;
}

/** Reverses `escapeIcsText` (RFC 5545 §3.3.11). */
function unescapeIcsText(text: string): string {
  return text.replace(/\\(.)/g, (_, c: string) => (c === 'n' || c === 'N' ? '\n' : c));
}

/** RFC 5545 §3.1: a line beginning with a space or tab is a continuation of the previous line. */
function unfoldLines(raw: string): string[] {
  const physical = raw.split(/\r\n|\r|\n/);
  const unfolded: string[] = [];
  for (const line of physical) {
    if ((line.startsWith(' ') || line.startsWith('\t')) && unfolded.length > 0) {
      unfolded[unfolded.length - 1] += line.slice(1);
    } else if (line.length > 0) {
      unfolded.push(line);
    }
  }
  return unfolded;
}

/** `NAME;PARAM=X:value` and `NAME:value` alike — params are discarded, only the name and value matter here. */
function splitProperty(line: string): { name: string; value: string } | null {
  const colon = line.indexOf(':');
  if (colon === -1) return null;
  const nameAndParams = line.slice(0, colon);
  const name = (nameAndParams.split(';')[0] ?? '').toUpperCase();
  return { name, value: line.slice(colon + 1) };
}

/** `20260203`, `20260203T090000`, `20260203T090000Z` → `2026-02-03`. Anything shorter is not a valid date and is skipped. */
function toIsoDate(value: string): string | null {
  const digits = value.slice(0, 8);
  if (!/^\d{8}$/.test(digits)) return null;
  return `${digits.slice(0, 4)}-${digits.slice(4, 6)}-${digits.slice(6, 8)}`;
}

/**
 * Parses an RFC 5545 calendar into its VEVENTs — the counterpart to `buildIcsCalendar`, for
 * "Import ICS" (docs/fasi/F6-planner-calendario.md "Non implementato"). All-day only, like the
 * writer: a timed `DTSTART` is truncated to its date, never rejected — an imported busy day still
 * blocks that day even without a time range in this app's model. An event with no `UID` or no
 * parseable `DTSTART` is skipped rather than failing the whole import (a malformed VEVENT
 * shouldn't sink every other one in the same file).
 */
export function parseIcsCalendar(raw: string): ParsedIcsEvent[] {
  const lines = unfoldLines(raw);
  const events: ParsedIcsEvent[] = [];
  let current: Partial<Record<'UID' | 'DTSTART' | 'SUMMARY' | 'DESCRIPTION', string>> | null = null;

  for (const line of lines) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const date = current.DTSTART ? toIsoDate(current.DTSTART) : null;
        if (current.UID && date) {
          events.push({
            uid: current.UID,
            date,
            summary: current.SUMMARY ? unescapeIcsText(current.SUMMARY) : '(senza titolo)',
            description: current.DESCRIPTION ? unescapeIcsText(current.DESCRIPTION) : null,
          });
        }
      }
      current = null;
      continue;
    }
    if (!current) continue; // outside any VEVENT — VCALENDAR/VTIMEZONE noise, ignored

    const prop = splitProperty(line);
    if (!prop) continue;
    if (prop.name === 'UID' || prop.name === 'DTSTART' || prop.name === 'SUMMARY' || prop.name === 'DESCRIPTION') {
      current[prop.name] = prop.value;
    }
  }

  return events;
}
