/**
 * Finance Phase 2C — canonical payment-confirmation transition.
 *
 * package_purchase and single_class_booking are created with a canonical
 * payment_records row at status "pending_confirmation" (Phase 2B-1/2B-2).
 * Nothing transitions that row afterward — this is the missing writer.
 * studio_walkin is intentionally out of scope: it is already paid at
 * creation and must never be touched by this helper.
 *
 * Caller contract: must run inside the same db.transaction() as, and after
 * locking, the source row (package_orders/bookings) so the payment-record
 * lock below and the source-row lock share one atomic unit. This module
 * owns locating/locking/validating/transitioning the payment_records row
 * and appending its "confirmed" payment_events row; it never touches the
 * source table itself.
 */
import { and, eq } from "drizzle-orm";
import {
  db,
  paymentRecordsTable,
  paymentEventsTable,
  type PaymentRecord,
  type PaymentRecordConfirmedMethod,
} from "@workspace/db";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ConfirmableFlowType = "package_purchase" | "single_class_booking";

export type ConfirmCanonicalPaymentRecordParams = {
  flowType: ConfirmableFlowType;
  packageOrderId?: number | null;
  bookingId?: number | null;
  confirmedPaymentMethod: PaymentRecordConfirmedMethod;
  confirmingAdminId: number;
};

export type ConfirmCanonicalPaymentRecordResult =
  | { kind: "confirmed"; record: PaymentRecord }
  | { kind: "already_confirmed"; record: PaymentRecord }
  | { kind: "legacy_missing" }
  | { kind: "integrity_error"; reason: "multiple_records" | "wrong_flow_type" | "wrong_source_fk" | "invalid_amount" }
  | { kind: "terminal"; record: PaymentRecord };

/**
 * Locates, locks (FOR UPDATE), validates, and — if eligible — transitions
 * the ONE canonical payment_records row for a source to status "paid",
 * appending exactly one "confirmed" payment_events row. Never inserts a
 * second payment_records row. Never creates a payment_events row without a
 * corresponding payment_records row.
 *
 * Idempotent: if the record is already "paid", returns "already_confirmed"
 * with the existing row unchanged — no second event, no timestamp rewrite.
 * Legacy-compatible: if no payment_records row exists for this source (a
 * pre-Phase-2B row), returns "legacy_missing" — callers must NOT fabricate
 * a Finance row/event and must preserve existing operational behavior
 * (Phase 2C approved policy #4); this is explicit Phase 2D backfill scope.
 * Corrupt-state-safe: more than one matching row, a flow_type mismatch, or
 * a source-FK mismatch all return a controlled "integrity_error" instead of
 * arbitrarily picking one row or throwing a raw DB error.
 */
export async function confirmCanonicalPaymentRecord(
  tx: Tx,
  params: ConfirmCanonicalPaymentRecordParams,
): Promise<ConfirmCanonicalPaymentRecordResult> {
  const matchCondition = params.flowType === "package_purchase"
    ? and(eq(paymentRecordsTable.flowType, "package_purchase"), eq(paymentRecordsTable.packageOrderId, params.packageOrderId!))
    : and(eq(paymentRecordsTable.flowType, "single_class_booking"), eq(paymentRecordsTable.bookingId, params.bookingId!));

  const matches = await tx.select().from(paymentRecordsTable).where(matchCondition).for("update");

  if (matches.length === 0) return { kind: "legacy_missing" };
  if (matches.length > 1) return { kind: "integrity_error", reason: "multiple_records" };

  const record = matches[0];
  if (record.flowType !== params.flowType) return { kind: "integrity_error", reason: "wrong_flow_type" };
  if (params.flowType === "package_purchase" && record.packageOrderId !== params.packageOrderId) {
    return { kind: "integrity_error", reason: "wrong_source_fk" };
  }
  if (params.flowType === "single_class_booking" && record.bookingId !== params.bookingId) {
    return { kind: "integrity_error", reason: "wrong_source_fk" };
  }

  if (record.status === "paid") return { kind: "already_confirmed", record };
  if (record.status !== "pending_confirmation" && record.status !== "unpaid" && record.status !== "failed") {
    // cancelled / refunded / partially_refunded / waived / legacy_unverified — terminal, not confirmable here.
    return { kind: "terminal", record };
  }
  if (record.finalPayableAmountMinor == null || record.finalPayableAmountMinor <= 0) {
    return { kind: "integrity_error", reason: "invalid_amount" };
  }

  const paidAt = new Date().toISOString();
  const [updated] = await tx
    .update(paymentRecordsTable)
    .set({
      status: "paid",
      paidAmountMinor: record.finalPayableAmountMinor,
      paidAt,
      confirmedPaymentMethod: params.confirmedPaymentMethod,
      // Admin selects from the fixed enum directly — there is no separate
      // client-supplied free-text value to preserve here, unlike
      // rawRequestedChannel at creation time.
      rawConfirmedMethod: null,
      confirmingAdminId: params.confirmingAdminId,
      updatedAt: paidAt,
    })
    .where(eq(paymentRecordsTable.id, record.id))
    .returning();

  await tx.insert(paymentEventsTable).values({
    paymentRecordId: record.id,
    paymentRefundId: null,
    eventType: "confirmed",
    amountMinor: updated.finalPayableAmountMinor,
    previousStatus: record.status,
    newStatus: "paid",
    creditTransactionId: null,
    actorAdminId: params.confirmingAdminId,
    actorType: "admin",
    reason: null,
    providerReference: null,
    ipAddress: null,
    userAgent: null,
    idempotencyKey: null,
  });

  return { kind: "confirmed", record: updated };
}

/**
 * Appends the "activation_credits_issued" payment_events row for a
 * package_purchase payment record that is already "paid", linked to the
 * credit_transactions row that was just inserted. Idempotent: if an
 * activation_credits_issued event already exists for this payment record,
 * does nothing and returns false — callers use this to safely resume a
 * "Finance paid but fulfillment incomplete" recovery without double-issuing
 * the event (Phase 2C approved policy #7).
 */
export async function appendActivationCreditsIssuedEventOnce(
  tx: Tx,
  params: { paymentRecordId: number; creditTransactionId: number; actorAdminId: number },
): Promise<boolean> {
  const [existing] = await tx
    .select({ id: paymentEventsTable.id })
    .from(paymentEventsTable)
    .where(and(
      eq(paymentEventsTable.paymentRecordId, params.paymentRecordId),
      eq(paymentEventsTable.eventType, "activation_credits_issued"),
    ))
    .limit(1);
  if (existing) return false;

  await tx.insert(paymentEventsTable).values({
    paymentRecordId: params.paymentRecordId,
    paymentRefundId: null,
    eventType: "activation_credits_issued",
    amountMinor: null,
    previousStatus: "paid",
    newStatus: "paid",
    creditTransactionId: params.creditTransactionId,
    actorAdminId: params.actorAdminId,
    actorType: "admin",
    reason: null,
    providerReference: null,
    ipAddress: null,
    userAgent: null,
    idempotencyKey: null,
  });
  return true;
}
