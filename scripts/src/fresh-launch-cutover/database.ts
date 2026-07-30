import pg from "pg";
import type { PoolClient } from "pg";

const { Pool } = pg;

export function createPool(connectionString: string): pg.Pool {
  return new Pool({
    connectionString,
    max: 2,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 60_000,
    application_name: "central-studio-fresh-launch-rehearsal",
  });
}

export async function withReadOnlyTransaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET TRANSACTION READ ONLY");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
    const result = await work(client);
    await client.query("ROLLBACK");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function withImportTransaction<T>(pool: pg.Pool, work: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL statement_timeout = '60s'");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("SET LOCAL idle_in_transaction_session_timeout = '120s'");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export function quoteIdent(value: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) throw new Error("UNSAFE_SQL_IDENTIFIER");
  return `"${value}"`;
}

export async function listColumns(client: PoolClient, table: string): Promise<string[]> {
  const result = await client.query<{ column_name: string }>(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1 ORDER BY ordinal_position`,
    [table],
  );
  if (result.rows.length === 0) throw new Error(`MANIFEST_TABLE_MISSING:${table}`);
  return result.rows.map((row) => row.column_name);
}

export async function latestMigration(client: PoolClient): Promise<string> {
  const registry = await client.query<{ migration_table: string | null }>(
    `SELECT to_regclass('drizzle.__drizzle_migrations')::text AS migration_table`,
  );
  if (registry.rows[0]?.migration_table) {
    const result = await client.query<{ name: string }>(
      `SELECT name FROM drizzle.__drizzle_migrations ORDER BY id DESC LIMIT 1`,
    );
    return result.rows[0]?.name ?? "unknown";
  }
  const phaseMarker = await client.query<{ present: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema='public' AND table_name='attendance' AND column_name='attendance_source'
     ) AS present`,
  );
  return phaseMarker.rows[0]?.present ? "0091_participant_aware_attendance" : "unknown";
}
