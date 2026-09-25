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
