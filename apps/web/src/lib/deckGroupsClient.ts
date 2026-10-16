import { useQuery } from '@tanstack/react-query';
import type {
  DeckGroupDto,
  SortFlashcardsEnqueued,
  SortFlashcardsStatus,
} from '@studyhub/contracts';

export const deckGroupsKey = (slug: string) => ['deck-groups', slug] as const;

async function fetchDeckGroups(slug: string): Promise<DeckGroupDto[]> {
  const res = await fetch(`/api/subjects/${slug}/flashcards/groups`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile caricare i mazzi');
  return body.groups as DeckGroupDto[];
}

export function useDeckGroups(slug: string) {
  return useQuery({ queryKey: deckGroupsKey(slug), queryFn: () => fetchDeckGroups(slug) });
}

/** Thrown on 409 so the CTA can say "already running" (and attach to the job when the id is given). */
export class SortConflictError extends Error {
  constructor(public jobId: string | null) {
    super('Un ordinamento è già in corso.');
  }
}

export async function startSort(slug: string): Promise<SortFlashcardsEnqueued> {
  const res = await fetch(`/api/subjects/${slug}/flashcards/sort`, { method: 'POST' });
  const body = await res.json().catch(() => ({}));
  if (res.status === 409) throw new SortConflictError(body.error?.jobId ?? null);
  if (!res.ok) throw new Error(body.error?.message ?? 'Non sono riuscito a ordinare le card.');
  return { jobId: body.jobId as string };
}

export async function fetchSortStatus(slug: string, jobId: string): Promise<SortFlashcardsStatus> {
  const res = await fetch(`/api/subjects/${slug}/flashcards/sort/${jobId}`);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error?.message ?? 'Impossibile leggere lo stato');
  // Type-only contracts on the client: the barrel pulls server code into the bundle.
  return body as SortFlashcardsStatus;
}
