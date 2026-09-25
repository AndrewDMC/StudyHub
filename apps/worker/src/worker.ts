import { randomUUID } from 'node:crypto';
import { Worker, type Job } from 'bullmq';
import { JOB_QUEUE_NAME } from '@studyhub/contracts';
import type { Database } from '@studyhub/db';
import { createRedisConnection } from './redis.js';
import { runJob } from './jobRunner.js';
import { logger } from './logger.js';

export function createJobWorker(db: Database, dataRoot: string): Worker {
  const worker = new Worker(
    JOB_QUEUE_NAME,
    async (job: Job) => {
      // `jobs.id` is a uuid column. Every producer that a caller later polls
      // by id (enqueueFlashcardsGeneration & friends) passes its own
      // `jobId: randomUUID()` at `queue.add()` time, so `job.id` is already
      // that same uuid here — trust it. `reconcile`'s repeatable occurrences
      // are the exception: BullMQ derives their id from the repeat key at
      // fire time (not a uuid, and not something a caller ever polls for),
      // so it gets a throwaway uuid instead of hitting `invalid input syntax
      // for type uuid` on every run.
      const id = job.name === 'reconcile' ? randomUUID() : (job.id ?? randomUUID());
      return runJob(db, dataRoot, { id, name: job.name, data: job.data });
    },
    { connection: createRedisConnection(), concurrency: 4 },
  );

  worker.on('ready', () => logger.info('worker connected to redis'));
  worker.on('completed', (job) => logger.info({ jobId: job.id, type: job.name }, 'job completed'));
  worker.on('failed', (job, err) =>
    logger.error({ jobId: job?.id, type: job?.name, err: err.message }, 'job failed'),
  );
  worker.on('error', (err) => logger.error({ err: err.message }, 'worker connection error'));

  return worker;
}
