import { and, eq, inArray, ne } from 'drizzle-orm';
import { computeMastery, retrievability } from '@studyhub/core';
import {
  attemptItemResults,
  flashcards,
  simulationItems,
  topics,
  type Flashcard,
} from './schema.js';

/**
 * Recomputes `topics.mastery` from its inputs (docs/02-filesystem-e-dati.md
 * §5, formula in `packages/core/src/mastery.ts`): average current
 * retrievability of the topic's reviewed flashcards + average accuracy of
 * every graded simulation item on the topic. Coverage has no data source
 * yet, so it's absent (renormalized away), never a silent zero.
 *
 * Lives in `@studyhub/db` (not `apps/worker`) because both `apps/worker`
 * (after grading a simulation) and `apps/web` (after every flashcard
 * review) need to trigger it — see docs/fasi/F4-flashcard.md and
 * docs/fasi/F5-esami-simulazioni.md "Stato".
 */
export async function recomputeTopicMastery(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  topicId: string,
  now: Date = new Date(),
): Promise<number | null> {
  const cards: Flashcard[] = await db
    .select()
    .from(flashcards)
    .where(
      and(
        eq(flashcards.topicId, topicId),
        eq(flashcards.suspended, false),
        ne(flashcards.state, 'new'),
      ),
    );
  const retrievabilities = cards.map((c) =>
    retrievability(
      {
        stability: c.stability,
        difficulty: c.difficulty,
        dueAt: c.dueAt,
        lastReviewAt: c.lastReviewAt,
        reps: c.reps,
        lapses: c.lapses,
        state: c.state,
      },
      now,
    ),
  );

  const itemIds: { id: string }[] = await db
    .select({ id: simulationItems.id })
    .from(simulationItems)
    .where(eq(simulationItems.topicId, topicId));
  const results: { awarded: number; max: number }[] =
    itemIds.length === 0
      ? []
      : await db
          .select({ awarded: attemptItemResults.awarded, max: attemptItemResults.max })
          .from(attemptItemResults)
          .where(
            inArray(
              attemptItemResults.itemId,
              itemIds.map((i) => i.id),
            ),
          );

  const mean = (xs: number[]) =>
    xs.length === 0 ? null : xs.reduce((a, b) => a + b, 0) / xs.length;
  const { value } = computeMastery({
    retrievability: mean(retrievabilities),
    simulationAccuracy: mean(results.map((r) => (r.max > 0 ? r.awarded / r.max : 0))),
    coverage: null,
  });

  await db.update(topics).set({ mastery: value }).where(eq(topics.id, topicId));
  return value;
}
