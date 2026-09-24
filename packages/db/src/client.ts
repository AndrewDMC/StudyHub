import { drizzle as drizzleNodePg, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema.js';

export type Database = NodePgDatabase<typeof schema>;

/**
 * Creates a Drizzle client against a real Postgres instance (`DATABASE_URL`).
 * Used by `apps/web`, `apps/worker`, `apps/cli`. Tests use
 * `createTestDb()` in `test/testDb.ts` (in-memory, no server required) instead.
 */
export function createDb(connectionString = process.env.DATABASE_URL): Database {
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }
  const pool = new Pool({ connectionString });
  return drizzleNodePg(pool, { schema });
}

export { schema };
