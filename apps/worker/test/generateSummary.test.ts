import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { artifactSources, artifacts, chunks, documents, subjects } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import { FakeProvider } from '@studyhub/ai';
import { processGenerateSummary } from '../src/processors/generation/generateSummary.js';
import { runJob } from '../src/jobRunner.js';

describe('processGenerateSummary', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-gensum-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    await db.insert(subjects).values({
      id: subjectId,
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'lezione.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza.",
      tokens: 30,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('writes a Markdown artifact with front-matter and indexes it as draft', async () => {
    const result = await processGenerateSummary(
      db,
      dataRoot,
      { subjectId, scope: { docIds: [docId] }, length: 'standard', force: false },
      new FakeProvider(),
    );

    const [artifact] = await db.select().from(artifacts).where(eq(artifacts.id, result.artifactId));
    expect(artifact?.kind).toBe('summary');
    expect(artifact?.status).toBe('draft');

    const contents = await readFile(artifact!.path, 'utf-8');
    expect(contents).toContain('generatedBy: studyhub-worker');
    expect(contents).toContain('promptVersion: summary/v1');
    expect(contents).toContain('# Riassunto');

    const sourceRows = await db
      .select()
      .from(artifactSources)
      .where(eq(artifactSources.artifactId, result.artifactId));
    expect(sourceRows.map((r) => r.documentId)).toEqual([docId]);
  });

  it('is idempotent end-to-end via runJob', async () => {
    const input = { subjectId, scope: { docIds: [docId] }, length: 'flash', force: false };
    const first = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_summary',
      data: input,
    })) as {
      artifactId: string;
      idempotent: boolean;
    };
    const second = (await runJob(db, dataRoot, {
      id: randomUUID(),
      name: 'generate_summary',
      data: input,
    })) as {
      artifactId: string;
      idempotent: boolean;
    };

    expect(first.idempotent).toBe(false);
    expect(second.idempotent).toBe(true);
    expect(second.artifactId).toBe(first.artifactId);

    const allSummaries = await db.select().from(artifacts);
    expect(allSummaries).toHaveLength(1);
  });

  it('throws for an unknown subject', async () => {
    await expect(
      processGenerateSummary(
        db,
        dataRoot,
        { subjectId: randomUUID(), scope: { docIds: [docId] }, length: 'standard', force: false },
        new FakeProvider(),
      ),
    ).rejects.toThrow(/subject not found/);
  });
});
