import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestDb } from '@studyhub/db/testDb';
import { documents, subjects, transcriptionCorrections } from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import type { AiProvider } from '@studyhub/ai';
import { processDistillHandwritingProfile } from '../src/processors/distillHandwritingProfile.js';
import { subjectHandwritingProfilePath } from '../src/processors/handwritingProfile.js';

function fakeDistillProvider(lines: string[]): AiProvider {
  return {
    name: 'fake-distill-test',
    generateFlashcards: vi.fn(),
    generateSummary: vi.fn(),
    generateSchema: vi.fn(),
    extractExamProfile: vi.fn(),
    generateSimulation: vi.fn(),
    gradeAnswer: vi.fn(),
    estimateTopics: vi.fn(),
    extractTopics: vi.fn(),
    transcribeSchema: vi.fn(),
    ocrText: vi.fn(),
    classifyDocumentType: vi.fn(),
    distillHandwritingProfile: vi.fn().mockResolvedValue({
      data: { lines },
      usage: { inputTokens: 20, outputTokens: 10 },
      model: 'claude-haiku-4-5-20251001',
      promptVersion: 'distill_handwriting_profile/v1',
    }),
  };
}

describe('processDistillHandwritingProfile', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-distill-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    subjectSlug = manifest.slug;
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    await db.insert(subjects).values({
      id: manifest.id,
      slug: subjectSlug,
      name: manifest.name,
      color: manifest.color,
      folderPath,
    });
    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId: manifest.id,
      type: 'schemi',
      originalName: 'schema.jpg',
      storedPath: '/irrelevant',
      mime: 'image/jpeg',
      bytes: 10,
      sha256: 'a'.repeat(64),
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('appends distilled lines to the subject handwriting profile', async () => {
    await db.insert(transcriptionCorrections).values({
      id: randomUUID(),
      documentId: docId,
      nodeKey: 'n1',
      before: 'Trasf adiabbatica',
      after: 'Trasf. adiabatica',
      kind: 'label',
    });

    const provider = fakeDistillProvider(['Scrive "adiabatica" abbreviato senza il punto.']);
    const result = await processDistillHandwritingProfile(
      db,
      dataRoot,
      { subjectSlug, documentId: docId },
      provider,
    );

    expect(result.linesAdded).toBe(1);
    const profile = await readFile(subjectHandwritingProfilePath(subjectSlug, dataRoot), 'utf-8');
    expect(profile).toContain('Scrive "adiabatica" abbreviato senza il punto.');
  });

  it('is a no-op (no provider call) when there are no corrections yet', async () => {
    const provider = fakeDistillProvider(['dovrebbe non essere usata']);
    const result = await processDistillHandwritingProfile(
      db,
      dataRoot,
      { subjectSlug, documentId: docId },
      provider,
    );

    expect(result.linesAdded).toBe(0);
    expect(provider.distillHandwritingProfile).not.toHaveBeenCalled();
  });
});
