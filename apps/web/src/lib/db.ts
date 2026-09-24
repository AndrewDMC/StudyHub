import { createDb, type Database } from '@studyhub/db';

// Next.js dev mode reloads route modules on every request; without this
// module-level cache we would open a new pg.Pool per request.
const globalForDb = globalThis as unknown as { __studyhubDb?: Database };

export function getDb(): Database {
  if (!globalForDb.__studyhubDb) {
    globalForDb.__studyhubDb = createDb();
  }
  return globalForDb.__studyhubDb;
}
