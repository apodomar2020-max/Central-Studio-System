/**
 * Test-only helper for the Unified Website CMS suites.
 *
 * Builds a FRESH, fully-migrated, DISPOSABLE local Postgres database and
 * seeds it with the read-only Production capture in ./unified-cms-golden
 * (public content only; `updated_by_admin_id` was nulled because no
 * system_users rows are seeded). Each suite passes its own database name so
 * suites never see each other's rows — which is what lets the golden test
 * assert the public list with an exact deepEqual instead of a fuzzy
 * "contains".
 *
 * SAFETY: refuses any host other than localhost/127.0.0.1 and any database
 * name that does not look disposable, before a connection is opened. There
 * is no code path here that can reach a managed (Railway) database.
 *
 * TIMEZONE: the database is created with `timezone = 'UTC'`, matching the
 * Production server default. The public detail contract carries
 * `publishedAt` as Postgres' own timestamptz TEXT rendering
 * ("2026-07-18 00:00:00+00"), which depends on the session timezone; a
 * developer machine running in Africa/Cairo would otherwise render
 * "+03" and the golden comparison would be testing the laptop, not the code.
 */
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

type Queryable = { query: (text: string, values?: unknown[]) => Promise<{ rows: any[] }> };
type PoolLike = Queryable & { connect: () => Promise<Queryable & { release: () => void }> };

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const GOLDEN_DIR = path.join(HERE, "unified-cms-golden");
const MIGRATIONS_DIR = path.resolve(HERE, "../../../../../lib/db/migrations");

export function goldenJson<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(path.join(GOLDEN_DIR, name), "utf8")) as T;
}

export function disposableUrl(dbName: string): string {
  const url = `postgres://localhost:5432/${dbName}`;
  const parsed = new URL(url);
  if (parsed.hostname !== "localhost" && parsed.hostname !== "127.0.0.1") throw new Error("Refusing: not localhost");
  if (!/disposable/i.test(parsed.pathname)) throw new Error(`Refusing: "${dbName}" does not look disposable`);
  if (/rlwy\.net|railway/i.test(url)) throw new Error("Refusing: looks like Railway");
  return url;
}

/**
 * DROP + CREATE the database through the local `psql` client (the
 * api-server package has no direct `pg` dependency, and the app pool can
 * only be created once DATABASE_URL points at the database that this call
 * creates). Call BEFORE importing @workspace/db.
 */
export function recreateDisposableDb(dbName: string): string {
  const url = disposableUrl(dbName);
  const run = (sql: string) => execFileSync("psql", ["-h", "localhost", "-p", "5432", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-qAtc", sql], { stdio: "pipe" });
  run(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  run(`CREATE DATABASE "${dbName}"`);
  run(`ALTER DATABASE "${dbName}" SET timezone TO 'UTC'`);
  return url;
}

/** Apply every migration in lib/db/migrations with the real drizzle migrator (the same one migrate.ts uses). */
export async function migrateWithPool(pool: PoolLike, options: { throughTag?: string } = {}): Promise<void> {
  const { drizzle } = await import("drizzle-orm/node-postgres");
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  const folder = options.throughTag ? truncatedMigrationsFolder(options.throughTag) : MIGRATIONS_DIR;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await migrate(drizzle(pool as any), { migrationsFolder: folder });
}

/**
 * A temp copy of lib/db/migrations whose journal stops at `throughTag`, so a
 * test can build the schema exactly as Production has it BEFORE a new
 * migration, seed real rows, and then apply the rest with the real migrator.
 */
function truncatedMigrationsFolder(throughTag: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "unified-cms-migrations-"));
  cpSync(MIGRATIONS_DIR, dir, { recursive: true });
  const journalPath = path.join(dir, "meta", "_journal.json");
  const journal = JSON.parse(readFileSync(journalPath, "utf8")) as { entries: Array<{ tag: string }> };
  const cut = journal.entries.findIndex((entry) => entry.tag === throughTag);
  if (cut < 0) throw new Error(`unknown migration tag ${throughTag}`);
  journal.entries = journal.entries.slice(0, cut + 1);
  writeFileSync(journalPath, JSON.stringify(journal, null, 2));
  return dir;
}

const SEED_ORDER = [
  "editorial_languages",
  "editorial_topics",
  "editorial_authors",
  "website_news_posts",
  "website_performances",
  "editorial_posts",
  "editorial_post_translations",
  "editorial_post_topics",
  "editorial_post_relations",
  "editorial_placements",
] as const;

/** Insert the captured rows verbatim (column-for-column), then fix sequences. */
export async function seedGoldenRows(pool: PoolLike): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const table of [...SEED_ORDER].reverse()) await client.query(`DELETE FROM "${table}"`);
    for (const table of SEED_ORDER) {
      const { rows: cols } = await client.query(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
        [table],
      );
      const types = new Map<string, string>(cols.map((c: { column_name: string; data_type: string }) => [c.column_name, c.data_type]));
      const rows = goldenJson<Array<Record<string, unknown>>>(`rows_${table}.json`);
      for (const row of rows) {
        const keys = Object.keys(row);
        for (const key of keys) if (!types.has(key)) throw new Error(`fixture column ${table}.${key} not in schema`);
        const values = keys.map((key) => (types.get(key) === "jsonb" || types.get(key) === "json") && row[key] !== null ? JSON.stringify(row[key]) : row[key]);
        await client.query(
          `INSERT INTO "${table}" (${keys.map((k) => `"${k}"`).join(", ")}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(", ")})`,
          values,
        );
      }
      await client.query(`SELECT setval(pg_get_serial_sequence('"${table}"', 'id'), GREATEST((SELECT max(id) FROM "${table}"), 1))`);
    }
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}
