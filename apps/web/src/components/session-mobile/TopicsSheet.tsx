'use client';

import type { RefObject } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { StudySessionDto } from '@studyhub/contracts';
import { fetchTopics } from '@/lib/sessionApi';
import { BottomSheet } from '../subject-mobile/BottomSheet';
import { SectionEmpty, SectionError, SkeletonRows } from '../subject-mobile/SectionState';

/** Mobile port of the desktop `TopicPicker`: a session without documents unlocks by picking a topic. */
export function TopicsSheet({
  slug,
  session,
  open,
  onOpenChange,
  pending,
  error,
  onChange,
  returnFocusRef,
}: {
  slug: string;
  session: StudySessionDto;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pending: boolean;
  error: string | null;
  onChange: (topicIds: string[]) => void;
  returnFocusRef: RefObject<HTMLElement | null>;
}) {
  const topics = useQuery({
    queryKey: ['topics', slug],
    queryFn: () => fetchTopics(slug),
    enabled: open,
  });
  const selected = session.topics.map((t) => t.id);

  return (
    <BottomSheet
      open={open}
      onOpenChange={onOpenChange}
      title="Argomenti della sessione"
      description="Scegli gli argomenti da cui prendere il materiale."
      returnFocusRef={returnFocusRef}
    >
      <div className="pt-3">
        {topics.isLoading ? (
          <div aria-busy="true">
            <SkeletonRows count={3} />
          </div>
        ) : topics.isError ? (
          <SectionError
            message={(topics.error as Error).message}
            onRetry={() => topics.refetch()}
          />
        ) : (topics.data ?? []).length === 0 ? (
          <SectionEmpty>
            Nessun argomento ancora. Aggiungili dalla scheda della materia.
          </SectionEmpty>
        ) : (
          <ul className="flex flex-col">
            {topics.data?.map((topic) => (
              <li key={topic.id}>
                <label className="flex min-h-11 items-center gap-3 text-[15px]">
                  <input
                    type="checkbox"
                    disabled={pending}
                    checked={selected.includes(topic.id)}
                    onChange={(e) =>
                      onChange(
                        e.target.checked
                          ? [...selected, topic.id]
                          : selected.filter((id) => id !== topic.id),
                      )
                    }
                    className="h-5 w-5 shrink-0 accent-[var(--accent)]"
                  />
                  <span className="min-w-0 break-words">{topic.name}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        {error && (
          <p role="alert" className="pt-2 text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </BottomSheet>
  );
}
