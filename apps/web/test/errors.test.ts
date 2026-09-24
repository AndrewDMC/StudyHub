import { describe, expect, it } from 'vitest';
import { formatError } from '../src/lib/errors';

describe('formatError', () => {
  it('returns a plain Error message', () => {
    expect(formatError(new Error('boom'))).toBe('boom');
  });

  it('falls back to the error name when message is empty', () => {
    const err = new Error('');
    err.name = 'ConnectionRefused';
    expect(formatError(err)).toBe('ConnectionRefused');
  });

  it('unwraps an AggregateError with an empty top-level message (e.g. ECONNREFUSED)', () => {
    const inner = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), {
      code: 'ECONNREFUSED',
    });
    const agg = new AggregateError([inner], '');
    expect(formatError(agg)).toBe('connect ECONNREFUSED 127.0.0.1:5432');
  });

  it('stringifies a non-Error throw', () => {
    expect(formatError('plain string error')).toBe('plain string error');
  });
});
