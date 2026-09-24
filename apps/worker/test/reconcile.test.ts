import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import { subjects } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import { reconcileSubjects } from '../src/processors/reconcile.js';

describe('reconcileSubjects', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-reconcile-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('imports a folder created by hand with a valid manifest', async () => {
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    await scaffoldSubject(dataRoot, manifest);

    const result = await reconcileSubjects(db, dataRoot);

    expect(result.imported).toEqual(['fisica-1']);
    const [row] = await db.select().from(subjects).where(eq(subjects.slug, 'fisica-1'));
    expect(row?.name).toBe('Fisica 1');
    expect(row?.id).toBe(manifest.id);
  });

  it('does not duplicate a subject that is already indexed', async () => {
    const manifest = createManifest({ name: 'Analisi 1', slug: 'analisi-1', color: 'violet' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    await db.insert(subjects).values({
      id: manifest.id,
      slug: manifest.slug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });

    const result = await reconcileSubjects(db, dataRoot);

    expect(result.imported).toEqual([]);
    expect(result.alreadyIndexed).toEqual(['analisi-1']);
    const rows = await db.select().from(subjects).where(eq(subjects.slug, 'analisi-1'));
    expect(rows).toHaveLength(1);
  });

  it('skips a folder with a missing or corrupt manifest instead of throwing', async () => {
    await mkdir(join(dataRoot, 'subjects', 'no-manifest'), { recursive: true });
    await mkdir(join(dataRoot, 'subjects', 'bad-manifest'), { recursive: true });
    await writeFile(
      join(dataRoot, 'subjects', 'bad-manifest', 'subject.json'),
      '{ not json',
      'utf-8',
    );

    const result = await reconcileSubjects(db, dataRoot);

    expect(result.imported).toEqual([]);
    expect(result.skippedInvalid.map((s) => s.slug).sort()).toEqual([
      'bad-manifest',
      'no-manifest',
    ]);
  });

  it('can be scoped to a single subject slug', async () => {
    const a = createManifest({ name: 'A', slug: 'a', color: 'blue' });
    const b = createManifest({ name: 'B', slug: 'b', color: 'cyan' });
    await scaffoldSubject(dataRoot, a);
    await scaffoldSubject(dataRoot, b);

    const result = await reconcileSubjects(db, dataRoot, { subjectSlug: 'a' });

    expect(result.imported).toEqual(['a']);
    const rows = await db.select().from(subjects);
    expect(rows).toHaveLength(1);
  });

  it('returns empty results when subjects/ does not exist', async () => {
    const result = await reconcileSubjects(db, dataRoot);
    expect(result).toEqual({ imported: [], alreadyIndexed: [], skippedInvalid: [] });
  });
});
