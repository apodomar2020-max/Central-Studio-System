/**
 * financeReadModel — pure source→normalized mapping for Finance Phase 1.
 *
 * This module contains NO database access and NO Express types on purpose: it
 * is the single place where "what does this row actually prove about money?"
 * is decided, so the answer is unit-testable and cannot drift between the
 * transactions endpoint, the overview endpoint, and the export.
 *
 * financeSources.ts performs the queries and hands raw row shapes in here.
 * routes/finance.ts does filtering/pagination/permissions and never re-derives
 * an amount or a reliability label itself.
 *
 * Invariants enforced here (see lib/api-zod/src/finance.ts for the full model):
 *   • Unknown amount → null, never 0.
 *   • package_orders.status is NEVER normalized to "paid".
 *   • Credit events carry null money and a unit delta.
 *   • Kashier is never described as verified settlement.
 *   • paidAt is only set from a real payment timestamp on the source row.
 */
import {
  type FinanceAmountAvailability,
  type FinanceAmountSource,
  type FinanceEventType,
  type FinanceNormalizedPaymentMethod,
  type FinancePaymentStatus,
  type FinanceRefundStatus,
  type FinanceReliabilityBadge,
  type FinanceSourceFamily,
  type UnifiedFinanceAmounts,
  type UnifiedFinanceCredit,
  type UnifiedFinanceTransaction,
} from "@workspace/api-zod";

// ─── Synthetic event id ───────────────────────────────────────────────────────

/**
 * Per-source id prefixes. Each source table has its own id sequence, so the
 * synthetic id is what makes an event addressable and gives ordering a stable
 * deterministic tiebreaker.
 */
export const FINANCE_ID_PREFIXES = {
  package_orders: "po",
  bookings: "bk",
  ballet_payments: "bp",
  ballet_assessment_fees: "baf",
  ballet_refunds: "br",
  payment_refunds: "pf",
  promotion_redemptions: "pr",
  credit_transactions: "ct",
} as const;

/** Walk-ins are bookings too, so they need a distinct prefix from `bk`. */
export const FINANCE_WALKIN_ID_PREFIX = "wi";

export function financeEventId(prefix: string, sourceId: number): string {
  return `${prefix}:${sourceId}`;
}

// ─── Shared helpers ───────────────────────────────────────────────────────────

/** Empty monetary block — the correct starting point for non-monetary events. */
export function emptyAmounts(): UnifiedFinanceAmounts {
  return {
    amountEgp: null,
    grossAmountEgp: null,
    discountAmountEgp: null,
    requestedRefundAmountEgp: null,
    approvedRefundAmountEgp: null,
    refundedAmountEgp: null,
    netAmountEgp: null,
    currency: "EGP",
  };
}

export function emptyCredit(): UnifiedFinanceCredit {
  return { unitDelta: null, balanceBefore: null, balanceAfter: null };
}

/**
 * Coerce a stored numeric column to a whole-EGP integer, or null.
 *
 * price_packages.price_egp and promotion_redemptions.discount_amount are
 * `real` columns while ballet amounts are `integer`; rounding here keeps a
 * single EGP presentation without inventing precision the studio does not use.
 * Anything non-finite becomes null rather than 0 — a missing price must never
 * read as "free".
 */
export function egpOrNull(value: unknown): number | null {
  if (value == null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed);
}

/** Trimmed non-empty string, else null. */
function textOrNull(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

// ─── Payment method normalization ─────────────────────────────────────────────

/**
 * Map a raw source payment-method string onto the normalized enum.
 *
 * Deliberately total and lossless-by-fallback: an unrecognized non-empty value
 * becomes "unknown" while `rawPaymentMethod` keeps the original text, so a new
 * method introduced elsewhere in the system degrades to "unknown" instead of
 * being silently mislabeled as a verified one.
 */
export function normalizePaymentMethod(
  raw: string | null | undefined,
): FinanceNormalizedPaymentMethod | null {
  const value = textOrNull(raw);
  if (value == null) return null;
  switch (value) {
    case "inPerson": return "in_person";
    case "cash": return "cash";
    case "card": return "card";
    case "kashier": return "kashier";
    case "bank_transfer": return "bank_transfer";
    case "bankTransfer": return "bank_transfer";
    case "pay_at_studio": return "pay_at_studio";
    case "online_payment": return "online_payment";
    case "package_credit": return "package_credit";
    default: return "unknown";
  }
}

/**
 * payment_records.confirmed_payment_method uses its own closed vocabulary
 * (cash/card/kashier/bank_transfer/unknown) — distinct from the booking/
 * Ballet raw strings normalizePaymentMethod handles, so it needs its own
 * mapping rather than falling through to "unknown" for a real, valid value.
 */
export function normalizePaymentRecordMethod(
  raw: string | null | undefined,
): FinanceNormalizedPaymentMethod | null {
  const value = textOrNull(raw);
  if (value == null) return null;
  switch (value) {
    case "cash": return "cash";
    case "card": return "card";
    case "kashier": return "kashier";
    case "bank_transfer": return "bank_transfer";
    default: return "unknown";
  }
}

// ─── Booking payment status normalization ─────────────────────────────────────

/**
 * bookings.payment_status uses "pending_payment"; the normalized contract uses
 * "pending". Every other value already matches. An unrecognized value yields
 * null (unknown) rather than a guess — `rawSourceStatus` preserves the truth.
 */
export function normalizeBookingPaymentStatus(
  raw: string | null | undefined,
): FinancePaymentStatus | null {
  switch (textOrNull(raw)) {
    case "pending_payment": return "pending";
    case "pending": return "pending";
    case "paid": return "paid";
    case "refunded": return "refunded";
    case "rejected": return "rejected";
    case "failed": return "failed";
    case "not_required": return "not_required";
    default: return null;
  }
}

/**
 * ballet_payments.status is pending | rejected | paid | refunded — already the
 * normalized vocabulary. Unrecognized → null.
 */
export function normalizeBalletPaymentStatus(
  raw: string | null | undefined,
): FinancePaymentStatus | null {
  switch (textOrNull(raw)) {
    case "pending": return "pending";
    case "paid": return "paid";
    case "refunded": return "refunded";
    case "rejected": return "rejected";
    case "failed": return "failed";
    default: return null;
  }
}

/** ballet_refunds.status already matches the normalized refund lifecycle. */
export function normalizeRefundStatus(
  raw: string | null | undefined,
): FinanceRefundStatus | null {
  switch (textOrNull(raw)) {
    case "underReview": return "underReview";
    case "approved": return "approved";
    case "rejected": return "rejected";
    case "processing": return "processing";
    case "refunded": return "refunded";
    case "failed": return "failed";
    case "withdrawn": return "withdrawn";
    default: return null;
  }
}

// ─── Centralized reliability labels ───────────────────────────────────────────

/**
 * The single source of truth for what each badge means. Any surface that shows
 * a badge shows this text — the wording is part of the contract, not copy.
 */
export const FINANCE_RELIABILITY_EXPLANATIONS: Readonly<
  Record<FinanceReliabilityBadge, string>
> = {
  recorded_collection:
    "An administrator recorded this collection in person with a stored historical amount. It is not independently reconciled through a cash drawer.",
  recorded_refund:
    "A refund lifecycle completed and the paid-out amount is stored on the refund record.",
  recorded_discount:
    "The discount amount was stored when the promotion was redeemed. A discount is not cash received or cash paid out.",
  estimated_operational:
    "No historical payment amount was stored for this event. The amount shown is re-derived from current pricing and is an operational estimate, not a recorded collection.",
  unverified_admin_tag:
    "Payment method was recorded as Kashier, but provider settlement is not verified by the current system.",
  legacy_display_only:
    "Bank Transfer is a legacy historical classification retained for display only. It is not reconciled against a bank statement by the current system.",
  service_credit_unit:
    "This event moves package session credits, not money. Credit units are never converted to EGP.",
  unknown_amount:
    "No amount could be resolved for this event, so the monetary value is unknown rather than zero.",
};

/** Attach the canonical explanation to a badge. */
export function reliability(badge: FinanceReliabilityBadge): UnifiedFinanceTransaction["reliability"] {
  return { badge, explanation: FINANCE_RELIABILITY_EXPLANATIONS[badge] };
}

/**
 * Reliability for a Ballet payment, keyed on the recorded method.
 *
 * A missing method is treated as an unverified admin tag rather than a
 * recorded collection: without a method there is nothing proving how the money
 * arrived, so claiming an in-person collection would overstate the evidence.
 */
export function balletPaymentReliabilityBadge(
  rawPaymentMethod: string | null | undefined,
): FinanceReliabilityBadge {
  switch (textOrNull(rawPaymentMethod)) {
    case "inPerson": return "recorded_collection";
    case "kashier": return "unverified_admin_tag";
    case "bankTransfer": return "legacy_display_only";
    default: return "unverified_admin_tag";
  }
}

// ─── A. Package purchase (package_orders) ─────────────────────────────────────

export interface PackageOrderSourceRow {
  id: number;
  status: string;
  packageId: number | null;
  packageName: string;
  studentId: number | null;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  /** Current catalog price — NOT a historical amount. Null when unresolvable. */
  currentCatalogPriceEgp: number | null;
  activatedAt: string | null;
  createdAt: string;
  /**
   * Canonical Finance Phase 2B-1/2C payment_records row for this package
   * order (flow_type = 'package_purchase'), when one exists. Null for a
   * legacy order created before the writer landed — see the fallback branch
   * in mapPackagePurchase, which is preserved unchanged for that case.
   */
  paymentRecordStatus: string | null;
  paymentRecordConfirmedMethod: string | null;
  paymentRecordFinalPayableAmountMinor: number | null;
  paymentRecordPaidAmountMinor: number | null;
  paymentRecordRefundedAmountMinor: number | null;
  paymentRecordDiscountAmountMinor: number | null;
  paymentRecordPaidAt: string | null;
}

/**
 * payment_records.status → the normalized Finance payment-status vocabulary.
 * The canonical enum is richer than FinancePaymentStatus; rawSourceStatus
 * (set to the exact payment_records.status) keeps the untruncated value, so
 * this coarsening never loses information Finance can't recover.
 */
function normalizePaymentRecordStatus(raw: string | null): FinancePaymentStatus | null {
  switch (raw) {
    case "unpaid": return "pending";
    case "pending_confirmation": return "pending";
    case "paid": return "paid";
    case "partially_refunded": return "refunded";
    case "refunded": return "refunded";
    case "waived": return "not_required";
    case "cancelled": return "rejected";
    case "failed": return "failed";
    case "legacy_unverified": return "pending";
    default: return null;
  }
}

/**
 * A package order is an OPERATIONAL record, not a receipt — but since Finance
 * Phase 2B-1 (creation) / 2C (activation confirmation), every new package
 * order also has a canonical payment_records row (flow_type =
 * 'package_purchase') recording the real payment status, confirmed method,
 * and exact minor-unit amount captured at creation/activation time. That row
 * takes priority whenever it exists (see the branch below): paymentStatus
 * comes from payment_records.status, the amount is the exact
 * finalPayableAmountMinor snapshot (never a live catalog re-derivation), and
 * reliability reads recorded_collection once paid — credit issuance (package
 * activation) stays a separate concept, never conflated with cash-collection
 * status.
 *
 * A legacy package order with no payment_records row (created before the
 * writer existed) falls back UNCHANGED to the original estimate-based
 * behavior:
 *   • paymentStatus is null (never "paid"),
 *   • the real operational status is preserved in rawSourceStatus,
 *   • the amount is today's catalog price, flagged estimated,
 *   • an unresolvable price yields null money and unknown_amount.
 * This fallback must never be removed — old test/legacy rows will never
 * retroactively gain a payment_records row.
 */
export function mapPackagePurchase(row: PackageOrderSourceRow): UnifiedFinanceTransaction {
  if (row.paymentRecordStatus != null) {
    return mapPackagePurchaseFromPaymentRecord(row);
  }
  return mapPackagePurchaseLegacyEstimate(row);
}

function mapPackagePurchaseFromPaymentRecord(row: PackageOrderSourceRow): UnifiedFinanceTransaction {
  const finalPayableEgp = row.paymentRecordFinalPayableAmountMinor != null
    ? row.paymentRecordFinalPayableAmountMinor / 100
    : null;
  const discountEgp = row.paymentRecordDiscountAmountMinor != null
    ? row.paymentRecordDiscountAmountMinor / 100
    : 0;
  const refundedEgp = row.paymentRecordRefundedAmountMinor != null
    ? row.paymentRecordRefundedAmountMinor / 100
    : 0;
  const grossEgp = finalPayableEgp != null ? finalPayableEgp + discountEgp : null;

  const normalizedStatus = normalizePaymentRecordStatus(row.paymentRecordStatus);
  const isPaidCollection = row.paymentRecordStatus === "paid" || row.paymentRecordStatus === "partially_refunded";
  const badge: FinanceReliabilityBadge = isPaidCollection ? "recorded_collection" : "estimated_operational";

  const amounts = emptyAmounts();
  amounts.amountEgp = finalPayableEgp;
  amounts.grossAmountEgp = grossEgp;
  amounts.discountAmountEgp = discountEgp > 0 ? discountEgp : null;
  amounts.netAmountEgp = finalPayableEgp;
  amounts.refundedAmountEgp = refundedEgp > 0 ? refundedEgp : null;

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.package_orders, row.id),
    eventType: "package_purchase",
    eventNature: isPaidCollection ? "cash_inflow" : "operational_estimate",
    sourceTable: "package_orders",
    sourceId: row.id,
    amounts,
    amountAvailability: "exact",
    amountSource: "payment_record_snapshot",
    credit: emptyCredit(),
    paymentStatus: normalizedStatus,
    refundStatus: null,
    // The exact payment_records.status, not the coarser package_orders
    // operational status — this is now the more precise "raw truth".
    rawSourceStatus: row.paymentRecordStatus,
    rawPaymentMethod: row.paymentRecordConfirmedMethod,
    normalizedPaymentMethod: normalizePaymentRecordMethod(row.paymentRecordConfirmedMethod),
    occurredAt: row.activatedAt ?? row.createdAt,
    paidAt: row.paymentRecordPaidAt,
    refundedAt: null,
    customer: {
      studentId: row.studentId,
      name: textOrNull(row.studentName),
      email: textOrNull(row.studentEmail),
      phone: textOrNull(row.studentPhone),
      participantScope: "unknown",
      childId: null,
      childName: null,
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: row.id,
      packageId: row.packageId,
      packageName: textOrNull(row.packageName),
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor: null,
    providerReference: null,
    reliability: {
      badge,
      explanation: isPaidCollection
        ? FINANCE_RELIABILITY_EXPLANATIONS.recorded_collection
          + " Package credit issuance is a separate operational fact, tracked independently of this cash-collection status."
        : "This package purchase has a canonical payment record, but it has not yet been confirmed paid — status shown is the real payment lifecycle state, not an estimate.",
    },
    sourceDeepLink: "/package-orders",
  };
}

function mapPackagePurchaseLegacyEstimate(row: PackageOrderSourceRow): UnifiedFinanceTransaction {
  const catalogPrice = egpOrNull(row.currentCatalogPriceEgp);
  const resolved = catalogPrice != null;

  const amounts = emptyAmounts();
  if (resolved) {
    amounts.amountEgp = catalogPrice;
    amounts.grossAmountEgp = catalogPrice;
    amounts.netAmountEgp = catalogPrice;
  }

  const amountAvailability: FinanceAmountAvailability = resolved ? "estimated" : "unknown";
  const amountSource: FinanceAmountSource = resolved ? "current_package_catalog_price" : "unavailable";
  const badge: FinanceReliabilityBadge = resolved ? "estimated_operational" : "unknown_amount";

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.package_orders, row.id),
    eventType: "package_purchase",
    eventNature: "operational_estimate",
    sourceTable: "package_orders",
    sourceId: row.id,
    amounts,
    amountAvailability,
    amountSource,
    credit: emptyCredit(),
    // Never derived from package_orders.status — see module header.
    paymentStatus: null,
    refundStatus: null,
    rawSourceStatus: row.status,
    rawPaymentMethod: null,
    normalizedPaymentMethod: null,
    occurredAt: row.activatedAt ?? row.createdAt,
    // No package order column records when money was taken.
    paidAt: null,
    refundedAt: null,
    customer: {
      studentId: row.studentId,
      name: textOrNull(row.studentName),
      email: textOrNull(row.studentEmail),
      phone: textOrNull(row.studentPhone),
      // package_orders has no participant/child dimension.
      participantScope: "unknown",
      childId: null,
      childName: null,
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: row.id,
      packageId: row.packageId,
      packageName: textOrNull(row.packageName),
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor: null,
    providerReference: null,
    reliability: {
      badge,
      explanation: resolved
        ? "Package activation implies operational approval and credit issuance, but payment collection is not independently recorded. The amount shown is the current catalog price, not a historical payment amount."
        : FINANCE_RELIABILITY_EXPLANATIONS.unknown_amount +
          " Package activation implies operational approval and credit issuance, but payment collection is not independently recorded.",
    },
    sourceDeepLink: "/package-orders",
  };
}

// ─── B/C. Generic booking + studio walk-in (bookings) ─────────────────────────

export interface BookingSourceRow {
  id: number;
  paymentStatus: string;
  paymentMode: string | null;
  bookingStatus: string;
  bookedAt: string;
  occurrenceDate: string | null;
  classId: number | null;
  classTitle: string | null;
  scheduleId: number | null;
  /** schedules.price_egp — current, editable value. */
  schedulePriceEgp: number | null;
  /** class_pricing_settings.<category>_walkin_price_egp for the class's assigned pricing category, when both resolve. */
  categoryWalkinPriceEgp: number | null;
  /** class_pricing_settings.single_class_price_egp — current global fallback. */
  singleClassSettingEgp: number | null;
  accountOwnerStudentId: number | null;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  bookingScope: string | null;
  participantChildId: number | null;
  childName: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  ownerPhone: string | null;
  attendanceId: number | null;
  /**
   * Canonical walk-in evidence: an admin_activity_logs row written by
   * studioWalkIn.ts with after->>'source' = 'unified_gateway_walk_in' for this
   * booking id. Deliberately NOT the booking's notes text, which is
   * client-settable through CreateBookingBody and therefore forgeable.
   */
  walkInActorAdminId: number | null;
  walkInActorEmail: string | null;
  isWalkIn: boolean;
  /**
   * Canonical Finance Phase 2B-2/2B-4/2C payment_records row for this
   * booking (flow_type in single_class_booking/studio_walkin), when one
   * exists. Null for a legacy booking created before the writer landed.
   */
  paymentRecordStatus: string | null;
  paymentRecordConfirmedMethod: string | null;
  paymentRecordGrossAmountMinor: number | null;
  paymentRecordDiscountAmountMinor: number | null;
  paymentRecordFinalPayableAmountMinor: number | null;
  paymentRecordPaidAmountMinor: number | null;
  paymentRecordRefundedAmountMinor: number | null;
  paymentRecordPaidAt: string | null;
}

/** Payment modes that represent money changing hands for a generic booking. */
export const MONETARY_BOOKING_PAYMENT_MODES = ["pay_at_studio", "online_payment"] as const;

/**
 * True when a booking is a cash-side event at all. `package_credit` and `free`
 * bookings are not payments — a package_credit booking's economics live in the
 * credit ledger (see mapCreditTransaction), so surfacing it as a payment would
 * double-count a single class.
 */
export function isMonetaryBookingPaymentMode(paymentMode: string | null | undefined): boolean {
  const value = textOrNull(paymentMode);
  return value === "pay_at_studio" || value === "online_payment";
}

/**
 * Generic single-class payment (B) and studio walk-in payment (C).
 *
 * Since Finance Phase 2B-2 (single-class direct-payment creation), 2B-4
 * (paid Studio Walk-in), and 2C (Pay-at-Studio confirmation), a booking with
 * a real cash flow also has a canonical payment_records row capturing the
 * exact minor-unit amount and payment status at creation/confirmation time.
 * That row takes priority whenever it exists (see the branch below) — the
 * displayed amount is the exact captured snapshot, immune to later schedule
 * price changes, and reliability reads recorded_collection once paid.
 *
 * A legacy/package-credit/free booking with no payment_records row falls
 * back UNCHANGED to the original schedule-price estimate (SAME fallback
 * order as the existing dashboard aggregate — coalesce(schedule.priceEgp,
 * classPricingSettings.singleClassPriceEgp) — so Finance never disagrees
 * with the Dashboard about a generic estimated figure), with the existing
 * "estimated_operational"/estimate-warning treatment preserved.
 */
export function mapBookingPayment(row: BookingSourceRow): UnifiedFinanceTransaction {
  if (row.paymentRecordStatus != null) {
    return mapBookingPaymentFromPaymentRecord(row);
  }
  return mapBookingPaymentLegacyEstimate(row);
}

function mapBookingPaymentFromPaymentRecord(row: BookingSourceRow): UnifiedFinanceTransaction {
  const finalPayableEgp = row.paymentRecordFinalPayableAmountMinor != null
    ? row.paymentRecordFinalPayableAmountMinor / 100
    : null;
  const grossEgp = row.paymentRecordGrossAmountMinor != null ? row.paymentRecordGrossAmountMinor / 100 : finalPayableEgp;
  const discountEgp = row.paymentRecordDiscountAmountMinor != null ? row.paymentRecordDiscountAmountMinor / 100 : 0;
  const refundedEgp = row.paymentRecordRefundedAmountMinor != null ? row.paymentRecordRefundedAmountMinor / 100 : 0;

  const normalizedStatus = normalizePaymentRecordStatus(row.paymentRecordStatus);
  const isPaidCollection = row.paymentRecordStatus === "paid" || row.paymentRecordStatus === "partially_refunded";
  const badge: FinanceReliabilityBadge = isPaidCollection ? "recorded_collection" : "estimated_operational";
  const eventType: FinanceEventType = row.isWalkIn ? "studio_walkin_payment" : "single_class_payment";

  const amounts = emptyAmounts();
  amounts.amountEgp = finalPayableEgp;
  amounts.grossAmountEgp = grossEgp;
  amounts.discountAmountEgp = discountEgp > 0 ? discountEgp : null;
  amounts.netAmountEgp = finalPayableEgp;
  amounts.refundedAmountEgp = refundedEgp > 0 ? refundedEgp : null;

  return {
    id: financeEventId(row.isWalkIn ? FINANCE_WALKIN_ID_PREFIX : FINANCE_ID_PREFIXES.bookings, row.id),
    eventType,
    eventNature: isPaidCollection ? "cash_inflow" : "operational_estimate",
    sourceTable: "bookings",
    sourceId: row.id,
    amounts,
    amountAvailability: "exact",
    amountSource: "payment_record_snapshot",
    credit: emptyCredit(),
    paymentStatus: normalizedStatus,
    refundStatus: null,
    rawSourceStatus: row.paymentRecordStatus,
    rawPaymentMethod: row.paymentRecordConfirmedMethod ?? row.paymentMode,
    normalizedPaymentMethod: row.paymentRecordConfirmedMethod != null
      ? normalizePaymentRecordMethod(row.paymentRecordConfirmedMethod)
      : normalizePaymentMethod(row.paymentMode),
    occurredAt: row.bookedAt,
    paidAt: row.paymentRecordPaidAt,
    refundedAt: null,
    customer: {
      studentId: row.accountOwnerStudentId,
      name: textOrNull(row.ownerName) ?? textOrNull(row.studentName),
      email: textOrNull(row.ownerEmail) ?? textOrNull(row.studentEmail),
      phone: textOrNull(row.ownerPhone) ?? textOrNull(row.studentPhone),
      participantScope:
        row.participantChildId != null || row.bookingScope === "child"
          ? "child"
          : row.bookingScope === "self"
            ? "self"
            : "unknown",
      childId: row.participantChildId,
      childName: textOrNull(row.childName),
    },
    references: {
      bookingId: row.id,
      attendanceId: row.attendanceId,
      packageOrderId: null,
      packageId: null,
      packageName: null,
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: {
      classId: row.classId,
      classTitle: textOrNull(row.classTitle),
      scheduleId: row.scheduleId,
      occurrenceDate: row.occurrenceDate,
    },
    actor: row.isWalkIn && (row.walkInActorAdminId != null || row.walkInActorEmail != null)
      ? { adminId: row.walkInActorAdminId, adminEmail: textOrNull(row.walkInActorEmail) }
      : null,
    providerReference: null,
    reliability: {
      badge,
      explanation: isPaidCollection
        ? FINANCE_RELIABILITY_EXPLANATIONS.recorded_collection
        : "This booking has a canonical payment record, but it has not yet been confirmed paid — status shown is the real payment lifecycle state, not an estimate.",
    },
    sourceDeepLink: row.isWalkIn
      ? `/attendance${row.studentEmail ? `?studentEmail=${encodeURIComponent(row.studentEmail)}` : ""}`
      : `/bookings${row.studentEmail ? `?studentEmail=${encodeURIComponent(row.studentEmail)}` : ""}`,
  };
}

function mapBookingPaymentLegacyEstimate(row: BookingSourceRow): UnifiedFinanceTransaction {
  const schedulePrice = egpOrNull(row.schedulePriceEgp);
  const categoryPrice = egpOrNull(row.categoryWalkinPriceEgp);
  const settingPrice = egpOrNull(row.singleClassSettingEgp);
  // Identical order to BOOKING_RESOLVED_PRICE (financeSources.ts) and to
  // resolveSingleClassPriceEgp's live-capture order (singleClassPricing.ts):
  // schedule override -> class's category price -> legacy single price.
  const resolvedPrice = schedulePrice ?? categoryPrice ?? settingPrice;

  const amounts = emptyAmounts();
  if (resolvedPrice != null) {
    amounts.amountEgp = resolvedPrice;
    amounts.grossAmountEgp = resolvedPrice;
    amounts.netAmountEgp = resolvedPrice;
  }

  const amountAvailability: FinanceAmountAvailability = resolvedPrice != null ? "estimated" : "unknown";
  const amountSource: FinanceAmountSource =
    schedulePrice != null
      ? "current_schedule_price"
      : categoryPrice != null
        ? "current_category_price_setting"
        : settingPrice != null
          ? "current_single_class_setting"
          : "unavailable";
  const badge: FinanceReliabilityBadge =
    resolvedPrice != null ? "estimated_operational" : "unknown_amount";

  const eventType: FinanceEventType = row.isWalkIn ? "studio_walkin_payment" : "single_class_payment";

  return {
    id: financeEventId(
      row.isWalkIn ? FINANCE_WALKIN_ID_PREFIX : FINANCE_ID_PREFIXES.bookings,
      row.id,
    ),
    eventType,
    eventNature: "operational_estimate",
    sourceTable: "bookings",
    sourceId: row.id,
    amounts,
    amountAvailability,
    amountSource,
    credit: emptyCredit(),
    // Preserved from the booking row — unlike package orders, bookings DO
    // carry a real payment status the operational flow maintains.
    paymentStatus: normalizeBookingPaymentStatus(row.paymentStatus),
    refundStatus: null,
    rawSourceStatus: row.paymentStatus,
    rawPaymentMethod: row.paymentMode,
    normalizedPaymentMethod: normalizePaymentMethod(row.paymentMode),
    occurredAt: row.bookedAt,
    paidAt: null,
    refundedAt: null,
    customer: {
      studentId: row.accountOwnerStudentId,
      name: textOrNull(row.ownerName) ?? textOrNull(row.studentName),
      email: textOrNull(row.ownerEmail) ?? textOrNull(row.studentEmail),
      phone: textOrNull(row.ownerPhone) ?? textOrNull(row.studentPhone),
      participantScope:
        row.participantChildId != null || row.bookingScope === "child"
          ? "child"
          : row.bookingScope === "self"
            ? "self"
            : "unknown",
      childId: row.participantChildId,
      childName: textOrNull(row.childName),
    },
    references: {
      bookingId: row.id,
      attendanceId: row.attendanceId,
      packageOrderId: null,
      packageId: null,
      packageName: null,
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: {
      classId: row.classId,
      classTitle: textOrNull(row.classTitle),
      scheduleId: row.scheduleId,
      occurrenceDate: row.occurrenceDate,
    },
    // Only walk-ins have a proven collecting/check-in admin (from the audit
    // log). A normal booking has no record of who took the money.
    actor: row.isWalkIn && (row.walkInActorAdminId != null || row.walkInActorEmail != null)
      ? { adminId: row.walkInActorAdminId, adminEmail: textOrNull(row.walkInActorEmail) }
      : null,
    providerReference: null,
    reliability: reliability(badge),
    sourceDeepLink: row.isWalkIn
      ? `/attendance${row.studentEmail ? `?studentEmail=${encodeURIComponent(row.studentEmail)}` : ""}`
      : `/bookings${row.studentEmail ? `?studentEmail=${encodeURIComponent(row.studentEmail)}` : ""}`,
  };
}

// ─── D. Ballet payment (ballet_payments) ──────────────────────────────────────

export interface BalletPaymentSourceRow {
  id: number;
  applicationId: number;
  packageOrderId: number | null;
  /** ballet_payments.amount_egp — a real stored historical amount. */
  amountEgp: number | null;
  status: string;
  paymentMethod: string | null;
  paidAt: string | null;
  refundedAt: string | null;
  createdAt: string;
  parentStudentId: number | null;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  childId: number | null;
  childName: string | null;
}

/**
 * Ballet payments are the only Studio events with a stored historical amount,
 * so they are the only ones marked `exact`.
 *
 * "Exact" describes the AMOUNT only, never settlement: a Kashier row means an
 * admin selected Kashier as the method, and no provider callback verifies it.
 * providerReference stays null because ballet_payments has no provider
 * transaction column — `notes` is free text and is not a provider reference.
 */
export function mapBalletPayment(row: BalletPaymentSourceRow): UnifiedFinanceTransaction {
  const stored = egpOrNull(row.amountEgp);
  const amounts = emptyAmounts();
  if (stored != null) {
    amounts.amountEgp = stored;
    amounts.grossAmountEgp = stored;
    amounts.netAmountEgp = stored;
  }

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.ballet_payments, row.id),
    eventType: "ballet_payment",
    eventNature: "cash_inflow",
    sourceTable: "ballet_payments",
    sourceId: row.id,
    amounts,
    amountAvailability: stored != null ? "exact" : "unknown",
    amountSource: stored != null ? "ballet_payment_snapshot" : "unavailable",
    credit: emptyCredit(),
    paymentStatus: normalizeBalletPaymentStatus(row.status),
    refundStatus: null,
    rawSourceStatus: row.status,
    rawPaymentMethod: row.paymentMethod,
    normalizedPaymentMethod: normalizePaymentMethod(row.paymentMethod),
    occurredAt: row.paidAt ?? row.createdAt,
    paidAt: row.paidAt,
    refundedAt: row.refundedAt,
    customer: {
      studentId: row.parentStudentId,
      name: textOrNull(row.parentName),
      email: textOrNull(row.parentEmail),
      phone: textOrNull(row.parentPhone),
      // A Ballet payment is always for the enrolled child.
      participantScope: "child",
      childId: row.childId,
      childName: textOrNull(row.childName),
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: row.packageOrderId,
      packageId: null,
      packageName: null,
      balletApplicationId: row.applicationId,
      balletPaymentId: row.id,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor: null,
    providerReference: null,
    reliability:
      stored == null
        ? reliability("unknown_amount")
        : reliability(balletPaymentReliabilityBadge(row.paymentMethod)),
    sourceDeepLink: `/ballet/payments?applicationId=${row.applicationId}`,
  };
}

export interface BalletAssessmentFeeSourceRow {
  id: number;
  parentStudentId: number | null;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  childId: number | null;
  childName: string | null;
  assessmentFeeAmountEgp: number | null;
  assessmentFeeStatus: string | null;
  assessmentFeePaidAt: Date | string | null;
  assessmentFeePaymentMethod: string | null;
  createdAt: Date | string;
}

export function mapBalletAssessmentFee(row: BalletAssessmentFeeSourceRow): UnifiedFinanceTransaction {
  const stored = egpOrNull(row.assessmentFeeAmountEgp);
  const validStored = stored != null && stored > 0 ? stored : null;
  const amounts = emptyAmounts();
  if (validStored != null) {
    amounts.amountEgp = validStored;
    amounts.grossAmountEgp = validStored;
    amounts.netAmountEgp = validStored;
  }

  const occurredAt = row.assessmentFeePaidAt
    ? (row.assessmentFeePaidAt instanceof Date ? row.assessmentFeePaidAt.toISOString() : String(row.assessmentFeePaidAt))
    : (row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt));

  const paidAt = row.assessmentFeePaidAt
    ? (row.assessmentFeePaidAt instanceof Date ? row.assessmentFeePaidAt.toISOString() : String(row.assessmentFeePaidAt))
    : null;

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.ballet_assessment_fees, row.id),
    eventType: "ballet_assessment_fee",
    eventNature: "cash_inflow",
    sourceTable: "ballet_applications",
    sourceId: row.id,
    amounts,
    amountAvailability: validStored != null ? "exact" : "unknown",
    amountSource: validStored != null ? "ballet_payment_snapshot" : "unavailable",
    credit: emptyCredit(),
    paymentStatus: row.assessmentFeeStatus === "paid" ? "paid" : "pending",
    refundStatus: null,
    rawSourceStatus: row.assessmentFeeStatus ?? "unpaid",
    rawPaymentMethod: row.assessmentFeePaymentMethod ?? "inPerson",
    normalizedPaymentMethod: normalizePaymentMethod(row.assessmentFeePaymentMethod ?? "inPerson"),
    occurredAt,
    paidAt,
    refundedAt: null,
    customer: {
      studentId: row.parentStudentId,
      name: textOrNull(row.parentName),
      email: textOrNull(row.parentEmail),
      phone: textOrNull(row.parentPhone),
      participantScope: "child",
      childId: row.childId,
      childName: textOrNull(row.childName),
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: null,
      packageId: null,
      packageName: null,
      balletApplicationId: row.id,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor: null,
    providerReference: null,
    reliability: reliability(validStored != null ? "recorded_collection" : "unknown_amount"),
    sourceDeepLink: `/ballet/applications/${row.id}`,
  };
}

// ─── E. Ballet refund (ballet_refunds) ────────────────────────────────────────

export interface BalletRefundSourceRow {
  id: number;
  applicationId: number;
  paymentId: number;
  status: string;
  requestedAmountEgp: number | null;
  approvedAmountEgp: number | null;
  refundedAmountEgp: number | null;
  /** A real refund transaction reference — never admin_notes. */
  transactionReference: string | null;
  processedAt: string | null;
  reviewedAt: string | null;
  createdAt: string;
  processedByAdminId: number | null;
  reviewedByAdminId: number | null;
  processedByAdminEmail: string | null;
  reviewedByAdminEmail: string | null;
  parentStudentId: number | null;
  parentName: string | null;
  parentEmail: string | null;
  parentPhone: string | null;
  childId: number | null;
  childName: string | null;
  originalPaymentMethod: string | null;
  originalPaymentAmountEgp: number | null;
}

/**
 * A refund at any lifecycle stage carries the exact amounts stored for that
 * stage, but only a COMPLETED refund is money that left the studio.
 *
 * "Completed" uses the same condition as the existing dashboard aggregate:
 * status = 'refunded' AND processed_at IS NOT NULL AND refunded_amount > 0.
 * Requested/approved amounts are exposed separately so a pending refund is
 * visible as exposure without ever being added to paid-out totals, and
 * `amountEgp` deliberately stays null until completion so no caller can sum a
 * pending refund as cash.
 */
export function isCompletedBalletRefund(row: {
  status: string;
  processedAt: string | null;
  refundedAmountEgp: number | null;
}): boolean {
  return (
    row.status === "refunded" &&
    row.processedAt != null &&
    (egpOrNull(row.refundedAmountEgp) ?? 0) > 0
  );
}

export function mapBalletRefund(row: BalletRefundSourceRow): UnifiedFinanceTransaction {
  const completed = isCompletedBalletRefund(row);
  const refunded = egpOrNull(row.refundedAmountEgp);

  const amounts = emptyAmounts();
  amounts.requestedRefundAmountEgp = egpOrNull(row.requestedAmountEgp);
  amounts.approvedRefundAmountEgp = egpOrNull(row.approvedAmountEgp);
  amounts.grossAmountEgp = egpOrNull(row.originalPaymentAmountEgp);
  if (completed && refunded != null) {
    amounts.refundedAmountEgp = refunded;
    // Signed as an outflow so a caller summing netAmountEgp across events
    // cannot accidentally treat a payout as income.
    amounts.amountEgp = refunded;
    amounts.netAmountEgp = -refunded;
  }

  const anyStoredAmount =
    amounts.requestedRefundAmountEgp != null ||
    amounts.approvedRefundAmountEgp != null ||
    amounts.refundedAmountEgp != null;

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.ballet_refunds, row.id),
    eventType: "ballet_refund",
    eventNature: "cash_outflow",
    sourceTable: "ballet_refunds",
    sourceId: row.id,
    amounts,
    amountAvailability: anyStoredAmount ? "exact" : "unknown",
    amountSource: anyStoredAmount ? "ballet_refund_snapshot" : "unavailable",
    credit: emptyCredit(),
    paymentStatus: null,
    refundStatus: normalizeRefundStatus(row.status),
    rawSourceStatus: row.status,
    // The refund inherits the original payment's method classification.
    rawPaymentMethod: row.originalPaymentMethod,
    normalizedPaymentMethod: normalizePaymentMethod(row.originalPaymentMethod),
    occurredAt: row.processedAt ?? row.reviewedAt ?? row.createdAt,
    paidAt: null,
    refundedAt: completed ? row.processedAt : null,
    customer: {
      studentId: row.parentStudentId,
      name: textOrNull(row.parentName),
      email: textOrNull(row.parentEmail),
      phone: textOrNull(row.parentPhone),
      participantScope: "child",
      childId: row.childId,
      childName: textOrNull(row.childName),
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: null,
      packageId: null,
      packageName: null,
      balletApplicationId: row.applicationId,
      balletPaymentId: row.paymentId,
      balletRefundId: row.id,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    // The processing admin is recorded on the row; fall back to the reviewer
    // for rows that have been decided but not yet paid out.
    actor:
      row.processedByAdminId != null || row.processedByAdminEmail != null
        ? { adminId: row.processedByAdminId, adminEmail: textOrNull(row.processedByAdminEmail) }
        : row.reviewedByAdminId != null || row.reviewedByAdminEmail != null
          ? { adminId: row.reviewedByAdminId, adminEmail: textOrNull(row.reviewedByAdminEmail) }
          : null,
    providerReference: textOrNull(row.transactionReference),
    reliability: completed
      ? reliability("recorded_refund")
      : anyStoredAmount
        ? {
          badge: "recorded_refund",
          explanation:
            "Requested and approved amounts are stored exactly as recorded, but this refund has not completed — no cash has been paid out yet.",
        }
        : reliability("unknown_amount"),
    sourceDeepLink: "/ballet/refunds",
  };
}

// ─── F. Package refund (payment_refunds) ─────────────────────────────────────

export interface PackageRefundSourceRow {
  id: number;
  status: string;
  requestedAmountMinor: number;
  approvedAmountMinor: number | null;
  refundedAmountMinor: number | null;
  refundMethod: string;
  requestedReason: string;
  transactionReference: string | null;
  createdAt: string;
  reviewedAt: string | null;
  processedAt: string | null;
  requestedByAdminId: number | null;
  reviewedByAdminId: number | null;
  processedByAdminId: number | null;
  requestedByAdminEmail: string | null;
  reviewedByAdminEmail: string | null;
  processedByAdminEmail: string | null;
  originalPaymentMethod: string | null;
  originalPaymentAmountMinor: number | null;
  packageOrderId: number;
  packageId: number | null;
  packageName: string;
  studentId: number | null;
  studentName: string;
  studentEmail: string;
  studentPhone: string | null;
  participantType: string | null;
  participantChildId: number | null;
  participantName: string | null;
}

function minorToEgpOrNull(value: number | null): number | null {
  return value == null || !Number.isFinite(value) ? null : value / 100;
}

/**
 * Normalize the existing package-refund lifecycle without recalculating it.
 * Requested/approved amounts remain exposure; only a refunded row with stored
 * completion evidence becomes a cash outflow.
 */
export function mapPackageRefund(row: PackageRefundSourceRow): UnifiedFinanceTransaction {
  const completed = row.status === "refunded"
    && row.processedAt != null
    && (row.refundedAmountMinor ?? 0) > 0;
  const requested = minorToEgpOrNull(row.requestedAmountMinor);
  const approved = minorToEgpOrNull(row.approvedAmountMinor);
  const refunded = minorToEgpOrNull(row.refundedAmountMinor);
  const amounts = emptyAmounts();
  amounts.requestedRefundAmountEgp = requested;
  amounts.approvedRefundAmountEgp = approved;
  amounts.grossAmountEgp = minorToEgpOrNull(row.originalPaymentAmountMinor);
  if (completed && refunded != null) {
    amounts.refundedAmountEgp = refunded;
    amounts.amountEgp = refunded;
    amounts.netAmountEgp = -refunded;
  }

  const effectivePaymentMethod = row.refundMethod === "original_payment_method"
    ? row.originalPaymentMethod
    : row.refundMethod;
  const approvedAt = ["approved", "processing", "refunded"].includes(row.status)
    ? row.reviewedAt
    : null;

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.payment_refunds, row.id),
    eventType: "package_refund",
    eventNature: "cash_outflow",
    sourceTable: "payment_refunds",
    sourceId: row.id,
    amounts,
    amountAvailability: "exact",
    amountSource: "package_refund_snapshot",
    credit: emptyCredit(),
    paymentStatus: null,
    refundStatus: normalizeRefundStatus(row.status),
    rawSourceStatus: row.status,
    rawPaymentMethod: effectivePaymentMethod,
    normalizedPaymentMethod: normalizePaymentRecordMethod(effectivePaymentMethod),
    occurredAt: row.processedAt ?? row.reviewedAt ?? row.createdAt,
    paidAt: null,
    refundedAt: completed ? row.processedAt : null,
    customer: {
      studentId: row.studentId,
      name: textOrNull(row.studentName),
      email: textOrNull(row.studentEmail),
      phone: textOrNull(row.studentPhone),
      participantScope: row.participantType === "self" || row.participantType === "child"
        ? row.participantType
        : "unknown",
      childId: row.participantType === "child" ? row.participantChildId : null,
      childName: row.participantType === "child" ? textOrNull(row.participantName) : null,
    },
    references: {
      bookingId: null,
      attendanceId: null,
      packageOrderId: row.packageOrderId,
      packageId: row.packageId,
      packageName: row.packageName,
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      paymentRefundId: row.id,
      promotionRedemptionId: null,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor:
      row.processedByAdminId != null || row.processedByAdminEmail != null
        ? { adminId: row.processedByAdminId, adminEmail: textOrNull(row.processedByAdminEmail) }
        : row.reviewedByAdminId != null || row.reviewedByAdminEmail != null
          ? { adminId: row.reviewedByAdminId, adminEmail: textOrNull(row.reviewedByAdminEmail) }
          : row.requestedByAdminId != null || row.requestedByAdminEmail != null
            ? { adminId: row.requestedByAdminId, adminEmail: textOrNull(row.requestedByAdminEmail) }
            : null,
    providerReference: textOrNull(row.transactionReference),
    refundDetails: {
      reason: textOrNull(row.requestedReason),
      requestedAt: row.createdAt,
      approvedAt,
      completedAt: completed ? row.processedAt : null,
    },
    reliability: completed
      ? reliability("recorded_refund")
      : {
        badge: "recorded_refund",
        explanation:
          "Requested and approved amounts are stored exactly as recorded, but this package refund has not completed — no cash has been paid out yet.",
      },
    sourceDeepLink: "/package-orders",
  };
}

// ─── G. Promotion discount (promotion_redemptions) ────────────────────────────

export interface PromotionRedemptionSourceRow {
  id: number;
  promotionId: number;
  promotionName: string | null;
  studentId: number;
  bookingId: number | null;
  packageOrderId: number | null;
  discountAmount: number | null;
  originalSubtotal: number | null;
  finalSubtotal: number | null;
  redeemedAt: string;
  studentName: string | null;
  studentEmail: string | null;
  studentPhone: string | null;
}

/**
 * A discount is neither cash in nor cash out — it is a reduction that was
 * applied at redemption time. The stored amount is exact, so it is safe to
 * report, but it must never be summed into inflow or outflow totals.
 */
export function mapPromotionDiscount(row: PromotionRedemptionSourceRow): UnifiedFinanceTransaction {
  const discount = egpOrNull(row.discountAmount);
  const gross = egpOrNull(row.originalSubtotal);
  const net = egpOrNull(row.finalSubtotal);

  const amounts = emptyAmounts();
  amounts.discountAmountEgp = discount;
  amounts.amountEgp = discount;
  amounts.grossAmountEgp = gross;
  amounts.netAmountEgp = net;

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.promotion_redemptions, row.id),
    eventType: "promotion_discount",
    eventNature: "discount",
    sourceTable: "promotion_redemptions",
    sourceId: row.id,
    amounts,
    amountAvailability: discount != null ? "exact" : "unknown",
    amountSource: discount != null ? "promotion_redemption_snapshot" : "unavailable",
    credit: emptyCredit(),
    paymentStatus: null,
    refundStatus: null,
    rawSourceStatus: null,
    rawPaymentMethod: null,
    normalizedPaymentMethod: null,
    occurredAt: row.redeemedAt,
    paidAt: null,
    refundedAt: null,
    customer: {
      studentId: row.studentId,
      name: textOrNull(row.studentName),
      email: textOrNull(row.studentEmail),
      phone: textOrNull(row.studentPhone),
      participantScope: "unknown",
      childId: null,
      childName: null,
    },
    references: {
      bookingId: row.bookingId,
      attendanceId: null,
      packageOrderId: row.packageOrderId,
      packageId: null,
      packageName: null,
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: row.id,
      creditTransactionId: null,
    },
    scheduleContext: null,
    actor: null,
    providerReference: null,
    reliability: discount != null ? reliability("recorded_discount") : reliability("unknown_amount"),
    // Prefer the order/booking the discount was applied to; otherwise the
    // Promotions page that owns the promotion itself.
    sourceDeepLink:
      row.packageOrderId != null
        ? "/package-orders"
        : row.bookingId != null
          ? "/bookings"
          : "/promotions",
  };
}

// ─── G/H/I. Credit transactions (credit_transactions) ─────────────────────────

export interface CreditTransactionSourceRow {
  id: number;
  packageOrderId: number;
  studentId: number | null;
  participantType: string | null;
  participantChildId: number | null;
  type: string;
  delta: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId: number | null;
  referenceType: string | null;
  createdAt: string;
  createdBy: string;
  packageName: string | null;
  packageId: number | null;
  studentName: string | null;
  studentEmail: string | null;
  studentPhone: string | null;
  participantName: string | null;
  childName: string | null;
}

/**
 * Credit transaction types proven to exist in the current codebase:
 *   package_activated    — packageOrders.ts activation (positive issuance)
 *   package_bonus        — adminCredits.ts bonus grant (positive issuance)
 *   package_refund       — credits restored on cancellation (positive issuance)
 *   attendance_deduction — checkInService.ts check-in (negative consumption)
 *   manual_adjustment    — adminCredits.ts override (signed either way)
 *
 * `manual_adjustment` maps to `future_manual_adjustment`: those rows really do
 * exist, so the reserved event type describes real data rather than a
 * synthesized event. No new adjustment capability is introduced.
 */
export const CREDIT_ISSUANCE_TYPES = ["package_activated", "package_bonus", "package_refund"] as const;
export const CREDIT_CONSUMPTION_TYPES = ["attendance_deduction"] as const;
export const CREDIT_ADJUSTMENT_TYPES = ["manual_adjustment"] as const;

/**
 * Classify a credit transaction type. Unknown types fall back to sign: a
 * negative delta consumes, anything else issues. Returning null instead would
 * silently drop ledger rows from Finance, which is worse than a sign-based
 * classification that still shows null money and a service-credit badge.
 */
export function classifyCreditTransaction(type: string, delta: number): FinanceEventType {
  if ((CREDIT_ADJUSTMENT_TYPES as readonly string[]).includes(type)) return "future_manual_adjustment";
  if ((CREDIT_ISSUANCE_TYPES as readonly string[]).includes(type)) return "package_credit_issuance";
  if ((CREDIT_CONSUMPTION_TYPES as readonly string[]).includes(type)) return "package_credit_consumption";
  return delta < 0 ? "package_credit_consumption" : "package_credit_issuance";
}

/**
 * Credit events are session units, never money.
 *
 * Every monetary field stays null and amountAvailability is not_applicable, so
 * a consumption can never be read as an expense or negative revenue and an
 * issuance can never be read as income.
 */
export function mapCreditTransaction(row: CreditTransactionSourceRow): UnifiedFinanceTransaction {
  const eventType = classifyCreditTransaction(row.type, row.delta);

  return {
    id: financeEventId(FINANCE_ID_PREFIXES.credit_transactions, row.id),
    eventType,
    eventNature: "service_credit",
    sourceTable: "credit_transactions",
    sourceId: row.id,
    amounts: emptyAmounts(),
    amountAvailability: "not_applicable",
    amountSource: "not_applicable_credit_only",
    credit: {
      unitDelta: row.delta,
      balanceBefore: row.balanceBefore,
      balanceAfter: row.balanceAfter,
    },
    paymentStatus: null,
    refundStatus: null,
    rawSourceStatus: row.type,
    rawPaymentMethod: null,
    // The "method" of a credit event is the credit itself.
    normalizedPaymentMethod: "package_credit",
    occurredAt: row.createdAt,
    paidAt: null,
    refundedAt: null,
    customer: {
      studentId: row.studentId,
      name: textOrNull(row.studentName),
      email: textOrNull(row.studentEmail),
      phone: textOrNull(row.studentPhone),
      participantScope:
        row.participantType === "child"
          ? "child"
          : row.participantType === "self"
            ? "self"
            : "unknown",
      childId: row.participantType === "child" ? row.participantChildId : null,
      childName: row.participantType === "child"
        ? textOrNull(row.childName ?? row.participantName)
        : null,
    },
    references: {
      // referenceType tells us what referenceId points at — only trust the
      // pointer when the row itself says which table it belongs to.
      bookingId: row.referenceType === "booking" ? row.referenceId : null,
      attendanceId: row.referenceType === "attendance" ? row.referenceId : null,
      packageOrderId: row.packageOrderId,
      packageId: row.packageId,
      packageName: textOrNull(row.packageName),
      balletApplicationId: null,
      balletPaymentId: null,
      balletRefundId: null,
      promotionRedemptionId: null,
      creditTransactionId: row.id,
    },
    scheduleContext: null,
    // createdBy is a free-text marker ("system", "mobile:check-in", or an admin
    // email) and carries no admin id, so it is not treated as proven actor
    // attribution. Only an email-shaped value is surfaced.
    actor: row.createdBy.includes("@")
      ? { adminId: null, adminEmail: row.createdBy }
      : null,
    providerReference: null,
    reliability: reliability("service_credit_unit"),
    // Deduction rows link to the attendance context that caused them; every
    // other row links to the owning package order list.
    sourceDeepLink:
      row.referenceType === "attendance" && row.studentEmail
        ? `/attendance?studentEmail=${encodeURIComponent(row.studentEmail)}`
        : "/package-orders",
  };
}

// ─── Family classification ────────────────────────────────────────────────────

/** Which permission family an already-mapped event belongs to. */
export function familyForEventType(eventType: FinanceEventType): FinanceSourceFamily {
  switch (eventType) {
    case "package_purchase": return "package_purchases";
    case "single_class_payment": return "class_payments";
    case "studio_walkin_payment": return "walkin_payments";
    case "ballet_payment": return "ballet_payments";
    case "ballet_assessment_fee": return "ballet_payments";
    case "ballet_refund": return "ballet_refunds";
    case "package_refund": return "package_refunds";
    case "promotion_discount": return "discounts";
    case "package_credit_issuance":
    case "package_credit_consumption":
    case "future_manual_adjustment":
      return "package_credits";
  }
}

// ─── Presentation labels ──────────────────────────────────────────────────────
// Re-exported from the shared contract so the Admin UI and the export render
// exactly the same wording. Kept exported here so existing backend imports
// (financeExport.ts, tests) keep working unchanged.
export {
  FINANCE_EVENT_TYPE_LABELS,
  FINANCE_EVENT_NATURE_LABELS,
  FINANCE_RELIABILITY_LABELS,
  FINANCE_PAYMENT_METHOD_LABELS,
} from "@workspace/api-zod";
