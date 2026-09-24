/**
 * Real-I/O entry point for the PRODUCTION WRITE News → Editorial migration
 * operations (execute, rollback). Final Editorial, Phase B.
 *
 * ─── THIS COMMAND EXISTS SO THAT NOBODY EVER PATCHES A GUARD ─────────────
 *
 * The Phase B migration has to be run in production exactly once, and a
 * rollback has to be possible if it goes wrong. Without a designed path for
 * that, the day of the cutover would end with someone editing
 * `assertEnvironmentSafe` under pressure. This file is that designed path:
 * reviewed, tested and merged long before it is used, and used only with an
 * authorization that is explicit in the command line and spoken aloud at the
 * prompt.
 *
 * ─── WHAT IT DEMANDS, ALL OF IT, EVERY TIME ──────────────────────────────
 *
 *   * the write authorization flag (the read-only one is refused here);
 *   * `--environment production`;
 *   * the mode's own strong confirmation phrase in `--confirm`, distinct
 *     from the read-only phrase and from the other write mode's phrase;
 *   * positive Railway production proof — environment, project, service,
 *     `.railway.internal` database host, deployed commit === --expected-commit;
 *   * a manifest that parses under the strict schema;
 *   * for `execute`, a freshly-planned production plan with ZERO blockers;
 *   * a second confirmation typed at an interactive prompt, which argv
 *     cannot supply.
 *
 * Any one of these missing is a refusal, not a warning.
 *
 * ─── TRANSACTION SHAPE IS THE ENGINE'S, NOT THIS FILE'S ──────────────────
 *
 * Planning still happens inside a read-only transaction; `execute` still
 * uses ONE transaction PER LEGACY POST, so an interrupted production run
 * leaves every completed post committed and is resumed by running it again.
 * That is newsMigrationWriter.ts's decision and this file does not second-
 * guess it — it calls the same engine the local CLI and the integration
 * tests call.
 */
import { readFile, readFileSync } from "node:fs";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import type { DbClient } from "../lib/dbTypes";
import { planNewsMigration } from "../lib/newsMigrationPlanner";
import { planNewsMigrationRollback } from "../lib/newsMigrationRollback";
import { deleteMigratedPosts, executeNewsMigration } from "../lib/newsMigrationWriter";
import { verifyNewsMigration } from "../lib/newsMigrationVerify";
import {
  EXIT_UNKNOWN_ERROR,
  runNewsMigrationProductionCli,
  type ProductionCliDeps,
} from "./newsMigrationProductionCli";

const readFileAsync = promisify(readFile);

async function readOnly<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return fn(tx as unknown as DbClient);
  });
}

async function main(): Promise<void> {
  const deps: ProductionCliDeps = {
    readManifestFile: async (path) => (await readFileAsync(path, "utf8")) as string,
    getEnv: (key) => process.env[key],

    // Planning and previewing stay read-only even in the write command.
    runDryRun: (manifest) => readOnly((tx) => planNewsMigration(tx, manifest)),
    runVerify: (manifest) => readOnly((tx) => verifyNewsMigration(tx, manifest)),
    runRollbackDryRun: (manifest, includeEdited) =>
      readOnly((tx) => planNewsMigrationRollback(tx, manifest, { includeEdited })),

    runExecute: async (manifest) => {
      const plan = await readOnly((tx) => planNewsMigration(tx, manifest));
      const result = await executeNewsMigration(
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
      process.stderr.write(
        `PRODUCTION WRITE. Type exactly "${phrase}" to proceed, or anything else to abort: `,
      );
      return readFileSync(0, "utf8").trim() === phrase;
    },

    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  };

  await runNewsMigrationProductionCli(process.argv.slice(2), "write", deps);
}

main()
  .catch((err) => {
    void err;
    console.error(
      JSON.stringify({
        errorCode: "unknown_error",
        message: "the production write news migration command failed to start",
      }),
    );
    process.exitCode = EXIT_UNKNOWN_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
