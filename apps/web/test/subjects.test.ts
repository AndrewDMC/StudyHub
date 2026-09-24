import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { exams } from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import {
  createSubject,
  deleteSubjectPermanently,
  getSubjectBySlug,
  listSubjectSummaries,
  setSubjectArchived,
} from '../src/lib/subjects';
import { SubjectNotFoundError } from '../src/lib/errors';

describe('createSubject — full F0 flow (input -> slug -> FS -> DB -> DTO)', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-web-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates a folder on disk with a valid manifest and an indexed DB row', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

    expect(subject.slug).toBe('fisica-1');
    expect(subject.name).toBe('Fisica 1');

    const subjectDir = join(dataRoot, 'subjects', 'fisica-1');
    const manifestRaw = await readFile(join(subjectDir, 'subject.json'), 'utf-8');
    const manifest = JSON.parse(manifestRaw);
    expect(manifest.slug).toBe('fisica-1');
    expect(manifest.id).toBe(subject.id);

    for (const dir of ['sources', 'derived', 'artifacts', 'plans', '.studyhub']) {
      const s = await stat(join(subjectDir, dir));
      expect(s.isDirectory()).toBe(true);
    }

    const listed = await listSubjectSummaries(db);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.slug).toBe('fisica-1');
    expect(listed[0]?.documentCount).toBe(0);
    expect(listed[0]?.nextExamAt).toBeNull();
  });

  it('disambiguates the slug when two subjects share the same name', async () => {
    const a = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'violet' });
    const b = await createSubject(db, dataRoot, { name: 'Analisi 1', color: 'cyan' });

    expect(a.slug).toBe('analisi-1');
    expect(b.slug).toBe('analisi-1-2');
    expect(a.id).not.toBe(b.id);

    const bothDirs = await Promise.all(
      [a.slug, b.slug].map((slug) => stat(join(dataRoot, 'subjects', slug))),
    );
    expect(bothDirs.every((s) => s.isDirectory())).toBe(true);
  });

  it('rejects a name that only contains illegal characters via disambiguation, not a crash', async () => {
    const subject = await createSubject(db, dataRoot, { name: '!!!', color: 'teal' });
    expect(subject.slug).toBe('subject');
  });

  it('getSubjectBySlug finds a created subject by its stable slug', async () => {
    await createSubject(db, dataRoot, { name: 'Chimica Organica', color: 'green' });
    const found = await getSubjectBySlug(db, 'chimica-organica');
    expect(found?.name).toBe('Chimica Organica');
    expect(await getSubjectBySlug(db, 'does-not-exist')).toBeNull();
  });
});

describe('listSubjectSummaries — empty state', () => {
  it('returns an empty array when no subject has been created', async () => {
    const db = await createTestDb();
    expect(await listSubjectSummaries(db)).toEqual([]);
  });
});

describe('listSubjectSummaries — aggregation and archived filtering', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-summaries-'));
    db = await createTestDb();
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('reports the soonest upcoming scheduled exam, ignoring past/cancelled ones', async () => {
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const soon = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000);
    const past = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);

    await db.insert(exams).values([
      { id: randomUUID(), subjectId: subject.id, title: 'Lontano', kind: 'scritto', date: future },
      { id: randomUUID(), subjectId: subject.id, title: 'Vicino', kind: 'orale', date: soon },
      { id: randomUUID(), subjectId: subject.id, title: 'Passato', kind: 'scritto', date: past },
      {
        id: randomUUID(),
        subjectId: subject.id,
        title: 'Annullato',
        kind: 'scritto',
        date: new Date(Date.now() + 1000),
        status: 'cancelled',
      },
    ]);

    const [summary] = await listSubjectSummaries(db);
    expect(summary?.nextExamAt).toBe(soon.toISOString());
  });

  it('excludes archived subjects by default, includes them with includeArchived', async () => {
    const a = await createSubject(db, dataRoot, { name: 'Attiva', color: 'blue' });
    const b = await createSubject(db, dataRoot, { name: 'Archiviata', color: 'rose' });
    await setSubjectArchived(db, b.slug, true);

    const visible = await listSubjectSummaries(db);
    expect(visible.map((s) => s.slug)).toEqual([a.slug]);

    const all = await listSubjectSummaries(db, { includeArchived: true });
    expect(all.map((s) => s.slug).sort()).toEqual([a.slug, b.slug].sort());
  });
});

describe('setSubjectArchived', () => {
  it('archives then unarchives without touching the filesystem', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-archive-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });

      const archived = await setSubjectArchived(db, subject.slug, true);
      expect(archived.archivedAt).not.toBeNull();

      const unarchived = await setSubjectArchived(db, subject.slug, false);
      expect(unarchived.archivedAt).toBeNull();

      const s = await stat(join(dataRoot, 'subjects', subject.slug));
      expect(s.isDirectory()).toBe(true);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    const db = await createTestDb();
    await expect(setSubjectArchived(db, 'nope', true)).rejects.toBeInstanceOf(SubjectNotFoundError);
  });
});

describe('deleteSubjectPermanently', () => {
  it('moves the folder to .trash/ and removes the DB row (not rm -rf)', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-delete-'));
    try {
      const db = await createTestDb();
      const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const subjectDir = join(dataRoot, 'subjects', subject.slug);

      await deleteSubjectPermanently(db, dataRoot, subject.slug);

      await expect(stat(subjectDir)).rejects.toThrow();
      expect(await getSubjectBySlug(db, subject.slug)).toBeNull();

      const trashEntries = await (
        await import('node:fs/promises')
      ).readdir(join(dataRoot, '.trash'));
      expect(trashEntries).toHaveLength(1);
      expect(trashEntries[0]).toContain(subject.slug);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });

  it('throws SubjectNotFoundError for an unknown slug', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-delete-missing-'));
    try {
      const db = await createTestDb();
      await expect(deleteSubjectPermanently(db, dataRoot, 'nope')).rejects.toBeInstanceOf(
        SubjectNotFoundError,
      );
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
