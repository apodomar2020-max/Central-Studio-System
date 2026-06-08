/**
 * Runs Drizzle migrations from the lib/db migrations folder.
 * Called once on server startup before the HTTP server begins accepting requests.
 */
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { pool } from "@workspace/db";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The migrations folder lives at <workspace-root>/lib/db/migrations.
// esbuild bundles everything into dist/index.mjs, so at runtime:
//   __dirname = /app/artifacts/api-server/dist
// Walking up 3 levels reaches the workspace root /app:
//   ../   → /app/artifacts/api-server
//   ../../ → /app/artifacts
//   ../../../ → /app  (workspace root)
const migrationsFolder = path.resolve(
  __dirname,
  "../../../lib/db/migrations",
);

export async function runMigrations(): Promise<void> {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
}
