import { describe, expect, it } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTestDb } from '@studyhub/db/testDb';
import { reconcileSubjects } from '@studyhub/worker/lib';
import { addSubject } from '../src/commands/subject.js';

// Guards the "@studyhub/worker/lib" boundary the `reconcile` CLI command
// depends on (docs/01-architettura.md: "apps/cli è lo stesso codice del
// worker invocato one-shot").
describe('reconcile via @studyhub/worker/lib', () => {
  it('is importable from apps/cli and finds a subject created through the CLI', async () => {
    const dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-cli-reconcile-'));
    try {
      const db = await createTestDb();
      await addSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
      const result = await reconcileSubjects(db, dataRoot);
      // Already indexed by addSubject itself; reconcile should be a no-op here.
      expect(result.alreadyIndexed).toEqual(['fisica-1']);
      expect(result.imported).toEqual([]);
    } finally {
      await rm(dataRoot, { recursive: true, force: true });
    }
  });
});
