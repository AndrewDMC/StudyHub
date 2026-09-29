import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { flashcards } from '@studyhub/db';
import { createSubject } from '../src/lib/subjects';
import { createDeck, createFlashcard } from '../src/lib/deckEditor';
import {
  exportDeckApkg,
  ImportFileError,
  importDeckFile,
  parseCardsCsv,
} from '../src/lib/deckExchange';
import { exportDeckCsv } from '../src/lib/generation';
import { listFlashcards } from '../src/lib/review';
import { NotFoundError } from '../src/lib/examPrep';

type Db = Awaited<ReturnType<typeof createTestDb>>;
const enc = (s: string) => new TextEncoder().encode(s);

describe('deck exchange (apkg + csv)', () => {
  let dataRoot: string;
  let db: Db;
  let slug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-exchange-'));
    db = await createTestDb();
    slug = (await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' })).slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('apkg export → import into another subject keeps FSRS state, tags, suspension (F4 criterion)', async () => {
    const deck = await createDeck(db, slug, 'Cinematica');
    const a = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Velocità?',
      back: 'Spostamento / tempo',
      hint: 'm/s',
      tags: ['fisica'],
    });
    const b = await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'basic',
      front: 'Accelerazione?',
      back: 'Variazione di velocità',
    });
    await db
      .update(flashcards)
      .set({
        state: 'review',
        stability: 21.5,
        difficulty: 4.25,
        dueAt: new Date('2026-11-01T06:00:00.000Z'),
        lastReviewAt: new Date('2026-10-05T06:00:00.000Z'),
        reps: 7,
        lapses: 2,
      })
      .where(eq(flashcards.id, a.id));
    await db.update(flashcards).set({ suspended: true }).where(eq(flashcards.id, b.id));

    const { filename, bytes } = await exportDeckApkg(db, slug, deck.id);
    expect(filename).toBe('cinematica.apkg');

    const other = await createSubject(db, dataRoot, { name: 'Fisica 2', color: 'teal' });
    const result = await importDeckFile(db, other.slug, { filename, bytes });
    expect(result).toMatchObject({ imported: 2, duplicates: 0, warnings: [] });
    expect(result.deck.title).toBe('Cinematica');

    const rows = await db.select().from(flashcards).where(eq(flashcards.deckId, result.deck.id));
    const velocity = rows.find((r) => r.front === 'Velocità?')!;
    expect(velocity).toMatchObject({
      state: 'review',
      stability: 21.5,
      difficulty: 4.25,
      reps: 7,
      lapses: 2,
      hint: 'm/s',
      tags: ['fisica'],
      suspended: false,
      sourceRef: null,
    });
    expect(velocity.dueAt!.toISOString()).toBe('2026-11-01T06:00:00.000Z');
    expect(velocity.lastReviewAt!.toISOString()).toBe('2026-10-05T06:00:00.000Z');
    expect(rows.find((r) => r.front === 'Accelerazione?')!.suspended).toBe(true);
  });

  it('re-importing the same file is a no-op (front+back duplicates skipped)', async () => {
    const deck = await createDeck(db, slug, 'D');
    await createFlashcard(db, slug, { deckId: deck.id, type: 'basic', front: 'a', back: 'b' });
    const file = await exportDeckApkg(db, slug, deck.id);

    const again = await importDeckFile(db, slug, file);
    expect(again).toMatchObject({ imported: 0, duplicates: 1 });
    expect((await listFlashcards(db, slug)).items).toHaveLength(1);
  });

  it('imports into an existing deck when deckId is given', async () => {
    const deck = await createDeck(db, slug, 'Esistente');
    const res = await importDeckFile(
      db,
      slug,
      { filename: 'x.csv', bytes: enc('front,back\nUno,1\nDue,2\n') },
      { deckId: deck.id },
    );
    expect(res.deck.id).toBe(deck.id);
    expect(res.imported).toBe(2);
    expect((await listFlashcards(db, slug, { deckId: deck.id })).items).toHaveLength(2);
  });

  it('refuses a deckId from another subject', async () => {
    const other = await createSubject(db, dataRoot, { name: 'Altra', color: 'rose' });
    const foreign = await createDeck(db, other.slug, 'Altrui');
    await expect(
      importDeckFile(
        db,
        slug,
        { filename: 'x.csv', bytes: enc('front,back\na,b\n') },
        { deckId: foreign.id },
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('CSV export → import round-trips text, type, hint and tags into a new deck', async () => {
    const deck = await createDeck(db, slug, 'Mazzo, con virgola');
    await createFlashcard(db, slug, {
      deckId: deck.id,
      type: 'qa',
      front: 'Domanda, "citata"?',
      back: 'Riga 1\nRiga 2',
      hint: 'aiuto',
      tags: ['uno', 'due'],
    });
    const { csv } = await exportDeckCsv(db, slug, deck.id);

    const other = await createSubject(db, dataRoot, { name: 'Altra', color: 'rose' });
    const res = await importDeckFile(
      db,
      other.slug,
      { filename: 'mazzo.csv', bytes: enc(csv) },
      { title: 'Importato' },
    );
    expect(res.deck.title).toBe('Importato');
    const [row] = (await listFlashcards(db, other.slug)).items;
    expect(row).toMatchObject({
      type: 'qa',
      front: 'Domanda, "citata"?',
      back: 'Riga 1\nRiga 2',
      hint: 'aiuto',
      tags: ['uno', 'due'],
      state: 'new',
    });
  });

  it('rejects unsupported files, empty files and garbage apkg with a clear error', async () => {
    await expect(importDeckFile(db, slug, { filename: 'x.pdf', bytes: enc('x') })).rejects.toThrow(
      /Formato non supportato/,
    );
    await expect(
      importDeckFile(db, slug, { filename: 'x.csv', bytes: enc('') }),
    ).rejects.toBeInstanceOf(ImportFileError);
    await expect(
      importDeckFile(db, slug, { filename: 'x.apkg', bytes: enc('not a zip') }),
    ).rejects.toBeInstanceOf(ImportFileError);
  });

  it('export of a deck outside the subject is a 404-style error', async () => {
    await expect(
      exportDeckApkg(db, slug, '00000000-0000-4000-8000-000000000000'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});

describe('parseCardsCsv', () => {
  it('matches header columns by name in any order and skips incomplete rows', () => {
    const cards = parseCardsCsv('back,front,tags\nB1,F1,"a, b"\n,solo-front,x\nB2,F2,\n');
    expect(cards.map((c) => [c.front, c.back, c.tags])).toEqual([
      ['F1', 'B1', ['a', 'b']],
      ['F2', 'B2', []],
    ]);
  });

  it('without a header: front, back, then tags — tab-separated (Anki plain-text export)', () => {
    const cards = parseCardsCsv('Domanda\tRisposta\ttag1 \nAltra\tRisp\t\n');
    expect(cards).toHaveLength(2);
    expect(cards[0]).toMatchObject({ front: 'Domanda', back: 'Risposta', tags: ['tag1'] });
  });

  it('an unknown type falls back to basic', () => {
    expect(parseCardsCsv('front,back,type\na,b,weird\nc,d,cloze\n').map((c) => c.type)).toEqual([
      'basic',
      'cloze',
    ]);
  });

  it('throws when nothing usable is found', () => {
    expect(() => parseCardsCsv('front,back\n')).toThrow(ImportFileError);
  });
});
