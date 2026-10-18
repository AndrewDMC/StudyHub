import type {
  SessionMood,
  StudySessionDto,
  TopicDto,
  UpdateSessionRequest,
} from '@studyhub/contracts';

export async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

export async function fetchSession(slug: string, id: string): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}`),
    'Impossibile caricare la sessione',
  );
  return body.session;
}

export async function patchSession(
  slug: string,
  id: string,
  patch: UpdateSessionRequest,
): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }),
    'Aggiornamento della sessione fallito',
  );
  return body.session;
}

export async function postEnd(
  slug: string,
  id: string,
  totals: { activeMs: number; pomodoros: number },
): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}/end`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(totals),
    }),
    'Impossibile terminare la sessione',
  );
  return body.session;
}

export async function patchSessionMood(
  slug: string,
  id: string,
  mood: SessionMood | null,
): Promise<StudySessionDto> {
  const body = await readJson<{ session: StudySessionDto }>(
    await fetch(`/api/subjects/${slug}/sessions/${id}/mood`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mood }),
    }),
    'Impossibile salvare. Riprova.',
  );
  return body.session;
}

export async function fetchTopics(slug: string): Promise<TopicDto[]> {
  const body = await readJson<{ topics: TopicDto[] }>(
    await fetch(`/api/subjects/${slug}/topics`),
    'Impossibile caricare gli argomenti',
  );
  return body.topics;
}
