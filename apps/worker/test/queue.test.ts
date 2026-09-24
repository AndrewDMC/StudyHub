import { describe, expect, it } from 'vitest';
import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { JOB_QUEUE_NAME } from '@studyhub/contracts';

// Regression: the shared queue name used to contain ':' and BullMQ threw at
// construction. This builds a real Queue so BullMQ's own validation runs.
// No Redis server exists in tests: the connection attempt is expected to
// fail and is swallowed — only the constructor's verdict matters here.
describe('JOB_QUEUE_NAME', () => {
  it('is accepted by BullMQ', async () => {
    const connection = new IORedis({
      lazyConnect: true,
      maxRetriesPerRequest: null,
      retryStrategy: () => null,
    });
    connection.on('error', () => {});

    let queue: Queue | undefined;
    expect(() => {
      queue = new Queue(JOB_QUEUE_NAME, { connection });
    }).not.toThrow();

    queue?.on('error', () => {});
    await queue?.waitUntilReady().catch(() => {});
    await queue?.close().catch(() => {});
  });
});
