import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { chunks, documents, subjects } from '@studyhub/db';
import { createManifest, resolveDocumentSourcePath, scaffoldSubject } from '@studyhub/core';
import { FakeProvider } from '@studyhub/ai';
import { processClassifyDocumentType } from '../src/processors/classifyDocumentType.js';

describe('processClassifyDocumentType', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-classify-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    subjectSlug = manifest.slug;
    await db.insert(subjects).values({
      id: subjectId,
      slug: subjectSlug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('sets typeSuggested + typeConfidence when the AI guess disagrees with the user-picked type', async () => {
    const docId = randomUUID();
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.pdf`,
      dataRoot,
    );
    await writeFile(storedPath, 'irrelevant');
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'esame.pdf',
      storedPath,
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Appello del 12 giugno, esame scritto di Fisica 1',
      tokens: 10,
    });

    const result = await processClassifyDocumentType(db, { documentId: docId }, new FakeProvider());

    expect(result.type).toBe('esami');
    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.typeSource).toBe('ai');
    expect(doc?.typeSuggested).toBe('esami');
    expect(doc?.typeConfidence).toBeGreaterThan(0);
    // Never overrides the user's own choice.
    expect(doc?.type).toBe('appunti');
  });

  it('leaves typeSuggested null when the AI guess agrees with the user-picked type', async () => {
    const docId = randomUUID();
    const storedPath = resolveDocumentSourcePath(
      subjectSlug,
      'appunti',
      `${randomUUID()}.pdf`,
      dataRoot,
    );
    await writeFile(storedPath, 'irrelevant');
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'esami',
      originalName: 'esame.pdf',
      storedPath,
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'b'.repeat(64),
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: 'Appello del 12 giugno, esame scritto',
      tokens: 10,
    });

    await processClassifyDocumentType(db, { documentId: docId }, new FakeProvider());

    const [doc] = await db.select().from(documents).where(eq(documents.id, docId));
    expect(doc?.typeSuggested).toBeNull();
  });

  it('throws for an unknown document id', async () => {
    await expect(
      processClassifyDocumentType(db, { documentId: randomUUID() }, new FakeProvider()),
    ).rejects.toThrow('document not found');
  });
});
