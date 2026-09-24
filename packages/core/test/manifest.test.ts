import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ManifestError,
  createManifest,
  manifestExists,
  manifestPath,
  readManifest,
  writeManifest,
} from '../src/manifest.js';

describe('createManifest / SubjectManifestSchema', () => {
  it('stamps the current schema version and a generated id', () => {
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(manifest.slug).toBe('fisica-1');
  });

  it('rejects an invalid color at construction time', () => {
    expect(() =>
      createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'rainbow' as never }),
    ).toThrow();
  });
});

describe('writeManifest / readManifest round-trip', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyhub-manifest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('writes and reads back an identical manifest', async () => {
    const manifest = createManifest({ name: 'Analisi 1', slug: 'analisi-1', color: 'violet' });
    await writeManifest(dir, manifest);
    expect(await manifestExists(dir)).toBe(true);

    const reread = await readManifest(dir);
    expect(reread).toEqual(manifest);
  });

  it('never leaves a temp file behind after a successful write', async () => {
    const manifest = createManifest({ name: 'Chimica', slug: 'chimica', color: 'teal' });
    await writeManifest(dir, manifest);
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(dir);
    expect(files).toEqual(['subject.json']);
  });

  it('throws ManifestError when the file is missing', async () => {
    await expect(readManifest(dir)).rejects.toBeInstanceOf(ManifestError);
  });

  it('throws ManifestError on malformed JSON', async () => {
    await writeFile(manifestPath(dir), '{ not json', 'utf-8');
    await expect(readManifest(dir)).rejects.toBeInstanceOf(ManifestError);
  });

  it('throws ManifestError when required fields are missing', async () => {
    await writeFile(manifestPath(dir), JSON.stringify({ schemaVersion: 1 }), 'utf-8');
    await expect(readManifest(dir)).rejects.toBeInstanceOf(ManifestError);
  });

  it('throws ManifestError on an unknown schemaVersion', async () => {
    const manifest = createManifest({ name: 'Bio', slug: 'bio', color: 'green' });
    await writeFile(
      manifestPath(dir),
      JSON.stringify({ ...manifest, schemaVersion: 999 }),
      'utf-8',
    );
    await expect(readManifest(dir)).rejects.toBeInstanceOf(ManifestError);
  });
});
