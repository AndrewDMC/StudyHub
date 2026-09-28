'use client';

import Link from 'next/link';
import type { DocumentDto, TopicDto } from '@studyhub/contracts';
import { useSelection } from '@/lib/selection';
import { GenerationPanel } from './GenerationPanel';

/**
 * Right column, present on every tab (docs/fasi/F2-materie.md "Destra") — the actions offered
 * always follow the current `SelectionContext`: N documents selected scopes generation to them,
 * a topic selected with no document scopes generation to it instead and offers "drill" (a review
 * session filtered to that topic, `apps/web/src/lib/review.ts::getReviewQueue`'s existing
 * `topicId` option — already there for F4, just never linked to from here).
 */
export function AiPanel({
  subjectSlug,
  documents,
  topics,
}: {
  subjectSlug: string;
  documents: DocumentDto[];
  topics: TopicDto[];
}) {
  const { docIds, topicIds } = useSelection();
  const hasDocSelection = docIds.size > 0;
  const selectedTopics = topics.filter((t) => topicIds.has(t.id));
  const isTopicDrill = !hasDocSelection && selectedTopics.length > 0;

  return (
    <div className="flex flex-col gap-3">
      {isTopicDrill && (
        <div className="rounded-[var(--radius-card)] border border-border bg-bg-surface p-3">
          <h2 className="mb-1 px-1 text-xs font-medium uppercase tracking-wide text-fg-muted">
            {selectedTopics.length === 1
              ? `Argomento: ${selectedTopics[0]!.name}`
              : 'Argomenti selezionati'}
          </h2>
          <p className="px-1 text-[11px] text-fg-secondary">
            Le generazioni qui sotto usano solo il materiale taggato a{' '}
            {selectedTopics.length === 1 ? 'questo argomento' : 'questi argomenti'}.
          </p>
          {selectedTopics.length === 1 && (
            <Link
              href={`/materie/${subjectSlug}/review?topicId=${selectedTopics[0]!.id}`}
              className="mt-2 block rounded-[var(--radius-control)] bg-accent px-3 py-1.5 text-center text-xs font-medium text-white hover:bg-accent-hover"
            >
              Drill: ripassa questo argomento
            </Link>
          )}
        </div>
      )}
      <GenerationPanel
        subjectSlug={subjectSlug}
        documents={documents}
        selectedDocIds={docIds}
        selectedTopicIds={topicIds}
      />
    </div>
  );
}
