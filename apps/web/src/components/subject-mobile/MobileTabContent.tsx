'use client';

import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { CoveragePanel } from '../CoveragePanel';
import { FlashcardMobile } from '../flashcard-mobile/FlashcardMobile';
import { SimulationsMobile } from '../simulation-mobile/SimulationsMobile';

/** Flashcard / Simulazioni (mobile screens) / Lacune (desktop panel, redesigned in a later slice). */
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
    return <SimulationsMobile slug={slug} documents={documents} topics={topics} />;
  }
  return (
    <div className="min-w-0">
      <CoveragePanel subjectSlug={slug} />
    </div>
  );
}
