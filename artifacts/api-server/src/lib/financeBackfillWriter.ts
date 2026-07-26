/**
 * Finance Phase 2D-3 — exact-evidence-only historical backfill writer.
 *
 * The ONLY code in this repository authorized to insert a payment_records
 * row with capture_origin='historical_backfill'. Locked policies (see
 * financeBackfillWriter.test.ts for the corresponding proofs):
 *
 *   1. A historical row is NEVER written with status='paid' — enforced both
 *      here (only ever inserts status='legacy_unverified') and structurally
 *      by payment_records_backfill_excludes_paid_waived_check.
 *   2. Writes exactly: one payment_records row (status='legacy_unverified',
 *      capture_origin='historical_backfill'), one payment_events row
 *      (event_type='legacy_created'). Nothing else — no 'confirmed' event,
 *      no activation_credits_issued, no paidAt, no confirmedPaymentMethod,
 *      no providerReference, no notification/push, no credit, no
 *      attendance, no refund, no source-table mutation.
 *   3. Writable ONLY for eligibility==='automatic_exact' AND
 *      isExactEvidenceEligible===true — estimated/unknown amounts,
 *      manual_review, excluded, corrupt, and already_canonical rows are
 *      never written. The classifier's own `writable` field stays
 *      hardcoded false (Phase 2D-1/2D-2 policy, unchanged); this writer
 *      makes its own independent authorization decision from `eligibility`
 *      and `isExactEvidenceEligible`, never by relying on `writable`.
 *   4. Reclassifies fresh, inside THIS transaction, against the currently
 *      locked source + currently locked existing payment_records rows —
 *      never reuses the batch's cached dry-run/approval-time classification,
 *      since source state may have changed since then.
 *   5. Idempotent by construction: payment_records' own unique constraints
 *      (flow_type, package_order_id) / (flow_type, booking_id) mean a
 *      retry — same batch OR a different batch — that reaches the insert
 *      step for an already-written source hits a real unique violation,
 *      which is translated to a controlled "duplicate" result, never a raw
 *      500. In practice this is rarely reached: the reclassify step (4)
 *      already sees the existing row and returns "already_canonical"
 *      before any insert is attempted.
 *   6. Concurrency: the SOURCE row (package_orders/bookings) is locked
 *      FOR UPDATE first — that lock is the serialization point. A second
 *      concurrent attempt at the same source blocks on that lock until the
 *      first transaction commits or rolls back, then re-reads and correctly
 *      observes the outcome (already_canonical or the same unique
 *      violation).
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  packageOrdersTable,
  bookingsTable,
  paymentRecordsTable,
  paymentEventsTable,
  paymentBackfillBatchesTable,
  paymentBackfillProgressItemsTable,
  type PaymentRecord,
  type PaymentEvent,
} from "@workspace/db";
import {
  classifyPackageOrder,
  classifyBooking,
  type FinanceBackfillClassification,
  type PaymentRecordSummaryInput,
} from "./financeBackfillClassifier";
import type { BatchStatus } from "./financeBackfillBatchStateMachine";
import { upsertProgressItem } from "./financeBackfillProgressService";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type WritableSourceFamily = "package_orders" | "bookings";

export interface WriteExactEvidenceSourceParams {
  batchId: string;
  sourceFamily: WritableSourceFamily;
  sourceId: number;
  /** Pinned identity the operator approved against — verified against the locked batch row. */
  expectedClassifierVersion: string;
  expectedCodeCommit: string;
  expectedEvidenceFingerprint: string;
}

export type WriteExactEvidenceSourceResult =
  | { kind: "written"; paymentRecord: PaymentRecord; event: PaymentEvent }
  | { kind: "already_canonical" }
  | { kind: "not_eligible"; classificationCode: string; eligibility: string }
  | { kind: "duplicate" }
  | { kind: "batch_not_found" }
  | { kind: "batch_wrong_state"; actualStatus: BatchStatus }
  | { kind: "batch_identity_mismatch"; reason: "classifier_version" | "code_commit" | "evidence_fingerprint" }
  | { kind: "source_not_found" };

const POSTGRES_UNIQUE_VIOLATION = "23505";

function pgErrorCode(err: unknown): string | undefined {
  if (err && typeof err === "object") {
    if ("code" in err && (err as { code: unknown }).code != null) return String((err as { code: unknown }).code);
    const cause = (err as { cause?: unknown }).cause;
    if (cause && typeof cause === "object" && "code" in cause) return String((cause as { code: unknown }).code);
  }
  return undefined;
}

async function fetchExistingRecords(tx: Tx, packageOrderId: number | null, bookingId: number | null): Promise<PaymentRecordSummaryInput[]> {
  const rows = await tx
    .select({
      id: paymentRecordsTable.id,
      flowType: paymentRecordsTable.flowType,
      packageOrderId: paymentRecordsTable.packageOrderId,
      bookingId: paymentRecordsTable.bookingId,
      status: paymentRecordsTable.status,
    })
    .from(paymentRecordsTable)
    .where(
      packageOrderId != null
        ? eq(paymentRecordsTable.packageOrderId, packageOrderId)
        : eq(paymentRecordsTable.bookingId, bookingId!),
    )
    .for("update");
  return rows;
}

export interface ClassifierFns {
  classifyPackageOrder: typeof classifyPackageOrder;
  classifyBooking: typeof classifyBooking;
}

/** The real, unmodified canonical classifier — the production default for every caller. */
const REAL_CLASSIFIER_FNS: ClassifierFns = { classifyPackageOrder, classifyBooking };

/**
 * Writes exactly one payment_records + payment_events row for ONE source,
 * or returns a controlled non-write outcome. Caller must invoke this inside
 * its own db.transaction() — this function does not open one itself, so a
 * chunk runner can bound each source to its own independent transaction
 * (see financeBackfillExecutionService.ts).
 *
 * `classifierFns` defaults to the real classifyPackageOrder/classifyBooking
 * — this is NOT a second classifier, only a seam so tests can exercise the
 * write path (locking, insert, event, progress, idempotency, concurrency)
 * against a constructed `automatic_exact` classification. In today's
 * schema, package_orders/bookings have no amount columns, so no real
 * classification ever reaches `automatic_exact`/`isExactEvidenceEligible`
 * (see financeBackfillClassifier.ts — `isExact` is hardcoded `false`,
 * and its own `computeIsExactEvidenceEligible` helper is never called).
 * That is a genuine, documented data limitation, not something this
 * writer works around: the production default always calls the real,
 * unmodified classifier.
 */
export async function writeExactEvidenceSource(
  tx: Tx,
  params: WriteExactEvidenceSourceParams,
  classifierFns: ClassifierFns = REAL_CLASSIFIER_FNS,
): Promise<WriteExactEvidenceSourceResult> {
  const [batch] = await tx
    .select()
    .from(paymentBackfillBatchesTable)
    .where(eq(paymentBackfillBatchesTable.id, params.batchId))
    .for("update");
  if (!batch) return { kind: "batch_not_found" };
  if (batch.status !== "running") {
    return { kind: "batch_wrong_state", actualStatus: batch.status as BatchStatus };
  }
  if (batch.classifierVersion !== params.expectedClassifierVersion) {
    return { kind: "batch_identity_mismatch", reason: "classifier_version" };
  }
  if (batch.sourceMainCommit !== params.expectedCodeCommit) {
    return { kind: "batch_identity_mismatch", reason: "code_commit" };
  }
  if (batch.evidenceFingerprint !== params.expectedEvidenceFingerprint) {
    return { kind: "batch_identity_mismatch", reason: "evidence_fingerprint" };
  }

  let classification: FinanceBackfillClassification;
  let flowType: "package_purchase" | "single_class_booking";
  let packageOrderId: number | null = null;
  let bookingId: number | null = null;
  let sourceCreatedAt: string;

  if (params.sourceFamily === "package_orders") {
    const [order] = await tx.select().from(packageOrdersTable).where(eq(packageOrdersTable.id, params.sourceId)).for("update");
    if (!order) return { kind: "source_not_found" };
    const existing = await fetchExistingRecords(tx, order.id, null);
    classification = classifierFns.classifyPackageOrder(
      { id: order.id, status: order.status, activatedAt: order.activatedAt, createdAt: order.createdAt, packageId: order.packageId },
      existing,
      null,
    );
    flowType = "package_purchase";
    packageOrderId = order.id;
    sourceCreatedAt = order.createdAt;
  } else {
    const [booking] = await tx.select().from(bookingsTable).where(eq(bookingsTable.id, params.sourceId)).for("update");
    if (!booking) return { kind: "source_not_found" };
    const existing = await fetchExistingRecords(tx, null, booking.id);
    const isStudioWalkinLinked = existing.some((e) => e.flowType === "studio_walkin");
    classification = classifierFns.classifyBooking(
      {
        id: booking.id,
        bookingStatus: booking.bookingStatus,
        paymentStatus: booking.paymentStatus,
        paymentMode: booking.paymentMode,
        scheduleId: booking.scheduleId,
        classId: booking.classId,
        balletScheduleId: booking.balletScheduleId,
        createdAt: booking.createdAt,
        isStudioWalkinLinked,
      },
      existing,
      null,
    );
    flowType = "single_class_booking";
    bookingId = booking.id;
    sourceCreatedAt = booking.createdAt;
  }

  if (classification.eligibility === "already_canonical") {
    await upsertProgressItem(tx, {
      batchId: params.batchId,
      sourceFamily: params.sourceFamily,
      sourceId: params.sourceId,
      classifierVersion: params.expectedClassifierVersion,
      codeCommit: params.expectedCodeCommit,
      classification,
    });
    return { kind: "already_canonical" };
  }

  // The single writability gate. Never derived from classification.writable
  // (permanently false — Phase 2D-1/2D-2 policy). Estimated/unknown
  // amounts, manual_review, excluded, corrupt: all fall through here.
  const isWritable = classification.eligibility === "automatic_exact" && classification.isExactEvidenceEligible === true && classification.amountAvailability === "exact";

  if (!isWritable) {
    await upsertProgressItem(tx, {
      batchId: params.batchId,
      sourceFamily: params.sourceFamily,
      sourceId: params.sourceId,
      classifierVersion: params.expectedClassifierVersion,
      codeCommit: params.expectedCodeCommit,
      classification,
    });
    return { kind: "not_eligible", classificationCode: classification.classificationCode, eligibility: classification.eligibility };
  }

  const idempotencyKey = `backfill:${params.batchId}:${params.sourceFamily}:${params.sourceId}`;
  const eventIdempotencyKey = `backfill-event:${params.batchId}:${params.sourceFamily}:${params.sourceId}`;

  try {
    const [record] = await tx
      .insert(paymentRecordsTable)
      .values({
        flowType,
        packageOrderId,
        bookingId,
        captureOrigin: "historical_backfill",
        backfillBatchId: params.batchId,
        occurredAt: sourceCreatedAt,
        evidenceClass: "legacy_operational_status",
        amountAvailability: "exact",
        amountSource: classification.amountSource,
        grossAmountMinor: classification.grossAmountMinor,
        discountAmountMinor: classification.discountAmountMinor,
        finalPayableAmountMinor: classification.finalPayableAmountMinor,
        paidAmountMinor: 0,
        refundedAmountMinor: 0,
        currency: "EGP",
        status: "legacy_unverified",
        creationIdempotencyKey: idempotencyKey,
      })
      .returning();

    const [event] = await tx
      .insert(paymentEventsTable)
      .values({
        paymentRecordId: record.id,
        eventType: "legacy_created",
        amountMinor: null,
        previousStatus: null,
        newStatus: "legacy_unverified",
        actorType: "system",
        reason: `Phase 2D-3 exact-evidence backfill — batch ${params.batchId}`,
        idempotencyKey: eventIdempotencyKey,
      })
      .returning();

    await upsertProgressItem(tx, {
      batchId: params.batchId,
      sourceFamily: params.sourceFamily,
      sourceId: params.sourceId,
      classifierVersion: params.expectedClassifierVersion,
      codeCommit: params.expectedCodeCommit,
      classification,
    });
    // upsertProgressItem derives a pre-write status ("eligible_not_executed"
    // for automatic_exact) — advance it to "succeeded" now that the write
    // has actually committed within this same transaction.
    await tx
      .update(paymentBackfillProgressItemsTable)
      .set({ status: "succeeded" })
      .where(
        and(
          eq(paymentBackfillProgressItemsTable.batchId, params.batchId),
          eq(paymentBackfillProgressItemsTable.sourceFamily, params.sourceFamily),
          eq(paymentBackfillProgressItemsTable.sourceId, params.sourceId),
        ),
      );
    return { kind: "written", paymentRecord: record, event };
  } catch (err) {
    if (pgErrorCode(err) !== POSTGRES_UNIQUE_VIOLATION) throw err;
    return { kind: "duplicate" };
  }
}
