import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { createTestDb } from '../src/testDb.js';
import { chunks, documents, subjects } from '../src/schema.js';

/**
 * Applies every migration under packages/db/drizzle/ (what production
 * Postgres runs via packages/db/src/migrate.ts) through createTestDb(),
 * exercising foreign keys and the FTS index — not just a hand-written
 * approximation of the schema.
 */
describe('drizzle migrations (applied via createTestDb)', () => {
  it('all migrations apply cleanly and round-trip a subject', async () => {
    const db = await createTestDb();
    const id = randomUUID();
    await db.insert(subjects).values({
      id,
      slug: 'fisica-1',
      name: 'Fisica 1',
      color: 'blue',
      folderPath: '/data/subjects/fisica-1',
    });
    const rows = await db.select().from(subjects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
  });

  it('documents/chunks migration applies and the FTS index works', async () => {
    const db = await createTestDb();
    const subjectId = randomUUID();
    await db.insert(subjects).values({
      id: subjectId,
      slug: 'analisi-1',
      name: 'Analisi 1',
      color: 'violet',
      folderPath: '/data/subjects/analisi-1',
    });

    const docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione-01.pdf',
      storedPath: '/data/subjects/analisi-1/sources/appunti/lezione-01.pdf',
      mime: 'application/pdf',
      bytes: 1234,
      sha256: 'a'.repeat(64),
    });

    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: "L'entropia di un sistema isolato non diminuisce mai.",
      tokens: 9,
    });

    const found = await db.execute(
      sql`select id from chunks where to_tsvector('italian', text) @@ plainto_tsquery('italian', 'entropia')`,
    );
    expect(found.rows).toHaveLength(1);
  });
});
