import path from "node:path";
import fs from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzlePglite } from "drizzle-orm/pglite";
import { migrate as migratePglite } from "drizzle-orm/pglite/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import postgres from "postgres";
import * as schema from "./schema";

export type Db = PgDatabase<PgQueryResultHKT, typeof schema>;
export { schema };

const MIGRATIONS = path.join(process.cwd(), "drizzle");

/** In-process Postgres (PGlite). Used for local development and tests; migrations run on open. */
export async function openPgliteDb(dataDir?: string): Promise<Db> {
  if (dataDir) fs.mkdirSync(dataDir, { recursive: true });
  const client = dataDir ? new PGlite(dataDir) : new PGlite();
  const db = drizzlePglite({ client, schema });
  await migratePglite(db, { migrationsFolder: MIGRATIONS });
  return db as unknown as Db;
}

/** Server Postgres. Migrations are applied separately with `npm run db:migrate`. */
export function openPostgresDb(url: string): Db {
  const client = postgres(url, { max: 10 });
  return drizzlePostgres({ client, schema }) as unknown as Db;
}

const g = globalThis as unknown as { __arrovenDb?: Promise<Db> };

/** The process-wide database handle, opened lazily on first use. */
export function getDb(): Promise<Db> {
  if (!g.__arrovenDb) {
    const url = process.env.DATABASE_URL;
    g.__arrovenDb = url
      ? Promise.resolve(openPostgresDb(url))
      : openPgliteDb(path.join(process.cwd(), ".data", "pglite"));
  }
  return g.__arrovenDb;
}
