'use client';

import Link from 'next/link';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  SessionBriefingDto,
  SessionDeckResult,
  SessionDrillResult,
  StudySessionDto,
} from '@studyhub/contracts';
import { Button } from '@/components/ui/button';

async function readJson<T>(res: Response, fallback: string): Promise<T> {
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? fallback);
  return body as T;
}

const base = (slug: string, sessionId: string) => `/api/subjects/${slug}/sessions/${sessionId}`;

/** Same request and query key as `SessionBriefing`: opening both costs one fetch. */
async function fetchBriefing(slug: string, sessionId: string): Promise<SessionBriefingDto> {
  return readJson(
    await fetch(`${base(slug, sessionId)}/briefing`),
    'Impossibile caricare punti chiave ed esercizi',
  );
}

/** Minutes, rounded, never below 1 for a session that really ran (a 20 s test is not "0 min"). */
const minutes = (ms: number) => (ms <= 0 ? 0 : Math.max(1, Math.round(ms / 60_000)));

/**
 * What "Termina" proposes once a session is over (docs/08 §2): the study time against the plan, cards from
 * the key points and a drill from the exercises the student got wrong. Both actions are free (no AI call)
 * and idempotent — asking twice shows the same deck / drill.
 */
export function SessionClosing({
  slug,
  sessionId,
  session,
  sessionKey,
}: {
  slug: string;
  sessionId: string;
  session: StudySessionDto;
  sessionKey: readonly unknown[];
}) {
  const queryClient = useQueryClient();
  const briefing = useQuery({
    queryKey: ['sessionBriefing', slug, sessionId],
    queryFn: () => fetchBriefing(slug, sessionId),
  });
  const items = briefing.data?.items ?? [];
  const keyPoints = items.filter((i) => i.kind === 'key_point').length;
  const wrong = items.filter((i) => i.kind === 'exercise' && i.state === 'wrong').length;
  const answered = items.filter((i) => i.kind === 'exercise' && i.state !== 'open');
  const right = answered.filter((i) => i.state === 'correct').length;

  const refresh = () => queryClient.invalidateQueries({ queryKey: sessionKey });
  const deck = useMutation({
    mutationFn: async () =>
      readJson<SessionDeckResult>(
        await fetch(`${base(slug, sessionId)}/flashcards`, { method: 'POST' }),
        'Creazione del mazzo non riuscita',
      ),
    onSuccess: refresh,
  });
  const drill = useMutation({
    mutationFn: async () =>
      readJson<SessionDrillResult>(
        await fetch(`${base(slug, sessionId)}/drill`, { method: 'POST' }),
        'Creazione del drill non riuscita',
      ),
    onSuccess: refresh,
  });

  const deckId = session.flashcardDeckId;
  const drillId = session.drillId;
  const studied = minutes(session.activeMs);

  return (
    <section
      aria-label="Chiusura della sessione"
      className="space-y-3 rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
    >
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 className="text-base font-semibold text-fg-primary">Com&apos;è andata</h2>
        <p className="text-sm text-fg-secondary">
          Hai studiato {studied} min
          {session.taskMinutes ? ` su ${session.taskMinutes} previsti` : ''}
          {answered.length > 0 ? ` · esercizi giusti ${right}/${answered.length}` : ''}.
        </p>
      </div>

      {briefing.isLoading ? (
        <p className="text-sm text-fg-muted">Caricamento…</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-3">
            <p className="text-sm font-medium text-fg-primary">Flashcard dai punti chiave</p>
            {deckId ? (
              <Link
                className="text-sm text-accent underline-offset-2 hover:underline"
                href={`/materie/${slug}/artifacts/${deckId}`}
              >
                Apri il mazzo →
              </Link>
            ) : keyPoints === 0 ? (
              <p className="text-xs text-fg-muted">
                Non hai generato punti chiave in questa sessione.
              </p>
            ) : (
              <>
                <p className="text-xs text-fg-muted">
                  {keyPoints} {keyPoints === 1 ? 'carta' : 'carte'}, ciascuna con la sua fonte.
                  Gratis. Il mazzo resta in bozza finché non lo approvi.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={deck.isPending}
                  onClick={() => deck.mutate()}
                >
                  {deck.isPending ? 'Creo il mazzo…' : 'Crea flashcard'}
                </Button>
              </>
            )}
            {deck.isError && (
              <p role="alert" className="text-xs text-danger">
                {(deck.error as Error).message}
              </p>
            )}
          </div>

          <div className="space-y-2 rounded-[var(--radius-control)] border border-border bg-bg-inset p-3">
            <p className="text-sm font-medium text-fg-primary">Esercizi sbagliati nei drill</p>
            {drillId ? (
              <Link
                className="text-sm text-accent underline-offset-2 hover:underline"
                href={`/materie/${slug}/simulations/${drillId}`}
              >
                Apri il drill →
              </Link>
            ) : wrong === 0 ? (
              <p className="text-xs text-fg-muted">Nessun esercizio segnato come sbagliato.</p>
            ) : (
              <>
                <p className="text-xs text-fg-muted">
                  {wrong} {wrong === 1 ? 'esercizio' : 'esercizi'} da rifare in un drill. Gratis da
                  creare; la correzione del tentativo è quella degli esami.
                </p>
                <Button
                  type="button"
                  size="sm"
                  disabled={drill.isPending}
                  onClick={() => drill.mutate()}
                >
                  {drill.isPending ? 'Creo il drill…' : 'Crea il drill'}
                </Button>
              </>
            )}
            {drill.isError && (
              <p role="alert" className="text-xs text-danger">
                {(drill.error as Error).message}
              </p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
