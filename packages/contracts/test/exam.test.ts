import { describe, expect, it } from 'vitest';
import { CreateExamRequestSchema } from '../src/exam.js';

describe('CreateExamRequestSchema', () => {
  it('accepts a minimal valid exam', () => {
    const result = CreateExamRequestSchema.safeParse({
      title: 'Scritto gennaio',
      kind: 'scritto',
      date: '2026-01-15T09:00:00.000Z',
    });
    expect(result.success).toBe(true);
  });

  it('rejects an invalid kind', () => {
    expect(
      CreateExamRequestSchema.safeParse({
        title: 'X',
        kind: 'quiz',
        date: '2026-01-15T09:00:00.000Z',
      }).success,
    ).toBe(false);
  });

  it('rejects a non-ISO date string', () => {
    expect(
      CreateExamRequestSchema.safeParse({ title: 'X', kind: 'orale', date: '15/01/2026' }).success,
    ).toBe(false);
  });
});
