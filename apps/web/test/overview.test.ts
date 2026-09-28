import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  documents,
  documentTopics,
  exams,
  flashcards,
  jobs,
  reviews,
  studyPlans,
  topics,
} from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { getSubjectOverview } from '../src/lib/overview';
import { SubjectNotFoundError } from '../src/lib/errors';

const AVAILABILITY = { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] };
const PREFS = {
  sessionLength: 50,
  intensity: 'standard' as const,
  simulationCount: 'auto' as const,
  simulationMinutes: 90,
  reviewMinutesPerCard: 0.5,
};
const FEASIBILITY = {
  feasible: true,
  requiredMinutes: 0,
  availableMinutes: 0,
  shortfallMinutes: 0,
  unscheduledTopicKeys: [],
  strategies: [],
};

describe('getSubjectOverview', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-overview-'));
    db = await createTestDb();
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    await expect(getSubjectOverview(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });

  it('reports an empty-but-valid overview for a fresh subject', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const overview = await getSubjectOverview(db, subject.slug);
    expect(overview).toEqual({ suggestedActions: [], recentActivity: [], gaps: [] });
  });

  describe('suggestedActions', () => {
    it('suggests "Ripassa" when cards are due', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId: subject.id,
        kind: 'flashcard_deck',
        title: 'Deck',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      await db.insert(flashcards).values({
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'due',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'new',
      });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions).toContainEqual(
        expect.objectContaining({ kind: 'review', href: `/materie/${subject.slug}/review` }),
      );
    });

    it('suggests "Drill" for the weakest topic under 40% mastery, ignoring one at/above it', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const weak = randomUUID();
      await db.insert(topics).values([
        { id: weak, subjectId: subject.id, name: 'Debole', slug: 'debole', mastery: 0.2 },
        { id: randomUUID(), subjectId: subject.id, name: 'Forte', slug: 'forte', mastery: 0.9 },
        { id: randomUUID(), subjectId: subject.id, name: 'Media', slug: 'media', mastery: 0.35 },
      ]);

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions).toContainEqual(
        expect.objectContaining({
          kind: 'drill',
          href: `/materie/${subject.slug}/review?topicId=${weak}`,
        }),
      );
    });

    it('suggests "Verifica" when schema documents have unconfirmed blocks, ignoring other document types', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      await db.insert(documents).values([
        {
          id: randomUUID(),
          subjectId: subject.id,
          type: 'schemi',
          originalName: 'schema.pdf',
          storedPath: '/x',
          mime: 'application/pdf',
          bytes: 1,
          sha256: 'a'.repeat(64),
          status: 'parsed',
          blockedBlocks: 3,
        },
        {
          id: randomUUID(),
          subjectId: subject.id,
          type: 'appunti',
          originalName: 'appunti.pdf',
          storedPath: '/y',
          mime: 'application/pdf',
          bytes: 1,
          sha256: 'b'.repeat(64),
          status: 'parsed',
          blockedBlocks: 5, // not schemi — must not count toward "Verifica"
        },
      ]);

      const overview = await getSubjectOverview(db, subject.slug);
      const verify = overview.suggestedActions.find((a) => a.kind === 'verify');
      expect(verify).toMatchObject({ href: `/materie/${subject.slug}?tab=schemi` });
      expect(verify?.description).toContain('3');
    });

    it('suggests "Genera piano" for an upcoming exam with no plan yet', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      await db.insert(exams).values({
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Scritto',
        kind: 'scritto',
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions).toContainEqual(
        expect.objectContaining({ kind: 'generate_plan', href: `/materie/${subject.slug}/piano` }),
      );
    });

    it('does not suggest "Genera piano" when a plan (active or draft) already exists', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      await db.insert(exams).values({
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Scritto',
        kind: 'scritto',
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      await db.insert(studyPlans).values({
        id: randomUUID(),
        subjectId: subject.id,
        startDate: '2026-01-01',
        targetDate: '2026-02-01',
        availability: AVAILABILITY,
        prefs: PREFS,
        feasibility: FEASIBILITY,
        warnings: [],
        model: 'fake-v1',
        promptVersion: 'estimate_topics/v1',
        status: 'draft',
      });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions.find((a) => a.kind === 'generate_plan')).toBeUndefined();
    });

    it('suggests "Tagga" for a parsed document with no topic, ignoring an already-tagged one', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const topicId = randomUUID();
      const taggedDocId = randomUUID();
      const untaggedDocId = randomUUID();
      await db.insert(topics).values({ id: topicId, subjectId: subject.id, name: 'A', slug: 'a' });
      await db.insert(documents).values([
        {
          id: taggedDocId,
          subjectId: subject.id,
          type: 'appunti',
          originalName: 'tagged.pdf',
          storedPath: '/x',
          mime: 'application/pdf',
          bytes: 1,
          sha256: 'a'.repeat(64),
          status: 'parsed',
        },
        {
          id: untaggedDocId,
          subjectId: subject.id,
          type: 'esami',
          originalName: 'untagged.pdf',
          storedPath: '/y',
          mime: 'application/pdf',
          bytes: 1,
          sha256: 'b'.repeat(64),
          status: 'parsed',
        },
      ]);
      await db.insert(documentTopics).values({ documentId: taggedDocId, topicId });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions).toContainEqual(
        expect.objectContaining({ kind: 'tag', href: `/materie/${subject.slug}?tab=esami` }),
      );
    });

    it('returns only the first 3 candidates, in priority order, when more than 3 apply', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      // review
      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId: subject.id,
        kind: 'flashcard_deck',
        title: 'Deck',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      await db.insert(flashcards).values({
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'due',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'new',
      });
      // drill
      await db
        .insert(topics)
        .values({
          id: randomUUID(),
          subjectId: subject.id,
          name: 'Debole',
          slug: 'debole',
          mastery: 0.1,
        });
      // verify
      await db.insert(documents).values({
        id: randomUUID(),
        subjectId: subject.id,
        type: 'schemi',
        originalName: 's.pdf',
        storedPath: '/s',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'c'.repeat(64),
        status: 'parsed',
        blockedBlocks: 1,
      });
      // generate_plan
      await db.insert(exams).values({
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Scritto',
        kind: 'scritto',
        date: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
      // tag (a 5th candidate — must be truncated away)
      await db.insert(documents).values({
        id: randomUUID(),
        subjectId: subject.id,
        type: 'appunti',
        originalName: 'untagged.pdf',
        storedPath: '/u',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'd'.repeat(64),
        status: 'parsed',
      });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.suggestedActions).toHaveLength(3);
      expect(overview.suggestedActions.map((a) => a.kind)).toEqual(['review', 'drill', 'verify']);
    });
  });

  describe('gaps', () => {
    it('flags a topic with no documents, no flashcards, and low mastery — independently', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const bareTopicId = randomUUID();
      const okTopicId = randomUUID();
      await db.insert(topics).values([
        { id: bareTopicId, subjectId: subject.id, name: 'Nudo', slug: 'nudo', mastery: 0.1 },
        { id: okTopicId, subjectId: subject.id, name: 'A posto', slug: 'a-posto', mastery: 0.9 },
      ]);
      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId: subject.id,
        type: 'appunti',
        originalName: 'x.pdf',
        storedPath: '/x',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'a'.repeat(64),
        status: 'parsed',
      });
      await db.insert(documentTopics).values({ documentId: docId, topicId: okTopicId });
      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId: subject.id,
        kind: 'flashcard_deck',
        title: 'Deck',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      await db.insert(flashcards).values({
        id: randomUUID(),
        deckId,
        topicId: okTopicId,
        type: 'basic',
        front: 'f',
        back: 'b',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
      });

      const overview = await getSubjectOverview(db, subject.slug);
      const bareGapKinds = overview.gaps
        .filter((g) => g.topicId === bareTopicId)
        .map((g) => g.kind);
      expect(bareGapKinds.sort()).toEqual(
        ['low_mastery', 'topic_without_documents', 'topic_without_flashcards'].sort(),
      );
      expect(overview.gaps.some((g) => g.topicId === okTopicId)).toBe(false);
    });
  });

  describe('recentActivity', () => {
    it('merges jobs, reviews and uploads from the last 7 days, newest first, excluding older ones and other subjects', async () => {
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const other = await createSubject(db, dataRoot, { name: 'Chimica 1', color: 'green' });

      const now = Date.now();
      const day = 24 * 60 * 60 * 1000;

      await db.insert(jobs).values([
        {
          id: randomUUID(),
          type: 'generate_flashcards',
          subjectId: subject.id,
          status: 'succeeded',
          createdAt: new Date(now - 1 * day),
        },
        {
          id: randomUUID(),
          type: 'generate_summary',
          subjectId: subject.id,
          status: 'succeeded',
          createdAt: new Date(now - 10 * day), // outside the 7-day window
        },
        {
          id: randomUUID(),
          type: 'generate_schema',
          subjectId: other.id,
          status: 'succeeded',
          createdAt: new Date(now - 1 * day), // another subject
        },
      ]);

      const docId = randomUUID();
      await db.insert(documents).values({
        id: docId,
        subjectId: subject.id,
        type: 'appunti',
        originalName: 'recent.pdf',
        storedPath: '/x',
        mime: 'application/pdf',
        bytes: 1,
        sha256: 'a'.repeat(64),
        status: 'parsed',
        createdAt: new Date(now - 2 * day),
      });

      const deckId = randomUUID();
      await db.insert(artifacts).values({
        id: deckId,
        subjectId: subject.id,
        kind: 'flashcard_deck',
        title: 'Deck',
        path: '/x.json',
        model: 'fake-v1',
        promptVersion: 'flashcards/v1',
      });
      const cardId = randomUUID();
      await db.insert(flashcards).values({
        id: cardId,
        deckId,
        type: 'basic',
        front: 'f',
        back: 'b',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
      });
      await db.insert(reviews).values({
        id: randomUUID(),
        flashcardId: cardId,
        rating: 3,
        elapsedMs: 1200,
        newStability: 2.5,
        reviewedAt: new Date(now - 3 * day),
      });

      const overview = await getSubjectOverview(db, subject.slug);
      expect(overview.recentActivity).toHaveLength(3);
      expect(overview.recentActivity.map((a) => a.kind)).toEqual(['job', 'upload', 'review']);
      expect(overview.recentActivity[0]).toMatchObject({
        kind: 'job',
        jobType: 'generate_flashcards',
      });
    });
  });
});
