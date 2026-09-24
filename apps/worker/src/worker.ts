import { Worker, type Job } from 'bullmq';
import { JOB_QUEUE_NAME } from '@studyhub/contracts';
import type { Database } from '@studyhub/db';
import { createRedisConnection } from './redis.js';
import { runJob } from './jobRunner.js';
import { logger } from './logger.js';

export function createJobWorker(db: Database, dataRoot: string): Worker {
  const worker = new Worker(
    JOB_QUEUE_NAME,
    async (job: Job) =>
      runJob(db, dataRoot, { id: job.id ?? job.name, name: job.name, data: job.data }),
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
