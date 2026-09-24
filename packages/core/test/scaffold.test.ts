import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from '../src/manifest.js';
import { listSubjectSlugsOnDisk, scaffoldSubject, SUBJECT_SUBFOLDERS } from '../src/scaffold.js';
import { resolveSubjectSubpath } from '../src/paths.js';

describe('scaffoldSubject', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-scaffold-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('creates every required sub-folder and the manifest', async () => {
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const subjectDir = await scaffoldSubject(dataRoot, manifest);

    for (const segments of SUBJECT_SUBFOLDERS) {
      const dir = resolveSubjectSubpath('fisica-1', segments, dataRoot);
      const s = await stat(dir);
      expect(s.isDirectory()).toBe(true);
    }

    const manifestStat = await stat(join(subjectDir, 'subject.json'));
    expect(manifestStat.isFile()).toBe(true);
  });

  it('is idempotent: calling it twice does not throw or duplicate anything', async () => {
    const manifest = createManifest({ name: 'Analisi 1', slug: 'analisi-1', color: 'cyan' });
    await scaffoldSubject(dataRoot, manifest);
    await expect(scaffoldSubject(dataRoot, manifest)).resolves.toBeDefined();
  });

  it('renaming the subject (new name, same slug) never moves the folder', async () => {
    const original = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const subjectDir = await scaffoldSubject(dataRoot, original);

    const renamed = { ...original, name: 'Fisica Generale 1' };
    const subjectDirAfterRename = await scaffoldSubject(dataRoot, renamed);

    expect(subjectDirAfterRename).toBe(subjectDir);
  });
});

describe('listSubjectSlugsOnDisk', () => {
  let dataRoot: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-list-'));
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('returns an empty list when subjects/ does not exist yet', async () => {
    expect(await listSubjectSlugsOnDisk(dataRoot)).toEqual([]);
  });

  it('lists subject folders created by scaffoldSubject', async () => {
    await scaffoldSubject(dataRoot, createManifest({ name: 'A', slug: 'a', color: 'blue' }));
    await scaffoldSubject(dataRoot, createManifest({ name: 'B', slug: 'b', color: 'rose' }));
    const slugs = await listSubjectSlugsOnDisk(dataRoot);
    expect(slugs.sort()).toEqual(['a', 'b']);
  });
});
