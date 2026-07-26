/**
 * Finance Phase 2D-2 — batch lifecycle service.
 *
 * Owns every state transition on payment_backfill_batches. Reads/writes
 * ONLY payment_backfill_batches and payment_backfill_progress_items —
 * never payment_records, payment_events, payment_refunds, or any source
 * table (package_orders/bookings/attendance/credit_transactions). No
 * caller of this module can create a Finance record, event, credit,
 * notification, or push — there is no code path here that touches those
 * tables at all.
 *
 * Concurrency: every transition locks the target row with `FOR UPDATE`
 * inside the caller's transaction, re-validates the transition against the
 * ACTUAL locked row (not a pre-transaction read), and returns a controlled
 * discriminated-union result — never a raw DB/constraint error. Two
 * concurrent callers attempting the same transition serialize on the row
 * lock; the second sees the already-updated row and returns the correct
 * idempotent/forbidden outcome, never double-applies the transition.
 *
 * "running" is control-state only in this phase — startBatch does not,
 * and cannot, process a single source row. No writer exists yet.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  paymentBackfillBatchesTable,
  paymentBackfillProgressItemsTable,
  type PaymentBackfillBatch,
} from "@workspace/db";
import {
  planTransition,
  BatchTransitionError,
  type BatchStatus,
} from "./financeBackfillBatchStateMachine";
import {
  fingerprintFromReport,
  scopeKeyFromFilters,
  type BoundEvidence,
} from "./financeBackfillEvidence";
import type { DryRunFilters, DryRunReport } from "./financeBackfillDryRun";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const POSTGRES_UNIQUE_VIOLATION = "23505";
const POSTGRES_CHECK_VIOLATION = "23514";

function pgErrorCode(err: unknown): string | undefined {
  // drizzle-orm wraps the real pg driver error as a "Failed query" Error
  // with the actual pg error (and its .code) on .cause, not on the
  // top-level error itself.
  if (err && typeof err === "object") {
    if ("code" in err && (err as { code: unknown }).code != null) {
      return String((err as { code: unknown }).code);
    }
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) {
      return String((cause as { code: unknown }).code);
    }
  }
  return undefined;
}

// ── Create batch ─────────────────────────────────────────────────────────────

export interface CreateBatchParams {
  createdBy: string;
  scope: DryRunFilters;
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
}

export type CreateBatchResult =
  | { kind: "created"; batch: PaymentBackfillBatch }
  | { kind: "overlapping_active_batch" };

/**
 * Creates only a batch control row — no Finance/source table is touched.
 * Concurrency: relies on the partial unique index on scope_key (active
 * statuses only), not a pre-insert existence check — a 23505 on that
 * specific index is caught and translated to "overlapping_active_batch",
 * never a raw 500. Two concurrent creates for the same scope always leave
 * exactly one row behind.
 */
export async function createBatch(tx: Tx, params: CreateBatchParams): Promise<CreateBatchResult> {
  const scopeKey = scopeKeyFromFilters(params.scope, params.expectedClassifierVersion, params.expectedCodeCommit);

  try {
    const [batch] = await tx
      .insert(paymentBackfillBatchesTable)
      .values({
        status: "created",
        createdBy: params.createdBy,
        sourceMainCommit: params.expectedCodeCommit,
        classifierVersion: params.expectedClassifierVersion,
        filters: params.scope,
        maxRows: params.scope.maxRows,
        batchSize: params.scope.batchSize,
        scopeKey,
      })
      .returning();
    return { kind: "created", batch };
  } catch (err) {
    if (pgErrorCode(err) === POSTGRES_UNIQUE_VIOLATION) {
      return { kind: "overlapping_active_batch" };
    }
    throw err;
  }
}

// ── Attach dry-run evidence ──────────────────────────────────────────────────

export type AttachEvidenceResult =
  | { kind: "attached"; batch: PaymentBackfillBatch }
  | { kind: "not_found" }
  | { kind: "wrong_state"; actualStatus: BatchStatus }
  | { kind: "scope_mismatch"; reason: "classifier_version" | "code_commit" | "filters" };

/** Recursively sorts object keys — jsonb does not preserve key insertion order on round-trip. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

function filtersEquivalent(a: DryRunFilters, b: DryRunFilters): boolean {
  // Cursor position legitimately differs run-to-run (resuming a scan is not
  // a scope change) — every other field must match exactly. Compared via a
  // canonical (sorted-key) form because `a` may have round-tripped through
  // a jsonb column, whose key order is not guaranteed to match insertion
  // order.
  const strip = (f: DryRunFilters) => ({ ...f, cursors: undefined });
  return JSON.stringify(canonicalize(strip(a))) === JSON.stringify(canonicalize(strip(b)));
}

/**
 * Requires the batch to be exactly "created" and the report's classifier
 * version / code commit / scope to exactly match what was declared at
 * batch creation. Stores the aggregate-only evidence and deterministic
 * fingerprint; never a source row.
 */
export async function attachDryRunEvidence(
  tx: Tx,
  batchId: string,
  report: DryRunReport,
): Promise<AttachEvidenceResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillBatchesTable)
    .where(eq(paymentBackfillBatchesTable.id, batchId))
    .for("update");
  if (!locked) return { kind: "not_found" };

  if (locked.status !== "created") {
    return { kind: "wrong_state", actualStatus: locked.status as BatchStatus };
  }
  if (locked.classifierVersion !== report.classifierVersion) {
    return { kind: "scope_mismatch", reason: "classifier_version" };
  }
  if (locked.sourceMainCommit !== report.codeCommit) {
    return { kind: "scope_mismatch", reason: "code_commit" };
  }
  if (!locked.filters || !filtersEquivalent(locked.filters as DryRunFilters, report.appliedFilters)) {
    return { kind: "scope_mismatch", reason: "filters" };
  }

  const fingerprint = fingerprintFromReport(report);
  const evidenceAggregate: BoundEvidence["aggregateCounts"] = {
    scannedCount: report.scannedCount,
    classifiedCount: report.classifiedCount,
    truncated: report.truncated,
    eligibilityCounts: report.aggregates.eligibilityCounts,
    classificationCounts: report.aggregates.classificationCounts,
    evidenceClassCounts: report.aggregates.evidenceClassCounts,
    amountAvailabilityCounts: report.aggregates.amountAvailabilityCounts,
    reasonCodeCounts: report.aggregates.reasonCodeCounts,
    warningCodeCounts: report.aggregates.warningCodeCounts,
    alreadyCanonicalCount: report.aggregates.alreadyCanonicalCount,
    manualReviewCount: report.aggregates.manualReviewCount,
    excludedCount: report.aggregates.excludedCount,
    corruptCount: report.aggregates.corruptCount,
    estimatedOnlyCount: report.aggregates.estimatedOnlyCount,
    unknownAmountCount: report.aggregates.unknownAmountCount,
    legacyPendingCount: report.aggregates.legacyPendingCount,
    exactEligibleCount: report.aggregates.automaticExactCount,
  };

  const [updated] = await tx
    .update(paymentBackfillBatchesTable)
    .set({
      status: "dry_run_completed",
      reportSchemaVersion: report.reportSchemaVersion,
      evidenceFingerprint: fingerprint,
      evidenceAggregate,
    })
    .where(and(eq(paymentBackfillBatchesTable.id, batchId), eq(paymentBackfillBatchesTable.status, "created")))
    .returning();

  if (!updated) {
    // Lost the race between the lock read and the guarded update (should be
    // unreachable given the FOR UPDATE lock above, but never trust that a
    // second layer of guard is redundant with a financial control row).
    const [current] = await tx.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
    return { kind: "wrong_state", actualStatus: (current?.status ?? "created") as BatchStatus };
  }
  return { kind: "attached", batch: updated };
}

// ── Approve batch ─────────────────────────────────────────────────────────────

export interface ApproveBatchParams {
  approvedBy: string;
  expectedFingerprint: string;
  expectedEligibleCount: number;
  maxExecutionCount: number;
}

export type ApproveBatchResult =
  | { kind: "approved"; batch: PaymentBackfillBatch }
  | { kind: "not_found" }
  | { kind: "wrong_state"; actualStatus: BatchStatus }
  | { kind: "stale_fingerprint" };

export async function approveBatch(tx: Tx, batchId: string, params: ApproveBatchParams): Promise<ApproveBatchResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillBatchesTable)
    .where(eq(paymentBackfillBatchesTable.id, batchId))
    .for("update");
  if (!locked) return { kind: "not_found" };

  if (locked.status === "approved") {
    // Idempotent re-approval is only safe if the fingerprint still matches
    // what was already approved — otherwise this is a stale/forged retry.
    if (locked.evidenceFingerprint !== params.expectedFingerprint) return { kind: "stale_fingerprint" };
    return { kind: "approved", batch: locked };
  }
  if (locked.status !== "dry_run_completed") {
    return { kind: "wrong_state", actualStatus: locked.status as BatchStatus };
  }
  if (locked.evidenceFingerprint !== params.expectedFingerprint) {
    return { kind: "stale_fingerprint" };
  }

  const [updated] = await tx
    .update(paymentBackfillBatchesTable)
    .set({
      status: "approved",
      approvedBy: params.approvedBy,
      approvedAt: new Date().toISOString(),
      expectedEligibleCount: params.expectedEligibleCount,
      maxExecutionCount: params.maxExecutionCount,
    })
    .where(and(eq(paymentBackfillBatchesTable.id, batchId), eq(paymentBackfillBatchesTable.status, "dry_run_completed")))
    .returning();

  if (!updated) {
    const [current] = await tx.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
    return { kind: "wrong_state", actualStatus: (current?.status ?? "dry_run_completed") as BatchStatus };
  }
  return { kind: "approved", batch: updated };
}

// ── Generic control transitions (start / pause / resume / cancel / fail) ────

export type ControlTransitionResult =
  | { kind: "transitioned"; batch: PaymentBackfillBatch; noop: boolean }
  | { kind: "not_found" }
  | { kind: "forbidden"; reason: string };

async function applyControlTransition(
  tx: Tx,
  batchId: string,
  action: "start" | "pause" | "resume" | "cancel" | "fail",
  extraSet: Partial<typeof paymentBackfillBatchesTable.$inferInsert>,
): Promise<ControlTransitionResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillBatchesTable)
    .where(eq(paymentBackfillBatchesTable.id, batchId))
    .for("update");
  if (!locked) return { kind: "not_found" };

  let plan;
  try {
    plan = planTransition(locked.status as BatchStatus, action);
  } catch (err) {
    if (err instanceof BatchTransitionError) return { kind: "forbidden", reason: err.code };
    throw err;
  }

  if (plan.noop) return { kind: "transitioned", batch: locked, noop: true };

  try {
    const [updated] = await tx
      .update(paymentBackfillBatchesTable)
      .set({ status: plan.toStatus, ...extraSet })
      .where(and(eq(paymentBackfillBatchesTable.id, batchId), eq(paymentBackfillBatchesTable.status, locked.status)))
      .returning();

    if (!updated) {
      const [current] = await tx.select().from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
      return { kind: "forbidden", reason: `concurrent status change to "${current?.status}"` };
    }
    return { kind: "transitioned", batch: updated, noop: false };
  } catch (err) {
    if (pgErrorCode(err) === POSTGRES_CHECK_VIOLATION) {
      return { kind: "forbidden", reason: "shape_constraint_violation" };
    }
    throw err;
  }
}

export async function startBatch(tx: Tx, batchId: string): Promise<ControlTransitionResult> {
  return applyControlTransition(tx, batchId, "start", {});
}

export async function pauseBatch(tx: Tx, batchId: string): Promise<ControlTransitionResult> {
  return applyControlTransition(tx, batchId, "pause", { pausedAt: new Date().toISOString() });
}

export async function resumeBatch(tx: Tx, batchId: string): Promise<ControlTransitionResult> {
  return applyControlTransition(tx, batchId, "resume", {});
}

export async function cancelBatch(tx: Tx, batchId: string, cancelledBy: string): Promise<ControlTransitionResult> {
  return applyControlTransition(tx, batchId, "cancel", {
    cancelledBy,
    cancelledAt: new Date().toISOString(),
  });
}

export async function failBatch(tx: Tx, batchId: string, reason: string): Promise<ControlTransitionResult> {
  const [existing] = await tx.select({ notes: paymentBackfillBatchesTable.notes }).from(paymentBackfillBatchesTable).where(eq(paymentBackfillBatchesTable.id, batchId));
  const appendedNote = `[failed] ${reason}`;
  const notes = existing?.notes ? `${existing.notes}\n${appendedNote}` : appendedNote;
  return applyControlTransition(tx, batchId, "fail", {
    finishedAt: new Date().toISOString(),
    notes,
  });
}

export type CompleteBatchResult = ControlTransitionResult | { kind: "incomplete_progress"; pendingCount: number };

/**
 * Completion requires every attached progress item to have already been
 * dispositioned (nothing left in "pending") — Phase 2D-2 has no writer, so
 * "complete" can never mean "finished executing", only "finished
 * classifying/reviewing everything in scope".
 */
export async function completeBatch(tx: Tx, batchId: string): Promise<CompleteBatchResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillBatchesTable)
    .where(eq(paymentBackfillBatchesTable.id, batchId))
    .for("update");
  if (!locked) return { kind: "not_found" };

  if (locked.status === "completed") return { kind: "transitioned", batch: locked, noop: true };
  if (locked.status !== "running") return { kind: "forbidden", reason: "forbidden_transition" };

  const pending = await tx
    .select({ id: paymentBackfillProgressItemsTable.id })
    .from(paymentBackfillProgressItemsTable)
    .where(
      and(
        eq(paymentBackfillProgressItemsTable.batchId, batchId),
        eq(paymentBackfillProgressItemsTable.status, "pending"),
      ),
    );
  if (pending.length > 0) return { kind: "incomplete_progress", pendingCount: pending.length };

  const [updated] = await tx
    .update(paymentBackfillBatchesTable)
    .set({ status: "completed", finishedAt: new Date().toISOString() })
    .where(and(eq(paymentBackfillBatchesTable.id, batchId), eq(paymentBackfillBatchesTable.status, "running")))
    .returning();

  if (!updated) return { kind: "forbidden", reason: "concurrent status change" };
  return { kind: "transitioned", batch: updated, noop: false };
}
