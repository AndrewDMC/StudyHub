import { isAbsolute, relative, resolve, sep } from 'node:path';
import { promises as fs } from 'node:fs';
import { isValidSlug } from './slug.js';

export class PathSafetyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PathSafetyError';
  }
}

const WINDOWS_RESERVED_BASENAMES = new Set([
  'con',
  'prn',
  'aux',
  'nul',
  'com1',
  'com2',
  'com3',
  'com4',
  'com5',
  'com6',
  'com7',
  'com8',
  'com9',
  'lpt1',
  'lpt2',
  'lpt3',
  'lpt4',
  'lpt5',
  'lpt6',
  'lpt7',
  'lpt8',
  'lpt9',
]);

/**
 * Validates a single path segment (one folder/file name, never a multi-part path)
 * before it is ever concatenated into a filesystem path. This is the one place
 * that stands between user input and the disk — see docs/01-architettura.md §5.
 */
export function assertSafeSegment(segment: string): void {
  if (segment.length === 0) {
    throw new PathSafetyError('empty path segment');
  }
  if (segment.includes('\0')) {
    throw new PathSafetyError(`path segment contains a null byte: ${JSON.stringify(segment)}`);
  }
  if (segment === '.' || segment === '..') {
    throw new PathSafetyError(`path traversal segment not allowed: ${segment}`);
  }
  if (
    isAbsolute(segment) ||
    /^[a-zA-Z]:/.test(segment) ||
    segment.includes('/') ||
    segment.includes('\\')
  ) {
    throw new PathSafetyError(
      `path segment must be a single name, got: ${JSON.stringify(segment)}`,
    );
  }

  const basename = segment.split('.')[0]?.toLowerCase() ?? '';
  if (WINDOWS_RESERVED_BASENAMES.has(basename)) {
    throw new PathSafetyError(`path segment is a reserved Windows device name: ${segment}`);
  }
  // Windows forbids trailing dots/spaces on path components; a name that only
  // differs by these would silently collide once persisted on a Windows host.
  if (/[. ]$/.test(segment)) {
    throw new PathSafetyError(
      `path segment must not end with a dot or space: ${JSON.stringify(segment)}`,
    );
  }
}

/** Asserts `candidate` is `root` itself or strictly nested inside it. */
function assertWithinRoot(candidate: string, root: string): void {
  const rel = relative(root, candidate);
  if (rel === '') return;
  if (rel.startsWith(`..${sep}`) || rel === '..' || isAbsolute(rel)) {
    throw new PathSafetyError(`resolved path escapes its root: ${candidate} (root: ${root})`);
  }
}

export function resolveDataRoot(dataRootOverride?: string): string {
  return resolve(dataRootOverride ?? process.env.STUDYHUB_DATA_DIR ?? './data');
}

export function resolveSubjectsRoot(dataRoot = resolveDataRoot()): string {
  return resolve(dataRoot, 'subjects');
}

/**
 * Resolves the on-disk folder for a subject given its stable slug.
 * Vince il filesystem per l'esistenza dei file (docs/fasi/F0-fondamenta.md).
 */
export function resolveSubjectPath(slug: string, dataRoot = resolveDataRoot()): string {
  if (!isValidSlug(slug)) {
    throw new PathSafetyError(`invalid subject slug: ${JSON.stringify(slug)}`);
  }
  const subjectsRoot = resolveSubjectsRoot(dataRoot);
  const candidate = resolve(subjectsRoot, slug);
  assertWithinRoot(candidate, subjectsRoot);
  return candidate;
}

/**
 * Resolves a path *inside* a subject's folder from a list of already-split
 * segments (never a raw string with separators). Every caller that needs to
 * reach `sources/`, `derived/`, `artifacts/`, etc. must go through this.
 */
export function resolveSubjectSubpath(
  slug: string,
  segments: string[],
  dataRoot = resolveDataRoot(),
): string {
  const subjectRoot = resolveSubjectPath(slug, dataRoot);
  for (const segment of segments) {
    assertSafeSegment(segment);
  }
  const candidate = resolve(subjectRoot, ...segments);
  assertWithinRoot(candidate, subjectRoot);
  return candidate;
}

/**
 * Defends against a symlink planted on disk (e.g. inside `sources/`) pointing
 * outside the allowed root. Lexical checks above catch traversal in the
 * *requested* path; this catches it after the filesystem resolves symlinks.
 * No-op if `candidate` does not exist yet (nothing to follow).
 */
export async function assertRealpathWithinRoot(candidate: string, root: string): Promise<void> {
  let realCandidate: string;
  let realRoot: string;
  try {
    realCandidate = await fs.realpath(candidate);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  try {
    realRoot = await fs.realpath(root);
  } catch (err: unknown) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw err;
  }
  assertWithinRoot(realCandidate, realRoot);
}
