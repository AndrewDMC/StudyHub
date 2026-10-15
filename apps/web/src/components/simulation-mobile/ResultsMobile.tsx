'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { SimulationSummaryDto, TopicDto } from '@studyhub/contracts';
import { countBelowHalf } from '@/lib/simulationMobile';
import { useAttemptResults } from '@/lib/useAttemptResults';
import { DocHeader } from '../document-mobile/DocHeader';
import { getJson } from '../ExamPrepPanel';
import {
  SectionEmpty,
  SectionError,
  SkeletonRows,
  MobileSection,
} from '../subject-mobile/SectionState';
import { ResultItem } from './ResultItem';
import { ScoreCard } from './ScoreCard';
import { WeakTopicsSheet } from './WeakTopicsSheet';
import { cardClass, primaryButton } from './styles';

/** Results below md: score, per-exercise accordion with the formative correction. */
export function ResultsMobile({
  subjectSlug: slug,
  attemptId,
}: {
  subjectSlug: string;
  attemptId: string;
}) {
  const queryClient = useQueryClient();
  const { attemptQuery, resultsQuery, graded, pendingOpinions, secondOpinion, drill } =
    useAttemptResults(slug, attemptId);
  const attempt = attemptQuery.data;

  const sims = useQuery({
    queryKey: ['simulations', slug],
    queryFn: () =>
      getJson<SimulationSummaryDto[]>(`/api/subjects/${slug}/simulations`, 'simulations'),
  });
  const topicsQuery = useQuery({
    queryKey: ['topics', slug],
    queryFn: () => getJson<TopicDto[]>(`/api/subjects/${slug}/topics`, 'topics'),
  });

  const [openId, setOpenId] = useState<string | null | undefined>(undefined);
  const [weakOpen, setWeakOpen] = useState(false);
  const [announce, setAnnounce] = useState('');
  const drillRef = useRef<HTMLButtonElement>(null);
  const sawPending = useRef(false);

  // The list of simulations and the trends change once an attempt is graded.
  useEffect(() => {
    if (!graded) {
      if (attempt) sawPending.current = true;
      return;
    }
    if (sawPending.current) setAnnounce('Correzione completata');
    void queryClient.invalidateQueries({ queryKey: ['simulations', slug] });
    void queryClient.invalidateQueries({ queryKey: ['topic-trends', slug] });
  }, [graded, attempt?.id]);

  const backHref = `/materie/${slug}?tab=simulazioni`;
  const simTitle = sims.data?.find((s) => s.id === attempt?.simulationId)?.title;
  const settled = !!attempt && !sims.isLoading;
  const headerTitle = simTitle ?? (settled ? 'Risultati' : undefined);

  const results = resultsQuery.data;
  const firstWeak = results?.find((r) => r.max > 0 && r.awarded / r.max < 0.5)?.itemId ?? null;
  const effectiveOpen = openId === undefined ? firstWeak : openId;

  const weakTopics = (attempt?.weakTopics ?? []).map((id) => ({
    id,
    name: topicsQuery.data?.find((t) => t.id === id)?.name ?? 'Argomento',
  }));

  let body;
  if (attemptQuery.isLoading) {
    body = (
      <div aria-busy="true">
        <SkeletonRows count={2} />
      </div>
    );
  } else if (attemptQuery.isError || !attempt) {
    body = (
      <div className="flex flex-col gap-3">
        <SectionError
          message={(attemptQuery.error as Error | null)?.message ?? 'Tentativo non trovato'}
          onRetry={() => void attemptQuery.refetch()}
        />
        <Link href={backHref} className="flex min-h-11 items-center text-fg-secondary underline">
          Torna alle simulazioni
        </Link>
      </div>
    );
  } else if (attempt.status === 'in_progress') {
    body = (
      <div role="status" className={`${cardClass} flex flex-col gap-3 p-5 text-sm`}>
        <p>L&apos;esame è ancora in corso.</p>
        <Link
          href={`/materie/${slug}/simulations/${attempt.simulationId}`}
          className={`${primaryButton} min-h-12 text-[15px]`}
        >
          Riprendi l&apos;esame
        </Link>
      </div>
    );
  } else if (!graded) {
    body = (
      <div role="status" className={`${cardClass} flex flex-col items-start gap-3 p-5 text-sm`}>
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="size-4 shrink-0 animate-spin rounded-full border-2 border-info border-t-transparent motion-reduce:animate-none"
          />
          <p>Esame consegnato. La correzione è in corso…</p>
        </div>
        <p className="text-[13px] text-fg-secondary">La pagina si aggiorna da sola.</p>
        <Link href={backHref} className="flex min-h-11 items-center text-accent underline">
          Torna alle simulazioni
        </Link>
      </div>
    );
  } else {
    const startDrill = (topicId: string) => drill.mutate(topicId);
    body = (
      <>
        <ScoreCard
          slug={slug}
          awarded={attempt.totalAwarded}
          max={attempt.totalMax}
          belowHalf={results ? countBelowHalf(results) : null}
          weakCount={weakTopics.length}
          onDrill={() => {
            if (weakTopics.length === 1) startDrill(weakTopics[0]!.id);
            else setWeakOpen(true);
          }}
          drillRef={drillRef}
          drillPending={drill.isPending}
          drillDone={drill.isSuccess}
          drillError={drill.isError ? (drill.error as Error).message : null}
        />
        <MobileSection title="Correzione" busy={resultsQuery.isLoading}>
          {resultsQuery.isLoading ? (
            <SkeletonRows count={3} />
          ) : resultsQuery.isError ? (
            <SectionError
              message={(resultsQuery.error as Error).message}
              onRetry={() => void resultsQuery.refetch()}
            />
          ) : results && results.length === 0 ? (
            <SectionEmpty>Nessun dettaglio di correzione disponibile.</SectionEmpty>
          ) : (
            <ul className="flex flex-col gap-2">
              {(results ?? []).map((r) => (
                <li key={r.itemId}>
                  <ResultItem
                    slug={slug}
                    result={r}
                    open={effectiveOpen === r.itemId}
                    onToggle={() => setOpenId(effectiveOpen === r.itemId ? null : r.itemId)}
                    opinionPending={pendingOpinions.has(r.itemId)}
                    opinionRequesting={
                      secondOpinion.isPending && secondOpinion.variables === r.itemId
                    }
                    opinionError={
                      secondOpinion.isError && secondOpinion.variables === r.itemId
                        ? (secondOpinion.error as Error).message
                        : null
                    }
                    onAskOpinion={() => secondOpinion.mutate(r.itemId)}
                  />
                </li>
              ))}
            </ul>
          )}
        </MobileSection>
      </>
    );
  }

  return (
    <div className="flex min-h-full min-w-0 flex-col bg-bg-base text-fg-primary">
      <DocHeader
        backHref={backHref}
        backLabel="Torna alle simulazioni"
        subtitle={simTitle ? 'Risultati' : undefined}
        title={headerTitle}
      />
      <main className="flex min-w-0 flex-col gap-5 p-4">
        {body}
        <p aria-live="polite" className="sr-only">
          {announce}
        </p>
      </main>
      <WeakTopicsSheet
        open={weakOpen}
        onOpenChange={setWeakOpen}
        topics={weakTopics}
        onPick={(id) => drill.mutate(id)}
        returnFocusRef={drillRef}
      />
    </div>
  );
}
