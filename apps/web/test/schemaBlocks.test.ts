import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { documents, schemaBlocks } from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import { listSchemaBlocks, updateSchemaBlock, SchemaBlockNotFoundError } from '../src/lib/schemaBlocks';
import { SubjectNotFoundError } from '../src/lib/errors';
import { DocumentNotFoundError } from '../src/lib/documentTopics';

describe('schemaBlocks', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let documentId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-schemablocks-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Chimica', color: 'green' });
    subjectSlug = subject.slug;

    documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId: subject.id,
      type: 'schemi',
      originalName: 'schema.jpg',
      storedPath: '/irrelevant',
      mime: 'image/jpeg',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
      verificationStatus: 'pending',
      blockedBlocks: 2,
    });
    await db.insert(schemaBlocks).values([
      {
        id: randomUUID(),
        documentId,
        ord: 0,
        text: 'Sistema',
        confidence: 'ok',
        note: null,
        verified: true,
      },
      {
        id: randomUUID(),
        documentId,
        ord: 1,
        text: 'Trasform. isobara?',
        confidence: 'uncertain',
        note: 'bassa confidenza',
        verified: false,
      },
      {
        id: randomUUID(),
        documentId,
        ord: 2,
        text: '???',
        confidence: 'illegible',
        note: 'grafia sovrapposta',
        verified: false,
      },
    ]);
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  describe('listSchemaBlocks', () => {
    it('returns the blocks ordered by ord', async () => {
      const blocks = await listSchemaBlocks(db, subjectSlug, documentId);
      expect(blocks.map((b) => b.text)).toEqual(['Sistema', 'Trasform. isobara?', '???']);
    });

    it('throws SubjectNotFoundError for an unknown slug', async () => {
      await expect(listSchemaBlocks(db, 'nope', documentId)).rejects.toBeInstanceOf(
        SubjectNotFoundError,
      );
    });

    it('throws DocumentNotFoundError for a document outside the subject', async () => {
      await expect(listSchemaBlocks(db, subjectSlug, randomUUID())).rejects.toBeInstanceOf(
        DocumentNotFoundError,
      );
    });
  });

  describe('updateSchemaBlock', () => {
    it('confirming a block edits its text and sets verified', async () => {
      const blocks = await listSchemaBlocks(db, subjectSlug, documentId);
      const uncertain = blocks.find((b) => b.confidence === 'uncertain')!;

      const updated = await updateSchemaBlock(db, subjectSlug, documentId, uncertain.id, {
        text: 'Trasformazione isobara',
        verified: true,
      });
      expect(updated.text).toBe('Trasformazione isobara');
      expect(updated.verified).toBe(true);
    });

    it('recomputes documents.blockedBlocks/verificationStatus down to 0/verified as every block is confirmed', async () => {
      const blocks = await listSchemaBlocks(db, subjectSlug, documentId);
      const uncertain = blocks.find((b) => b.confidence === 'uncertain')!;
      const illegible = blocks.find((b) => b.confidence === 'illegible')!;

      await updateSchemaBlock(db, subjectSlug, documentId, uncertain.id, { verified: true });
      const [afterOne] = await db.select().from(documents).where(eq(documents.id, documentId));
      expect(afterOne?.blockedBlocks).toBe(1);
      expect(afterOne?.verificationStatus).toBe('partial');

      await updateSchemaBlock(db, subjectSlug, documentId, illegible.id, {
        text: 'Recuperato a mano',
        verified: true,
      });
      const [afterAll] = await db.select().from(documents).where(eq(documents.id, documentId));
      expect(afterAll?.blockedBlocks).toBe(0);
      expect(afterAll?.verificationStatus).toBe('verified');
    });

    it('un-confirming a verified block moves verificationStatus back to pending/partial', async () => {
      const blocks = await listSchemaBlocks(db, subjectSlug, documentId);
      const ok = blocks.find((b) => b.confidence === 'ok')!;

      await updateSchemaBlock(db, subjectSlug, documentId, ok.id, { verified: false });
      const [doc] = await db.select().from(documents).where(eq(documents.id, documentId));
      expect(doc?.blockedBlocks).toBe(3);
      expect(doc?.verificationStatus).toBe('pending');
    });

    it('throws SchemaBlockNotFoundError for a block outside the document', async () => {
      await expect(
        updateSchemaBlock(db, subjectSlug, documentId, randomUUID(), { verified: true }),
      ).rejects.toBeInstanceOf(SchemaBlockNotFoundError);
    });
  });
});
