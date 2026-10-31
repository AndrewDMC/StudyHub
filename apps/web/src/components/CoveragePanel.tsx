'use client';

import { useQuery } from '@tanstack/react-query';
import type { CoverageMapDto, CoverageTopicDto } from '@studyhub/contracts';
import { SkeletonBlock, SkeletonRows } from '@/components/flashcards/shared/Skeletons';
import { ProgressBar } from './subject-tabs/ProgressBar';
import { StatTile } from './subject-tabs/StatTile';
import { TabEmptyState } from './subject-tabs/TabEmptyState';
import { TabSection } from './subject-tabs/TabSection';
import { TabError } from './subject-tabs/TabState';
import { CARD_BOX, DIVIDED, TAB_STACK } from './subject-tabs/styles';

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
    return <span className="text-fg-secondary">{topic.recurring ? 'ricorrente' : '—'}</span>;
  const ratio = topic.examMentions / topic.examTotal;
  return (
    <span className="flex items-center gap-2">
      <span
        role="img"
        aria-label={`${topic.examMentions} esami su ${topic.examTotal}`}
        className="w-16"
      >
        <ProgressBar ratio={ratio} tone="accent" />
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

  if (query.isLoading)
    return (
      <div role="status" aria-busy="true" className={TAB_STACK}>
        <span className="sr-only">Caricamento…</span>
        <div className="grid grid-cols-1 gap-3 @xl/tab:grid-cols-3">
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
          <SkeletonBlock className="h-24" />
        </div>
        <SkeletonRows count={4} />
      </div>
    );
  if (query.isError)
    return (
      <div className={TAB_STACK}>
        <TabError message={(query.error as Error).message} onRetry={() => query.refetch()} />
      </div>
    );
  const map = query.data!;
  const gaps = map.topics.filter((t) => t.flags.length > 0);
  const weak = map.topics.filter((t) => t.flags.includes('weak')).length;

  if (map.topics.length === 0 && map.unmapped.length === 0)
    return (
      <div className={TAB_STACK}>
        <TabEmptyState
          title="Nessun argomento ancora"
          text="Aggiungi gli argomenti della materia (o estraili dai documenti): la mappa incrocia poi materiale, flashcard ed esami passati."
        />
      </div>
    );

  return (
    <div className={TAB_STACK} data-testid="coverage">
      <div className="grid grid-cols-1 gap-3 @xl/tab:grid-cols-3">
        <StatTile
          label="Argomenti senza lacune"
          value={`${map.topics.length - gaps.length}/${map.topics.length}`}
          hint="con materiale, flashcard e mastery non bassa"
        />
        <StatTile label="Argomenti deboli" value={weak} hint="con mastery bassa" />
        <StatTile
          label="Temi senza argomento"
          value={map.unmapped.length}
          hint="ricorrono negli esami ma non sono argomenti"
        />
      </div>

      {gaps.length > 0 && (
        <TabSection
          title="Da colmare per primo"
          description="Ordinati per peso all'esame e per quanto ti manca."
        >
          <ol className={`${CARD_BOX} ${DIVIDED}`}>
            {gaps.slice(0, 5).map((t, i) => (
              <li key={t.topicId} className="flex flex-wrap items-center gap-x-5 gap-y-2 px-5 py-4">
                <span className="w-5 font-mono text-xs text-fg-secondary">{i + 1}</span>
                <div className="flex min-w-0 flex-1 basis-72 flex-col gap-0.5">
                  <span className="font-medium text-fg-primary">{t.name}</span>
                  <span className="text-[13px] text-fg-secondary">{t.message}</span>
                </div>
                <div className="text-xs">
                  <ExamFrequency topic={t} />
                </div>
              </li>
            ))}
          </ol>
        </TabSection>
      )}
      {gaps.length === 0 && map.topics.length > 0 && (
        <p className={`${CARD_BOX} border-ok p-4 text-sm text-ok`}>
          Nessuna lacuna: ogni argomento ha materiale, flashcard e una mastery non bassa.
        </p>
      )}

      {map.unmapped.length > 0 && (
        <TabSection
          title="Temi d'esame senza argomento"
          description="Ricorrono negli esami ma non sono argomenti della materia."
        >
          <ul className={`${CARD_BOX} ${DIVIDED}`}>
            {map.unmapped.map((u) => (
              <li key={u.name} className="px-5 py-3.5">
                <span className="font-medium text-fg-primary">{u.name}</span>
                <span className="text-[13px] text-fg-secondary">
                  {' — '}
                  {u.materialMentions === 0
                    ? 'nessun tuo documento ne parla'
                    : `citato in ${u.materialMentions} ${u.materialMentions === 1 ? 'tuo documento' : 'tuoi documenti'}`}
                </span>
              </li>
            ))}
          </ul>
        </TabSection>
      )}

      <TabSection title="Tutti gli argomenti">
        <div className={`${CARD_BOX} overflow-x-auto`}>
          <table className="w-full text-left text-[13px]">
            <thead className="text-xs uppercase tracking-[0.05em] text-fg-secondary">
              <tr>
                <th className="px-4 py-2.5 font-medium">Argomento</th>
                <th className="px-4 py-2.5 font-medium">Negli esami</th>
                <th className="px-4 py-2.5 font-medium">Materiale</th>
                <th className="px-4 py-2.5 font-medium">Card</th>
                <th className="px-4 py-2.5 font-medium">Mastery</th>
                <th className="px-4 py-2.5 font-medium">Stato</th>
              </tr>
            </thead>
            <tbody>
              {map.topics.map((t) => (
                <tr key={t.topicId} className="border-t border-border">
                  <td className="px-4 py-2.5 font-medium text-fg-primary">{t.name}</td>
                  <td className="px-4 py-2.5">
                    <ExamFrequency topic={t} />
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-fg-secondary">
                    {t.materialDocs === 0 ? '—' : `${t.materialDocs} doc · ${t.materialPages} pag`}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-fg-secondary">
                    {t.cards}
                  </td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-fg-secondary">
                    {t.mastery === null ? 'N/D' : `${Math.round(t.mastery * 100)}%`}
                  </td>
                  <td className="px-4 py-2.5">
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
      </TabSection>

      <p className="text-xs text-fg-secondary">
        {map.examTotal === 0
          ? 'Nessun esame passato con testo estratto: la frequenza non è calcolabile.'
          : `Frequenza calcolata su ${map.examTotal} ${map.examTotal === 1 ? 'esame passato' : 'esami passati'} cercando le parole dell'argomento nel testo: è un indizio, non un verdetto.`}
      </p>
    </div>
  );
}
