'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import type { CoverageMapDto, TopicDto } from '@studyhub/contracts';
import { filterCounts, matchesFilter, type GapFilter } from '@/lib/coverageMobile';
import { materialHref } from '@/lib/subjectTabs';
import { useTopicDue } from '../flashcard-mobile/queries';
import { GenerateSheet } from '../simulation-mobile/GenerateSheet';
import { secondaryButton } from '../simulation-mobile/styles';
import { SectionEmpty, SectionError, SkeletonRows } from '../subject-mobile/SectionState';
import { GapFilters } from './GapFilters';
import { PriorityCard } from './PriorityCard';
import type { SheetKind } from './TopicAction';
import { TopicCard } from './TopicCard';
import { TopicFlashcardsSheet } from './TopicFlashcardsSheet';
import { UnmappedDisclosure } from './UnmappedDisclosure';

async function fetchCoverage(slug: string): Promise<CoverageMapDto> {
  const res = await fetch(`/api/subjects/${slug}/coverage`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
  return body.coverage as CoverageMapDto;
}

/** Mobile "Lacune": priority gap, filters with counts and one card per topic. */
export function CoverageMobile({ slug, topics }: { slug: string; topics: TopicDto[] }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: ['coverage', slug], queryFn: () => fetchCoverage(slug) });
  const dueByTopic = useTopicDue(slug);
  const [filter, setFilter] = useState<GapFilter>('tutte');
  const [sheet, setSheet] = useState<{ kind: SheetKind; topicId: string } | null>(null);
  const [drillStarted, setDrillStarted] = useState(false);
  const triggerRef = useRef<HTMLElement | null>(null);

  const openSheet = (kind: SheetKind, topicId: string, trigger: HTMLElement) => {
    triggerRef.current = trigger;
    setSheet({ kind, topicId });
  };

  if (query.isLoading) {
    return (
      <div aria-busy="true">
        <SkeletonRows count={3} />
      </div>
    );
  }
  if (query.isError) {
    return (
      <SectionError message={(query.error as Error).message} onRetry={() => void query.refetch()} />
    );
  }
  const map = query.data!;

  if (map.topics.length === 0 && map.unmapped.length === 0) {
    return (
      <SectionEmpty>
        <p>
          Nessun argomento ancora. Aggiungi gli argomenti della materia (o estraili dai documenti):
          la mappa incrocia poi materiale, flashcard ed esami passati.
        </p>
        <Link href={materialHref(slug, 'tutti')} className={`${secondaryButton} mt-3 min-h-11`}>
          Vai al materiale
        </Link>
      </SectionEmpty>
    );
  }

  const priority = map.topics.find((t) => t.flags.length > 0);
  const visible = map.topics.filter((t) => matchesFilter(t, filter));
  const counts = filterCounts(map.topics);
  const sheetTopic = sheet ? map.topics.find((t) => t.topicId === sheet.topicId) : undefined;

  return (
    <div className="flex min-w-0 flex-col gap-5" data-testid="coverage">
      <p className="text-xs text-fg-muted">
        {map.examTotal === 0
          ? 'Nessun esame passato con testo estratto: la frequenza non è calcolabile.'
          : `Frequenza calcolata su ${map.examTotal} ${map.examTotal === 1 ? 'esame passato' : 'esami passati'} cercando le parole dell'argomento nel testo: è un indizio, non un verdetto.`}
      </p>

      {priority ? (
        <PriorityCard
          slug={slug}
          topic={priority}
          due={dueByTopic?.get(priority.topicId)}
          onOpenSheet={openSheet}
        />
      ) : (
        map.topics.length > 0 && (
          <p className="flex items-start gap-2 rounded-[var(--radius-card)] border border-ok bg-bg-surface p-4 text-sm text-ok">
            <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Nessuna lacuna: ogni argomento ha materiale, flashcard e una mastery non bassa.
          </p>
        )
      )}

      {drillStarted && (
        <div
          role="status"
          className="flex flex-col items-start gap-1 rounded-[var(--radius-card)] border border-ok bg-bg-surface p-3 text-sm text-ok"
        >
          <p>Drill in generazione — lo trovi nella tab Simulazioni.</p>
          <Link
            href={`/materie/${slug}?tab=simulazioni`}
            className="inline-flex min-h-11 items-center font-medium underline"
          >
            Vai alle simulazioni
          </Link>
        </div>
      )}

      {map.topics.length > 0 && (
        <>
          <GapFilters value={filter} counts={counts} onChange={setFilter} />
          <section>
            <h2 className="sr-only">Argomenti</h2>
            {visible.length === 0 ? (
              <SectionEmpty>Nessun argomento in questa categoria.</SectionEmpty>
            ) : (
              <ul className="space-y-3">
                {visible.map((t) => (
                  <li key={t.topicId} className="min-w-0">
                    <TopicCard
                      slug={slug}
                      topic={t}
                      due={dueByTopic?.get(t.topicId)}
                      onOpenSheet={openSheet}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}

      {map.unmapped.length > 0 && <UnmappedDisclosure unmapped={map.unmapped} />}

      <GenerateSheet
        slug={slug}
        mode="drill_argomento"
        documents={[]}
        topics={topics}
        open={sheet?.kind === 'drill'}
        onOpenChange={(o) => !o && setSheet(null)}
        initialTopicId={sheet?.kind === 'drill' ? sheet.topicId : undefined}
        returnFocusRef={triggerRef}
        onStarted={() => {
          setDrillStarted(true);
          void queryClient.invalidateQueries({ queryKey: ['simulations', slug] });
        }}
      />
      <TopicFlashcardsSheet
        open={sheet?.kind === 'flashcards'}
        onOpenChange={(o) => !o && setSheet(null)}
        slug={slug}
        topicId={sheet?.topicId ?? ''}
        topicName={sheetTopic?.name ?? ''}
        returnFocusRef={triggerRef}
      />
    </div>
  );
}
