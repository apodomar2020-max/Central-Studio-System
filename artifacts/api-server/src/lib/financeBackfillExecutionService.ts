/**
 * Finance Phase 2D-3 — bounded chunk execution over writeExactEvidenceSource.
 *
 * Each source gets its OWN db.transaction() — never one large transaction
 * for a whole chunk/batch. Justification: a crash or forced stop mid-chunk
 * then only ever loses the CURRENT source's in-flight (uncommitted)
 * transaction; every source processed before it stays committed exactly as
 * written, and the very next source retried on resume re-locks the batch,
 * re-locks that source, and reclassifies fresh — so recovery never needs a
 * special code path, it is the same code path as a normal call.
 *
 * Before each source, the batch's current status is re-read (a fresh,
 * unlocked read — the per-source call takes its own lock) so a pause or
 * cancel issued mid-chunk is honoured before the next source starts, not
 * only at chunk boundaries.
 */
import { eq } from "drizzle-orm";
import { db, paymentBackfillBatchesTable } from "@workspace/db";
import {
  writeExactEvidenceSource,
  type WriteExactEvidenceSourceParams,
  type WriteExactEvidenceSourceResult,
  type ClassifierFns,
  type WritableSourceFamily,
} from "./financeBackfillWriter";
import type { BatchStatus } from "./financeBackfillBatchStateMachine";

export interface RunChunkParams {
  batchId: string;
  sourceFamily: WritableSourceFamily;
  sourceIds: number[];
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
  expectedEvidenceFingerprint: string;
  /** Hard cap on sources actually attempted this call, independent of sourceIds.length. */
  maxRows: number;
}

export interface ChunkOutcome {
  sourceId: number;
  result: WriteExactEvidenceSourceResult;
}

export interface RunChunkReport {
  attempted: number;
  written: number;
  alreadyCanonical: number;
  notEligible: number;
  duplicates: number;
  stoppedEarly:
    | { reason: "batch_not_running"; actualStatus: BatchStatus }
    | { reason: "batch_identity_or_source_error"; lastResult: WriteExactEvidenceSourceResult }
    | null;
  outcomes: ChunkOutcome[];
}

export async function runBatchChunk(params: RunChunkParams, classifierFns?: ClassifierFns): Promise<RunChunkReport> {
  if (!Number.isInteger(params.maxRows) || params.maxRows <= 0) {
    throw new Error("maxRows is required and must be a positive integer");
  }

  const outcomes: ChunkOutcome[] = [];
  let written = 0;
  let alreadyCanonical = 0;
  let notEligible = 0;
  let duplicates = 0;
  let stoppedEarly: RunChunkReport["stoppedEarly"] = null;

  const boundedIds = params.sourceIds.slice(0, params.maxRows);

  for (const sourceId of boundedIds) {
    const [batch] = await db
      .select({ status: paymentBackfillBatchesTable.status })
      .from(paymentBackfillBatchesTable)
      .where(eq(paymentBackfillBatchesTable.id, params.batchId));
    if (!batch || batch.status !== "running") {
      stoppedEarly = { reason: "batch_not_running", actualStatus: (batch?.status ?? "cancelled") as BatchStatus };
      break;
    }

    const writeParams: WriteExactEvidenceSourceParams = {
      batchId: params.batchId,
      sourceFamily: params.sourceFamily,
      sourceId,
      expectedClassifierVersion: params.expectedClassifierVersion,
      expectedCodeCommit: params.expectedCodeCommit,
      expectedEvidenceFingerprint: params.expectedEvidenceFingerprint,
    };

    const result = await db.transaction((tx) => writeExactEvidenceSource(tx, writeParams, classifierFns));
    outcomes.push({ sourceId, result });

    if (result.kind === "written") written += 1;
    else if (result.kind === "already_canonical") alreadyCanonical += 1;
    else if (result.kind === "not_eligible") notEligible += 1;
    else if (result.kind === "duplicate") duplicates += 1;
    else {
      // batch_not_found / batch_wrong_state / batch_identity_mismatch /
      // source_not_found: a hard stop condition for the whole chunk, not
      // just this row — the batch's own identity is no longer trustworthy.
      stoppedEarly = { reason: "batch_identity_or_source_error", lastResult: result };
      break;
    }
  }

  return {
    attempted: outcomes.length,
    written,
    alreadyCanonical,
    notEligible,
    duplicates,
    stoppedEarly,
    outcomes,
  };
}
