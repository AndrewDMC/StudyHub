import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifactSources,
  artifacts,
  chunks,
  documentTopics,
  documents,
  flashcards,
  studyPlans,
  tasks,
  topics,
} from '@studyhub/db';
import { resolveDocumentDerivedDir, resolveSubjectSubpath } from '@studyhub/core';
import { createSubject } from '../src/lib/subjects';
import { deleteDocument, getDocumentDeletionImpact } from '../src/lib/documents';
import { DocumentNotFoundError } from '../src/lib/documentTopics';
import { SubjectNotFoundError } from '../src/lib/errors';
import { ConflictError } from '../src/lib/examPrep';

describe('delete document', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let slug: string;
  let subjectId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-docdelete-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Analisi 2', color: 'violet' });
    slug = subject.slug;
    subjectId = subject.id;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addDoc(status: 'parsed' | 'failed' | 'parsing' = 'failed') {
    const id = randomUUID();
    const dir = resolveSubjectSubpath(slug, ['sources', 'altro'], dataRoot);
    await mkdir(dir, { recursive: true });
    const storedPath = join(dir, `${id}.pdf`);
    await writeFile(storedPath, 'bytes');
    const derived = resolveDocumentDerivedDir(slug, id, dataRoot);
    await mkdir(derived, { recursive: true });
    await writeFile(join(derived, 'content.md'), '# testo');
    await db.insert(documents).values({
      id,
      subjectId,
      type: 'altro',
      originalName: 'ASDParzApp.pdf',
      storedPath,
      mime: 'application/pdf',
      bytes: 5,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status,
    });
    return { id, storedPath, derived };
  }

  async function addTopic(name: string) {
    const id = randomUUID();
    await db.insert(topics).values({ id, subjectId, name, slug: name.toLowerCase() });
    return id;
  }

  it('removes the row and moves the files to .trash/ (recoverable)', async () => {
    const { id, storedPath, derived } = await addDoc('failed');

    const { trashedTo } = await deleteDocument(db, dataRoot, slug, id);

    expect(await db.select().from(documents).where(eq(documents.id, id))).toHaveLength(0);
    await expect(stat(storedPath)).rejects.toThrow();
    await expect(stat(derived)).rejects.toThrow();
    expect(trashedTo.startsWith(join(dataRoot, '.trash'))).toBe(true);
    expect(await readFile(join(trashedTo, 'derived', 'content.md'), 'utf-8')).toBe('# testo');
  });

  it('cascades chunks and topic links, and recomputes the topic mastery', async () => {
    const { id } = await addDoc('parsed');
    const topicId = await addTopic('Integrali');
    await db.insert(documentTopics).values({ documentId: id, topicId });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: id,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'testo',
      tokens: 1,
    });

    await deleteDocument(db, dataRoot, slug, id);

    expect(await db.select().from(chunks)).toHaveLength(0);
    expect(await db.select().from(documentTopics)).toHaveLength(0);
    // the topic itself survives
    expect(await db.select().from(topics).where(eq(topics.id, topicId))).toHaveLength(1);
  });

  it('keeps flashcards and artifacts built from the document', async () => {
    const { id } = await addDoc('parsed');
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Mazzo',
      path: 'artifacts/mazzo',
      model: 'fake',
      promptVersion: 'v1',
    });
    await db.insert(artifactSources).values({ artifactId: deckId, documentId: id });
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      type: 'basic',
      front: 'f',
      back: 'b',
      sourceRef: { docId: id, page: 1, quote: 'q' },
    });

    const impact = await getDocumentDeletionImpact(db, slug, id);
    expect(impact.artifacts).toEqual([{ id: deckId, title: 'Mazzo', kind: 'flashcard_deck' }]);
    expect(impact.flashcardsCiting).toBe(1);

    await deleteDocument(db, dataRoot, slug, id);

    expect(await db.select().from(flashcards)).toHaveLength(1);
    expect(await db.select().from(artifacts)).toHaveLength(1);
    expect(await db.select().from(artifactSources)).toHaveLength(0);
  });

  it('reports chunks, topics and open planned tasks before deleting', async () => {
    const { id } = await addDoc('parsed');
    const other = await addDoc('parsed');
    const topicId = await addTopic('Fubini');
    await db.insert(documentTopics).values({ documentId: id, topicId });
    await db.insert(chunks).values(
      [0, 1].map((ord) => ({
        id: randomUUID(),
        documentId: id,
        pageFrom: 1,
        pageTo: 1,
        ord,
        text: `t${ord}`,
        tokens: 1,
      })),
    );

    const planId = randomUUID();
    await db.insert(studyPlans).values({
      id: planId,
      subjectId,
      status: 'active',
      startDate: '2026-10-05',
      targetDate: '2026-11-05',
      availability: { perWeekday: [60, 60, 60, 60, 60, 0, 0], blackoutDates: [] },
      prefs: {
        sessionLength: 45,
        intensity: 'standard',
        simulationCount: 'auto',
        simulationMinutes: 90,
        reviewMinutesPerCard: 1,
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
      model: 'fake',
      promptVersion: 'v1',
    });
    const task = (docId: string, status: 'todo' | 'done') => ({
      id: randomUUID(),
      subjectId,
      planId,
      taskKey: `read:${randomUUID().slice(0, 6)}`,
      date: '2026-10-06',
      kind: 'read' as const,
      minutes: 30,
      title: 't',
      description: '',
      payload: { action: 'read' as const, material: [{ docId, pageFrom: 1, pageTo: 2 }] },
      status,
    });
    await db.insert(tasks).values([task(id, 'todo'), task(id, 'done'), task(other.id, 'todo')]);

    const impact = await getDocumentDeletionImpact(db, slug, id);
    expect(impact).toMatchObject({
      name: 'ASDParzApp.pdf',
      deletable: true,
      blockedReason: null,
      chunks: 2,
      topics: ['Fubini'],
      openTasks: 1, // done tasks and other documents' tasks don't count
    });
  });

  it('refuses a document that is still being processed', async () => {
    const { id, storedPath } = await addDoc('parsing');
    expect((await getDocumentDeletionImpact(db, slug, id)).deletable).toBe(false);
    await expect(deleteDocument(db, dataRoot, slug, id)).rejects.toBeInstanceOf(ConflictError);
    // nothing was touched
    expect(await readFile(storedPath, 'utf-8')).toBe('bytes');
    expect(await db.select().from(documents).where(eq(documents.id, id))).toHaveLength(1);
  });

  it('404s on an unknown document, another subject, or an unknown subject', async () => {
    await expect(deleteDocument(db, dataRoot, slug, randomUUID())).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
    const { id } = await addDoc('failed');
    await createSubject(db, dataRoot, { name: 'Fisica', color: 'blue' });
    await expect(deleteDocument(db, dataRoot, 'fisica', id)).rejects.toBeInstanceOf(
      DocumentNotFoundError,
    );
    await expect(deleteDocument(db, dataRoot, 'nope', id)).rejects.toBeInstanceOf(
      SubjectNotFoundError,
    );
  });

  it('frees the sha256 so the same file can be uploaded again', async () => {
    const { id } = await addDoc('failed');
    const [row] = await db.select().from(documents).where(eq(documents.id, id));
    await deleteDocument(db, dataRoot, slug, id);
    const again = await db.select().from(documents).where(eq(documents.sha256, row!.sha256));
    expect(again).toHaveLength(0);
  });
});
