import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { GenerateFlashcardsJobInputSchema, GenerationScopeSchema } from '../src/generation.js';

describe('GenerationScopeSchema', () => {
  it('accepts docIds only', () => {
    expect(GenerationScopeSchema.safeParse({ docIds: [randomUUID()] }).success).toBe(true);
  });
  it('accepts topicIds only', () => {
    expect(GenerationScopeSchema.safeParse({ topicIds: [randomUUID()] }).success).toBe(true);
  });
  it('rejects an empty scope', () => {
    expect(GenerationScopeSchema.safeParse({}).success).toBe(false);
    expect(GenerationScopeSchema.safeParse({ docIds: [] }).success).toBe(false);
  });
});

describe('GenerateFlashcardsJobInputSchema', () => {
  it('applies defaults', () => {
    const result = GenerateFlashcardsJobInputSchema.parse({
      subjectId: randomUUID(),
      scope: { docIds: [randomUUID()] },
    });
    expect(result.count).toBe('auto');
    expect(result.types).toEqual(['basic']);
    expect(result.difficulty).toBe(2);
    expect(result.force).toBe(false);
  });

  it('rejects an invalid flashcard type', () => {
    const result = GenerateFlashcardsJobInputSchema.safeParse({
      subjectId: randomUUID(),
      scope: { docIds: [randomUUID()] },
      types: ['essay'],
    });
    expect(result.success).toBe(false);
  });
});
