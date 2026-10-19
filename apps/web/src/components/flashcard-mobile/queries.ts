'use client';

import { useQuery } from '@tanstack/react-query';
import type { ArtifactDto, FlashcardDto } from '@studyhub/contracts';
import { REVIEW_OVERVIEW_KEY, fetchReviewOverview } from '@/lib/reviewOverview';

export { useFlashcardPages, useFlashcardStats } from '../flashcards/api';

/** Cards due today per topic id (null while loading or on error), from the same overview query. */
export function useTopicDue(slug: string): Map<string, number> | null {
  const query = useQuery({ queryKey: REVIEW_OVERVIEW_KEY, queryFn: fetchReviewOverview });
  const topics = query.data?.subjects.find((s) => s.slug === slug)?.topics;
  if (!topics) return null;
  const map = new Map<string, number>();
  for (const t of topics) if (t.id !== null) map.set(t.id, t.due);
  return map;
}

async function fetchArtifacts(slug: string): Promise<ArtifactDto[]> {
  const res = await fetch(`/api/subjects/${slug}/artifacts`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i mazzi');
  return body.artifacts as ArtifactDto[];
}

/** Same key as the other `artifacts` consumers. */
export function useArtifacts(slug: string) {
  return useQuery({ queryKey: ['artifacts', slug], queryFn: () => fetchArtifacts(slug) });
}

export async function fetchDeckCards(slug: string, artifactId: string): Promise<FlashcardDto[]> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/flashcards`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare le flashcard');
  return body.flashcards as FlashcardDto[];
}

/** Same key as the deck review screen: opening a draft is instant. */
export function useDeckCards(slug: string, artifactId: string) {
  return useQuery({
    queryKey: ['deck-cards', artifactId],
    queryFn: () => fetchDeckCards(slug, artifactId),
  });
}

export async function reviewDeckCard(
  slug: string,
  artifactId: string,
  cardId: string,
  body: { action: 'approve' | 'discard' | 'edit'; front?: string; back?: string },
): Promise<FlashcardDto | null> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/flashcards/${cardId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error?.message ?? 'Azione fallita');
  return (data?.flashcard as FlashcardDto | undefined) ?? null;
}

export async function approveDeck(slug: string, artifactId: string): Promise<void> {
  const res = await fetch(`/api/subjects/${slug}/artifacts/${artifactId}/approve`, {
    method: 'POST',
  });
  if (!res.ok) {
    const body = await res.json().catch(() => null);
    throw new Error(body?.error?.message ?? 'Approvazione fallita');
  }
}
