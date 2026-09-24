import IORedis from 'ioredis';

/**
 * Shared connection factory for the queue and the worker. `retryStrategy`
 * makes ioredis keep reconnecting with capped exponential backoff instead of
 * giving up — this is what "il worker sopravvive al riavvio di Redis"
 * (docs/fasi/F0-fondamenta.md) means in practice.
 * `maxRetriesPerRequest: null` is required by BullMQ for its blocking commands.
 */
export function createRedisConnection(url = process.env.REDIS_URL): IORedis {
  if (!url) {
    throw new Error('REDIS_URL is not set');
  }
  return new IORedis(url, {
    maxRetriesPerRequest: null,
    retryStrategy(attempt: number) {
      return Math.min(attempt * 500, 10_000);
    },
  });
}
