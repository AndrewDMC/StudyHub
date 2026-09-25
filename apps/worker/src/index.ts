import { writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createDb } from '@studyhub/db';
import { resolveDataRoot } from '@studyhub/core';
import { createJobQueue } from './queue.js';
import { createJobWorker } from './worker.js';
import { logger } from './logger.js';

const RECONCILE_INTERVAL_MS = 15 * 60 * 1000;
const HEARTBEAT_INTERVAL_MS = 10_000;
const HEARTBEAT_FILE = process.env.STUDYHUB_HEARTBEAT_FILE ?? '/tmp/studyhub-worker-heartbeat';

/** Read by docker/Dockerfile.worker's HEALTHCHECK — the worker has no HTTP port. */
function startHeartbeat(): NodeJS.Timeout {
  const tick = () => void writeFile(HEARTBEAT_FILE, String(Date.now())).catch(() => {});
  tick();
  return setInterval(tick, HEARTBEAT_INTERVAL_MS);
}

async function main() {
  const db = createDb();
  const dataRoot = resolveDataRoot();

  const queue = await createJobQueue();
  const worker = createJobWorker(db, dataRoot);
  const heartbeat = startHeartbeat();

  // Trigger: worker startup + every 15 min + on-demand (docs/02-filesystem-e-dati.md §2).
  // jobId here is BullMQ's own dedup key, not the `jobs` table row id — see
  // worker.ts, which mints a fresh uuid for every reconcile occurrence.
  await queue.add('reconcile', {}, { jobId: randomUUID() });
  await queue.add(
    'reconcile',
    {},
    { repeat: { every: RECONCILE_INTERVAL_MS }, jobId: 'reconcile:scheduled' },
  );

  logger.info({ dataRoot }, 'studyhub worker started');

  const shutdown = async (signal: string) => {
    logger.info({ signal }, 'shutting down');
    clearInterval(heartbeat);
    await worker.close();
    await queue.close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error({ err: err instanceof Error ? err.message : err }, 'worker failed to start');
  process.exit(1);
});
