import { minorToEgp } from "./money";

/**
 * F-04/F-19 correction: resolves the customer-visible historical amount
 * for one row of GET /my/bookings.
 *
 * Priority, matching the canonical Finance semantics already established
 * by the payment_records contract (lib/db/src/schema/paymentRecords.ts)
 * and financeBackfillWriter.ts's isWritable gate:
 *
 *   1. An EXACT captured payment_records amount, when one exists — never
 *      overridden by today's live schedule price, which can change
 *      independently of what was actually charged at booking time. Every
 *      row ever actually persisted to payment_records (live-capture or
 *      historical_backfill) has amountAvailability "exact" — the
 *      isWritable gate in financeBackfillWriter.ts refuses to write
 *      "estimated_backfill"/"unknown" classifications at all — but this
 *      function still checks the value defensively rather than assuming
 *      that invariant can never change.
 *
 *   2. A non-monetary booking (package-credit / free — paymentStatus
 *      "not_required") never had a payment_records row created for it
 *      (see POST /bookings' isDirectPaymentBooking gate) — it must show
 *      0, never the class's walk-in price, which would misrepresent it
 *      as a cash charge.
 *
 *   3. A legacy direct-payment booking predating Finance capture (no
 *      payment_records row, genuinely monetary) has no exact evidence
 *      anywhere in the system for what was actually charged. It keeps
 *      exactly the existing pre-Finance-capture fallback — today's
 *      schedule price — rather than inventing a 0 or a new "unknown"
 *      value that isn't already part of the API contract.
 */
export interface ResolveMyBookingPriceInput {
  paymentRecordAmountAvailability: string | null;
  paymentRecordFinalPayableAmountMinor: number | null;
  paymentStatus: string;
  schedulePriceEgp: number | null;
}

export function resolveMyBookingPriceEgp(input: ResolveMyBookingPriceInput): number {
  const hasExactCapturedAmount =
    input.paymentRecordAmountAvailability === "exact" && input.paymentRecordFinalPayableAmountMinor != null;

  if (hasExactCapturedAmount) {
    return minorToEgp(input.paymentRecordFinalPayableAmountMinor!);
  }

  if (input.paymentStatus === "not_required") {
    return 0;
  }

  return input.schedulePriceEgp ?? 0;
}

/**
 * F-05 correction: resolves the customer-visible historical amount for
 * one row of GET /my/packages.
 *
 * A package order can carry at most one payment_records row — the
 * payment_records_source_fk_matches_flow_type_check CHECK constraint
 * structurally requires any row with a non-null packageOrderId to be
 * flowType 'package_purchase', and payment_records_flow_package_order_
 * unique scopes uniqueness to (flowType, packageOrderId) — so this is
 * enforced by the schema itself, not merely by application code.
 *
 * Priority:
 *   1. An EXACT captured amount (already net of any promotion discount —
 *      finalPayableAmountMinor = gross - discount) — never overridden by
 *      today's live catalogue price, which is a product-catalogue value,
 *      not payment history, and can change independently of what a
 *      customer actually paid.
 *   2. A legacy order with no payment_records row keeps exactly today's
 *      existing fallback — the current catalogue price — unchanged. This
 *      is the same historical behavior every order used before this
 *      correction; only orders with a canonical record now diverge from
 *      it, which is the intended distinction between legacy and
 *      canonical pricing evidence.
 */
export interface ResolveMyPackagePriceInput {
  paymentRecordAmountAvailability: string | null;
  paymentRecordFinalPayableAmountMinor: number | null;
  catalogPriceEgp: number | null;
}

export function resolveMyPackagePriceEgp(input: ResolveMyPackagePriceInput): number | null {
  const hasExactCapturedAmount =
    input.paymentRecordAmountAvailability === "exact" && input.paymentRecordFinalPayableAmountMinor != null;

  if (hasExactCapturedAmount) {
    return minorToEgp(input.paymentRecordFinalPayableAmountMinor!);
  }

  return input.catalogPriceEgp;
}
