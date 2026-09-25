import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  artifacts,
  documentTopics,
  documents,
  exams,
  flashcards,
  studyPlans,
  tasks,
  topics,
} from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import {
  createSubject,
  deleteSubjectPermanently,
  getSubjectBySlug,
  listSubjectSummaries,
  setSubjectArchived,
} from '../src/lib/subjects';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('createSubject — full F0 flow (input -> slug -> FS -> DB -> DTO)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-web-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates a folder on disk with a valid manifest and an indexed DB row', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

    expect(subject.slug).toBe('fisica-1');
    expect(subject.name).toBe('Fisica 1');

    const subjectDir = join(dataRoot, 'subjects', 'fisica-1');
    const manifestRaw = await readFile(join(subjectDir, 'subject.json'), 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.slug).toBe('fisica-1');
    expect(manifest.id).toBe(subject.id);

    for (const dir of ['sources', 'derived', 'artifacts', 'plans', '.studyhub']) {
      const s = await stat(join(subjectDir, dir));
      expect(s.isDirectory()).toBe(true);
    }

    const listed = await listSubjectSummaries(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.slug).toBe('fisica-1');
    expect(listed[0]?.documentCount).toBe(0);
    expect(listed[0]?.nextExamAt).toBeNull();
    expect(listed[0]?.averageMastery).toBeNull();
    expect(listed[0]?.dueCardsToday).toBe(0);
  });

  it('disambiguates the slug when two subjects share the same name', async () => {
    const a = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'violet' });
    const b = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'cyan' });

    expect(a.slug).toBe('analisi-1');
    expect(b.slug).toBe('analisi-1-2');
    expect(a.id).not.toBe(b.id);

    const bothDirs = await Promise.all(
      [a.slug, b.slug].map((slug) => stat(join(dataRoot, 'subjects', slug))),
    );
    expect(bothDirs.every((s) => s.isDirectory())).toBe(true);
  });

  it('rejects a name that only contains illegal characters via disambiguation, not a crash', async () => {
    const subject = await createSubject(db, dataRoot, { name: '!!!', color: 'teal' });
    expect(subject.slug).toBe('subject');
  });

  it('getSubjectBySlug finds a created subject by its stable slug', async () => {
    await createSubject(db, dataRoot, { name: 'Chimica Organica', color: 'green' });
    const found = await getSubjectBySlug(db, 'chimica-organica');
    expect(found?.name).toBe('Chimica Organica');
    expect(await getSubjectBySlug(db, 'does-not-exist')).toBeNull();
  });
});

describe('listSubjectSummaries — empty state', () => {
  it('returns an empty array when no subject has been created', async () => {
    const db = await createTestDb();
    expect(await listSubjectSummaries(db)).toEqual([]);
  });
});

describe('listSubjectSummaries — aggregation and archived filtering', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-summaries-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('reports the soonest upcoming scheduled exam, ignoring past/cancelled ones', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    await db.insert(exams).values([
      { id: randomUUID(), subjectId: subject.id, title: 'Lontano', kind: 'scritto', date: future },
      { id: randomUUID(), subjectId: subject.id, title: 'Vicino', kind: 'orale', date: soon },
      { id: randomUUID(), subjectId: subject.id, title: 'Passato', kind: 'scritto', date: past },
      {
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Annullato',
        kind: 'scritto',
        date: new Date(Date.now() + 1000),
        status: 'cancelled',
      },
    ]);

    const [summary] = await listSubjectSummaries(db);
    expect(summary?.nextExamAt).toBe(soon.toISOString());
  });

  it('excludes archived subjects by default, includes them with includeArchived', async () => {
    const a = await createSubject(db, dataRoot, { name: 'Attiva', color: 'blue' });
    const b = await createSubject(db, dataRoot, { name: 'Archiviata', color: 'rose' });
    await setSubjectArchived(db, b.slug, true);

    const visible = await listSubjectSummaries(db);
    expect(visible.map((s) => s.slug)).toEqual([a.slug]);

    const all = await listSubjectSummaries(db, { includeArchived: true });
    expect(all.map((s) => s.slug).sort()).toEqual([a.slug, b.slug].sort());
  });

  it('averages topic mastery per subject, ignoring topics without one', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await db.insert(topics).values([
      { id: randomUUID(), subjectId: subject.id, name: 'A', slug: 'a', mastery: 0.4 },
      { id: randomUUID(), subjectId: subject.id, name: 'B', slug: 'b', mastery: 0.8 },
      { id: randomUUID(), subjectId: subject.id, name: 'C', slug: 'c', mastery: null },
    ]);

    const [summary] = await listSubjectSummaries(db);
    expect(summary?.averageMastery).toBe(0.6);
  });

  it('counts due-today flashcards per subject (new, or past/at their dueAt; suspended and future excluded)', async () => {
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
    await db.insert(flashcards).values([
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'new card',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'new',
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'overdue',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'future',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
      {
        id: randomUUID(),
        deckId,
        type: 'basic',
        front: 'suspended overdue',
        back: 'x',
        sourceRef: { docId: randomUUID(), page: 1, quote: 'x' },
        state: 'review',
        dueAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
        suspended: true,
      },
    ]);

    const [summary] = await listSubjectSummaries(db);
    expect(summary?.dueCardsToday).toBe(2);
  });

  it('computes topic reading coverage for the subject (pages read over pages assigned)', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const topicId = randomUUID();
    await db.insert(topics).values({ id: topicId, subjectId: subject.id, name: 'A', slug: 'a' });
    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId: subject.id,
      type: 'appunti',
      originalName: 'doc.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
      pages: 20,
    });
    await db.insert(documentTopics).values({ documentId: docId, topicId });
    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId: subject.id,
      startDate: '2026-01-05',
      targetDate: '2026-02-04',
      availability: { perWeekday: [0, 120, 120, 120, 120, 120, 0], blackoutDates: [] },
      prefs: {
        sessionLength: 50,
        intensity: 'standard',
        simulationCount: 'auto',
        simulationMinutes: 90,
        reviewMinutesPerCard: 0.5,
      },
      feasibility: {
        feasible: true,
        requiredMinutes: 0,
        availableMinutes: 0,
        shortfallMinutes: 0,
        unscheduledTopicKeys: [],
        strategies: [],
      },
      warnings: [],
      model: 'fake-v1',
      promptVersion: 'estimate_topics/v1',
      status: 'active',
    });
    await db.insert(tasks).values({
      id: randomUUID(),
      subjectId: subject.id,
      planId,
      taskKey: 'read:1',
      date: '2026-01-05',
      kind: 'read',
      topicId,
      minutes: 30,
      title: 'Studia',
      description: '',
      payload: { action: 'read', material: [{ docId, pageFrom: 1, pageTo: 10 }], topicId },
      status: 'done',
    });

    const [summary] = await listSubjectSummaries(db);
    expect(summary?.topicCoverage).toBeCloseTo(0.5, 1);
  });

  it('reports null topic coverage when no document is tagged to a topic yet', async () => {
    await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const [summary] = await listSubjectSummaries(db);
    expect(summary?.topicCoverage).toBeNull();
  });
});

describe('setSubjectArchived', () => {
  it('archives then unarchives without touching the filesystem', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-archive-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

      const archived = await setSubjectArchived(db, subject.slug, true);
      expect(archived.archivedAt).not.toBeNull();

      const unarchived = await setSubjectArchived(db, subject.slug, false);
      expect(unarchived.archivedAt).toBeNull();

      const s = await stat(join(dataRoot, 'subjects', subject.slug));
      expect(s.isDirectory()).toBe(true);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    const db = await createTestDb();
    await expect(setSubjectArchived(db, 'nope', true)).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});

describe('deleteSubjectPermanently', () => {
  it('moves the folder to .trash/ and removes the DB row (not rm -rf)', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-delete-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const subjectDir = join(dataRoot, 'subjects', subject.slug);

      await deleteSubjectPermanently(db, dataRoot, subject.slug);

      await expect(stat(subjectDir)).rejects.toThrow();
      expect(await getSubjectBySlug(db, subject.slug)).toBeNull();

      const trashEntries = await (
        await import('node:fs/promises')
      ).readdir(join(dataRoot, '.trash'));
      expect(trashEntries).toHaveLength(1);
      expect(trashEntries[0]).toContain(subject.slug);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-delete-missing-'));
    try {
      const db = await createTestDb();
      await expect(deleteSubjectPermanently(db, dataRoot, 'nope')).rejects.toBeInstanceOf(
        SubjectNotFoundError,
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
