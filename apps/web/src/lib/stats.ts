import { and, eq, gt, sql } from 'drizzle-orm';
import { artifacts, exams, flashcards, subjects, topics, type Flashcard } from '@studyhub/db';
import {
  cardsAtRiskForExam,
  forecastDueCounts,
  retentionCalibration,
  type FlashcardSchedule,
  type FsrsCardState,
  type ReviewSample,
} from '@studyhub/core';
import type { FlashcardStatsDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

function toSchedule(row: Flashcard): FlashcardSchedule {
  return {
    stability: row.stability,
    difficulty: row.difficulty,
    dueAt: row.dueAt,
    lastReviewAt: row.lastReviewAt,
    reps: row.reps,
    lapses: row.lapses,
    state: row.state,
  };
}

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

export type FlashcardStats = FlashcardStatsDto;

/** docs/fasi/F4-flashcard.md "Statistiche": counts by state, 30-day forecast, exam risk. */
export async function getFlashcardStats(db: AnyDb, subjectSlug: string): Promise<FlashcardStats> {
  const subject = await requireSubject(db, subjectSlug);

  const joined: { f: Flashcard }[] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id));
  const all = joined.map((r) => r.f);
  // A flagged ("scadente") card is out of the queue, so it must be out of every number that
  // describes the queue too — counts, forecast, exam risk.
  const cards = all.filter((c) => !c.flaggedAt);
  const flaggedCount = all.length - cards.length;

  const countsByState: Record<FsrsCardState, number> = {
    new: 0,
    learning: 0,
    review: 0,
    relearning: 0,
  };
  let suspendedCount = 0;
  for (const card of cards) {
    if (card.suspended) suspendedCount += 1;
    else countsByState[card.state] += 1;
  }

  const forecast = forecastDueCounts(cards.filter((c) => !c.suspended).map(toSchedule), 30);

  const [nextExam] = await db
    .select()
    .from(exams)
    .where(
      and(
        eq(exams.subjectId, subject.id),
        eq(exams.status, 'scheduled'),
        gt(exams.date, new Date()),
      ),
    )
    .orderBy(exams.date)
    .limit(1);

  let atRiskForNextExam: FlashcardStats['atRiskForNextExam'] = null;
  if (nextExam) {
    const reviewed = cards.filter((c) => !c.suspended && c.state !== 'new');
    const atRisk = cardsAtRiskForExam(
      reviewed.map((c) => ({ id: c.id, schedule: toSchedule(c) })),
      nextExam.date,
    );
    atRiskForNextExam = {
      examTitle: nextExam.title,
      examDate: nextExam.date.toISOString(),
      atRiskCount: atRisk.length,
      totalCount: reviewed.length,
    };
  }

  const [topicMastery, retention] = await Promise.all([
    getTopicMastery(db, subject.id, cards),
    getRetention(db, subject.id),
  ]);

  return {
    countsByState,
    suspendedCount,
    flaggedCount,
    forecast,
    atRiskForNextExam,
    topicMastery,
    retention,
  };
}

/** One heatmap cell per topic: stored mastery (docs/02 §5) plus how many live cards it holds. */
async function getTopicMastery(
  db: AnyDb,
  subjectId: string,
  cards: Flashcard[],
): Promise<FlashcardStats['topicMastery']> {
  const rows: { id: string; name: string; mastery: number | null }[] = await db
    .select({ id: topics.id, name: topics.name, mastery: topics.mastery })
    .from(topics)
    .where(eq(topics.subjectId, subjectId))
    .orderBy(topics.orderIndex, topics.name);

  const perTopic = new Map<string, number>();
  for (const card of cards) {
    if (card.topicId && !card.suspended) {
      perTopic.set(card.topicId, (perTopic.get(card.topicId) ?? 0) + 1);
    }
  }
  return rows.map((t) => ({
    topicId: t.id,
    name: t.name,
    mastery: t.mastery,
    cardCount: perTopic.get(t.id) ?? 0,
  }));
}

/**
 * Real vs predicted retention from the `reviews` log. Each review after a card's first is a
 * sample: the gap since that card's previous review, the stability it had then, and whether it
 * was recalled. The gap comes from the log itself (LAG over the card's own history), not from
 * the card's current state, so it stays correct however many reviews came since.
 */
async function getRetention(db: AnyDb, subjectId: string): Promise<FlashcardStats['retention']> {
  const result = await db.execute(sql`
    SELECT elapsed_days, prev_stability, rating
    FROM (
      SELECT r.rating,
             r.prev_stability,
             EXTRACT(EPOCH FROM (r.reviewed_at - LAG(r.reviewed_at) OVER (
               PARTITION BY r.flashcard_id ORDER BY r.reviewed_at, r.id
             ))) / 86400.0 AS elapsed_days,
             a.subject_id
      FROM reviews r
      JOIN flashcards f ON f.id = r.flashcard_id
      JOIN artifacts a ON a.id = f.deck_id
    ) t
    WHERE t.subject_id = ${subjectId} AND t.elapsed_days IS NOT NULL AND t.prev_stability IS NOT NULL
  `);
  const rows = (Array.isArray(result) ? result : ((result as { rows?: unknown }).rows ?? [])) as {
    elapsed_days: number | string;
    prev_stability: number | string;
    rating: number | string;
  }[];

  const samples: ReviewSample[] = rows.map((r) => ({
    elapsedDays: Number(r.elapsed_days),
    prevStability: Number(r.prev_stability),
    success: Number(r.rating) > 1,
  }));
  return { sampleCount: samples.length, buckets: retentionCalibration(samples) };
}
