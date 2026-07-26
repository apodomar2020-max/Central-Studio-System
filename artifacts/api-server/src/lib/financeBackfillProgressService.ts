/**
 * Finance Phase 2D-2 — per-source progress persistence.
 *
 * Owns payment_backfill_progress_items only — never a Finance/source table.
 * No function in this module can set a row to "succeeded" or "processing":
 * both are rejected by the table's own CHECK constraint (defense in depth
 * matching financeBackfillProgressItems.ts's schema doc), so even a caller
 * bug cannot fake a completed Finance write here.
 */
import { and, eq, sql } from "drizzle-orm";
import { db, paymentBackfillProgressItemsTable, type PaymentBackfillProgressItem } from "@workspace/db";
import type { FinanceBackfillClassification } from "./financeBackfillClassifier";
import type { SourceFamily } from "./financeBackfillDryRun";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

const POSTGRES_UNIQUE_VIOLATION = "23505";

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

/** Maps a classifier eligibility/classification pair to the progress-item status vocabulary. */
export function progressStatusForClassification(c: Pick<FinanceBackfillClassification, "eligibility">): string {
  switch (c.eligibility) {
    case "already_canonical": return "already_canonical";
    case "manual_review": return "manual_review";
    case "excluded": return "excluded";
    case "corrupt": return "corrupt";
    case "automatic_exact": return "eligible_not_executed"; // no writer yet — never "succeeded"
    default: return "pending";
  }
}

export interface UpsertProgressItemParams {
  batchId: string;
  sourceFamily: SourceFamily;
  sourceId: number;
  classifierVersion: string;
  codeCommit: string;
  classification: FinanceBackfillClassification;
}

export type UpsertProgressItemResult =
  | { kind: "created"; item: PaymentBackfillProgressItem }
  | { kind: "already_exists"; item: PaymentBackfillProgressItem; identical: boolean };

/**
 * Deterministic identity: (batchId, sourceFamily, sourceId). Idempotent —
 * calling this twice with identical classification data for the same
 * identity returns the existing row unchanged ("already_exists",
 * identical: true) rather than creating a duplicate or erroring. A second
 * call with DIFFERENT classification data for the same identity also
 * returns the existing row (the service never silently overwrites
 * conflicting evidence) with identical: false, so the caller can decide
 * how to handle drift.
 */
export async function upsertProgressItem(tx: Tx, params: UpsertProgressItemParams): Promise<UpsertProgressItemResult> {
  const status = progressStatusForClassification(params.classification);

  try {
    // Nested tx.transaction() = a SAVEPOINT: if the insert hits the unique
    // violation, only this savepoint rolls back, not the caller's whole
    // transaction — otherwise Postgres would abort the entire transaction
    // and the fallback SELECT below would itself fail with 25P02
    // ("current transaction is aborted").
    const item = await tx.transaction(async (tx2) => {
      const [inserted] = await tx2
        .insert(paymentBackfillProgressItemsTable)
        .values({
          batchId: params.batchId,
          sourceFamily: params.sourceFamily,
          sourceId: params.sourceId,
          classifierVersion: params.classifierVersion,
          codeCommit: params.codeCommit,
          classificationCode: params.classification.classificationCode,
          eligibility: params.classification.eligibility,
          status,
        })
        .returning();
      return inserted;
    });
    return { kind: "created", item };
  } catch (err) {
    if (pgErrorCode(err) !== POSTGRES_UNIQUE_VIOLATION) throw err;

    const [existing] = await tx
      .select()
      .from(paymentBackfillProgressItemsTable)
      .where(
        and(
          eq(paymentBackfillProgressItemsTable.batchId, params.batchId),
          eq(paymentBackfillProgressItemsTable.sourceFamily, params.sourceFamily),
          eq(paymentBackfillProgressItemsTable.sourceId, params.sourceId),
        ),
      );
    if (!existing) throw err; // should be unreachable — the unique violation implies a matching row exists

    const identical =
      existing.classifierVersion === params.classifierVersion &&
      existing.codeCommit === params.codeCommit &&
      existing.classificationCode === params.classification.classificationCode &&
      existing.eligibility === params.classification.eligibility;
    return { kind: "already_exists", item: existing, identical };
  }
}

export type MarkFailedResult =
  | { kind: "marked"; item: PaymentBackfillProgressItem }
  | { kind: "not_found" }
  | { kind: "terminal"; actualStatus: string };

const PROGRESS_TERMINAL_STATUSES = new Set(["succeeded", "failed", "cancelled"]);

/** Records a failure reason and increments attempts. Never touches a Finance table. */
export async function markProgressItemFailed(
  tx: Tx,
  itemId: number,
  errorCode: string,
): Promise<MarkFailedResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillProgressItemsTable)
    .where(eq(paymentBackfillProgressItemsTable.id, itemId))
    .for("update");
  if (!locked) return { kind: "not_found" };
  if (PROGRESS_TERMINAL_STATUSES.has(locked.status)) {
    return { kind: "terminal", actualStatus: locked.status };
  }

  const [updated] = await tx
    .update(paymentBackfillProgressItemsTable)
    .set({
      status: "failed",
      lastErrorCode: errorCode,
      attempts: sql`${paymentBackfillProgressItemsTable.attempts} + 1`,
    })
    .where(eq(paymentBackfillProgressItemsTable.id, itemId))
    .returning();
  if (!updated) return { kind: "not_found" };
  return { kind: "marked", item: updated };
}

export type CancelProgressItemResult =
  | { kind: "cancelled"; item: PaymentBackfillProgressItem }
  | { kind: "not_found" }
  | { kind: "terminal"; actualStatus: string };

export async function cancelProgressItem(tx: Tx, itemId: number): Promise<CancelProgressItemResult> {
  const [locked] = await tx
    .select()
    .from(paymentBackfillProgressItemsTable)
    .where(eq(paymentBackfillProgressItemsTable.id, itemId))
    .for("update");
  if (!locked) return { kind: "not_found" };
  if (locked.status === "cancelled") return { kind: "cancelled", item: locked };
  if (PROGRESS_TERMINAL_STATUSES.has(locked.status)) return { kind: "terminal", actualStatus: locked.status };

  const [updated] = await tx
    .update(paymentBackfillProgressItemsTable)
    .set({ status: "cancelled" })
    .where(eq(paymentBackfillProgressItemsTable.id, itemId))
    .returning();
  if (!updated) return { kind: "not_found" };
  return { kind: "cancelled", item: updated };
}

export async function countProgressByStatus(tx: Tx, batchId: string): Promise<Record<string, number>> {
  const rows = await tx
    .select({ status: paymentBackfillProgressItemsTable.status, n: sql<number>`count(*)::int` })
    .from(paymentBackfillProgressItemsTable)
    .where(eq(paymentBackfillProgressItemsTable.batchId, batchId))
    .groupBy(paymentBackfillProgressItemsTable.status);
  const out: Record<string, number> = {};
  for (const row of rows) out[row.status] = row.n;
  return out;
}
