import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documents } from '@studyhub/db';
import { embedText } from '@studyhub/ai/embeddings';
import { createSubject } from '../src/lib/subjects';
import { searchSubject } from '../src/lib/search';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('searchSubject', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-search-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    subjectId = subject.id;

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'termodinamica.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });

    await db.insert(chunks).values([
      {
        id: randomUUID(),
        documentId: docId,
        pageFrom: 3,
        pageTo: 3,
        ord: 0,
        text: "L'entropia di un sistema isolato non diminuisce mai nel tempo.",
        tokens: 12,
      },
      {
        id: randomUUID(),
        documentId: docId,
        pageFrom: 7,
        pageTo: 7,
        ord: 1,
        text: 'Il gatto dorme tutto il pomeriggio sul divano di casa.',
        tokens: 12,
      },
    ]);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('finds the chunk with the exact page for an FTS match', async () => {
    const results = await searchSubject(db, subjectSlug, 'entropia');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.pageFrom).toBe(3);
    expect(results[0]?.excerpt).toContain('entropia');
  });

  it('returns empty results for a blank query', async () => {
    expect(await searchSubject(db, subjectSlug, '   ')).toEqual([]);
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    await expect(searchSubject(db, 'materia-inesistente', 'entropia')).rejects.toThrow(
      SubjectNotFoundError,
    );
  });

  it('also matches via vector similarity once chunks are embedded (RRF fusion)', async () => {
    const rows = await db.select().from(chunks).where(eq(chunks.documentId, docId));
    for (const row of rows) {
      const vector = await embedText(row.text);
      await db.update(chunks).set({ embedding: vector }).where(eq(chunks.id, row.id));
    }

    // A semantically related but lexically different query — FTS alone wouldn't match "calore".
    const results = await searchSubject(db, subjectSlug, 'calore e disordine termodinamico');
    expect(results.length).toBeGreaterThan(0);
  }, 20_000);
});
