import type { ReviewOverviewDto } from '@studyhub/contracts';

/** React Query key shared by the Ripasso home and the tab bar badge. */
export const REVIEW_OVERVIEW_KEY = ['review-overview'] as const;

export async function fetchReviewOverview(): Promise<ReviewOverviewDto> {
  const res = await fetch('/api/review/overview');
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile caricare il ripasso');
  return body as ReviewOverviewDto;
}
