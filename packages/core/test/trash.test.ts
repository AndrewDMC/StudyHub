import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createManifest } from '../src/manifest.js';
import { scaffoldSubject } from '../src/scaffold.js';
import { moveSubjectFolderToTrash } from '../src/trash.js';

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
