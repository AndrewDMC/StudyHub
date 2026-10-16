import { and, eq, inArray, isNull } from 'drizzle-orm';
import {
  artifacts,
  autoAttachFlashcards,
  flashcards,
  recomputeTopicMastery,
  resolvePrimaryTopics,
  subjects,
  topics,
} from '@studyhub/db';
import {
  buildTopicNameIndex,
  estimateCostEur,
  matchTopicId,
  resolveModel,
  resolveProvider,
  truncate,
  type AiProvider,
} from '@studyhub/ai';
import { toIsoDate } from '@studyhub/core';
import type { SortFlashcardsJobInput, SortFlashcardsOutput } from '@studyhub/contracts';
import { BudgetExceededError, checkBudget } from './shared.js';

const MODEL_ROUTING_SORT_FLASHCARDS = 'claude-haiku-4-5-20251001'; // docs/03-ai-e-worker.md §4: classificare = haiku
/** Cards per AI call: keeps each prompt and answer small, and a failed call cheap to repeat. */
export const SORT_BATCH_SIZE = 40;
/** A card's text is cut before it reaches the model: the topic is evident from the start of it. */
const CARD_TEXT_MAX_CHARS = 400;

export interface SortFlashcardsResult extends SortFlashcardsOutput {
  /** The daily budget cap stopped the job before every batch ran; what ran is applied and costed. */
  stoppedByBudget: boolean;
  costEur: number;
  usage: { inputTokens: number; outputTokens: number };
}

/**
 * `sort_flashcards`: files the subject's topic-less flashcards under its existing topics. Started
 * by the student ("Ordina automaticamente"), so the result is applied directly — but it only ever
 * fills an empty `topicId`: a card that already has a topic is never touched, no topic is ever
 * created, and a card the model cannot place stays unsorted.
 *
 * Order of work: (1) free — a card citing a document that has a primary topic takes that topic;
 * (2) the rest go to the model in batches, whose answers are matched by name to the subject's
 * topics (a name that matches nothing leaves the card unsorted). A subject without topics returns
 * `noTopics` without calling the model.
 */
export async function processSortFlashcards(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: SortFlashcardsJobInput,
  provider: AiProvider = resolveProvider(),
): Promise<SortFlashcardsResult> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.id, input.subjectId));
  if (!subject) throw new Error(`subject not found: ${input.subjectId}`);

  const subjectTopics: { id: string; name: string; parentId: string | null }[] = await db
    .select({ id: topics.id, name: topics.name, parentId: topics.parentId })
    .from(topics)
    .where(eq(topics.subjectId, input.subjectId))
    .orderBy(topics.orderIndex, topics.name);

  const unsortedFilter = input.cardIds
    ? and(
        eq(artifacts.subjectId, input.subjectId),
        isNull(flashcards.topicId),
        inArray(flashcards.id, input.cardIds),
      )
    : and(eq(artifacts.subjectId, input.subjectId), isNull(flashcards.topicId));
  const cards: {
    id: string;
    front: string;
    back: string;
    sourceRef: { docId: string } | null;
  }[] = await db
    .select({
      id: flashcards.id,
      front: flashcards.front,
      back: flashcards.back,
      sourceRef: flashcards.sourceRef,
    })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(unsortedFilter)
    .orderBy(flashcards.createdAt, flashcards.id);

  const free = { costEur: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  if (subjectTopics.length === 0) {
    return {
      assigned: 0,
      assignedByDocument: 0,
      assignedByAi: 0,
      unassigned: cards.length,
      noTopics: true,
      stoppedByBudget: false,
      ...free,
    };
  }
  if (cards.length === 0) {
    return {
      assigned: 0,
      assignedByDocument: 0,
      assignedByAi: 0,
      unassigned: 0,
      noTopics: false,
      stoppedByBudget: false,
      ...free,
    };
  }

  // Every update is guarded by `topic_id IS NULL`: a card the student filed by hand while the job
  // ran keeps their choice.
  const touchedTopicIds = new Set<string>();
  const assignedCardIds: string[] = [];
  const assignTopic = async (topicId: string, cardIds: string[]): Promise<number> => {
    if (cardIds.length === 0) return 0;
    const updated: { id: string }[] = await db
      .update(flashcards)
      .set({ topicId })
      .where(and(inArray(flashcards.id, cardIds), isNull(flashcards.topicId)))
      .returning({ id: flashcards.id });
    if (updated.length > 0) touchedTopicIds.add(topicId);
    for (const u of updated) assignedCardIds.push(u.id);
    return updated.length;
  };

  let assignedByDocument = 0;
  let assignedByAi = 0;
  let costEur = 0;
  let stoppedByBudget = false;
  const usage = { inputTokens: 0, outputTokens: 0 };
  // Mastery depends on the cards a topic holds (coverage), so every topic that gained cards is
  // recomputed — also when the job fails halfway, since the cards already moved. The lesson links
  // follow; a failure there must not mask the error that stopped the job.
  const settle = async () => {
    for (const topicId of touchedTopicIds) await recomputeTopicMastery(db, topicId);
    // Lessons: the newly filed cards join the nearest lesson of their topic.
    await autoAttachFlashcards(db, {
      subjectId: input.subjectId,
      cardIds: assignedCardIds,
      today: toIsoDate(new Date()),
    });
  };
  try {
    // (1) Free fallback: the topic of the document the card cites.
    const primaryByDoc = await resolvePrimaryTopics(db, input.subjectId, [
      ...new Set(cards.flatMap((c) => (c.sourceRef?.docId ? [c.sourceRef.docId] : []))),
    ]);
    const idsByTopic = new Map<string, string[]>();
    const remaining: typeof cards = [];
    for (const card of cards) {
      const primary = card.sourceRef?.docId ? primaryByDoc.get(card.sourceRef.docId) : undefined;
      if (primary)
        idsByTopic.set(primary.topicId, [...(idsByTopic.get(primary.topicId) ?? []), card.id]);
      else remaining.push(card);
    }
    for (const [topicId, ids] of idsByTopic) {
      assignedByDocument += await assignTopic(topicId, ids);
    }

    // (2) The model, in batches.
    if (remaining.length > 0) {
      const model = resolveModel(MODEL_ROUTING_SORT_FLASHCARDS);
      const topicIndex = buildTopicNameIndex(subjectTopics);
      const parentNameById = new Map(subjectTopics.map((t) => [t.id, t.name]));
      const promptTopics = subjectTopics.map((t) => ({
        name: t.name,
        parentName: t.parentId ? (parentNameById.get(t.parentId) ?? null) : null,
      }));

      for (let start = 0; start < remaining.length; start += SORT_BATCH_SIZE) {
        // Budget guard (same cap as the other AI jobs) on the cumulative cost, before paying for the
        // next batch: what was already paid for stays applied, the rest is left for a rerun.
        try {
          // 1e-9 (below cost resolution): with nothing spent by this job yet, a day already AT the cap (not only over it) stops too.
          await checkBudget(db, Math.max(costEur, 1e-9), false);
        } catch (err) {
          if (!(err instanceof BudgetExceededError)) throw err;
          stoppedByBudget = true;
          break;
        }
        const batch = remaining.slice(start, start + SORT_BATCH_SIZE);
        const result = await provider.sortFlashcards(
          {
            subjectName: subject.name,
            topics: promptTopics,
            cards: batch.map((c) => ({
              id: c.id,
              front: truncate(c.front, CARD_TEXT_MAX_CHARS),
              back: truncate(c.back, CARD_TEXT_MAX_CHARS),
            })),
          },
          model,
        );

        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        costEur += estimateCostEur(
          result.model,
          result.usage.inputTokens,
          result.usage.outputTokens,
        );

        // Anti-hallucination gate: only cardIds this batch actually sent count (first answer wins),
        // and only names that resolve to a topic of the subject.
        const batchIds = new Set(batch.map((c) => c.id));
        const answered = new Set<string>();
        const batchIdsByTopic = new Map<string, string[]>();
        for (const assignment of result.data.assignments) {
          if (!batchIds.has(assignment.cardId) || answered.has(assignment.cardId)) continue;
          answered.add(assignment.cardId);
          const topicId = matchTopicId(assignment.topicName, topicIndex);
          if (topicId) {
            batchIdsByTopic.set(topicId, [
              ...(batchIdsByTopic.get(topicId) ?? []),
              assignment.cardId,
            ]);
          }
        }
        for (const [topicId, ids] of batchIdsByTopic) {
          assignedByAi += await assignTopic(topicId, ids);
        }
      }
    }
  } catch (err) {
    try {
      await settle();
    } catch {
      // keep the original error
    }
    throw err;
  }
  await settle();

  const assigned = assignedByDocument + assignedByAi;
  return {
    assigned,
    assignedByDocument,
    assignedByAi,
    unassigned: cards.length - assigned,
    noTopics: false,
    stoppedByBudget,
    costEur,
    usage,
  };
}
