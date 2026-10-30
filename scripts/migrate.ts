import path from "node:path";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const url = process.env.DATABASE_URL;
if (!url) {
  console.log("DATABASE_URL is not set. The embedded development database migrates itself on startup.");
  process.exit(0);
}
const client = postgres(url, { max: 1 });
await migrate(drizzle({ client }), { migrationsFolder: path.join(process.cwd(), "drizzle") });
await client.end();
console.log("Migrations applied.");
