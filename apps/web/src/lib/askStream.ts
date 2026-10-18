import type { AskSubjectEvent } from '@studyhub/contracts';
import { readSse } from './sseClient';

/** Error before the stream starts (HTTP status + server message). */
export class AskError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'AskError';
  }
}

export type AskScope = { docIds: string[] } | { topicIds: string[] } | Record<string, never>;

/**
 * POSTs a question to `/api/subjects/{slug}/ask` and streams the answer events. No model is sent
 * (the server default applies). Errors before the stream come back as a JSON error with its status.
 */
export async function streamAsk(
  slug: string,
  question: string,
  scope: AskScope,
  onEvent: (event: AskSubjectEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/ask`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    ...(signal ? { signal } : {}),
    body: JSON.stringify({ question, ...scope }),
  });
  if (!res.ok || !res.body) {
    const body = await res.json().catch(() => null);
    throw new AskError(res.status, body?.error?.message ?? 'Invio della domanda non riuscito');
  }
  await readSse<AskSubjectEvent>(res, onEvent);
}
