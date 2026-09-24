import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import * as schema from './schema.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_FOLDER = resolve(__dirname, '../drizzle');

/**
 * In-memory Postgres (WASM, via pglite) running the *real* migrations from
 * `packages/db/drizzle/` — the same SQL files `packages/db/src/migrate.ts`
 * applies to production Postgres. Lets every workspace package run genuine
 * integration tests (actual SQL, actual constraints) without Docker or a
 * running Postgres server. Not used at runtime, only in tests.
 */
export async function createTestDb(): Promise<PgliteDatabase<typeof schema>> {
  const client = new PGlite();
  const migrationDb = drizzle(client);
  await migrate(migrationDb, { migrationsFolder: MIGRATIONS_FOLDER });
  return drizzle(client, { schema });
}
