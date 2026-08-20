/**
 * Wave 3: single-class booking refund lifecycle.
 *
 * Extends the existing canonical Finance refund architecture
 * (payment_refunds, already flow-type-agnostic — keyed by paymentRecordId,
 * not by a flowType column) to the single_class_booking flow, exactly
 * mirroring packageRefundService.ts's request/approve/reject/complete/fail
 * shape. No schema migration — payment_refunds and payment_records already
 * fully support this flow (payment_records_flow_type_check already lists
 * 'single_class_booking'; every online/pay_at_studio booking already gets
 * a canonical payment_records row at creation — see POST /bookings).
 *
 * Unlike package refunds (which retire N credit lots), a single-class
 * booking has exactly one flat payment covering one seat — there is no
 * partial-consumption concept, so eligibility is simply "was this exact
 * payment record paid, and does it still have refundable balance", and the
 * refundable amount is never admin-discretionary: it is always the full
 * remaining paid amount (paidAmountMinor - refundedAmountMinor), matching
 * the owner policy's "never exceed amount actually paid" and avoiding
 * inventing partial-refund math this wave was not asked to build.
 *
 * Historical safety: this service is never invoked for a booking whose
 * cancellation predates this wave — it only runs inside the live
 * PATCH /bookings/:id/cancel transaction, at the moment of a NEW
 * cancellation. No historical cancelled-paid booking is touched,
 * backfilled, or reinterpreted by anything in this file.
 */
import { and, desc, eq } from "drizzle-orm";
import {
  bookingsTable,
  db,
  paymentEventsTable,
  paymentRecordsTable,
  paymentRefundsTable,
  type PaymentRefund,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type PaymentRecord = typeof paymentRecordsTable.$inferSelect;

export class BookingRefundServiceError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BookingRefundServiceError";
  }
}

export type BookingRefundEligibility = {
  bookingId: number;
  paymentRecordId: number | null;
  eligible: boolean;
  refundableAmountMinor: number;
  reason: "eligible" | "no_payment_record" | "not_paid" | "no_remaining_balance" | "wrong_flow_type";
};

/**
 * Pure-ish (single read, no lock) eligibility check — used both by the
 * cancellation route (to decide whether to open a refund) and by the
 * Admin refund-eligibility view.
 */
export async function bookingRefundEligibility(bookingId: number, client: typeof db = db): Promise<BookingRefundEligibility> {
  const [record] = await client
    .select()
    .from(paymentRecordsTable)
    .where(and(eq(paymentRecordsTable.bookingId, bookingId), eq(paymentRecordsTable.flowType, "single_class_booking")))
    .limit(1);
  if (!record) return { bookingId, paymentRecordId: null, eligible: false, refundableAmountMinor: 0, reason: "no_payment_record" };
  if (record.flowType !== "single_class_booking") return { bookingId, paymentRecordId: record.id, eligible: false, refundableAmountMinor: 0, reason: "wrong_flow_type" };
  if (record.status !== "paid" && record.status !== "partially_refunded") {
    return { bookingId, paymentRecordId: record.id, eligible: false, refundableAmountMinor: 0, reason: "not_paid" };
  }
  const refundableAmountMinor = Math.max(0, record.paidAmountMinor - record.refundedAmountMinor);
  if (refundableAmountMinor <= 0) return { bookingId, paymentRecordId: record.id, eligible: false, refundableAmountMinor: 0, reason: "no_remaining_balance" };
  return { bookingId, paymentRecordId: record.id, eligible: true, refundableAmountMinor, reason: "eligible" };
}

/**
 * Wave 3.1: read-only combined view for the Admin refund dialog — the
 * eligibility snapshot plus the existing refund row for this booking, if
 * one has already been opened (by the student's own cancellation; Admin
 * never opens a booking refund directly, unlike packages). Purely additive
 * — computed entirely from bookingRefundEligibility() and a plain lookup,
 * no new math, no lifecycle change. Mirrors getPackageRefundOverview's
 * exact shape so the Admin UI can reuse the same dialog pattern.
 */
export async function getBookingRefundOverview(bookingId: number): Promise<{ eligibility: BookingRefundEligibility; refund: PaymentRefund | null }> {
  const eligibility = await bookingRefundEligibility(bookingId);
  if (eligibility.paymentRecordId == null) return { eligibility, refund: null };
  const [refund] = await db
    .select()
    .from(paymentRefundsTable)
    .where(eq(paymentRefundsTable.paymentRecordId, eligibility.paymentRecordId))
    .orderBy(desc(paymentRefundsTable.id))
    .limit(1);
  return { eligibility, refund: refund ?? null };
}

async function lockPaymentRecordForBooking(tx: Tx, bookingId: number): Promise<PaymentRecord | null> {
  const [record] = await tx
    .select()
    .from(paymentRecordsTable)
    .where(and(eq(paymentRecordsTable.bookingId, bookingId), eq(paymentRecordsTable.flowType, "single_class_booking")))
    .for("update")
    .limit(1);
  return record ?? null;
}

/**
 * Opens (or replays) a refund request for a paid single-class booking.
 * Called from inside the SAME transaction as the student cancellation
 * write in POST /bookings/:id/cancel — the booking's own bookingStatus
 * transition to "cancelled" always proceeds regardless of this refund's
 * outcome (releasing the seat is not conditioned on Finance review).
 *
 * Idempotent via requestIdempotencyKey (booking_refund:{bookingId}) — a
 * retried/duplicate cancellation attempt can never open two refund rows
 * for the same booking.
 */
export async function requestBookingRefundInTx(tx: Tx, params: {
  bookingId: number;
  requestedReason: string;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean } | null> {
  const requestIdempotencyKey = `booking_refund:${params.bookingId}`;
  const [existing] = await tx
    .select()
    .from(paymentRefundsTable)
    .where(eq(paymentRefundsTable.requestIdempotencyKey, requestIdempotencyKey))
    .limit(1);
  if (existing) return { refund: existing, replayed: true };

  const record = await lockPaymentRecordForBooking(tx, params.bookingId);
  if (!record) return null; // no canonical payment record — package-credit/free bookings never reach here
  if (record.status !== "paid" && record.status !== "partially_refunded") return null; // nothing collected — no refund fabricated
  const refundableAmountMinor = Math.max(0, record.paidAmountMinor - record.refundedAmountMinor);
  if (refundableAmountMinor <= 0) return null;

  const [refund] = await tx.insert(paymentRefundsTable).values({
    paymentRecordId: record.id,
    status: "underReview",
    requestedAmountMinor: refundableAmountMinor,
    refundMethod: "cash",
    requestedReason: params.requestedReason,
    requestedByAdminId: null, // student self-cancellation, not admin-initiated
    requestIdempotencyKey,
  }).returning();
  return { refund, replayed: false };
}

async function lockRefundContext(tx: Tx, refundId: number): Promise<{ refund: PaymentRefund; record: PaymentRecord }> {
  const [refund] = await tx.select().from(paymentRefundsTable).where(eq(paymentRefundsTable.id, refundId)).for("update").limit(1);
  if (!refund) throw new BookingRefundServiceError("BOOKING_REFUND_NOT_FOUND", "Booking refund not found.");
  const [record] = await tx.select().from(paymentRecordsTable).where(eq(paymentRecordsTable.id, refund.paymentRecordId)).for("update").limit(1);
  if (!record || record.flowType !== "single_class_booking" || record.bookingId == null) {
    throw new BookingRefundServiceError("BOOKING_REFUND_INTEGRITY_ERROR", "Refund payment linkage is not a single-class booking.");
  }
  return { refund, record };
}

export async function getBookingRefund(refundId: number): Promise<{ refund: PaymentRefund; bookingId: number }> {
  return db.transaction(async (tx) => {
    const { refund, record } = await lockRefundContext(tx, refundId);
    return { refund, bookingId: record.bookingId! };
  });
}

export async function approveBookingRefund(params: {
  refundId: number;
  reviewedByAdminId: number;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund, record } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "approved") return { refund, replayed: true };
    if (refund.status !== "underReview") throw new BookingRefundServiceError("REFUND_STATUS_CONFLICT", "Only an under-review refund can be approved.");
    const refundableAmountMinor = Math.max(0, record.paidAmountMinor - record.refundedAmountMinor);
    if (refundableAmountMinor !== refund.requestedAmountMinor) {
      throw new BookingRefundServiceError("REFUND_ELIGIBILITY_CHANGED", "Refund eligibility changed after request.");
    }
    const reviewedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "approved",
      approvedAmountMinor: refundableAmountMinor,
      reviewedByAdminId: params.reviewedByAdminId,
      reviewedAt,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: reviewedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

export async function rejectBookingRefund(params: {
  refundId: number;
  reviewedByAdminId: number;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "rejected") return { refund, replayed: true };
    if (refund.status !== "underReview") throw new BookingRefundServiceError("REFUND_STATUS_CONFLICT", "Only an under-review refund can be rejected.");
    const reviewedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "rejected",
      reviewedByAdminId: params.reviewedByAdminId,
      reviewedAt,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: reviewedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

export async function failBookingRefund(params: {
  refundId: number;
  processedByAdminId: number;
  failedReason: string;
  adminNotes?: string | null;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "failed") return { refund, replayed: true };
    if (refund.status !== "approved" && refund.status !== "processing") {
      throw new BookingRefundServiceError("REFUND_STATUS_CONFLICT", "Only an approved or processing refund can fail.");
    }
    const processedAt = (params.now ?? new Date()).toISOString();
    const [updated] = await tx.update(paymentRefundsTable).set({
      status: "failed",
      processedByAdminId: params.processedByAdminId,
      processedAt,
      failedReason: params.failedReason,
      adminNotes: params.adminNotes ?? refund.adminNotes,
      updatedAt: processedAt,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();
    return { refund: updated, replayed: false };
  });
}

/**
 * Manual-payout completion — Central Studio has no automated payout gateway
 * for this flow either (matching the package/Ballet refund reality), so
 * this always requires a transactionReference exactly like
 * completePackageRefund. Idempotent via completionIdempotencyKey.
 */
export async function completeBookingRefund(params: {
  refundId: number;
  processedByAdminId: number;
  completionIdempotencyKey: string;
  transactionReference: string;
  now?: Date;
}): Promise<{ refund: PaymentRefund; replayed: boolean }> {
  return db.transaction(async (tx) => {
    const { refund, record } = await lockRefundContext(tx, params.refundId);
    if (refund.status === "refunded") {
      if (refund.completionIdempotencyKey !== params.completionIdempotencyKey || refund.transactionReference !== params.transactionReference) {
        throw new BookingRefundServiceError("REFUND_ALREADY_COMPLETED", "Refund was completed with different payout evidence.");
      }
      return { refund, replayed: true };
    }
    if (refund.status !== "approved" && refund.status !== "processing") {
      throw new BookingRefundServiceError("REFUND_STATUS_CONFLICT", "Only an approved or processing refund can complete.");
    }
    const now = params.now ?? new Date();
    const refundableAmountMinor = Math.max(0, record.paidAmountMinor - record.refundedAmountMinor);
    if (refund.approvedAmountMinor !== refundableAmountMinor) {
      throw new BookingRefundServiceError("REFUND_ELIGIBILITY_CHANGED", "Refund eligibility changed before payout completion.");
    }
    const refundedAmountMinor = record.refundedAmountMinor + refundableAmountMinor;
    // Never exceed amount actually paid — the check constraint enforces this
    // too, but failing fast here gives a typed error instead of a raw
    // constraint-violation exception.
    if (refundedAmountMinor > record.paidAmountMinor) {
      throw new BookingRefundServiceError("PAYMENT_REFUND_EXCEEDS_PAID", "Refund would exceed the paid amount.");
    }
    const paymentStatus = refundedAmountMinor === record.paidAmountMinor ? "refunded" : "partially_refunded";
    const nowIso = now.toISOString();
    // The original captured amount (grossAmountMinor/finalPayableAmountMinor/
    // paidAmountMinor) is never rewritten — only refundedAmountMinor/status
    // change, exactly like completePackageRefund's payment_records update.
    await tx.update(paymentRecordsTable).set({
      refundedAmountMinor,
      status: paymentStatus,
      updatedAt: nowIso,
    }).where(eq(paymentRecordsTable.id, record.id));

    // Mirror the canonical payment_records status onto the booking's own
    // display field (bookingsTable.paymentStatus already has a "refunded"
    // value in its enum — see PAYMENT_STATUSES in routes/bookings.ts — it
    // was simply never written by anything until this refund lifecycle).
    // Only ever "refunded" here: this service always refunds the full
    // remaining balance, never a partial amount.
    if (paymentStatus === "refunded" && record.bookingId != null) {
      await tx.update(bookingsTable).set({ paymentStatus: "refunded" }).where(eq(bookingsTable.id, record.bookingId));
    }

    const [updatedRefund] = await tx.update(paymentRefundsTable).set({
      status: "refunded",
      refundedAmountMinor: refundableAmountMinor,
      processedByAdminId: params.processedByAdminId,
      processedAt: nowIso,
      transactionReference: params.transactionReference,
      completionIdempotencyKey: params.completionIdempotencyKey,
      failedReason: null,
      updatedAt: nowIso,
    }).where(eq(paymentRefundsTable.id, refund.id)).returning();

    await tx.insert(paymentEventsTable).values({
      paymentRecordId: record.id,
      paymentRefundId: refund.id,
      eventType: "refund_payout_completed",
      amountMinor: refundableAmountMinor,
      previousStatus: record.status,
      newStatus: paymentStatus,
      creditTransactionId: null,
      actorAdminId: params.processedByAdminId,
      actorType: "admin",
      reason: refund.requestedReason,
      providerReference: params.transactionReference,
      idempotencyKey: params.completionIdempotencyKey,
    });

    return { refund: updatedRefund, replayed: false };
  });
}

export type { PaymentRefund };
