import { and, eq, gt } from 'drizzle-orm';
import { artifacts, exams, flashcards, subjects, type Flashcard } from '@studyhub/db';
import {
  cardsAtRiskForExam,
  forecastDueCounts,
  type FlashcardSchedule,
  type FsrsCardState,
} from '@studyhub/core';
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

export interface FlashcardStats {
  countsByState: Record<FsrsCardState, number>;
  suspendedCount: number;
  forecast: { date: string; count: number }[];
  atRiskForNextExam: {
    examTitle: string;
    examDate: string;
    atRiskCount: number;
    totalCount: number;
  } | null;
}

/** docs/fasi/F4-flashcard.md "Statistiche": counts by state, 30-day forecast, exam risk. */
export async function getFlashcardStats(db: AnyDb, subjectSlug: string): Promise<FlashcardStats> {
  const subject = await requireSubject(db, subjectSlug);

  const joined: { f: Flashcard }[] = await db
    .select({ f: flashcards })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id));
  const cards = joined.map((r) => r.f);

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

  return { countsByState, suspendedCount, forecast, atRiskForNextExam };
}
