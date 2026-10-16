import type { DeckGroupDto, SortFlashcardsStatus, TopicDto } from '@studyhub/contracts';

/** Filter / queue token for cards without a topic (same as `argomento=none` of the review queue). */
export const NO_TOPIC = 'none';

export interface DeckRow {
  group: DeckGroupDto;
  /** 0 = root, 1 = child (deeper levels are flattened to 1). */
  depth: 0 | 1;
}

export interface DeckTree {
  rows: DeckRow[];
  /** The "Senza argomento" group, always kept apart so it can be rendered last. */
  unsorted: DeckGroupDto | null;
}

/**
 * One level of hierarchy, without summing children into the parent. A child whose parent has no
 * cards (or is unknown) becomes a root. Order: topic order of the subject, then any leftover group.
 */
export function buildDeckTree(groups: DeckGroupDto[], topics: TopicDto[]): DeckTree {
  const unsorted = groups.find((g) => g.topicId === null) ?? null;
  const withTopic = groups.filter((g) => g.topicId !== null);
  const order = new Map(topics.map((t, i) => [t.id, i]));
  const byOrder = (a: DeckGroupDto, b: DeckGroupDto) =>
    (order.get(a.topicId!) ?? Number.MAX_SAFE_INTEGER) -
    (order.get(b.topicId!) ?? Number.MAX_SAFE_INTEGER);
  const present = new Set(withTopic.map((g) => g.topicId));
  const isChild = (g: DeckGroupDto) => g.parentTopicId !== null && present.has(g.parentTopicId);

  const roots = withTopic.filter((g) => !isChild(g)).sort(byOrder);
  const rows: DeckRow[] = [];
  for (const root of roots) {
    rows.push({ group: root, depth: 0 });
    const children = withTopic.filter((g) => g.parentTopicId === root.topicId).sort(byOrder);
    for (const child of children) rows.push({ group: child, depth: 1 });
  }
  // Grandchildren (parent present but itself a child) would be lost above: append flattened.
  const seen = new Set(rows.map((r) => r.group.topicId));
  for (const g of withTopic.sort(byOrder)) {
    if (!seen.has(g.topicId)) rows.push({ group: g, depth: 1 });
  }
  return { rows, unsorted };
}

export function groupName(g: DeckGroupDto): string {
  return g.topicId === null ? 'Senza argomento' : (g.topicName ?? 'Argomento');
}

/** Filter value of a group for the card list and the review queue. */
export function groupFilterValue(g: DeckGroupDto): string {
  return g.topicId ?? NO_TOPIC;
}

export function groupSummary(g: DeckGroupDto): string {
  return `${g.total} card · ${g.due} da ripassare · ${g.new} nuove`;
}

export function reviewHref(slug: string, g: DeckGroupDto): string {
  return `/ripasso?materia=${encodeURIComponent(slug)}&argomento=${groupFilterValue(g)}`;
}

/** A group can be reviewed only if something is due or new. */
export function canReview(g: DeckGroupDto): boolean {
  return g.due + g.new > 0;
}

export type SortView =
  | { phase: 'running' }
  | { phase: 'done'; sorted: number; remaining: number; noTopics: boolean }
  | { phase: 'failed' };

/** Maps the job status of `GET .../flashcards/sort/[jobId]` to what the CTA shows. */
export function sortView(status: SortFlashcardsStatus): SortView {
  if (status.status === 'succeeded') {
    return {
      phase: 'done',
      sorted: status.output?.assigned ?? 0,
      remaining: status.output?.unassigned ?? 0,
      noTopics: status.output?.noTopics ?? false,
    };
  }
  if (status.status === 'failed' || status.status === 'cancelled') return { phase: 'failed' };
  return { phase: 'running' };
}

export function sortMessage(v: Extract<SortView, { phase: 'done' }>): string {
  if (v.sorted === 0) return 'Nessuna card è stata assegnata: nessun argomento corrispondente.';
  const base = `${v.sorted} card ordinate nei loro argomenti.`;
  return v.remaining > 0 ? `${base} ${v.remaining} sono rimaste senza argomento.` : base;
}
