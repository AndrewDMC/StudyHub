import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import {
  artifacts,
  chunks,
  documentTopics,
  documents,
  examProfiles,
  flashcards,
  topics,
} from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { getCoverageMap } from '../src/lib/coverage';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('getCoverageMap', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let slug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-coverage-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Segnali', color: 'teal' });
    subjectId = subject.id;
    slug = subject.slug;
  });
  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function addDoc(
    type: 'esami' | 'appunti',
    text: string,
    over: Partial<typeof documents.$inferInsert> = {},
  ) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId,
      type,
      originalName: `${type}-${id.slice(0, 4)}.pdf`,
      storedPath: '/x',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
      pages: 10,
      ...over,
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: id,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text,
      tokens: 5,
    });
    return id;
  }

  async function addTopic(name: string, mastery: number | null = null) {
    const id = randomUUID();
    await db
      .insert(topics)
      .values({ id, subjectId, name, slug: name.toLowerCase().replace(/\W+/g, '-'), mastery });
    return id;
  }

  async function addCard(topicId: string | null) {
    const deckId = randomUUID();
    await db.insert(artifacts).values({
      id: deckId,
      subjectId,
      kind: 'flashcard_deck',
      title: 'Deck',
      path: '/d.json',
      model: 'fake-v1',
      promptVersion: 'flashcards/v1',
    });
    await db.insert(flashcards).values({
      id: randomUUID(),
      deckId,
      topicId,
      type: 'basic',
      front: 'Q',
      back: 'A',
      sourceRef: { docId: randomUUID(), page: 1, quote: 'q' },
    });
  }

  it('says "compare in 4 esami su 5" for a topic the material does not cover', async () => {
    const laplace = await addTopic('Trasformata di Laplace');
    for (const text of [
      'Es 1: trasformata di Laplace del segnale.',
      'Calcolare la trasformata di Laplace.',
      'Es 1: trasformate di Laplace.',
      'Trasformata di Laplace inversa.',
      'Solo esercizi sulla convoluzione.',
    ])
      await addDoc('esami', text);

    const map = await getCoverageMap(db, slug);
    const t = map.topics.find((x) => x.topicId === laplace)!;
    expect(map.examTotal).toBe(5);
    expect(t).toMatchObject({ examMentions: 4, materialDocs: 0, cards: 0 });
    expect(t.flags).toEqual(['no_material', 'no_cards']);
    expect(t.message).toBe(
      'Non hai materiale su "Trasformata di Laplace" e nessuna flashcard, che compare in 4 esami su 5.',
    );
  });

  it("counts linked study material (docs and pages) and the topic's cards, and clears the flags", async () => {
    const t = await addTopic('Convoluzione', 0.8);
    const doc = await addDoc('appunti', 'la convoluzione tra segnali', { pages: 12 });
    await db.insert(documentTopics).values({ documentId: doc, topicId: t });
    await addCard(t);
    await addCard(null); // a card with no topic belongs to none

    const [row] = (await getCoverageMap(db, slug)).topics;
    expect(row).toMatchObject({ materialDocs: 1, materialPages: 12, cards: 1, flags: [] });
    expect(row!.message).toBeNull();
  });

  it('ignores documents that are not parsed yet (they would dilute every frequency)', async () => {
    await addTopic('Entropia');
    await addDoc('esami', 'entropia');
    await addDoc('esami', 'entropia', { status: 'parsing' });
    await addDoc('esami', 'niente', { status: 'failed' });
    const map = await getCoverageMap(db, slug);
    expect(map.examTotal).toBe(1);
    expect(map.topics[0]).toMatchObject({ examMentions: 1, examTotal: 1 });
  });

  it('an exam document is never counted as study material', async () => {
    const t = await addTopic('Entropia');
    const exam = await addDoc('esami', 'entropia');
    await db.insert(documentTopics).values({ documentId: exam, topicId: t });
    const [row] = (await getCoverageMap(db, slug)).topics;
    expect(row!.materialDocs).toBe(0);
  });

  it('lists recurring exam themes from the profile that match no topic, with how much material mentions them', async () => {
    await addTopic('Entropia');
    await addDoc('appunti', 'La serie di Fourier converge.');
    await db.insert(examProfiles).values({
      id: randomUUID(),
      subjectId,
      sourceDocIds: [],
      profile: {
        itemCount: 3,
        durationMin: 60,
        totalPoints: 30,
        kindDistribution: { open: 1 },
        avgMinutesPerItem: 20,
        verbosity: 'media',
        recurringTopics: ['Entropia', 'Trasformata di Laplace', 'Serie di Fourier'],
        notes: '',
      },
      model: 'fake-v1',
      promptVersion: 'exam_profile/v1',
    });
    const map = await getCoverageMap(db, slug);
    expect(map.unmapped).toEqual([
      { name: 'Trasformata di Laplace', materialMentions: 0 },
      { name: 'Serie di Fourier', materialMentions: 1 },
    ]);
    expect(map.topics[0]!.recurring).toBe(true);
  });

  it('only sees its own subject, and rejects an unknown one', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Altra', color: 'rose' });
    await db
      .insert(topics)
      .values({ id: randomUUID(), subjectId: other.id, name: 'Altrui', slug: 'altrui' });
    await addTopic('Mio');
    expect((await getCoverageMap(db, slug)).topics.map((t) => t.name)).toEqual(['Mio']);
    await expect(getCoverageMap(db, 'non-esiste')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});
