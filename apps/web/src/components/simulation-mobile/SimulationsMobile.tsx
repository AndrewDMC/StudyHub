'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DocumentDto,
  ExamProfileDto,
  SimulationSummaryDto,
  TopicDto,
  TopicTrendDto,
} from '@studyhub/contracts';
import { getJson } from '../ExamPrepPanel';
import { ExamProfileCard } from './ExamProfileCard';
import { GenerateSheet, type GenerateMode } from './GenerateSheet';
import { ProfileEditSheet } from './ProfileEditSheet';
import { ReextractSheet } from './ReextractSheet';
import { SimulationList, type GeneratingRow } from './SimulationList';
import { SimulationSheet } from './SimulationSheet';
import { TrendsDisclosure } from './TrendsDisclosure';
import { primaryButton, secondaryButton } from './styles';

const GENERATING_TTL_MS = 3 * 60 * 1000;

type Generating = GeneratingRow & { baseCount: number };

/** Simulazioni tab below md: exam profile, generation, the list of simulations and the trends. */
export function SimulationsMobile({
  slug,
  documents,
  topics,
}: {
  slug: string;
  documents: DocumentDto[];
  topics: TopicDto[];
}) {
  const queryClient = useQueryClient();
  const [generating, setGenerating] = useState<Generating[]>([]);
  const [editOpen, setEditOpen] = useState(false);
  const [reextractOpen, setReextractOpen] = useState(false);
  const [generateMode, setGenerateMode] = useState<GenerateMode | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [extractNotice, setExtractNotice] = useState<string | null>(null);
  const [startedNotice, setStartedNotice] = useState<string | null>(null);

  const editRef = useRef<HTMLButtonElement | null>(null);
  const reextractRef = useRef<HTMLButtonElement | null>(null);
  const fullRef = useRef<HTMLButtonElement | null>(null);
  const drillRef = useRef<HTMLButtonElement | null>(null);
  const rowRef = useRef<HTMLElement | null>(null);
  const fullHelpId = useId();
  const drillHelpId = useId();

  const profileQuery = useQuery({
    queryKey: ['exam-profile', slug],
    queryFn: () => getJson<ExamProfileDto | null>(`/api/subjects/${slug}/exam-profile`, 'profile'),
  });
  const simsQuery = useQuery({
    queryKey: ['simulations', slug],
    queryFn: () =>
      getJson<SimulationSummaryDto[]>(`/api/subjects/${slug}/simulations`, 'simulations'),
    refetchInterval: generating.length > 0 ? 3000 : false,
  });
  const trendsQuery = useQuery({
    queryKey: ['topic-trends', slug],
    queryFn: () => getJson<TopicTrendDto[]>(`/api/subjects/${slug}/topic-trends`, 'trends'),
  });

  const profile = profileQuery.data;
  const sims = simsQuery.data;

  // A local "in generazione" row goes away once the list has grown past its size at request time.
  useEffect(() => {
    if (!sims) return;
    setGenerating((rows) => {
      const next = rows.filter((r) => sims.length <= r.baseCount);
      return next.length === rows.length ? rows : next;
    });
  }, [sims]);

  const startGenerating = (label: string) => {
    const key = `${Date.now()}-${Math.random()}`;
    setGenerating((rows) => [...rows, { key, label, baseCount: sims?.length ?? 0 }]);
    setStartedNotice('Generazione avviata — la lista si aggiorna a breve.');
    void queryClient.invalidateQueries({ queryKey: ['simulations', slug] });
    setTimeout(() => {
      setGenerating((rows) => rows.filter((r) => r.key !== key));
      void queryClient.invalidateQueries({ queryKey: ['simulations', slug] });
    }, GENERATING_TTL_MS);
  };

  const selected = sims?.find((s) => s.id === selectedId) ?? null;

  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ExamProfileCard
        query={profileQuery}
        notice={extractNotice}
        onEdit={() => setEditOpen(true)}
        onReextract={() => setReextractOpen(true)}
        editRef={editRef}
        reextractRef={reextractRef}
      />

      <section aria-label="Genera" className="flex flex-col gap-2">
        <button
          type="button"
          ref={fullRef}
          aria-haspopup="dialog"
          aria-describedby={profile ? undefined : fullHelpId}
          disabled={!profile}
          onClick={() => setGenerateMode('esame_completo')}
          className={`${primaryButton} min-h-[52px] text-[15px]`}
        >
          Nuova simulazione completa
        </button>
        {!profile && !profileQuery.isLoading && (
          <p id={fullHelpId} className="text-center text-xs text-fg-muted">
            Serve prima il profilo dell&apos;esame.
          </p>
        )}
        <button
          type="button"
          ref={drillRef}
          aria-haspopup="dialog"
          aria-describedby={topics.length === 0 ? drillHelpId : undefined}
          disabled={topics.length === 0}
          onClick={() => setGenerateMode('drill_argomento')}
          className={`${secondaryButton} min-h-11`}
        >
          Drill su un argomento…
        </button>
        {topics.length === 0 && (
          <p id={drillHelpId} className="text-center text-xs text-fg-muted">
            Servono degli argomenti: carica e analizza del materiale.
          </p>
        )}
        <p className="text-center text-xs text-fg-muted">
          Vedi la stima del costo prima di confermare
        </p>
        {startedNotice && (
          <p role="status" className="text-center text-[13px] text-ok">
            {startedNotice}
          </p>
        )}
      </section>

      <SimulationList
        query={simsQuery}
        generating={generating}
        hasProfile={!!profile}
        onOpen={(sim, trigger) => {
          rowRef.current = trigger;
          setSelectedId(sim.id);
          setSheetOpen(true);
        }}
      />

      <TrendsDisclosure trends={trendsQuery.data ?? []} />

      <ProfileEditSheet
        slug={slug}
        profile={profile}
        open={editOpen}
        onOpenChange={setEditOpen}
        returnFocusRef={editRef}
      />
      <ReextractSheet
        slug={slug}
        hasProfile={!!profile}
        open={reextractOpen}
        onOpenChange={setReextractOpen}
        onStarted={() => {
          setExtractNotice('Estrazione avviata — il profilo si aggiorna a breve.');
          setTimeout(
            () => void queryClient.invalidateQueries({ queryKey: ['exam-profile', slug] }),
            3000,
          );
        }}
        returnFocusRef={reextractRef}
      />
      <GenerateSheet
        slug={slug}
        mode={generateMode ?? 'esame_completo'}
        documents={documents}
        topics={topics}
        open={generateMode !== null}
        onOpenChange={(o) => {
          if (!o) setGenerateMode(null);
        }}
        onStarted={startGenerating}
        returnFocusRef={generateMode === 'drill_argomento' ? drillRef : fullRef}
      />
      <SimulationSheet
        slug={slug}
        sim={selected}
        open={sheetOpen && selected !== null}
        onOpenChange={setSheetOpen}
        returnFocusRef={rowRef}
      />
    </div>
  );
}
