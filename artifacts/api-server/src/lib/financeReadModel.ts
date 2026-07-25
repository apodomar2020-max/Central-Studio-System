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
  ballet_refunds: "br",
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
    case "kashier": return "kashier";
    case "bankTransfer": return "bank_transfer";
    case "pay_at_studio": return "pay_at_studio";
    case "online_payment": return "online_payment";
    case "package_credit": return "package_credit";
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
}

/**
 * A package order is an OPERATIONAL record, not a receipt.
 *
 * `status` in (active, fullyUsed, expired) proves an admin approved the order
 * and credits were issued — it does not prove money was collected, and there
 * is no column anywhere that records the collected amount. So:
 *   • paymentStatus is null (never "paid"),
 *   • the real status is preserved in rawSourceStatus,
 *   • the amount is today's catalog price, flagged estimated,
 *   • an unresolvable price yields null money and unknown_amount.
 */
export function mapPackagePurchase(row: PackageOrderSourceRow): UnifiedFinanceTransaction {
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
 * Both are the same table with the same missing information — bookings store
 * no historical amount — so they share one mapper and differ only in event
 * type, walk-in actor attribution, and deep link. The amount uses the SAME
 * fallback order as the existing dashboard aggregate
 * (coalesce(schedule.priceEgp, classPricingSettings.singleClassPriceEgp)) so
 * Finance can never disagree with the Dashboard about a generic figure.
 *
 * paidAt stays null: no booking column records a payment instant, and an
 * attendance check-in time must never be silently promoted to a payment time.
 */
export function mapBookingPayment(row: BookingSourceRow): UnifiedFinanceTransaction {
  const schedulePrice = egpOrNull(row.schedulePriceEgp);
  const settingPrice = egpOrNull(row.singleClassSettingEgp);
  const resolvedPrice = schedulePrice ?? settingPrice;

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

// ─── F. Promotion discount (promotion_redemptions) ────────────────────────────

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
      participantScope: "unknown",
      childId: null,
      childName: null,
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
    case "ballet_refund": return "ballet_refunds";
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
