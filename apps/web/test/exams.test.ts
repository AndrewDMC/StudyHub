import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import { createExam, deleteExam, ExamNotFoundError, listExams } from '../src/lib/exams';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('exams', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-exams-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates an exam defaulting to status=scheduled', async () => {
    const exam = await createExam(db, subjectSlug, {
      title: 'Scritto gennaio',
      kind: 'scritto',
      date: '2026-01-15T09:00:00.000Z',
    });
    expect(exam.status).toBe('scheduled');
    expect(exam.date).toBe('2026-01-15T09:00:00.000Z');
  });

  it('lists exams ordered by date', async () => {
    await createExam(db, subjectSlug, {
      title: 'Feb',
      kind: 'orale',
      date: '2026-02-01T09:00:00.000Z',
    });
    await createExam(db, subjectSlug, {
      title: 'Gen',
      kind: 'scritto',
      date: '2026-01-01T09:00:00.000Z',
    });
    const list = await listExams(db, subjectSlug);
    expect(list.map((e) => e.title)).toEqual(['Gen', 'Feb']);
  });

  it('deletes an exam', async () => {
    const exam = await createExam(db, subjectSlug, {
      title: 'X',
      kind: 'parziale',
      date: '2026-03-01T09:00:00.000Z',
    });
    await deleteExam(db, subjectSlug, exam.id);
    expect(await listExams(db, subjectSlug)).toEqual([]);
  });

  it('throws ExamNotFoundError for an unknown exam id', async () => {
    await expect(
      deleteExam(db, subjectSlug, '11111111-1111-1111-1111-111111111111'),
    ).rejects.toBeInstanceOf(ExamNotFoundError);
  });

  it('throws SubjectNotFoundError for an unknown subject', async () => {
    await expect(listExams(db, 'nope')).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});
