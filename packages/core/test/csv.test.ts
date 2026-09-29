import { describe, expect, it } from 'vitest';
import { buildCsv, parseCsv } from '../src/csv.js';

describe('buildCsv', () => {
  it('writes a header row and each data row, CRLF-terminated', () => {
    const csv = buildCsv(['front', 'back'], [["Cos'è X?", 'X è Y']]);
    expect(csv).toBe("front,back\r\nCos'è X?,X è Y\r\n");
  });

  it('quotes a field containing a comma, doubling nothing else', () => {
    const csv = buildCsv(['a'], [['uno, due, tre']]);
    expect(csv).toBe('a\r\n"uno, due, tre"\r\n');
  });

  it('quotes a field containing a double quote, doubling it', () => {
    const csv = buildCsv(['a'], [['disse "ciao"']]);
    expect(csv).toBe('a\r\n"disse ""ciao"""\r\n');
  });

  it('quotes a field containing a newline', () => {
    const csv = buildCsv(['a'], [['riga uno\nriga due']]);
    expect(csv).toBe('a\r\n"riga uno\nriga due"\r\n');
  });

  it('leaves a plain field unquoted', () => {
    const csv = buildCsv(['a'], [['semplice']]);
    expect(csv).toBe('a\r\nsemplice\r\n');
  });

  it('produces just the header row for an empty dataset', () => {
    const csv = buildCsv(['a', 'b'], []);
    expect(csv).toBe('a,b\r\n');
  });
});

describe('parseCsv', () => {
  it('round-trips whatever buildCsv writes, including quotes, commas and newlines', () => {
    const rows = [
      ['front', 'back'],
      ['Cos’è "X"?', 'uno, due\ntre'],
      ['', 'vuoto a sinistra'],
    ];
    expect(parseCsv(buildCsv(rows[0]!, rows.slice(1)))).toEqual(rows);
  });

  it('accepts LF endings, a BOM and a missing trailing newline', () => {
    expect(parseCsv('﻿a,b\n1,2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('autodetects semicolons and tabs (Excel / Anki exports)', () => {
    expect(parseCsv('a;b\n1;2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
    expect(parseCsv('a\tb\n1\t2')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });

  it('ignores blank lines and keeps empty middle fields', () => {
    expect(parseCsv('a,,c\n\n1,2,3\n')).toEqual([
      ['a', '', 'c'],
      ['1', '2', '3'],
    ]);
  });
});
