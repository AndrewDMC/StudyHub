import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdir, mkdtemp, rm, stat, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from '../src/manifest.js';
import { scaffoldSubject } from '../src/scaffold.js';
import { moveDocumentToTrash, moveSubjectFolderToTrash } from '../src/trash.js';
import { resolveDocumentDerivedDir } from '../src/documentPaths.js';
import { resolveSubjectSubpath } from '../src/paths.js';

describe('moveSubjectFolderToTrash', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-trash-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('moves the folder (not rm -rf) so its contents survive under .trash/', async () => {
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const subjectDir = await scaffoldSubject(dataRoot, manifest);

    const dest = await moveSubjectFolderToTrash('fisica-1', dataRoot);

    await expect(stat(subjectDir)).rejects.toThrow();
    const manifestContents = await readFile(join(dest, 'subject.json'), 'utf-8');
    expect(JSON.parse(manifestContents).slug).toBe('fisica-1');
  });

  it('places the trashed folder under <dataRoot>/.trash/<timestamp>-<slug>', async () => {
    const manifest = createManifest({ name: 'Chimica', slug: 'chimica', color: 'green' });
    await scaffoldSubject(dataRoot, manifest);

    const dest = await moveSubjectFolderToTrash('chimica', dataRoot);

    expect(dest.startsWith(join(dataRoot, '.trash'))).toBe(true);
    expect(dest.endsWith('-chimica')).toBe(true);
  });

  it('throws for an invalid slug rather than touching the filesystem', async () => {
    await expect(moveSubjectFolderToTrash('../../etc', dataRoot)).rejects.toThrow();
  });
});

describe('moveDocumentToTrash', () => {
  let dataRoot: string;
  let slug: string;
  const docId = '11111111-1111-4111-8111-111111111111';

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-doctrash-'));
    slug = 'analisi-2';
    await scaffoldSubject(dataRoot, createManifest({ name: 'Analisi 2', slug, color: 'blue' }));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  async function seed() {
    const sourcesDir = resolveSubjectSubpath(slug, ['sources', 'altro'], dataRoot);
    await mkdir(sourcesDir, { recursive: true });
    const stored = join(sourcesDir, 'abc.pdf');
    await writeFile(stored, 'pdf-bytes');
    const derived = resolveDocumentDerivedDir(slug, docId, dataRoot);
    await mkdir(derived, { recursive: true });
    await writeFile(join(derived, 'content.md'), '# testo');
    return { stored, derived };
  }

  it('moves the source file and the derived folder under .trash/, not rm', async () => {
    const { stored, derived } = await seed();
    const { dest } = await moveDocumentToTrash(slug, docId, stored, dataRoot);

    await expect(stat(stored)).rejects.toThrow();
    await expect(stat(derived)).rejects.toThrow();
    expect(await readFile(join(dest, 'source', 'abc.pdf'), 'utf-8')).toBe('pdf-bytes');
    expect(await readFile(join(dest, 'derived', 'content.md'), 'utf-8')).toBe('# testo');
    expect(dest.startsWith(join(dataRoot, '.trash'))).toBe(true);
    expect(dest.endsWith(`-${slug}-doc-${docId}`)).toBe(true);
  });

  it('undo puts everything back', async () => {
    const { stored, derived } = await seed();
    const trashed = await moveDocumentToTrash(slug, docId, stored, dataRoot);
    await trashed.undo();
    expect(await readFile(stored, 'utf-8')).toBe('pdf-bytes');
    expect(await readFile(join(derived, 'content.md'), 'utf-8')).toBe('# testo');
  });

  it('tolerates a document that never produced a derived folder or lost its file', async () => {
    const stored = join(resolveSubjectSubpath(slug, ['sources'], dataRoot), 'gone.pdf');
    await expect(moveDocumentToTrash(slug, docId, stored, dataRoot)).resolves.toBeDefined();
  });

  it('never moves a stored path outside the subject sources folder', async () => {
    const outside = join(dataRoot, 'precious.txt');
    await writeFile(outside, 'keep me');
    await moveDocumentToTrash(slug, docId, outside, dataRoot);
    expect(await readFile(outside, 'utf-8')).toBe('keep me');
  });
});
