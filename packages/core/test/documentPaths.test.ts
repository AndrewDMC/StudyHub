import { describe, expect, it } from 'vitest';
import { sep } from 'node:path';
import { resolveDocumentDerivedDir, resolveDocumentSourcePath } from '../src/documentPaths.js';
import { resolveSubjectPath } from '../src/paths.js';
import { PathSafetyError } from '../src/paths.js';

describe('resolveDocumentSourcePath', () => {
  const dataRoot = '/data';

  it('resolves under sources/<type>/', () => {
    const path = resolveDocumentSourcePath('fisica-1', 'appunti', 'abc.pdf', dataRoot);
    expect(path).toBe(
      resolveSubjectPath('fisica-1', dataRoot) +
        sep +
        'sources' +
        sep +
        'appunti' +
        sep +
        'abc.pdf',
    );
  });

  it('rejects a stored filename smuggling traversal', () => {
    expect(() =>
      resolveDocumentSourcePath('fisica-1', 'appunti', '../../etc/passwd', dataRoot),
    ).toThrow(PathSafetyError);
  });
});

describe('resolveDocumentDerivedDir', () => {
  it('resolves under derived/<documentId>/', () => {
    const dataRoot = '/data';
    const docId = '11111111-1111-1111-1111-111111111111';
    const path = resolveDocumentDerivedDir('fisica-1', docId, dataRoot);
    expect(path).toBe(resolveSubjectPath('fisica-1', dataRoot) + sep + 'derived' + sep + docId);
  });
});
