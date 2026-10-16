import type { FlashcardDto, TopicDto } from '@studyhub/contracts';
import { plainCardText } from '@/lib/flashcardMobile';

/** Max card ids per PUT (mirrors `UpdateTaskFlashcardsRequest`). */
export const MAX_ATTACH = 500;

/** "1 card" / "N card": the badge label of a task row. */
export function cardCountLabel(n: number): string {
  return `${n} card`;
}

/** Cards of a task that the review queue can actually serve. */
export function reviewableCount(items: ReadonlyArray<{ reviewable: boolean }>): number {
  return items.filter((c) => c.reviewable).length;
}

/** Plain-text one-liner of a card front, for accessible names. */
export function cardPreview(front: string, max = 80): string {
  const text = plainCardText(front);
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

/** `/ripasso` scoped to the cards attached to one task. */
export function ripassaTaskHref(slug: string, taskId: string): string {
  return `/ripasso?materia=${slug}&task=${taskId}`;
}

export interface AttachableCard {
  card: FlashcardDto;
  attached: boolean;
}

/** Flattens the picker pages (dropping duplicates across pages) and flags the already attached ones. */
export function attachableCards(
  pages: ReadonlyArray<{ items: FlashcardDto[] }>,
  attachedIds: ReadonlySet<string>,
): AttachableCard[] {
  const seen = new Set<string>();
  const out: AttachableCard[] = [];
  for (const page of pages) {
    for (const card of page.items) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      out.push({ card, attached: attachedIds.has(card.id) });
    }
  }
  return out;
}

/** Picker topic filter -> the `topicId` query value ('' = no filter). */
export function topicFilterParam(filter: string): string {
  return filter === 'all' ? '' : filter;
}

/** Topics sorted by name, children right after their parent and prefixed with "— ". */
export function topicOptions(
  topics: ReadonlyArray<Pick<TopicDto, 'id' | 'name' | 'parentId'>>,
): Array<{ id: string; label: string }> {
  const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, 'it');
  const ids = new Set(topics.map((t) => t.id));
  const roots = topics.filter((t) => !t.parentId || !ids.has(t.parentId)).sort(byName);
  const out: Array<{ id: string; label: string }> = [];
  const visit = (t: Pick<TopicDto, 'id' | 'name'>, depth: number) => {
    out.push({ id: t.id, label: `${'— '.repeat(depth)}${t.name}` });
    for (const child of topics.filter((c) => c.parentId === t.id).sort(byName)) {
      visit(child, depth + 1);
    }
  };
  for (const root of roots) visit(root, 0);
  return out;
}

/** Index to focus after removing the item at `removedIndex` of a list of `length` (before removal): next, else previous, else none. */
export function focusIndexAfterRemoval(removedIndex: number, length: number): number | null {
  if (length <= 1) return null;
  return removedIndex < length - 1 ? removedIndex : removedIndex - 1;
}

/** Announcement after the list changed. */
export function attachedAnnouncement(n: number): string {
  return `${n} card attaccate.`;
}
