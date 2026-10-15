'use client';

import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { StatsPanel } from '../StatsPanel';
import { CalibrationPanel } from '../CalibrationPanel';
import { FlashcardListPanel } from '../FlashcardListPanel';
import { ExamPrepPanel } from '../ExamPrepPanel';
import { CoveragePanel } from '../CoveragePanel';

/** Flashcard / Simulazioni / Lacune: the desktop panels as they are (redesigned in later slices). */
export function MobileTabContent({
  slug,
  tab,
  documents,
  topics,
}: {
  slug: string;
  tab: 'flashcard' | 'simulazioni' | 'lacune';
  documents: DocumentDto[];
  topics: TopicDto[];
}) {
  if (tab === 'flashcard') {
    return (
      <div className="min-w-0 space-y-4">
        <StatsPanel subjectSlug={slug} />
        <CalibrationPanel subjectSlug={slug} />
        <FlashcardListPanel subjectSlug={slug} topics={topics} />
      </div>
    );
  }
  if (tab === 'simulazioni') {
    return (
      <div className="min-w-0">
        <ExamPrepPanel subjectSlug={slug} documents={documents} />
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <CoveragePanel subjectSlug={slug} />
    </div>
  );
}
