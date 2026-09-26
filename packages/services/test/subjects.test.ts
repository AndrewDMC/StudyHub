import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb } from '@studyhub/db/testDb';
import { subjects } from '@studyhub/db';
import { createSubjectRow } from '../src/index.js';

describe('createSubjectRow', () => {
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let dataRoot: string;

  beforeEach(async () => {
    db = await createTestDb();
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-services-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('scaffolds the folder and inserts the DB row', async () => {
    const row = await createSubjectRow(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

    expect(row.slug).toBe('fisica-1');
    expect(row.name).toBe('Fisica 1');
    expect(row.folderPath).toContain('fisica-1');

    const rows = await db.select().from(subjects);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(row.id);
  });

  it('disambiguates the slug against existing DB rows and on-disk folders', async () => {
    await createSubjectRow(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const second = await createSubjectRow(db, dataRoot, { name: 'Fisica 1', color: 'green' });

    expect(second.slug).not.toBe('fisica-1');
  });
});
