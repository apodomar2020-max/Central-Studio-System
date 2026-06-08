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

// The migrations folder lives in lib/db/migrations relative to the workspace root.
// After esbuild bundles the server, __dirname points to dist/, so we walk up to
// find the workspace root. In source (tsx dev mode) the path is the same.
const migrationsFolder = path.resolve(
  __dirname,
  "../../../../lib/db/migrations",
);

export async function runMigrations(): Promise<void> {
  const db = drizzle(pool);
  await migrate(db, { migrationsFolder });
}
