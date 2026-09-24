import { Queue } from 'bullmq';
import { JOB_QUEUE_NAME } from '@studyhub/contracts';
import { createRedisConnection } from './redis.js';

export function createJobQueue(): Queue {
  return new Queue(JOB_QUEUE_NAME, {
    connection: createRedisConnection(),
    defaultJobOptions: {
      attempts: 5,
      backoff: { type: 'exponential', delay: 2000 },
      removeOnComplete: { count: 500 },
      removeOnFail: { count: 1000 },
    },
  });
}
