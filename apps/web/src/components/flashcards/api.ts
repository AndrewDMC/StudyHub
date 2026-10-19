'use client';

import { useEffect, useState } from 'react';
import {
  useInfiniteQuery,
  useQuery,
  type QueryClient,
  type UseInfiniteQueryResult,
} from '@tanstack/react-query';
import type {
  CalibrationDto,
  DeckSummaryDto,
  FlashcardDto,
  FlashcardPageDto,
  FlashcardStatsDto,
} from '@studyhub/contracts';
import { fetchCard, fetchDeckSummaries, fetchTags } from '@/lib/deckEditorClient';
import {
  REVIEW_OVERVIEW_KEY,
  fetchSubjectOverview,
  subjectOverviewKey,
} from '@/lib/reviewOverview';

export interface Filters {
  topicId: string;
  state: string;
  deckId: string;
  tag: string;
  q: string;
  flagged: boolean;
  /** Only cards out of the review (suspended or flagged). */
  excluded?: boolean;
  /** `due` = next review first; omitted = newest first. */
  sort?: 'due' | 'recent';
}

export const EMPTY_FILTERS: Filters = {
  topicId: '',
  state: '',
  deckId: '',
  tag: '',
  q: '',
  flagged: false,
};

export async function fetchPage(
  slug: string,
  filters: Filters,
  cursor: string | undefined,
  extra?: { suspended?: boolean },
): Promise<FlashcardPageDto> {
  const qs = new URLSearchParams();
  if (filters.topicId) qs.set('topicId', filters.topicId);
  if (filters.state) qs.set('state', filters.state);
  if (filters.deckId) qs.set('deckId', filters.deckId);
  if (filters.tag) qs.set('tag', filters.tag);
  if (filters.q) qs.set('q', filters.q);
  if (filters.flagged) qs.set('flagged', 'true');
  if (filters.excluded) qs.set('excluded', 'true');
  if (filters.sort) qs.set('sort', filters.sort);
  if (cursor) qs.set('cursor', cursor);
  if (extra?.suspended !== undefined) qs.set('suspended', String(extra.suspended));
  const res = await fetch(`/api/subjects/${slug}/flashcards?${qs.toString()}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le flashcard');
  return body.page as FlashcardPageDto;
}

export const STATE_LABELS: Record<string, string> = {
  new: 'Nuova',
  learning: 'In apprendimento',
  review: 'In ripasso',
  relearning: 'Da rinforzare',
};

/** Debounces a fast-changing value (the search box) so each keystroke isn't a request. */
export function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

/** Pages of 50 cards; the key starts with `['flashcard-list', slug]` so one invalidation covers all filters. */
export function useFlashcardPages(
  slug: string,
  filters: Filters,
): UseInfiniteQueryResult<{ pages: FlashcardPageDto[] }, Error> {
  return useInfiniteQuery({
    queryKey: ['flashcard-list', slug, filters],
    queryFn: ({ pageParam }) => fetchPage(slug, filters, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  }) as UseInfiniteQueryResult<{ pages: FlashcardPageDto[] }, Error>;
}

async function fetchStats(slug: string): Promise<FlashcardStatsDto> {
  const res = await fetch(`/api/subjects/${slug}/stats/flashcards`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le statistiche');
  return body.stats as FlashcardStatsDto;
}

/** One fetch, one invalidation: same key as the subject page. */
export function useFlashcardStats(slug: string) {
  return useQuery({ queryKey: ['stats', slug], queryFn: () => fetchStats(slug) });
}

export function useDeckSummaries(slug: string) {
  return useQuery({ queryKey: ['decks', slug], queryFn: () => fetchDeckSummaries(slug) });
}

export function useFlashcardTags(slug: string) {
  return useQuery({ queryKey: ['flashcard-tags', slug], queryFn: () => fetchTags(slug) });
}

/** A single card, only when `id` is given and not already available (deep link to the detail). */
export function useFlashcard(slug: string, id: string | null, enabled: boolean) {
  return useQuery({
    queryKey: ['flashcard', slug, id],
    queryFn: () => fetchCard(slug, id!),
    enabled: enabled && id !== null,
    retry: false,
  });
}

async function fetchCalibration(slug: string): Promise<CalibrationDto> {
  const res = await fetch(`/api/subjects/${slug}/stats/calibration`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare la calibrazione');
  return body.calibration as CalibrationDto;
}

export function useCalibration(slug: string) {
  return useQuery({ queryKey: ['calibration', slug], queryFn: () => fetchCalibration(slug) });
}

export interface SubjectOverview {
  dueCount: number;
  newCount: number;
  due: number;
  estimatedMinutes: number;
}

/**
 * Today's review of this subject from the review overview. A loaded overview without the subject
 * means nothing is reviewable: zeros, not "unknown".
 */
export function useSubjectOverview(slug: string) {
  const query = useQuery({
    queryKey: subjectOverviewKey(slug),
    queryFn: () => fetchSubjectOverview(slug),
  });
  const subject = query.data?.subjects.find((s) => s.slug === slug);
  const data: SubjectOverview | undefined = query.isSuccess
    ? {
        dueCount: subject?.dueCount ?? 0,
        newCount: subject?.newCount ?? 0,
        due: subject?.due ?? 0,
        estimatedMinutes: subject?.estimatedMinutes ?? 0,
      }
    : undefined;
  return {
    data,
    isLoading: query.isLoading,
    isError: query.isError,
    refetch: query.refetch,
  };
}

/** After any change to cards or decks: every view that shows counts or lists is refreshed. */
export function invalidateFlashcards(qc: QueryClient, slug: string): void {
  for (const key of [
    ['flashcard-list', slug],
    ['flashcard', slug],
    ['flashcard-tags', slug],
    ['flashcard-stats', slug],
    ['stats', slug],
    ['decks', slug],
    ['deck-groups', slug],
    ['artifacts', slug],
    REVIEW_OVERVIEW_KEY,
  ] as const) {
    void qc.invalidateQueries({ queryKey: key });
  }
}

export type { DeckSummaryDto, FlashcardDto };

/** Cards of the loaded pages, flattened. */
export function pagesToCards(data: { pages: FlashcardPageDto[] } | undefined): FlashcardDto[] {
  return data?.pages.flatMap((p) => p.items) ?? [];
}
