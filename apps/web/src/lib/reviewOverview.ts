import type { ReviewOverviewDto } from '@studyhub/contracts';

/** React Query key shared by the Ripasso home and the tab bar badge. */
export const REVIEW_OVERVIEW_KEY = ['review-overview'] as const;

/** Key of the overview of one subject (also archived ones): separate from the home's. */
export const subjectOverviewKey = (slug: string) => ['review-overview', 'subject', slug] as const;

export async function fetchReviewOverview(): Promise<ReviewOverviewDto> {
  return fetchOverview('/api/review/overview');
}

/** Overview limited to one subject; works for archived subjects too. */
export function fetchSubjectOverview(slug: string): Promise<ReviewOverviewDto> {
  return fetchOverview(`/api/review/overview?materia=${encodeURIComponent(slug)}`);
}

async function fetchOverview(url: string): Promise<ReviewOverviewDto> {
  const res = await fetch(url);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error?.message ?? 'Impossibile caricare il ripasso');
  return body as ReviewOverviewDto;
}
