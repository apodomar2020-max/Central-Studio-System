/**
 * Real-I/O entry point for the Finance Phase 2D-4 production read-only
 * dry-run CLI. Thin — all logic lives in
 * financeBackfillProductionDryRunCli.ts and is unit-tested there with
 * injected fakes. Invoked by `pnpm run finance:backfill:production-dry-run`.
 *
 * Read-only transaction: the planner runs inside a real Postgres
 * `db.transaction()` with `SET TRANSACTION READ ONLY` issued first (a
 * mutation attempted anywhere inside is rejected by Postgres itself), and
 * additionally sets `default_transaction_read_only = on` for the session as
 * a second, independent layer of DB-level enforcement.
 */
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { runFinanceBackfillDryRun, type DbLike } from "../lib/financeBackfillDryRun";
import { runProductionDryRunCli, EXIT_PLANNER_ERROR } from "./financeBackfillProductionDryRunCli";

async function runDryRunReadOnly(filters: Parameters<typeof runFinanceBackfillDryRun>[0]) {
  await pool.query("SET SESSION default_transaction_read_only = on");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return runFinanceBackfillDryRun(filters, tx as unknown as DbLike);
  });
}

async function main(): Promise<void> {
  await runProductionDryRunCli(process.argv.slice(2), {
    getEnv: (key) => process.env[key],
    runDryRun: runDryRunReadOnly,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  });
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ errorCode: "unknown_error", message: "the production dry-run failed to start" }));
    void err;
    process.exitCode = EXIT_PLANNER_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
