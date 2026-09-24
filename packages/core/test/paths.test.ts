import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm, symlink, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import {
  PathSafetyError,
  assertRealpathWithinRoot,
  assertSafeSegment,
  resolveSubjectPath,
  resolveSubjectSubpath,
  resolveSubjectsRoot,
} from '../src/paths.js';

describe('resolveSubjectPath', () => {
  const dataRoot = '/data';

  it('resolves a valid slug under subjects/', () => {
    const path = resolveSubjectPath('fisica-1', dataRoot);
    expect(path).toBe(resolveSubjectsRoot(dataRoot) + sep + 'fisica-1');
  });

  it('rejects an invalid slug before touching the filesystem', () => {
    expect(() => resolveSubjectPath('../../etc/passwd', dataRoot)).toThrow(PathSafetyError);
    expect(() => resolveSubjectPath('..', dataRoot)).toThrow(PathSafetyError);
    expect(() => resolveSubjectPath('con', dataRoot)).toThrow(PathSafetyError);
    expect(() => resolveSubjectPath('Fisica 1', dataRoot)).toThrow(PathSafetyError);
    expect(() => resolveSubjectPath('', dataRoot)).toThrow(PathSafetyError);
  });

  it('rejects a slug smuggling a traversal via URL-encoding-like tricks', () => {
    expect(() => resolveSubjectPath('..%2f..%2fetc', dataRoot)).toThrow(PathSafetyError);
  });
});

describe('resolveSubjectSubpath', () => {
  const dataRoot = '/data';

  it('resolves nested segments inside the subject folder', () => {
    const path = resolveSubjectSubpath('fisica-1', ['sources', 'appunti'], dataRoot);
    expect(path).toBe(resolveSubjectPath('fisica-1', dataRoot) + sep + 'sources' + sep + 'appunti');
  });

  it('rejects a segment containing ".." even if the joined path looks fine', () => {
    expect(() =>
      resolveSubjectSubpath('fisica-1', ['sources', '..', '..', 'other'], dataRoot),
    ).toThrow(PathSafetyError);
  });

  it('rejects a segment that is itself an absolute path', () => {
    expect(() => resolveSubjectSubpath('fisica-1', ['/etc/passwd'], dataRoot)).toThrow(
      PathSafetyError,
    );
  });

  it('rejects a segment smuggling a separator', () => {
    expect(() => resolveSubjectSubpath('fisica-1', ['sources/../../etc'], dataRoot)).toThrow(
      PathSafetyError,
    );
  });

  it('rejects a Windows drive-letter segment', () => {
    expect(() => resolveSubjectSubpath('fisica-1', ['C:\\Windows'], dataRoot)).toThrow(
      PathSafetyError,
    );
  });

  it('rejects a null byte', () => {
    expect(() => resolveSubjectSubpath('fisica-1', ['evil\0.txt'], dataRoot)).toThrow(
      PathSafetyError,
    );
  });
});

describe('assertSafeSegment — Windows reserved names', () => {
  it.each(['con', 'CON', 'nul', 'NUL.txt', 'com1', 'LPT9.md'])('rejects %s', (segment) => {
    expect(() => assertSafeSegment(segment)).toThrow(PathSafetyError);
  });

  it('rejects trailing dot or space', () => {
    expect(() => assertSafeSegment('notes.')).toThrow(PathSafetyError);
    expect(() => assertSafeSegment('notes ')).toThrow(PathSafetyError);
  });

  it('accepts ordinary names', () => {
    expect(() => assertSafeSegment('appunti')).not.toThrow();
    expect(() => assertSafeSegment('lezione-01.pdf')).not.toThrow();
  });
});

describe('assertRealpathWithinRoot (symlink escape)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'studyhub-pathtest-'));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it('is a no-op when the path does not exist', async () => {
    await expect(
      assertRealpathWithinRoot(join(dir, 'root', 'missing'), join(dir, 'root')),
    ).resolves.toBeUndefined();
  });

  it('accepts a real file inside the root', async () => {
    const root = join(dir, 'root');
    await mkdir(root, { recursive: true });
    const inside = join(root, 'file.txt');
    await import('node:fs/promises').then((fs) => fs.writeFile(inside, 'x'));
    await expect(assertRealpathWithinRoot(inside, root)).resolves.toBeUndefined();
  });

  it('rejects a symlink inside the root that points outside it', async () => {
    const root = join(dir, 'root');
    const outside = join(dir, 'outside');
    await mkdir(root, { recursive: true });
    await mkdir(outside, { recursive: true });
    const secretFile = join(outside, 'secret.txt');
    await import('node:fs/promises').then((fs) => fs.writeFile(secretFile, 'top secret'));

    const link = join(root, 'escape-link');
    try {
      await symlink(secretFile, link);
    } catch (err) {
      // Creating symlinks may require elevated privileges on some Windows
      // configurations; skip rather than fail the suite in that case.
      if ((err as NodeJS.ErrnoException).code === 'EPERM') return;
      throw err;
    }

    await expect(assertRealpathWithinRoot(link, root)).rejects.toThrow(PathSafetyError);
  });
});
