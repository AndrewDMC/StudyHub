/**
 * Name -> topic matching shared by every place that turns a model-proposed topic name into a
 * `topicId` (flashcard generation, flashcard sorting). The model is told to copy a name verbatim
 * from the list it was given, but a stray capital, accent or double space must not turn a correct
 * answer into "no topic" — so matching is case-, accent- and whitespace-insensitive. A name that
 * still matches nothing is a miss (`null`), never an error and never a guess.
 */

/** Lowercased, accent-folded, whitespace-collapsed form used as the comparison key. */
export function normalizeTopicName(name: string): string {
  return name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Builds a reusable lookup from a subject's topics. When two topics normalize to the same key the
 * first one in input order wins (callers pass them ordered), so the result is deterministic.
 */
export function buildTopicNameIndex<T extends { id: string; name: string }>(
  topics: readonly T[],
): Map<string, T> {
  const index = new Map<string, T>();
  for (const topic of topics) {
    const key = normalizeTopicName(topic.name);
    if (key && !index.has(key)) index.set(key, topic);
  }
  return index;
}

/** The id of the topic named `name` (normalized), or `null` for a missing/empty/unknown name. */
export function matchTopicId(
  name: string | null | undefined,
  index: ReadonlyMap<string, { id: string }>,
): string | null {
  if (!name) return null;
  const key = normalizeTopicName(name);
  if (!key) return null;
  return index.get(key)?.id ?? null;
}
