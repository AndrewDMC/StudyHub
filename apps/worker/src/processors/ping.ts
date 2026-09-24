import type { PingJobInput } from '@studyhub/contracts';

/** The simplest possible job: proves the worker is alive and wired to the queue. */
export async function processPing(input: PingJobInput): Promise<{ message: string; at: string }> {
  return {
    message: input.message ? `pong: ${input.message}` : 'pong',
    at: new Date().toISOString(),
  };
}
