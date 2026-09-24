import { Queue } from 'bullmq';
import IORedis from 'ioredis';
import { JOB_QUEUE_NAME } from '@studyhub/contracts';

const globalForQueue = globalThis as unknown as { __studyhubQueue?: Queue };

/** Same queue apps/worker consumes (docs/01-architettura.md §1: web enqueues, worker processes). */
export function getJobQueue(): Queue {
  if (!globalForQueue.__studyhubQueue) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL is not set');
    const connection = new IORedis(url, { maxRetriesPerRequest: null });
    globalForQueue.__studyhubQueue = new Queue(JOB_QUEUE_NAME, { connection });
  }
  return globalForQueue.__studyhubQueue;
}
