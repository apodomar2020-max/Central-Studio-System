/**
 * Real-I/O entry point for the Finance Phase 2D-1C dry-run CLI. Thin: all
 * actual logic (parsing, safety guards, formatting) lives in
 * financeBackfillDryRunCli.ts and is unit-tested there with injected fakes.
 * This file only wires real dependencies and is invoked directly by
 * `pnpm run finance:backfill:dry-run` — see package.json.
 *
 * Read-only transaction: the planner is invoked inside a real Postgres
 * `db.transaction()` with `SET TRANSACTION READ ONLY` issued first, so a
 * mutation attempted anywhere inside the dry-run's query path is rejected
 * by Postgres itself, not merely by this codebase's own conventions.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import { runFinanceBackfillDryRun, type DbLike } from "../lib/financeBackfillDryRun";
import { runCli, EXIT_UNKNOWN_ERROR, type GitState } from "./financeBackfillDryRunCli";

const execFileAsync = promisify(execFile);

async function getRealGitState(): Promise<GitState> {
  try {
    const { stdout: commitOut } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    const commit = commitOut.trim();
    if (!commit) return { commit: null, dirty: null };

    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"]);
    const dirty = statusOut.trim().length > 0;
    return { commit, dirty };
  } catch {
    return { commit: null, dirty: null };
  }
}

async function runDryRunReadOnly(filters: Parameters<typeof runFinanceBackfillDryRun>[0]) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return runFinanceBackfillDryRun(filters, tx as unknown as DbLike);
  });
}

async function main(): Promise<void> {
  await runCli(process.argv.slice(2), {
    runDryRun: runDryRunReadOnly,
    getEnv: (key) => process.env[key],
    getGitState: getRealGitState,
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  });
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ errorCode: "unknown_error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = EXIT_UNKNOWN_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
