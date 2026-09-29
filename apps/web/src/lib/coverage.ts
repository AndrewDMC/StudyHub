import { and, eq, inArray } from 'drizzle-orm';
import {
  artifacts,
  chunks,
  documentTopics,
  documents,
  examProfiles,
  flashcards,
  subjects,
  topics,
} from '@studyhub/db';
import { computeCoverageMap, describeGap } from '@studyhub/core';
import type { CoverageMapDto } from '@studyhub/contracts';
import { SubjectNotFoundError } from './errors';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDb = any;

/** Full text per document (chunks in order), for documents in `docIds`. */
async function textByDocument(db: AnyDb, docIds: string[]): Promise<string[]> {
  if (docIds.length === 0) return [];
  const rows: { documentId: string; ord: number; text: string }[] = await db
    .select({ documentId: chunks.documentId, ord: chunks.ord, text: chunks.text })
    .from(chunks)
    .where(inArray(chunks.documentId, docIds));
  const byDoc = new Map<string, { ord: number; text: string }[]>();
  for (const r of rows) byDoc.set(r.documentId, [...(byDoc.get(r.documentId) ?? []), r]);
  // A past exam with no extracted text still counts toward "N esami" — it just can't mention anything.
  return docIds.map((id) =>
    (byDoc.get(id) ?? [])
      .sort((a, b) => a.ord - b.ord)
      .map((c) => c.text)
      .join('\n'),
  );
}

/**
 * The coverage map of one subject (docs/06-miglioramenti.md #2 "Gap Analysis"): topics × study
 * material × flashcards × how often past exams raise the topic. Only `parsed` documents count —
 * an exam still being extracted has no text to be matched against, so counting it would dilute
 * every frequency ("2 esami su 5" when 3 of the 5 have nothing to search).
 */
export async function getCoverageMap(db: AnyDb, subjectSlug: string): Promise<CoverageMapDto> {
  const [subject] = await db.select().from(subjects).where(eq(subjects.slug, subjectSlug));
  if (!subject) throw new SubjectNotFoundError(subjectSlug);

  const topicRows: { id: string; name: string; mastery: number | null }[] = await db
    .select({ id: topics.id, name: topics.name, mastery: topics.mastery })
    .from(topics)
    .where(eq(topics.subjectId, subject.id));

  const docRows: { id: string; type: string; pages: number | null }[] = await db
    .select({ id: documents.id, type: documents.type, pages: documents.pages })
    .from(documents)
    .where(and(eq(documents.subjectId, subject.id), eq(documents.status, 'parsed')));
  const examDocIds = docRows.filter((d) => d.type === 'esami').map((d) => d.id);
  const studyDocs = docRows.filter((d) => d.type !== 'esami');
  const studyPages = new Map(studyDocs.map((d) => [d.id, d.pages ?? 0]));

  const links: { documentId: string; topicId: string }[] =
    studyDocs.length === 0
      ? []
      : await db
          .select({ documentId: documentTopics.documentId, topicId: documentTopics.topicId })
          .from(documentTopics)
          .where(
            inArray(
              documentTopics.documentId,
              studyDocs.map((d) => d.id),
            ),
          );
  const material = new Map<string, { docs: number; pages: number }>();
  for (const l of links) {
    const m = material.get(l.topicId) ?? { docs: 0, pages: 0 };
    m.docs += 1;
    m.pages += studyPages.get(l.documentId) ?? 0;
    material.set(l.topicId, m);
  }

  // Suspended cards are still cards the user made; only deck membership scopes them to the subject.
  const cardRows: { topicId: string | null }[] = await db
    .select({ topicId: flashcards.topicId })
    .from(flashcards)
    .innerJoin(artifacts, eq(flashcards.deckId, artifacts.id))
    .where(eq(artifacts.subjectId, subject.id));
  const cards = new Map<string, number>();
  for (const c of cardRows) if (c.topicId) cards.set(c.topicId, (cards.get(c.topicId) ?? 0) + 1);

  const [profile] = await db
    .select({ profile: examProfiles.profile })
    .from(examProfiles)
    .where(eq(examProfiles.subjectId, subject.id));

  const map = computeCoverageMap({
    topics: topicRows.map((t) => ({
      id: t.id,
      name: t.name,
      mastery: t.mastery,
      materialDocs: material.get(t.id)?.docs ?? 0,
      materialPages: material.get(t.id)?.pages ?? 0,
      cards: cards.get(t.id) ?? 0,
    })),
    examTexts: await textByDocument(db, examDocIds),
    materialTexts: await textByDocument(
      db,
      studyDocs.map((d) => d.id),
    ),
    recurringTopics: profile?.profile.recurringTopics ?? [],
  });

  return {
    examTotal: map.examTotal,
    topics: map.topics.map((t) => ({ ...t, message: describeGap(t) })),
    unmapped: map.unmapped,
  };
}
