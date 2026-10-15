'use client';

import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { ExamPrepPanel } from '../ExamPrepPanel';
import { CoveragePanel } from '../CoveragePanel';
import { FlashcardMobile } from '../flashcard-mobile/FlashcardMobile';

/** Flashcard (mobile screen) / Simulazioni / Lacune (desktop panels, redesigned in later slices). */
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
    return <FlashcardMobile slug={slug} topics={topics} />;
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
