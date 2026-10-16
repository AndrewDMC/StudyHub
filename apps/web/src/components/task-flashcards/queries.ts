'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  TaskFlashcardsResponse,
  TopicDto,
  UpdateTaskFlashcardsRequest,
} from '@studyhub/contracts';
import { send } from '../plan-mobile/usePlanData';

const taskCardsUrl = (slug: string, taskId: string) =>
  `/api/subjects/${slug}/plan/tasks/${taskId}/flashcards`;

export const taskFlashcardsKey = (slug: string, taskId: string) =>
  ['task-flashcards', slug, taskId] as const;

/** Cards attached to one task; `enabled` only while the dialog/sheet is open (or a session has a task). */
export function useTaskFlashcards(
  slug: string,
  taskId: string | null | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: taskFlashcardsKey(slug, taskId ?? ''),
    queryFn: async () => (await send(taskCardsUrl(slug, taskId!), 'GET')) as TaskFlashcardsResponse,
    enabled: enabled && !!taskId,
  });
}

/** Attach/detach cards: the response is the updated list, so the cache is set, not refetched. */
export function useUpdateTaskFlashcards(slug: string, taskId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (req: UpdateTaskFlashcardsRequest) =>
      (await send(taskCardsUrl(slug, taskId), 'PUT', req)) as TaskFlashcardsResponse,
    onSuccess: (data) => {
      queryClient.setQueryData(taskFlashcardsKey(slug, taskId), data);
      void queryClient.invalidateQueries({ queryKey: ['plans', slug] });
    },
  });
}

/** Same key and shape as the topics query of `PlanClient`. */
export function useTopicList(slug: string, enabled = true) {
  return useQuery({
    queryKey: ['topics', slug],
    queryFn: async () => {
      const res = await fetch(`/api/subjects/${slug}/topics`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error?.message ?? 'Caricamento fallito');
      return body.topics as TopicDto[];
    },
    enabled,
  });
}
