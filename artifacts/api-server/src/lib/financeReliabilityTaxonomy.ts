/**
 * Finance Phase 2D-1 — historical backfill reliability taxonomy.
 *
 * Shared, typed vocabulary used by financeBackfillClassifier.ts (and, later,
 * the Phase 2D-2 writer) to describe HOW confident a piece of historical
 * evidence is, independent of whether it is eligible for automatic backfill.
 *
 * payment_records only has three coarse buckets (`evidence_class`,
 * `amount_availability`, `amount_source`). This taxonomy is the finer-grained
 * ANALYSIS vocabulary a human reviewer needs to decide whether a legacy row may
 * ever be written. Nothing here is persisted in Phase 2D-1 — the classifier and
 * the dry-run planner are strictly read-only.
 */

/** How trustworthy the gross amount is. */
export const AMOUNT_RELIABILITIES = [
  "exact_source_snapshot",
  "exact_order_snapshot",
  "exact_schedule_snapshot",
  "estimated_operational",
  "unknown_amount",
] as const;
export type AmountReliability = (typeof AMOUNT_RELIABILITIES)[number];

/** How trustworthy the discount figure is. */
export const DISCOUNT_RELIABILITIES = [
  "exact_stored_discount",
  "exact_source_snapshot",
  "reconstructable_immutable",
  "estimated_discount",
  "unknown_discount",
] as const;
export type DiscountReliability = (typeof DISCOUNT_RELIABILITIES)[number];

/** How trustworthy the payment-status reading of the source row is. */
export const PAYMENT_STATUS_RELIABILITIES = [
  "operational_pending",
  "confirmed_operationally",
  "fulfilled_unverified",
  "cancelled_or_rejected",
  "refunded",
  "partially_refunded",
  "ambiguous",
  "unknown",
] as const;
export type PaymentStatusReliability = (typeof PAYMENT_STATUS_RELIABILITIES)[number];

/** How trustworthy the payment method is. */
export const PAYMENT_METHOD_RELIABILITIES = [
  "exact_stored_method",
  "admin_confirmed_historical",
  "provider_backed",
  "legacy_display_only",
  "explicit_unknown",
  "unknown",
] as const;
export type PaymentMethodReliability = (typeof PAYMENT_METHOD_RELIABILITIES)[number];

/** How trustworthy the "when did money move" timestamp is. */
export const TIMESTAMP_RELIABILITIES = [
  "exact_payment_timestamp",
  "exact_operational_confirmation_timestamp",
  "fulfillment_timestamp_proxy",
  "source_updated_at_proxy",
  "unknown",
] as const;
export type TimestampReliability = (typeof TIMESTAMP_RELIABILITIES)[number];

/** How trustworthy the "who did it" attribution is. */
export const ACTOR_RELIABILITIES = [
  "authenticated_admin",
  "authenticated_user",
  "system_backfill",
  "unknown_historical_actor",
] as const;
export type ActorReliability = (typeof ACTOR_RELIABILITIES)[number];

/** The amount tiers that count as an exact source-time snapshot. */
export const EXACT_AMOUNT_RELIABILITIES: readonly AmountReliability[] = [
  "exact_source_snapshot",
  "exact_order_snapshot",
  "exact_schedule_snapshot",
];

export function isExactAmountReliability(value: AmountReliability): boolean {
  return (EXACT_AMOUNT_RELIABILITIES as readonly string[]).includes(value);
}

export function isExactDiscountReliability(value: DiscountReliability): boolean {
  return value === "exact_stored_discount" || value === "exact_source_snapshot";
}

export function isExactTimestampReliability(value: TimestampReliability): boolean {
  return value === "exact_payment_timestamp" || value === "exact_operational_confirmation_timestamp";
}
