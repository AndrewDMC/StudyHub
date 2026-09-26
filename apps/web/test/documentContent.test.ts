import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { documents } from '@studyhub/db';
import { resolveDocumentDerivedDir } from '@studyhub/core';
import { createTestDb } from '@studyhub/db/testDb';
import { createSubject } from '../src/lib/subjects';
import {
  getDocumentContent,
  saveDocumentContent,
  resolveDocumentContentConflict,
  NoCanonicalMarkdownError,
} from '../src/lib/documentContent';

describe('documentContent', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let documentId: string;
  let derivedDir: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-doccontent-'));
    db = await createTestDb();
    const subject = await createSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;

    documentId = randomUUID();
    await db.insert(documents).values({
      id: documentId,
      subjectId: subject.id,
      type: 'appunti',
      originalName: 'lezione.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });

    derivedDir = resolveDocumentDerivedDir(subjectSlug, documentId, dataRoot);
    await mkdir(derivedDir, { recursive: true });
    await writeFile(join(derivedDir, 'content.md'), '# Lezione 1\n\nPrimo principio.', 'utf-8');
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('reads content.md with edited=false and no conflict by default', async () => {
    const content = await getDocumentContent(db, dataRoot, subjectSlug, documentId);
    expect(content.markdown).toContain('Primo principio.');
    expect(content.edited).toBe(false);
    expect(content.conflict).toBeNull();
  });

  it('throws NoCanonicalMarkdownError when content.md does not exist yet', async () => {
    const otherDocId = randomUUID();
    await db.insert(documents).values({
      id: otherDocId,
      subjectId: (await db.select().from(documents).where(eq(documents.id, documentId)))[0]!
        .subjectId,
      type: 'appunti',
      originalName: 'nuovo.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'b'.repeat(64),
    });
    await expect(getDocumentContent(db, dataRoot, subjectSlug, otherDocId)).rejects.toThrow(
      NoCanonicalMarkdownError,
    );
  });

  it('saveDocumentContent writes the file and sets mdEdited=true', async () => {
    await saveDocumentContent(db, dataRoot, subjectSlug, documentId, '# Modificato da me');

    const content = await getDocumentContent(db, dataRoot, subjectSlug, documentId);
    expect(content.markdown).toBe('# Modificato da me');
    expect(content.edited).toBe(true);
  });

  it('surfaces a conflict when mdConflict is set and content.new.md exists', async () => {
    await db
      .update(documents)
      .set({ mdEdited: true, mdConflict: true })
      .where(eq(documents.id, documentId));
    await writeFile(join(derivedDir, 'content.new.md'), '# Nuova versione dal re-ingest', 'utf-8');

    const content = await getDocumentContent(db, dataRoot, subjectSlug, documentId);
    expect(content.conflict?.newMarkdown).toContain('Nuova versione dal re-ingest');
  });

  it('resolveDocumentContentConflict("mine") discards content.new.md and clears the flag', async () => {
    await db
      .update(documents)
      .set({ mdEdited: true, mdConflict: true })
      .where(eq(documents.id, documentId));
    await writeFile(join(derivedDir, 'content.new.md'), '# Nuova versione', 'utf-8');

    await resolveDocumentContentConflict(db, dataRoot, subjectSlug, documentId, 'mine');

    const content = await getDocumentContent(db, dataRoot, subjectSlug, documentId);
    expect(content.markdown).toContain('Primo principio.');
    expect(content.conflict).toBeNull();
  });

  it('resolveDocumentContentConflict("new") overwrites content.md and clears mdEdited', async () => {
    await db
      .update(documents)
      .set({ mdEdited: true, mdConflict: true })
      .where(eq(documents.id, documentId));
    await writeFile(join(derivedDir, 'content.new.md'), '# Nuova versione', 'utf-8');

    await resolveDocumentContentConflict(db, dataRoot, subjectSlug, documentId, 'new');

    const content = await getDocumentContent(db, dataRoot, subjectSlug, documentId);
    expect(content.markdown).toContain('Nuova versione');
    expect(content.edited).toBe(false);
    expect(content.conflict).toBeNull();
  });
});
