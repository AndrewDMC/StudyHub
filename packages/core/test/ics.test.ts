import { describe, expect, it } from 'vitest';
import { buildIcsCalendar, type IcsEvent } from '../src/ics.js';

const NOW = new Date('2026-01-15T10:30:00.000Z');

describe('buildIcsCalendar', () => {
  it('produces a valid VCALENDAR wrapper with CRLF line endings', () => {
    const ics = buildIcsCalendar([], NOW);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('VERSION:2.0\r\n');
    expect(ics).not.toContain('\n\n'); // every line break is \r\n, never a bare \n
  });

  it('writes one all-day VEVENT per item, DTSTART with no dashes', () => {
    const events: IcsEvent[] = [
      { uid: 'task-1@studyhub', dateStart: '2026-02-03', summary: 'Ripassa termodinamica' },
    ];
    const ics = buildIcsCalendar(events, NOW);
    expect(ics).toContain('BEGIN:VEVENT\r\n');
    expect(ics).toContain('UID:task-1@studyhub\r\n');
    expect(ics).toContain('DTSTART;VALUE=DATE:20260203\r\n');
    expect(ics).toContain('SUMMARY:Ripassa termodinamica\r\n');
    expect(ics).toContain('DTSTAMP:20260115T103000Z\r\n');
    expect(ics).toContain('END:VEVENT\r\n');
  });

  it('escapes commas, semicolons, backslashes and newlines in text fields', () => {
    const events: IcsEvent[] = [
      {
        uid: 'task-2@studyhub',
        dateStart: '2026-02-03',
        summary: 'Studia; ripassa, formula\\teorema',
        description: 'Riga uno\nRiga due',
      },
    ];
    const ics = buildIcsCalendar(events, NOW);
    expect(ics).toContain('SUMMARY:Studia\\; ripassa\\, formula\\\\teorema\r\n');
    expect(ics).toContain('DESCRIPTION:Riga uno\\nRiga due\r\n');
  });

  it('folds a line longer than 75 characters, continuation starting with a space', () => {
    const longSummary = 'S'.repeat(120);
    const ics = buildIcsCalendar([{ uid: 'x@studyhub', dateStart: '2026-02-03', summary: longSummary }], NOW);
    const summaryLine = ics.split('\r\n').find((l) => l.startsWith('SUMMARY:'))!;
    expect(summaryLine.length).toBeLessThanOrEqual(75);
    // The continuation is on the next physical line, indented by exactly one space.
    const lines = ics.split('\r\n');
    const idx = lines.indexOf(summaryLine);
    expect(lines[idx + 1]?.startsWith(' ')).toBe(true);
  });

  it('omits DESCRIPTION/CATEGORIES when not provided', () => {
    const ics = buildIcsCalendar([{ uid: 'x@studyhub', dateStart: '2026-02-03', summary: 'Solo titolo' }], NOW);
    expect(ics).not.toContain('DESCRIPTION:');
    expect(ics).not.toContain('CATEGORIES:');
  });

  it('joins multiple categories with a comma', () => {
    const ics = buildIcsCalendar(
      [
        {
          uid: 'x@studyhub',
          dateStart: '2026-02-03',
          summary: 'Titolo',
          categories: ['Fisica 1', 'Esame'],
        },
      ],
      NOW,
    );
    expect(ics).toContain('CATEGORIES:Fisica 1,Esame\r\n');
  });

  it('writes every event given, preserving order', () => {
    const events: IcsEvent[] = [
      { uid: 'a@studyhub', dateStart: '2026-02-01', summary: 'A' },
      { uid: 'b@studyhub', dateStart: '2026-02-02', summary: 'B' },
    ];
    const ics = buildIcsCalendar(events, NOW);
    const aIndex = ics.indexOf('UID:a@studyhub');
    const bIndex = ics.indexOf('UID:b@studyhub');
    expect(aIndex).toBeGreaterThan(-1);
    expect(bIndex).toBeGreaterThan(aIndex);
  });
});
