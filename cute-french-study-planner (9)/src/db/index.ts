import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

// The notebook now stores its data in the browser. The server database is
// optional (only read once to import older notes), so a missing URL must not
// crash the build — e.g. on Netlify without any external database.
const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  new Pool({
    connectionString: databaseUrl,
  });

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool);
