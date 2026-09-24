/**
 * A DB connection failure often surfaces as `AggregateError` with an empty
 * top-level `.message` (Node wraps multiple failed connection attempts,
 * e.g. IPv4+IPv6, and leaves `.message` blank) — `err.message` alone would
 * violate "un errore mostra l'errore reale" (docs/fasi/F1-ingest.md).
 */
/** Shared so every route/lib module checks the same class with `instanceof`. */
export class SubjectNotFoundError extends Error {
  constructor(slug: string) {
    super(`Materia non trovata: ${slug}`);
    this.name = 'SubjectNotFoundError';
  }
}

export function formatError(err: unknown): string {
  if (err instanceof AggregateError && err.errors.length > 0) {
    const inner = err.errors.map((e) => (e instanceof Error ? e.message : String(e))).join('; ');
    if (inner) return inner;
  }
  if (err instanceof Error) {
    return err.message || err.name;
  }
  return String(err);
}
