import { describe, expect, it } from 'vitest';
import { CreateSubjectRequestSchema } from '../src/subject.js';

describe('CreateSubjectRequestSchema', () => {
  it('accepts a minimal valid payload', () => {
    const result = CreateSubjectRequestSchema.safeParse({ name: 'Fisica 1', color: 'blue' });
    expect(result.success).toBe(true);
  });

  it('trims the name', () => {
    const result = CreateSubjectRequestSchema.parse({ name: '  Fisica 1  ', color: 'blue' });
    expect(result.name).toBe('Fisica 1');
  });

  it('rejects an empty name', () => {
    expect(CreateSubjectRequestSchema.safeParse({ name: '   ', color: 'blue' }).success).toBe(
      false,
    );
  });

  it('rejects an invalid color', () => {
    expect(
      CreateSubjectRequestSchema.safeParse({ name: 'Fisica 1', color: 'rainbow' }).success,
    ).toBe(false);
  });

  it('rejects a non-positive CFU', () => {
    expect(
      CreateSubjectRequestSchema.safeParse({ name: 'Fisica 1', color: 'blue', cfu: 0 }).success,
    ).toBe(false);
  });
});
