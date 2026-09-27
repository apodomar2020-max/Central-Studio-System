/**
 * Real-I/O entry point for the PRODUCTION READ-ONLY News → Editorial
 * migration operations (dry-run, verify, rollback-dry-run).
 * Final Editorial, Phase B.
 *
 * ─── READ-ONLY IS ENFORCED THREE TIMES, INDEPENDENTLY ────────────────────
 *
 *   1. This entrypoint declares the "read-only" capability, so the argument
 *      parser refuses `--mode execute` and `--mode rollback` outright —
 *      before a manifest is read or a connection is opened.
 *   2. `runExecute` / `runRollback` are wired to functions that THROW. Even
 *      if a future edit let a write mode through the parser, there is no
 *      writer reachable from this file: it does not import
 *      newsMigrationWriter at all.
 *   3. Every query runs inside a real `SET TRANSACTION READ ONLY`
 *      transaction, on a session that also has
 *      `default_transaction_read_only = on`. A mutation is rejected by
 *      Postgres itself, not by this code's good intentions.
 *
 * The read-only wrapper is the SAME one newsMigrationCli.entry.ts uses for
 * these three modes — deliberately not a second implementation of the idea.
 */
import { readFile } from "node:fs";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { db, pool } from "@workspace/db";
import type { DbClient } from "../lib/dbTypes";
import { planNewsMigration } from "../lib/newsMigrationPlanner";
import { verifyNewsMigration } from "../lib/newsMigrationVerify";
import { planNewsMigrationRollback } from "../lib/newsMigrationRollback";
import {
  EXIT_UNKNOWN_ERROR,
  runNewsMigrationProductionCli,
  type ProductionCliDeps,
} from "./newsMigrationProductionCli";

const readFileAsync = promisify(readFile);

async function readOnly<T>(fn: (tx: DbClient) => Promise<T>): Promise<T> {
  await pool.query("SET SESSION default_transaction_read_only = on");
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET TRANSACTION READ ONLY`);
    return fn(tx as unknown as DbClient);
  });
}

const unreachable = (): never => {
  throw new Error("unreachable: the production read-only command has no write capability");
};

async function main(): Promise<void> {
  const deps: ProductionCliDeps = {
    readManifestFile: async (path) => (await readFileAsync(path, "utf8")) as string,
    getEnv: (key) => process.env[key],

    runDryRun: (manifest) => readOnly((tx) => planNewsMigration(tx, manifest)),
    runVerify: (manifest) => readOnly((tx) => verifyNewsMigration(tx, manifest)),
    runRollbackDryRun: (manifest, includeEdited) =>
      readOnly((tx) => planNewsMigrationRollback(tx, manifest, { includeEdited })),

    runExecute: unreachable,
    runRollback: unreachable,
    // No read-only mode ever prompts: there is nothing to be sure about.
    requestConfirmation: unreachable,

    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  };

  await runNewsMigrationProductionCli(process.argv.slice(2), "read-only", deps);
}

main()
  .catch((err) => {
    void err;
    console.error(
      JSON.stringify({
        errorCode: "unknown_error",
        message: "the production read-only news migration command failed to start",
      }),
    );
    process.exitCode = EXIT_UNKNOWN_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
