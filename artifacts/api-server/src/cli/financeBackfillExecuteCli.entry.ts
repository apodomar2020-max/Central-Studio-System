/**
 * Real-I/O entry point for the Finance Phase 2D-3 execution CLI. Thin — all
 * logic lives in financeBackfillExecuteCli.ts and is unit-tested there with
 * injected fakes. This file wires real dependencies and is invoked directly
 * by `pnpm run finance:backfill:execute` — see package.json.
 *
 * As shipped, this CLI's environment guard is IDENTICAL to (reused from,
 * not reimplemented from) the read-only dry-run CLI: it refuses
 * `--environment production` and any non-local/managed database host,
 * unconditionally. That means, as released in this PR, this command cannot
 * reach production — by design, matching this phase's locked policy
 * ("production execution requires separate approval after dry-run", and
 * the explicit instruction not to weaken the dry-run CLI's own guards).
 * Enabling a real production run is a deliberate, separately-authorized
 * follow-up change, not something this entry point does.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync } from "node:fs";
import { db, pool, paymentBackfillBatchesTable } from "@workspace/db";
import { eq, and, ne } from "drizzle-orm";
import { runExecuteCli, EXIT_EXECUTION_ERROR, type ExecuteCliDeps, type GitState } from "./financeBackfillExecuteCli";
import { runFinanceBackfillDryRun } from "../lib/financeBackfillDryRun";
import { runBatchChunk } from "../lib/financeBackfillExecutionService";
import type { DryRunFilters } from "../lib/financeBackfillDryRun";

const execFileAsync = promisify(execFile);

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

async function main(): Promise<void> {
  const deps: ExecuteCliDeps = {
    getEnv: (key) => process.env[key],
    getGitState: getRealGitState,
    hasOverlappingActiveBatch: async (batchId) => {
      const [batch] = await db.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
      if (!batch?.scopeKey) return false;
      const overlapping = await db
        .select({ id: paymentBackfillBatchesTable.id })
        .from(paymentBackfillBatchesTable)
        .where(
          and(
            eq(paymentBackfillBatchesTable.scopeKey, batch.scopeKey),
            ne(paymentBackfillBatchesTable.id, batchId),
          ),
        );
      return overlapping.length > 0;
    },
    runDryRunForBatch: async (batchId) => {
      const [batch] = await db.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
      if (!batch?.filters) throw new Error("batch has no bound scope");
      return runFinanceBackfillDryRun(batch.filters as DryRunFilters);
    },
    getApprovedExpectedEligibleCount: async (batchId) => {
      const [batch] = await db.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
      return batch?.expectedEligibleCount ?? null;
    },
    requestSecondConfirmation: async () => {
      // Real second confirmation: re-reads the confirmation phrase from a
      // SEPARATE stdin prompt, never from an argv flag (a flag could be
      // scripted/automated — this is deliberately not scriptable that way).
      process.stderr.write("Type the confirmation phrase again to proceed, or anything else to abort: ");
      const line = readFileSync(0, "utf8").trim();
      return line === "EXECUTE HISTORICAL BACKFILL";
    },
    runChunk: async (batchId, maxRows, chunkSize) => {
      const [batch] = await db.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
      if (!batch?.filters) throw new Error("batch has no bound scope");
      const filters = batch.filters as DryRunFilters;
      const family = filters.sourceFamilies[0];
      if (family !== "bookings" && family !== "package_orders") {
        throw new Error(`unsupported writable source family: ${family}`);
      }
      // Source ID enumeration for a real chunk is intentionally out of
      // scope for Phase 2D-3's release session — see PR description.
      return runBatchChunk({
        batchId,
        sourceFamily: family,
        sourceIds: [],
        expectedClassifierVersion: batch.classifierVersion ?? "",
        expectedCodeCommit: batch.sourceMainCommit,
        expectedEvidenceFingerprint: batch.evidenceFingerprint ?? "",
        maxRows,
      });
    },
    stdout: (line) => console.log(line),
    stderr: (line) => console.error(line),
    exit: (code) => {
      process.exitCode = code;
    },
  };

  await runExecuteCli(process.argv.slice(2), deps);
}

main()
  .catch((err) => {
    console.error(JSON.stringify({ errorCode: "unknown_error", message: err instanceof Error ? err.message : String(err) }));
    process.exitCode = EXIT_EXECUTION_ERROR;
  })
  .finally(async () => {
    await pool.end();
  });
