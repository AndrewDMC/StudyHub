import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { addSubject, listSubjectRows } from '../src/commands/subject.js';

describe('CLI subject add/ls', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-cli-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('subject add creates the folder and an indexed row', async () => {
    const row = await addSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    expect(row.slug).toBe('fisica-1');

    const s = await stat(join(dataRoot, 'subjects', 'fisica-1', 'subject.json'));
    expect(s.isFile()).toBe(true);
  });

  it('subject ls returns an empty list before any subject exists', async () => {
    expect(await listSubjectRows(db)).toEqual([]);
  });

  it('subject ls reflects subjects created by subject add, sorted by name', async () => {
    await addSubject(db, dataRoot, { name: 'Zoologia', color: 'green' });
    await addSubject(db, dataRoot, { name: 'Analisi 1', color: 'violet' });

    const rows = await listSubjectRows(db);
    expect(rows.map((r) => r.name)).toEqual(['Analisi 1', 'Zoologia']);
  });
});
