import { describe, expect, it } from 'vitest';
import { buildCsv } from '../src/csv.js';

describe('buildCsv', () => {
  it('writes a header row and each data row, CRLF-terminated', () => {
    const csv = buildCsv(['front', 'back'], [['Cos\'è X?', 'X è Y']]);
    expect(csv).toBe('front,back\r\nCos\'è X?,X è Y\r\n');
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
