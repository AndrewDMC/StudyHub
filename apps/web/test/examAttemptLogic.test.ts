import { describe, expect, it, vi } from 'vitest';
import { performSubmit, remainingFrom, requeueAnswers } from '../src/lib/examAttemptLogic';

describe('examAttemptLogic', () => {
  it('requeues a failed batch without overwriting newer keystrokes', () => {
    expect(requeueAnswers({ a: 'old', b: 'kept' }, { a: 'new', c: 'x' })).toEqual({
      a: 'new',
      b: 'kept',
      c: 'x',
    });
    expect(requeueAnswers({ a: '1' }, {})).toEqual({ a: '1' });
  });

  it('computes the remaining time from an absolute deadline', () => {
    const deadline = 1_000_000 + 90_000;
    expect(remainingFrom(deadline, 1_000_000)).toBe(90);
    expect(remainingFrom(deadline, 1_000_000 + 60_500)).toBe(30);
    // a background tab that resumes 2 minutes later: the time is gone, not drifting
    expect(remainingFrom(deadline, 1_000_000 + 120_000)).toBe(0);
  });

  it('does not hand in when the save failed', async () => {
    const post = vi.fn();
    const out = await performSubmit({ flush: async () => false, post });
    expect(out.ok).toBe(false);
    expect(post).not.toHaveBeenCalled();
  });

  it('hands in anyway when forced (time is up)', async () => {
    const post = vi.fn().mockResolvedValue(undefined);
    const out = await performSubmit({ flush: async () => false, post, force: true });
    expect(out).toEqual({ ok: true });
    expect(post).toHaveBeenCalledOnce();
  });

  it('reports a network error on the hand-in and allows a retry', async () => {
    const post = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('network'))
      .mockResolvedValueOnce(undefined);
    const flush = async () => true;
    const first = await performSubmit({ flush, post });
    expect(first.ok).toBe(false);
    const second = await performSubmit({ flush, post });
    expect(second).toEqual({ ok: true });
    expect(post).toHaveBeenCalledTimes(2);
  });
});
