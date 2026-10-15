'use client';

import type { ExamDto, FlashcardStatsDto } from '@studyhub/contracts';
import { StatusCard } from './StatusCard';
import { NextActionsSection } from './NextActionsSection';
import { TodayTasksSection } from './TodayTasksSection';
import { TopicsMasterySection } from './TopicsMasterySection';
import { RecentActivitySection } from './RecentActivitySection';

export function MobileOverview({
  slug,
  documentCount,
  topicCount,
  flashcardTotal,
  nextExam,
  stats,
  fakeProvider,
}: {
  slug: string;
  documentCount: number;
  topicCount: number | null;
  flashcardTotal: number | null;
  nextExam: ExamDto | undefined;
  stats: FlashcardStatsDto | undefined;
  fakeProvider: boolean;
}) {
  return (
    <div className="space-y-6">
      <StatusCard
        slug={slug}
        documentCount={documentCount}
        topicCount={topicCount}
        flashcardTotal={flashcardTotal}
        nextExam={nextExam}
      />
      <NextActionsSection slug={slug} />
      <TodayTasksSection slug={slug} />
      <TopicsMasterySection slug={slug} stats={stats} topicCount={topicCount ?? 0} />
      <RecentActivitySection slug={slug} />
      {fakeProvider && (
        <div className="rounded-[var(--radius-card)] border border-dashed border-border bg-bg-surface p-3 text-xs text-fg-muted">
          Generazione simulata (nessun provider AI configurato): le flashcard/riassunti sono creati
          per estrazione deterministica dal testo, non da un modello reale — vedi
          docs/fasi/F3-ai-core.md &quot;Stato&quot;.
        </div>
      )}
    </div>
  );
}
