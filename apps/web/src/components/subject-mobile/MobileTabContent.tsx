'use client';

import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { CoverageMobile } from '../coverage-mobile/CoverageMobile';
import { FlashcardMobile } from '../flashcard-mobile/FlashcardMobile';
import { SimulationsMobile } from '../simulation-mobile/SimulationsMobile';

/** Flashcard / Simulazioni / Lacune (mobile screens). */
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
    return <FlashcardMobile slug={slug} topics={topics} documents={documents} />;
  }
  if (tab === 'simulazioni') {
    return <SimulationsMobile slug={slug} documents={documents} topics={topics} />;
  }
  return <CoverageMobile slug={slug} topics={topics} />;
}
