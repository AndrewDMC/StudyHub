import { describe, expect, it } from 'vitest';
import { CreateTopicRequestSchema } from '../src/topic.js';

describe('CreateTopicRequestSchema', () => {
  it('accepts a name with no parent', () => {
    expect(CreateTopicRequestSchema.safeParse({ name: 'Limiti' }).success).toBe(true);
  });
  it('rejects an empty name', () => {
    expect(CreateTopicRequestSchema.safeParse({ name: '   ' }).success).toBe(false);
  });
});
