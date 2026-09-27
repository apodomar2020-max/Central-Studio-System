/**
 * Real-I/O entry point for the News → Editorial migration CLI (Final
 * Editorial, Phase B). Thin: parsing, safety guards, mode dispatch and
 * formatting all live in `newsMigrationCli.ts` and are unit-tested there
 * with injected fakes. This file only wires real dependencies.
 *
 * ─── READ-ONLY MODES ARE READ-ONLY AT THE DATABASE, NOT BY CONVENTION ────
 *
 * `dry-run`, `verify` and `rollback-dry-run` each run inside a real
 * transaction that issues `SET TRANSACTION READ ONLY` as its first
 * statement. A mutation attempted anywhere inside their query path is then
 * rejected by Postgres itself — not merely absent from this code. That
 * matters because the planner they share is also called by `execute`,
 * where writes are legitimate: the read-only claim is enforced at the
 * boundary rather than by inspecting which functions get called.
 *
 * ─── EXECUTE'S TRANSACTION SHAPE ─────────────────────────────────────────
 *
 * `execute` does NOT wrap everything in one transaction. It hands the
 * writer a runner that opens ONE transaction PER LEGACY POST — see
 * newsMigrationWriter.ts for why that is the right unit — so an
 * interrupted run leaves every completed post committed and is resumed
 * simply by running it again.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readFileSync } from "node:fs";
import { promisify as promisifyFs } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import type { DbClient } from "../lib/dbTypes";
import {
  EXIT_UNKNOWN_ERROR,
  runNewsMigrationCli,
  type CliDeps,
} from "./newsMigrationCli";
import type { GitState } from "./financeBackfillDryRunCli";
import { planNewsMigration } from "../lib/newsMigrationPlanner";
import { verifyNewsMigration } from "../lib/newsMigrationVerify";
import { planNewsMigrationRollback } from "../lib/newsMigrationRollback";
import { deleteMigratedPosts, executeNewsMigration } from "../lib/newsMigrationWriter";

const execFileAsync = promisify(execFile);
const readFileAsync = promisifyFs(readFile);

async function getRealGitState(): Promise<GitState> {
  try {
    const { stdout: commitOut } = await execFileAsync("git", ["rev-parse", "HEAD"]);
    const commit = commitOut.trim();
    if (!commit) return { commit: null, dirty: null };
    const { stdout: statusOut } = await execFileAsync("git", ["status", "--porcelain"]);
    return { commit, dirty: statusOut.trim().length > 0 };
  } catch {
    return { commit: null, dirty: null };
  }
}

/** Every read-only mode goes through here. See the header. */
async function readOnly<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return fn(tx as unknown as DbClient);
  });
}

async function main(): Promise<void> {
  const deps: CliDeps = {
    readManifestFile: async (path) => (await readFileAsync(path, "utf8")) as string,
    getEnv: (key) => process.env[key],
    getGitState: getRealGitState,

    runDryRun: (manifest) => readOnly((tx) => planNewsMigration(tx, manifest)),
    runVerify: (manifest) => readOnly((tx) => verifyNewsMigration(tx, manifest)),
    runRollbackDryRun: (manifest, includeEdited) =>
      readOnly((tx) => planNewsMigrationRollback(tx, manifest, { includeEdited })),

    runExecute: async (manifest) => {
      // Planned in its OWN read-only transaction first, so the plan the
      // writer acts on is the same one the operator just confirmed.
      const plan = await readOnly((tx) => planNewsMigration(tx, manifest));
      const result = await executeNewsMigration(
        // ONE transaction per legacy post. Not one for the whole run.
        (fn) => db.transaction(async (tx) => fn(tx as unknown as DbClient)),
        plan,
        manifest,
      );
      return { plan, result };
    },

    runRollback: async (manifest, includeEdited) => {
      const report = await readOnly((tx) =>
        planNewsMigrationRollback(tx, manifest, { includeEdited }),
      );
      const deleted = await db.transaction(async (tx) =>
        deleteMigratedPosts(tx as unknown as DbClient, report.deletablePostIds),
      );
      return { report, deleted };
    },

    requestConfirmation: async (phrase) => {
      // Read from a SEPARATE stdin prompt, never from an argv flag: a flag
      // can be pasted into a script once and re-run forever by something
      // that has forgotten what it does.
      process.stderr.write(`Type exactly "${phrase}" to proceed, or anything else to abort: `);
      return readFileSync(0, "utf8").trim() === phrase;
    },

    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  };

  await runNewsMigrationCli(process.argv.slice(2), deps);
}

main()
  .catch((err) => {
    console.error(
      JSON.stringify({
        errorCode: "unknown_error",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exitCode = EXIT_UNKNOWN_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
