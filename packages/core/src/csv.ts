/**
 * Minimal RFC 4180 CSV writer — dependency-free, same spirit as `ics.ts`. Used for the deck
 * export that's importable into Anki's own CSV importer (docs/fasi/F4-flashcard.md scope:
 * "Export/import Anki `.apkg` (bidirezionale) e CSV" — this is the CSV half; see that file's
 * "Stato" for what's declared out of scope).
 */

/** Quotes a field only when it needs it (contains a comma, quote or newline); doubles internal quotes. */
function escapeCsvField(field: string): string {
  if (/[",\r\n]/.test(field)) {
    return `"${field.replace(/"/g, '""')}"`;
  }
  return field;
}

/** `headers` + `rows`, CRLF line endings as the RFC requires. */
export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCsvField).join(','));
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * RFC 4180 reader, the inverse of `buildCsv`: quoted fields (with `""` escapes and embedded
 * newlines), CRLF or LF rows, an optional UTF-8 BOM. `delimiter` defaults to autodetection from
 * the first line (comma, semicolon or tab) because Excel and Anki write different ones.
 */
export function parseCsv(text: string, delimiter?: string): string[][] {
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text; // UTF-8 BOM
  const sep = delimiter ?? detectDelimiter(source);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field === '') {
      inQuotes = true;
    } else if (ch === sep) {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && source[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  // A blank line parses as [''] — not a record.
  return rows.filter((r) => !(r.length === 1 && r[0] === ''));
}

function detectDelimiter(source: string): string {
  const firstLine = source.split(/\r?\n/, 1)[0] ?? '';
  // Ignore delimiters inside quotes on the first line.
  const unquoted = firstLine.replace(/"[^"]*"/g, '');
  const counts = [',', ';', '\t'].map((d) => [d, unquoted.split(d).length - 1] as const);
  const best = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
  return best[1] > 0 ? best[0] : ',';
}
