import { describe, expect, it } from 'vitest';
import { processPing } from '../src/processors/ping.js';

describe('processPing', () => {
  it('returns a default pong with no input', async () => {
    const result = await processPing({});
    expect(result.message).toBe('pong');
    expect(() => new Date(result.at).toISOString()).not.toThrow();
  });

  it('echoes a provided message', async () => {
    const result = await processPing({ message: 'hello' });
    expect(result.message).toBe('pong: hello');
  });
});
