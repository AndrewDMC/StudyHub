import { and, eq, isNotNull } from 'drizzle-orm';
import { artifacts, flashcards, reviews, subjects, topics } from '@studyhub/db';
import {
  MIN_SAMPLES_PER_LEVEL,
  computeCalibration,
  illusionByGroup,
  isCorrectRating,
  type CalibrationSample,
  type Confidence,
} from '@studyhub/core';
import type { CalibrationDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/**
 * How well the user's confidence tracks their results in this subject (docs/06-miglioramenti.md
 * #4). Only reviews where the user declared a confidence take part: skipping the declaration is
 * a choice, not an answer, and a guessed default would poison the very statistic this measures.
 */
export async function getCalibration(db: AnyDb, subjectSlug: string): Promise<CalibrationDto> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const rows: { confidence: number | null; rating: number; topicId: string | null }[] = await db
    .select({
      confidence: reviews.confidence,
      rating: reviews.rating,
      topicId: flashcards.topicId,
    })
    .from(reviews)
    .innerJoin(flashcards, eq(reviews.flashcardId, flashcards.id))
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(and(eq(artifacts.subjectId, subject.id), isNotNull(reviews.confidence)));

  const samples: CalibrationSample[] = rows.map((r) => ({
    confidence: r.confidence as Confidence,
    correct: isCorrectRating(r.rating),
    group: r.topicId,
  }));

  const calibration = computeCalibration(samples);
  const worst = illusionByGroup(samples);
  const names = new Map<string, string>();
  if (worst.length > 0) {
    const topicRows: { id: string; name: string }[] = await db
      .select({ id: topics.id, name: topics.name })
      .from(topics)
      .where(eq(topics.subjectId, subject.id));
    for (const t of topicRows) names.set(t.id, t.name);
  }

  return {
    ...calibration,
    minSamplesPerLevel: MIN_SAMPLES_PER_LEVEL,
    illusionByTopic: worst.map((g) => ({
      topicId: g.group,
      name: names.get(g.group) ?? 'Argomento eliminato',
      sure: g.sure,
      sureButWrong: g.sureButWrong,
      illusionRate: g.illusionRate,
    })),
  };
}
