import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { exams, subjects, topics } from '@studyhub/db';
import { addSubject } from '../src/commands/subject.js';
import { backupData, restoreData } from '../src/backup.js';

describe('backup/restore', () => {
  let dataRoot: string;
  let backupDir: string;
  let restoredDataRoot: string;
  let sourceDb: Awaited<ReturnType<typeof createTestDb>>;
  let targetDb: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-backup-src-'));
    backupDir = await mkdtemp(join(tmpdir(), 'studyhub-backup-dest-'));
    restoredDataRoot = await mkdtemp(join(tmpdir(), 'studyhub-backup-restored-'));
    sourceDb = await createTestDb();
    targetDb = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
    await rm(backupDir, { recursive: true, force: true });
    await rm(restoredDataRoot, { recursive: true, force: true });
  });

  it('restores subjects, exams and a topic parent/child tree onto a fresh database and data root', async () => {
    const subject = await addSubject(sourceDb, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await sourceDb.insert(exams).values({
      id: randomUUID(),
      subjectId: subject.id,
      title: 'Scritto',
      kind: 'scritto',
      date: new Date('2026-06-01T09:00:00.000Z'),
    });
    const parentId = randomUUID();
    const childId = randomUUID();
    await sourceDb.insert(topics).values([
      { id: parentId, subjectId: subject.id, name: 'Meccanica', slug: 'meccanica' },
      { id: childId, subjectId: subject.id, parentId, name: 'Cinematica', slug: 'cinematica' },
    ]);

    const backupResult = await backupData(sourceDb, dataRoot, backupDir);
    expect(backupResult.tables.subjects).toBe(1);
    expect(backupResult.tables.exams).toBe(1);
    expect(backupResult.tables.topics).toBe(2);
    const manifest = await stat(join(backupDir, 'backup.json'));
    expect(manifest.isFile()).toBe(true);

    const restoreResult = await restoreData(targetDb, restoredDataRoot, backupDir);
    expect(restoreResult.tables.subjects).toBe(1);

    const restoredSubjects = await targetDb.select().from(subjects);
    expect(restoredSubjects).toHaveLength(1);
    expect(restoredSubjects[0]!.slug).toBe('fisica-1');

    const restoredExams = await targetDb.select().from(exams);
    expect(restoredExams).toHaveLength(1);
    expect(restoredExams[0]!.title).toBe('Scritto');
    expect(restoredExams[0]!.date).toBeInstanceOf(Date); // revived from the serialized ISO string, not left as text

    const restoredTopics = await targetDb.select().from(topics);
    const restoredChild = restoredTopics.find((t) => t.id === childId)!;
    expect(restoredChild.parentId).toBe(parentId);

    const subjectFolder = await stat(
      join(restoredDataRoot, 'subjects', 'fisica-1', 'subject.json'),
    );
    expect(subjectFolder.isFile()).toBe(true);
  });

  it('restore replaces existing state rather than merging with it', async () => {
    await addSubject(targetDb, restoredDataRoot, { name: 'Da rimuovere', color: 'green' });
    await addSubject(sourceDb, dataRoot, { name: 'Fisica 1', color: 'blue' });

    await backupData(sourceDb, dataRoot, backupDir);
    await restoreData(targetDb, restoredDataRoot, backupDir);

    const restoredSubjects = await targetDb.select().from(subjects);
    expect(restoredSubjects.map((s) => s.slug)).toEqual(['fisica-1']);

    const oldFolder = await stat(join(restoredDataRoot, 'subjects', 'da-rimuovere')).catch(
      () => null,
    );
    expect(oldFolder).toBeNull();
  });

  it('is repeatable: restoring the same backup twice does not duplicate rows', async () => {
    await addSubject(sourceDb, dataRoot, { name: 'Fisica 1', color: 'blue' });
    await backupData(sourceDb, dataRoot, backupDir);

    await restoreData(targetDb, restoredDataRoot, backupDir);
    await restoreData(targetDb, restoredDataRoot, backupDir);

    const restoredSubjects = await targetDb.select().from(subjects);
    expect(restoredSubjects).toHaveLength(1);
  });
});
