'use client';

import { useQuery } from '@tanstack/react-query';
import type { CoverageMapDto, CoverageTopicDto } from '@studyhub/contracts';

async function fetchCoverage(slug: string): Promise<CoverageMapDto> {
  const res = await fetch(`/api/subjects/${slug}/coverage`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body.coverage as CoverageMapDto;
}

const FLAG_LABELS: Record<CoverageTopicDto['flags'][number], string> = {
  no_material: 'Senza materiale',
  no_cards: 'Senza flashcard',
  weak: 'Debole',
};

/** Frequency as text *and* a bar: the color is never the only carrier (docs/05-design-system.md §6). */
function ExamFrequency({ topic }: { topic: CoverageTopicDto }) {
  if (topic.examTotal === 0)
    return <span className="text-fg-muted">{topic.recurring ? 'ricorrente' : '—'}</span>;
  const ratio = topic.examMentions / topic.examTotal;
  return (
    <span className="flex items-center gap-2">
      <span
        className="relative h-1.5 w-16 rounded-full bg-bg-inset"
        role="img"
        aria-label={`${topic.examMentions} esami su ${topic.examTotal}`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full bg-accent"
          style={{ width: `${ratio * 100}%` }}
        />
      </span>
      <span className="font-mono tabular-nums text-fg-secondary">
        {topic.examMentions}/{topic.examTotal}
      </span>
    </span>
  );
}

/**
 * "Lacune": topics × material × flashcards × past-exam frequency, worst gap first
 * (docs/06-miglioramenti.md #2). The match against exams is textual, so the counts are evidence,
 * not a verdict — the panel says so.
 */
export function CoveragePanel({ subjectSlug }: { subjectSlug: string }) {
  const query = useQuery({
    queryKey: ['coverage', subjectSlug],
    queryFn: () => fetchCoverage(subjectSlug),
  });

  if (query.isLoading) return <p className="text-sm text-fg-muted">Caricamento…</p>;
  if (query.isError)
    return (
      <p role="alert" className="text-sm text-danger">
        {(query.error as Error).message}
      </p>
    );
  const map = query.data!;
  const gaps = map.topics.filter((t) => t.flags.length > 0);

  if (map.topics.length === 0 && map.unmapped.length === 0)
    return (
      <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-8 text-center text-sm text-fg-muted">
        Nessun argomento ancora. Aggiungi gli argomenti della materia (o estraili dai documenti): la
        mappa incrocia poi materiale, flashcard ed esami passati.
      </div>
    );

  return (
    <div className="space-y-4" data-testid="coverage">
      <p className="text-xs text-fg-muted">
        {map.examTotal === 0
          ? 'Nessun esame passato con testo estratto: la frequenza non è calcolabile.'
          : `Frequenza calcolata su ${map.examTotal} ${map.examTotal === 1 ? 'esame passato' : 'esami passati'} cercando le parole dell'argomento nel testo: è un indizio, non un verdetto.`}
      </p>

      {gaps.length > 0 && (
        <section
          aria-label="Lacune principali"
          className="rounded-[var(--radius-card)] border border-warn bg-bg-surface p-4"
        >
          <h2 className="mb-2 text-sm font-semibold text-fg-primary">Da colmare per primo</h2>
          <ol className="space-y-1.5 text-sm text-fg-secondary">
            {gaps.slice(0, 5).map((t) => (
              <li key={t.topicId}>{t.message}</li>
            ))}
          </ol>
        </section>
      )}
      {gaps.length === 0 && map.topics.length > 0 && (
        <p className="rounded-[var(--radius-card)] border border-ok bg-bg-surface p-4 text-sm text-ok">
          Nessuna lacuna: ogni argomento ha materiale, flashcard e una mastery non bassa.
        </p>
      )}

      {map.unmapped.length > 0 && (
        <section
          aria-label="Temi d'esame senza argomento"
          className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-4"
        >
          <h2 className="mb-1 text-sm font-semibold text-fg-primary">
            Ricorrono negli esami ma non sono argomenti della materia
          </h2>
          <ul className="space-y-1 text-sm text-fg-secondary">
            {map.unmapped.map((u) => (
              <li key={u.name}>
                <span className="font-medium text-fg-primary">{u.name}</span> —{' '}
                {u.materialMentions === 0
                  ? 'nessun tuo documento ne parla'
                  : `citato in ${u.materialMentions} ${u.materialMentions === 1 ? 'tuo documento' : 'tuoi documenti'}`}
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="overflow-x-auto rounded-[var(--radius-card)] border border-border bg-bg-surface">
        <table className="w-full text-left text-xs">
          <thead className="text-fg-muted">
            <tr>
              <th className="px-3 py-2 font-medium">Argomento</th>
              <th className="px-3 py-2 font-medium">Negli esami</th>
              <th className="px-3 py-2 font-medium">Materiale</th>
              <th className="px-3 py-2 font-medium">Card</th>
              <th className="px-3 py-2 font-medium">Mastery</th>
              <th className="px-3 py-2 font-medium">Stato</th>
            </tr>
          </thead>
          <tbody>
            {map.topics.map((t) => (
              <tr key={t.topicId} className="border-t border-border">
                <td className="px-3 py-2 font-medium text-fg-primary">{t.name}</td>
                <td className="px-3 py-2">
                  <ExamFrequency topic={t} />
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-fg-secondary">
                  {t.materialDocs === 0 ? '—' : `${t.materialDocs} doc · ${t.materialPages} pag`}
                </td>
                <td className="px-3 py-2 font-mono tabular-nums text-fg-secondary">{t.cards}</td>
                <td className="px-3 py-2 font-mono tabular-nums text-fg-secondary">
                  {t.mastery === null ? 'N/D' : `${Math.round(t.mastery * 100)}%`}
                </td>
                <td className="px-3 py-2">
                  {t.flags.length === 0 ? (
                    <span className="text-ok">OK</span>
                  ) : (
                    <span className="text-warn">
                      {t.flags.map((f) => FLAG_LABELS[f]).join(' · ')}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
