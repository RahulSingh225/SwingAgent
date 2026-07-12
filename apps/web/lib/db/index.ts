import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const DEFAULT_LOCAL_URL = 'postgres://marketos:marketos@localhost:5432/marketos';

// Reuse the connection across dev hot reloads
const globalForDb = globalThis as unknown as { pgClient?: ReturnType<typeof postgres> };

const client =
  globalForDb.pgClient ??
  postgres(process.env.DATABASE_URL ?? DEFAULT_LOCAL_URL, { max: 10 });

if (process.env.NODE_ENV !== 'production') {
  globalForDb.pgClient = client;
}

export const db = drizzle(client, { schema });
export { schema };
