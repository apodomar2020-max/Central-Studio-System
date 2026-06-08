/**
 * Standalone migration runner.
 *
 * Run once at deploy time (or on startup) to apply any pending migrations:
 *
 *   DATABASE_URL=postgres://... pnpm --filter @workspace/db run migrate
 *
 * Drizzle reads migration files from the `migrations/` folder produced by
 * `drizzle-kit generate`.  Only new migrations (not yet recorded in the
 * `__drizzle_migrations` table) are applied, so it is safe to run on every
 * deploy.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";
import path from "path";
import { fileURLToPath } from "url";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set before running migrations.");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsFolder = path.join(__dirname, "../migrations");

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool);

console.log("Running migrations from:", migrationsFolder);

await migrate(db, { migrationsFolder });

console.log("Migrations complete.");
await pool.end();
