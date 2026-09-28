import { and, desc, eq, gt, gte, inArray, isNotNull, lte, or } from 'drizzle-orm';
import {
  artifacts,
  documents,
  documentTopics,
  exams,
  flashcards,
  jobs,
  reviews,
  studyPlans,
  subjects,
  topics,
  type Document,
  type Job,
  type Review,
  type Topic,
} from '@studyhub/db';
import type {
  JobType,
  RecentActivityItemDto,
  SubjectOverviewDto,
  SuggestedActionDto,
} from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

async function requireSubject(db: AnyDb, subjectSlug: string) {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);
  return subject;
}

const RECENT_DAYS = 7;
const RECENT_ACTIVITY_LIMIT = 10;
// docs/02-filesystem-e-dati.md §5 mastery bands, same threshold TopicsPanel's heatmap uses for "rosso".
const LOW_MASTERY_THRESHOLD = 0.4;

/** Candidate actions in priority order — the first 3 that apply are shown (docs/fasi/F2-materie.md). */
async function suggestedActions(
  db: AnyDb,
  subjectSlug: string,
  subjectId: string,
  topicRows: Topic[],
  docRows: Document[],
  taggedDocIds: Set<string>,
): Promise<SuggestedActionDto[]> {
  const candidates: SuggestedActionDto[] = [];
  const now = new Date();

  const dueCards: { id: string }[] = await db
    .select({ id: flashcards.id })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(
      and(
        eq(artifacts.subjectId, subjectId),
        eq(flashcards.suspended, false),
        or(
          eq(flashcards.state, 'new'),
          and(isNotNull(flashcards.dueAt), lte(flashcards.dueAt, now)),
        ),
      ),
    );
  if (dueCards.length > 0) {
    candidates.push({
      kind: 'review',
      label: 'Ripassa',
      description: `${dueCards.length} flashcard in scadenza`,
      href: `/materie/${subjectSlug}/review`,
    });
  }

  const weakestTopic = topicRows
    .filter(
      (t): t is Topic & { mastery: number } =>
        t.mastery !== null && t.mastery < LOW_MASTERY_THRESHOLD,
    )
    .sort((a, b) => a.mastery - b.mastery)[0];
  if (weakestTopic) {
    candidates.push({
      kind: 'drill',
      label: 'Drill',
      description: `"${weakestTopic.name}" è al ${Math.round(weakestTopic.mastery * 100)}% di mastery`,
      href: `/materie/${subjectSlug}/review?topicId=${weakestTopic.id}`,
    });
  }

  const blockedTotal = docRows
    .filter((d) => d.type === 'schemi')
    .reduce((sum, d) => sum + d.blockedBlocks, 0);
  if (blockedTotal > 0) {
    candidates.push({
      kind: 'verify',
      label: 'Verifica',
      description: `${blockedTotal} bloc${blockedTotal === 1 ? 'co' : 'chi'} da confermare negli schemi`,
      href: `/materie/${subjectSlug}?tab=schemi`,
    });
  }

  const [nextExam] = await db
    .select()
    .from(exams)
    .where(and(eq(exams.subjectId, subjectId), eq(exams.status, 'scheduled'), gt(exams.date, now)))
    .orderBy(exams.date)
    .limit(1);
  if (nextExam) {
    const [plan] = await db
      .select({ id: studyPlans.id })
      .from(studyPlans)
      .where(
        and(eq(studyPlans.subjectId, subjectId), inArray(studyPlans.status, ['active', 'draft'])),
      )
      .limit(1);
    if (!plan) {
      candidates.push({
        kind: 'generate_plan',
        label: 'Genera piano',
        description: `Esame "${nextExam.title}" senza un piano di studio`,
        href: `/materie/${subjectSlug}/piano`,
      });
    }
  }

  const untaggedDoc = docRows.find((d) => d.status === 'parsed' && !taggedDocIds.has(d.id));
  if (untaggedDoc) {
    candidates.push({
      kind: 'tag',
      label: 'Tagga',
      description: `"${untaggedDoc.originalName}" non ha un argomento assegnato`,
      href: `/materie/${subjectSlug}?tab=${untaggedDoc.type}`,
    });
  }

  return candidates.slice(0, 3);
}

async function recentActivity(
  db: AnyDb,
  subjectId: string,
  since: Date,
): Promise<RecentActivityItemDto[]> {
  const [jobRows, reviewRows, uploadRows]: [Job[], (Review & { docId: string })[], Document[]] =
    await Promise.all([
      db
        .select()
        .from(jobs)
        .where(and(eq(jobs.subjectId, subjectId), gte(jobs.createdAt, since)))
        .orderBy(desc(jobs.createdAt))
        .limit(RECENT_ACTIVITY_LIMIT),
      db
        .select({
          id: reviews.id,
          flashcardId: reviews.flashcardId,
          rating: reviews.rating,
          elapsedMs: reviews.elapsedMs,
          reviewedAt: reviews.reviewedAt,
          prevStability: reviews.prevStability,
          newStability: reviews.newStability,
          docId: artifacts.id,
        })
        .from(reviews)
        .innerJoin(flashcards, eq(reviews.flashcardId, flashcards.id))
        .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
        .where(and(eq(artifacts.subjectId, subjectId), gte(reviews.reviewedAt, since)))
        .orderBy(desc(reviews.reviewedAt))
        .limit(RECENT_ACTIVITY_LIMIT),
      db
        .select()
        .from(documents)
        .where(and(eq(documents.subjectId, subjectId), gte(documents.createdAt, since)))
        .orderBy(desc(documents.createdAt))
        .limit(RECENT_ACTIVITY_LIMIT),
    ]);

  const items: RecentActivityItemDto[] = [
    ...jobRows.map((j): RecentActivityItemDto => ({
      kind: 'job',
      id: j.id,
      jobType: j.type as JobType,
      status: j.status,
      timestamp: j.createdAt.toISOString(),
    })),
    ...reviewRows.map((r): RecentActivityItemDto => ({
      kind: 'review',
      id: r.id,
      rating: r.rating as 1 | 2 | 3 | 4,
      timestamp: r.reviewedAt.toISOString(),
    })),
    ...uploadRows.map((d): RecentActivityItemDto => ({
      kind: 'upload',
      id: d.id,
      documentName: d.originalName,
      documentType: d.type,
      timestamp: d.createdAt.toISOString(),
    })),
  ];
  items.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return items.slice(0, RECENT_ACTIVITY_LIMIT);
}

/**
 * Panoramica tab (docs/fasi/F2-materie.md "Centro"): 3 azioni consigliate (regole
 * deterministiche, non AI), attività recente (ultimi 7 giorni) e gap rilevati.
 *
 * `detectDrift` (piano indietro) è deliberatamente **fuori** da `gaps`: è già la sua stessa API
 * (`GET /api/subjects/:slug/plan/drift`) e già mostrato come banner in cima a `DailyTasksPanel`,
 * che vive nella stessa tab — ripeterlo qui sarebbe lo stesso avviso due volte.
 */
export async function getSubjectOverview(
  db: AnyDb,
  subjectSlug: string,
): Promise<SubjectOverviewDto> {
  const subject = await requireSubject(db, subjectSlug);
  const since = new Date(Date.now() - RECENT_DAYS * 24 * 60 * 60 * 1000);

  const [topicRows, docRows, docTopicRows]: [
    Topic[],
    Document[],
    { topicId: string; documentId: string }[],
  ] = await Promise.all([
    db.select().from(topics).where(eq(topics.subjectId, subject.id)),
    db.select().from(documents).where(eq(documents.subjectId, subject.id)),
    db
      .select({ topicId: documentTopics.topicId, documentId: documentTopics.documentId })
      .from(documentTopics)
      .innerJoin(documents, eq(documentTopics.documentId, documents.id))
      .where(eq(documents.subjectId, subject.id)),
  ]);

  const topicIds = topicRows.map((t) => t.id);
  const flashcardTopicRows: { topicId: string | null }[] =
    topicIds.length > 0
      ? await db
          .select({ topicId: flashcards.topicId })
          .from(flashcards)
          .where(inArray(flashcards.topicId, topicIds))
      : [];
  const topicsWithFlashcards = new Set(flashcardTopicRows.map((r) => r.topicId));
  const topicsWithDocs = new Set(docTopicRows.map((r) => r.topicId));
  const taggedDocIds = new Set(docTopicRows.map((r) => r.documentId));

  const gaps: SubjectOverviewDto['gaps'] = [];
  for (const t of topicRows) {
    if (!topicsWithDocs.has(t.id)) {
      gaps.push({
        kind: 'topic_without_documents',
        topicId: t.id,
        topicName: t.name,
        message: `"${t.name}" non ha documenti assegnati`,
      });
    }
    if (!topicsWithFlashcards.has(t.id)) {
      gaps.push({
        kind: 'topic_without_flashcards',
        topicId: t.id,
        topicName: t.name,
        message: `"${t.name}" non ha flashcard`,
      });
    }
    if (t.mastery !== null && t.mastery < LOW_MASTERY_THRESHOLD) {
      gaps.push({
        kind: 'low_mastery',
        topicId: t.id,
        topicName: t.name,
        message: `Mastery bassa (${Math.round(t.mastery * 100)}%)`,
      });
    }
  }

  const [actions, activity] = await Promise.all([
    suggestedActions(db, subjectSlug, subject.id, topicRows, docRows, taggedDocIds),
    recentActivity(db, subject.id, since),
  ]);

  return { suggestedActions: actions, recentActivity: activity, gaps };
}
