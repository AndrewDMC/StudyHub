'use client';

import { useState } from 'react';
import type { TopicDto } from '@studyhub/contracts';
import { CardsSection } from './CardsSection';
import { DeckGroupsSection } from './DeckGroupsSection';
import { DeckToolsDisclosure } from './DeckToolsDisclosure';
import { DraftDecksLink } from './DraftDecksLink';
import { ForecastCard } from './ForecastCard';
import { RetentionCard } from './RetentionCard';
import { ReviewHeroCard } from './ReviewHeroCard';
import { useFlashcardStats } from './queries';

/** Tab Flashcard below md: today's review, drafts to approve, forecast, retention, the card list. */
export function FlashcardMobile({ slug, topics }: { slug: string; topics: TopicDto[] }) {
  const stats = useFlashcardStats(slug);
  // Shared by the deck rows and the topic chips: both filter "Le tue card".
  const [topicId, setTopicId] = useState('');
  return (
    <div className="flex min-w-0 flex-col gap-5">
      <ReviewHeroCard slug={slug} />
      <DraftDecksLink slug={slug} />
      <ForecastCard slug={slug} />
      <RetentionCard slug={slug} />
      <DeckGroupsSection slug={slug} topics={topics} topicId={topicId} onTopicChange={setTopicId} />
      <CardsSection
        slug={slug}
        topics={topics}
        stats={stats.data}
        topicId={topicId}
        onTopicChange={setTopicId}
      />
      <DeckToolsDisclosure slug={slug} topics={topics} />
    </div>
  );
}
