import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { createTestDb } from '@studyhub/db/testDb';
import {
  attemptAnswerPhotos,
  attemptItemResults,
  chunks,
  documents,
  simulationAttempts,
  simulationItems,
  subjects,
} from '@studyhub/db';
import { createManifest, scaffoldSubject } from '@studyhub/core';
import { FakeProvider, type AiProvider, type GradePromptInput } from '@studyhub/ai';
import { processExtractExamProfile } from '../src/processors/exam/extractExamProfile.js';
import { processGenerateSimulation } from '../src/processors/exam/generateSimulation.js';
import { processGradeAttempt } from '../src/processors/exam/gradeAttempt.js';
import { processGradeItemSecondOpinion } from '../src/processors/exam/gradeItemSecondOpinion.js';

const PAST_EXAM_TEXT =
  'Tempo a disposizione: 90 minuti. Esercizio 1. Enunciare il secondo principio della termodinamica (15 punti). Esercizio 2. Calcolare il rendimento di un ciclo di Carnot (15 punti).';
const STUDY_TEXT =
  "L'entropia di un sistema isolato non diminuisce mai, come afferma il secondo principio. Il rendimento di una macchina di Carnot dipende solo dalle temperature delle sorgenti. Una trasformazione reversibile può essere percorsa in entrambi i versi senza lasciare traccia.";
const TYPED = 'Risposta scritta a mano, vedi foto.';

/** FakeProvider that records what the grader is asked (by item) and what the OCR is asked to read. */
function recordingProvider(overrides: Partial<AiProvider> = {}) {
  const graded: GradePromptInput[] = [];
  const ocrPaths: string[] = [];
  const provider: AiProvider = Object.assign(new FakeProvider(), {
    async gradeAnswer(input: GradePromptInput, model: string) {
      graded.push(input);
      return new FakeProvider().gradeAnswer(input, model);
    },
    async ocrText(input: { imagePath: string; mime: string }, model: string) {
      ocrPaths.push(input.imagePath);
      return new FakeProvider().ocrText(input, model);
    },
    ...overrides,
  });
  const answerFor = (prompt: string) => graded.find((g) => g.item.prompt === prompt)?.answer;
  return { provider, graded, ocrPaths, answerFor };
}

describe('grade_attempt with photos of handwritten answers', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectId: string;
  let attemptId: string;
  let items: { id: string; prompt: string; ord: number }[];

  async function addDoc(type: 'esami' | 'appunti', text: string) {
    const id = randomUUID();
    await db.insert(documents).values({
      id,
      subjectId,
      type,
      originalName: `${type}.pdf`,
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 1,
      sha256: randomUUID().replace(/-/g, '').padEnd(64, '0'),
      status: 'parsed',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: id,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text,
      tokens: 50,
    });
  }

  /** Stores a photo row (and, unless told otherwise, its file) the way the upload route does. */
  async function addPhoto(
    itemId: string,
    opts: { onDisk?: boolean; relPath?: string; mime?: string; size?: number } = {},
  ) {
    const id = randomUUID();
    const relPath = opts.relPath ?? `.studyhub/attempts/${attemptId}/${id}.png`;
    if (opts.onDisk !== false && !opts.relPath) {
      const dir = join(dataRoot, 'subjects', 'fisica-1', '.studyhub', 'attempts', attemptId);
      await mkdir(dir, { recursive: true });
      await writeFile(join(dir, `${id}.png`), 'not-a-real-png');
    }
    await db.insert(attemptAnswerPhotos).values({
      id,
      attemptId,
      itemId,
      relPath,
      mime: opts.mime ?? 'image/png',
      size: opts.size ?? 14,
    });
    return id;
  }

  const photoRow = async (id: string) =>
    (await db.select().from(attemptAnswerPhotos).where(eq(attemptAnswerPhotos.id, id)))[0]!;

  const grade = (provider: AiProvider) =>
    processGradeAttempt(db, dataRoot, { attemptId, force: false }, provider);

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-photos-'));
    db = await createTestDb();
    const manifest = createManifest({ name: 'Fisica 1', slug: 'fisica-1', color: 'blue' });
    const folderPath = await scaffoldSubject(dataRoot, manifest);
    subjectId = manifest.id;
    await db.insert(subjects).values({
      id: subjectId,
      slug: manifest.slug,
      name: manifest.name,
      color: 'blue',
      folderPath,
    });
    await addDoc('esami', PAST_EXAM_TEXT);
    await addDoc('appunti', STUDY_TEXT);
    await processExtractExamProfile(
      db,
      dataRoot,
      { subjectId, overwriteEdited: false, force: false },
      new FakeProvider(),
    );
    const { artifactId } = await processGenerateSimulation(
      db,
      dataRoot,
      { subjectId, mode: 'esame_completo', difficulty: 2, force: false },
      new FakeProvider(),
    );
    items = await db
      .select()
      .from(simulationItems)
      .where(eq(simulationItems.simulationId, artifactId))
      .orderBy(simulationItems.ord);
    attemptId = randomUUID();
    await db.insert(simulationAttempts).values({
      id: attemptId,
      simulationId: artifactId,
      durationMin: 60,
      status: 'submitted',
      submittedAt: new Date(),
      answers: { [items[0]!.id]: TYPED },
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('appends the transcription of the photo to the typed answer before grading', async () => {
    const photoId = await addPhoto(items[0]!.id);
    const { provider, ocrPaths, answerFor } = recordingProvider();

    const result = await grade(provider);

    expect(result.warnings).toEqual([]);
    expect(ocrPaths).toHaveLength(1);
    expect(ocrPaths[0]).toContain(photoId);
    const answer = answerFor(items[0]!.prompt)!;
    expect(answer.startsWith(TYPED)).toBe(true);
    expect(answer).toContain(`\n\n[Foto del foglio]\n[Trascrizione simulata] ${photoId}.png`);
    // The other item has neither typed text nor photos: untouched.
    expect(answerFor(items[1]!.prompt)).toBe('');
  });

  it('grades a photo-only answer from its transcription and numbers several photos', async () => {
    const itemId = items[1]!.id;
    await addPhoto(itemId);
    await addPhoto(itemId);
    const { provider, answerFor } = recordingProvider();

    await grade(provider);

    const answer = answerFor(items[1]!.prompt)!;
    expect(answer.startsWith('[Foto del foglio 1/2]\n')).toBe(true);
    expect(answer).toContain('\n\n[Foto del foglio 2/2]\n');
  });

  it('does not fail when the photo file is missing on disk: warns and grades the typed text', async () => {
    const photoId = await addPhoto(items[0]!.id, { onDisk: false });
    const { provider, ocrPaths, answerFor } = recordingProvider();

    const result = await grade(provider);

    expect(result.alreadyGraded).toBe(false);
    expect(ocrPaths).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(photoId);
    expect(answerFor(items[0]!.prompt)).toBe(TYPED);
    const results = await db
      .select()
      .from(attemptItemResults)
      .where(eq(attemptItemResults.attemptId, attemptId));
    expect(results).toHaveLength(items.length);
  });

  it('after a provider failure (bad key) is fixed, the retry transcribes the photo for real instead of grading on a stored failure', async () => {
    const photoId = await addPhoto(items[0]!.id);
    const broken = recordingProvider({
      async ocrText() {
        throw Object.assign(new Error('401 invalid x-api-key'), { status: 401 });
      },
    });
    await expect(grade(broken.provider)).rejects.toThrow(/401/);
    expect((await photoRow(photoId)).transcriptStatus).toBeNull();

    const fixed = recordingProvider();
    const result = await grade(fixed.provider);

    expect(result.warnings).toEqual([]);
    expect(fixed.ocrPaths).toHaveLength(1);
    expect(fixed.answerFor(items[0]!.prompt)).toContain('[Trascrizione simulata]');
    expect((await photoRow(photoId)).transcriptStatus).toBe('ok');
  });

  it.each([
    ['429 rate limit', Object.assign(new Error('rate limited'), { status: 429 })],
    ['529 overloaded', Object.assign(new Error('overloaded'), { status: 529 })],
    ['401 unauthorized', Object.assign(new Error('invalid x-api-key'), { status: 401 })],
    ['403 forbidden', Object.assign(new Error('forbidden'), { status: 403 })],
    ['404 model not found', Object.assign(new Error('model not found'), { status: 404 })],
    ['400 bad request', Object.assign(new Error('bad request'), { status: 400 })],
    ['unauthenticated CLI', new Error('chiamata a `claude` fallita (exit 1): not logged in')],
    [
      'dropped connection',
      Object.assign(new Error('Connection error.'), { name: 'APIConnectionError' }),
    ],
  ])(
    'a provider error (%s) is rethrown: no grade is written, the photo keeps no status',
    async (_label, error) => {
      const photoId = await addPhoto(items[0]!.id);
      const { provider, graded } = recordingProvider({
        async ocrText() {
          throw error;
        },
      });

      await expect(grade(provider)).rejects.toBe(error);

      expect(graded).toEqual([]);
      const results = await db
        .select()
        .from(attemptItemResults)
        .where(eq(attemptItemResults.attemptId, attemptId));
      expect(results).toEqual([]);
      const [attempt] = await db
        .select()
        .from(simulationAttempts)
        .where(eq(simulationAttempts.id, attemptId));
      expect(attempt?.status).toBe('submitted');
      expect((await photoRow(photoId)).transcriptStatus).toBeNull();
    },
  );

  it('a retry after a provider failure reuses the transcripts already stored and only reads the rest', async () => {
    const first = await addPhoto(items[0]!.id);
    const second = await addPhoto(items[1]!.id);
    let calls = 0;
    const flaky = recordingProvider({
      async ocrText(input, model) {
        calls += 1;
        if (calls === 2) throw Object.assign(new Error('overloaded'), { status: 529 });
        return new FakeProvider().ocrText(input, model);
      },
    });
    await expect(grade(flaky.provider)).rejects.toThrow();
    expect((await photoRow(first)).transcriptStatus).toBe('ok');
    expect((await photoRow(second)).transcriptStatus).toBeNull();

    const retry = recordingProvider();
    const result = await grade(retry.provider);

    expect(retry.ocrPaths).toHaveLength(1);
    expect(retry.ocrPaths[0]).toContain(second);
    expect(result.warnings).toEqual([]);
    // The reused transcript still reaches the grader.
    expect(retry.answerFor(items[0]!.prompt)).toContain(`[Trascrizione simulata] ${first}.png`);
  });

  it.each([
    ['unsupported mime', { mime: 'image/heic' }],
    ['declared size over the limit', { size: 5 * 1024 * 1024 + 1 }],
  ])('%s: marked failed without calling the provider', async (_label, opts) => {
    const photoId = await addPhoto(items[0]!.id, opts);
    const { provider, ocrPaths, answerFor } = recordingProvider();

    const result = await grade(provider);

    expect(ocrPaths).toEqual([]);
    expect(result.warnings).toHaveLength(1);
    expect(answerFor(items[0]!.prompt)).toBe(TYPED);
    const row = await photoRow(photoId);
    expect(row.transcriptStatus).toBe('failed');
    expect(row.transcribedAt).toBeInstanceOf(Date);
  });

  it('a file on disk bigger than the limit is failed without calling the provider, whatever the row says', async () => {
    const id = randomUUID();
    const dir = join(dataRoot, 'subjects', 'fisica-1', '.studyhub', 'attempts', attemptId);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${id}.png`), Buffer.alloc(5 * 1024 * 1024 + 1));
    await db.insert(attemptAnswerPhotos).values({
      id,
      attemptId,
      itemId: items[0]!.id,
      relPath: `.studyhub/attempts/${attemptId}/${id}.png`,
      mime: 'image/png',
      size: 10,
    });
    const { provider, ocrPaths } = recordingProvider();

    await grade(provider);

    expect(ocrPaths).toEqual([]);
    expect((await photoRow(id)).transcriptStatus).toBe('failed');
  });

  it('stores text, status and time of a successful transcription on the photo', async () => {
    const photoId = await addPhoto(items[0]!.id);

    await grade(new FakeProvider());

    const row = await photoRow(photoId);
    expect(row.transcriptStatus).toBe('ok');
    expect(row.transcript).toContain(`[Trascrizione simulata] ${photoId}.png`);
    expect(row.transcribedAt).toBeInstanceOf(Date);
  });

  it('ignores an illegible photo with a warning and remembers it as illegible', async () => {
    const photoId = await addPhoto(items[0]!.id);
    const { provider, answerFor } = recordingProvider({
      async ocrText() {
        return {
          data: { text: '', confidence: 'illegible' as const },
          usage: { inputTokens: 5, outputTokens: 0 },
          model: 'claude-sonnet-5-5',
          promptVersion: 'ocr_text/v1',
        };
      },
    });

    const result = await grade(provider);

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toMatch(/illeggibile/);
    expect(answerFor(items[0]!.prompt)).toBe(TYPED);
    expect((await photoRow(photoId)).transcriptStatus).toBe('illegible');
  });

  it('refuses a stored path that escapes the subject folder (path safety) without reading it', async () => {
    await addPhoto(items[0]!.id, { relPath: '../../outside/secret.png' });
    const { provider, ocrPaths } = recordingProvider();

    const result = await grade(provider);

    expect(ocrPaths).toEqual([]);
    expect(result.warnings).toHaveLength(1);
  });

  it('records the OCR cost like any other step', async () => {
    await addPhoto(items[0]!.id);
    const { provider } = recordingProvider({
      async ocrText() {
        return {
          data: { text: 'x = 3', confidence: 'ok' as const },
          usage: { inputTokens: 1_000_000, outputTokens: 0 },
          model: 'claude-sonnet-5-5',
          promptVersion: 'ocr_text/v1',
        };
      },
    });

    const result = await grade(provider);

    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(1_000_000);
    expect(result.costEur).toBeGreaterThan(1); // 1M Sonnet input tokens are billed
  });

  it('with no photos, makes no OCR call at all', async () => {
    const { provider, ocrPaths } = recordingProvider();

    const result = await grade(provider);

    expect(ocrPaths).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  describe('second opinion', () => {
    const secondOpinion = (provider: AiProvider, itemId: string) =>
      processGradeItemSecondOpinion(db, dataRoot, { attemptId, itemId, force: false }, provider);

    it('reuses the transcription stored by the first grade: the provider reads the photo once overall', async () => {
      const photoId = await addPhoto(items[0]!.id);
      const first = recordingProvider();
      await grade(first.provider);
      const second = recordingProvider();

      const result = await secondOpinion(second.provider, items[0]!.id);

      expect(first.ocrPaths).toHaveLength(1);
      expect(second.ocrPaths).toEqual([]);
      expect(result.warnings).toEqual([]);
      // Same answer the first grade saw: typed text plus the stored transcription.
      expect(second.graded[0]!.answer).toBe(first.answerFor(items[0]!.prompt));
      expect(second.graded[0]!.answer).toContain(
        `[Foto del foglio]\n[Trascrizione simulata] ${photoId}.png`,
      );
    });

    it('rethrows a provider error without writing the second opinion', async () => {
      await grade(new FakeProvider());
      await addPhoto(items[0]!.id);
      const { provider } = recordingProvider({
        async ocrText() {
          throw Object.assign(new Error('rate limited'), { status: 429 });
        },
      });

      await expect(secondOpinion(provider, items[0]!.id)).rejects.toThrow(/rate limited/);

      const [row] = await db
        .select()
        .from(attemptItemResults)
        .where(eq(attemptItemResults.itemId, items[0]!.id));
      expect(row?.secondOpinionAt).toBeNull();
    });

    it('a photo that failed at the first grade is reported again and the re-grade uses the typed text', async () => {
      await addPhoto(items[0]!.id, { onDisk: false });
      await grade(new FakeProvider());
      const { provider, graded, ocrPaths } = recordingProvider();

      const result = await secondOpinion(provider, items[0]!.id);

      expect(ocrPaths).toEqual([]);
      expect(result.warnings).toHaveLength(1);
      expect(graded[0]!.answer).toBe(TYPED);
      const [row] = await db
        .select()
        .from(attemptItemResults)
        .where(eq(attemptItemResults.itemId, items[0]!.id));
      expect(row?.secondOpinionAt).toBeInstanceOf(Date);
    });

    it('reads a photo never transcribed, only for the re-graded item, and stores it', async () => {
      await grade(new FakeProvider()); // graded before any photo existed
      const mine = await addPhoto(items[0]!.id);
      await addPhoto(items[1]!.id);
      const { provider, ocrPaths, graded } = recordingProvider();

      await secondOpinion(provider, items[0]!.id);

      expect(ocrPaths).toHaveLength(1);
      expect(ocrPaths[0]).toContain(mine);
      expect(graded[0]!.answer).toContain('[Foto del foglio]');
      expect((await photoRow(mine)).transcriptStatus).toBe('ok');
    });
  });
});
