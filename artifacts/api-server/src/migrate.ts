/**
 * Standalone migration entrypoint — bundled to dist/migrate.mjs.
 *
 * Runs as an explicit deployment step (Railway `preDeployCommand`) or manually:
 *
 *   MIGRATION_DATABASE_URL=postgres://... node artifacts/api-server/dist/migrate.mjs
 *
 * The API server and queue worker never run migrations at startup; this
 * script is the only production path that mutates the database schema.
 * Drizzle only applies migrations not yet recorded in `__drizzle_migrations`,
 * so re-running is a no-op.
 *
 * Exit codes: 0 = migrations applied (or skipped on worker), non-zero = failure.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import path from "path";
import { fileURLToPath } from "url";
import { assertDatabaseUrlSafeOutsideRailway } from "../../../lib/db/src/guard";
import { createPostgresPool } from "../../../lib/db/src/pool";
import { resolveMigrationDatabaseUrl } from "../scripts/database-role-boundaries.mjs";

// railway.toml is shared by the API and worker services, so the worker would
// also run this pre-deploy step. Schema changes must have exactly one owner
// (the API service), so the worker exits immediately without opening a pool.
if (process.env["QUEUE_WORKER_ENABLED"] === "true") {
  console.log(
    "[migrate] QUEUE_WORKER_ENABLED=true — worker service never runs migrations, skipping.",
  );
  process.exit(0);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The migrations folder lives at <workspace-root>/lib/db/migrations.
// esbuild bundles this file into dist/migrate.mjs, so at runtime:
//   __dirname = /app/artifacts/api-server/dist
// Walking up 3 levels reaches the workspace root /app:
//   ../   → /app/artifacts/api-server
//   ../../ → /app/artifacts
//   ../../../ → /app  (workspace root)
const migrationsFolder = path.resolve(__dirname, "../../../lib/db/migrations");

let pool: ReturnType<typeof createPostgresPool> | undefined;

try {
  const migrationDatabaseUrl = resolveMigrationDatabaseUrl(process.env);
  assertDatabaseUrlSafeOutsideRailway(migrationDatabaseUrl);
  pool = createPostgresPool(migrationDatabaseUrl);
  console.log(`[migrate] Applying pending migrations from ${migrationsFolder}`);
  await migrate(drizzle(pool), { migrationsFolder });
  console.log("[migrate] Migrations complete.");
  await pool.end();
  process.exit(0);
} catch (err) {
  console.error("[migrate] Migration failed:", err);
  await pool?.end().catch(() => {});
  process.exit(1);
}
