import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { chunks, documents, topics, documentTopics } from '@studyhub/db';
import { createTestDb } from '@studyhub/db/testDb';
import { addSubject } from '../src/commands/subject.js';
import { buildGenerationDryRun, SubjectNotFoundCliError } from '../src/commands/generate.js';

describe('CLI generate <kind> --dry-run', () => {
  let dataRoot: string;
  let db: Awaited<ReturnType<typeof createTestDb>>;
  let subjectSlug: string;
  let subjectId: string;
  let docId: string;

  beforeEach(async () => {
    dataRoot = await mkdtemp(join(tmpdir(), 'studyhub-cli-generate-'));
    db = await createTestDb();
    const subject = await addSubject(db, dataRoot, { name: 'Fisica 1', color: 'blue' });
    subjectSlug = subject.slug;
    subjectId = subject.id;

    docId = randomUUID();
    await db.insert(documents).values({
      id: docId,
      subjectId,
      type: 'appunti',
      originalName: 'entropia.pdf',
      storedPath: '/irrelevant',
      mime: 'application/pdf',
      bytes: 10,
      sha256: 'a'.repeat(64),
      status: 'parsed',
    });
    await db.insert(chunks).values({
      id: randomUUID(),
      documentId: docId,
      pageFrom: 1,
      pageTo: 1,
      ord: 0,
      text: "L'entropia di un sistema isolato non diminuisce mai. Il secondo principio della termodinamica lo formalizza.",
      tokens: 20,
    });
  });

  afterEach(async () => {
    await rm(dataRoot, { recursive: true, force: true });
  });

  it('never calls a provider: renders the real flashcards prompt and a positive cost estimate', async () => {
    const result = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'flashcards',
      scope: { docIds: [docId] },
    });

    expect(result.promptVersion).toBe('flashcards/v1');
    expect(result.model).toBe('claude-sonnet-5');
    expect(result.docCount).toBe(1);
    expect(result.chunkCount).toBe(1);
    expect(result.system.length).toBeGreaterThan(0);
    expect(result.userPrompt).toContain("L'entropia");
    expect(result.userPrompt).toContain(docId);
    expect(result.inputTokens).toBeGreaterThan(0);
    expect(result.outputTokens).toBeGreaterThan(0);
    expect(result.costEur).toBeGreaterThan(0);
  });

  it('renders the schema and summary prompts too, with their own prompt version', async () => {
    const schema = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'schema',
      scope: { docIds: [docId] },
      depth: 3,
      style: 'mappa',
    });
    expect(schema.promptVersion).toBe('schema/v1');
    expect(schema.userPrompt).toContain("L'entropia");

    const summary = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'summary',
      scope: { docIds: [docId] },
      length: 'esteso',
    });
    expect(summary.promptVersion).toBe('summary/v1');
    expect(summary.userPrompt).toContain("L'entropia");
  });

  it('respects an explicit --model for the cost estimate', async () => {
    const cheap = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'flashcards',
      scope: { docIds: [docId] },
      model: 'claude-haiku-4-5-20251001',
    });
    const pricier = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'flashcards',
      scope: { docIds: [docId] },
      model: 'claude-opus-5',
    });
    expect(cheap.model).toBe('claude-haiku-4-5-20251001');
    expect(pricier.costEur).toBeGreaterThan(cheap.costEur);
  });

  it('resolves a topicIds-only scope, same as the worker itself', async () => {
    const topicId = randomUUID();
    await db
      .insert(topics)
      .values({ id: topicId, subjectId, name: 'Termodinamica', slug: 'termodinamica' });
    await db.insert(documentTopics).values({ documentId: docId, topicId });

    const result = await buildGenerationDryRun(db, {
      subjectSlug,
      kind: 'flashcards',
      scope: { topicIds: [topicId] },
    });
    expect(result.docCount).toBe(1);
  });

  it('throws for a scope with neither --docs nor --topics', async () => {
    await expect(
      buildGenerationDryRun(db, { subjectSlug, kind: 'flashcards', scope: {} }),
    ).rejects.toThrow(/almeno un documento/);
  });

  it('throws SubjectNotFoundCliError for an unknown slug', async () => {
    await expect(
      buildGenerationDryRun(db, {
        subjectSlug: 'nope',
        kind: 'flashcards',
        scope: { docIds: [docId] },
      }),
    ).rejects.toBeInstanceOf(SubjectNotFoundCliError);
  });
});
