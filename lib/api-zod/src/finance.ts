/**
 * Finance Department — Phase 1 shared read-only contract.
 *
 * Phase 1 is a READ-ONLY visibility and aggregation layer. Nothing in this
 * file describes a mutation, and no Finance endpoint accepts one. Every
 * financial write continues to live in its existing operational page
 * (Package Orders, Bookings, Attendance, Ballet Payments, Ballet Refunds,
 * Promotions) — Finance only normalizes what those pages already recorded and
 * deep-links back to them.
 *
 * ── Locked financial model (do not "improve" these semantics locally) ───────
 *
 * Central Studio currently has NO unified immutable monetary ledger. This
 * contract therefore separates three different kinds of number and never
 * blends them behind a single "revenue" label:
 *
 *   1. RECORDED amounts — a historical amount was actually stored on the row
 *      at the time of the event (`ballet_payments.amount_egp`,
 *      `ballet_refunds.refunded_amount_egp`, `promotion_redemptions.
 *      discount_amount`). These are exact.
 *
 *   2. OPERATIONAL ESTIMATES — no historical amount was ever stored, so the
 *      value is re-derived from TODAY's catalog/schedule/settings price
 *      (generic package orders, generic single-class bookings, studio
 *      walk-ins). A later price edit changes these retroactively. They are
 *      never proof that money was collected.
 *
 *   3. SERVICE CREDITS — `credit_transactions` is an append-only *quantity*
 *      ledger of session units. It is NOT a cash ledger. Credit events carry
 *      unit deltas and null money, and are never converted to EGP.
 *
 * Consequences encoded below:
 *   • `package_orders.status` values (active / fullyUsed / expired) prove
 *     operational activation and credit issuance — NOT payment collection.
 *     Package purchase events therefore always carry `paymentStatus: null`
 *     and keep the real row status in `rawSourceStatus`.
 *   • `paymentMethod: "kashier"` is an admin-recorded classification only.
 *     Provider settlement is unverified. Never label it settled/verified.
 *   • `paymentMethod: "bankTransfer"` is a legacy historical classification,
 *     display-only for new Finance views.
 *   • An unknown amount is `null` — never `0`. Zero means "zero EGP".
 *
 * Forbidden vocabulary anywhere downstream of this contract: "Verified Cash",
 * "Verified Gateway Receipt", "Full Financial Ledger", "Bank-Settled Revenue".
 */

/** What kind of financial event a normalized row represents. */
export const FINANCE_EVENT_TYPES = [
  "package_purchase",
  "single_class_payment",
  "studio_walkin_payment",
  "ballet_payment",
  "ballet_refund",
  "package_refund",
  "promotion_discount",
  "package_credit_issuance",
  "package_credit_consumption",
  "future_manual_adjustment",
] as const;
export type FinanceEventType = (typeof FINANCE_EVENT_TYPES)[number];

/**
 * How the event relates to money. `operational_estimate` deliberately is NOT
 * `cash_inflow`: those rows have no stored historical amount, so they must
 * never be summed into a recorded-cash figure.
 */
export const FINANCE_EVENT_NATURES = [
  "cash_inflow",
  "cash_outflow",
  "operational_estimate",
  "discount",
  "service_credit",
] as const;
export type FinanceEventNature = (typeof FINANCE_EVENT_NATURES)[number];

/** Quality of the monetary figure on this row. */
export const FINANCE_AMOUNT_AVAILABILITIES = [
  /** A historical amount was stored on the source row. */
  "exact",
  /** Re-derived from current pricing; not a historical snapshot. */
  "estimated",
  /** No amount could be resolved at all — monetary fields are null. */
  "unknown",
  /** The event is not monetary (credit-unit events). */
  "not_applicable",
] as const;
export type FinanceAmountAvailability = (typeof FINANCE_AMOUNT_AVAILABILITIES)[number];

/** Where the displayed amount came from. */
export const FINANCE_AMOUNT_SOURCES = [
  "ballet_payment_snapshot",
  "ballet_refund_snapshot",
  "package_refund_snapshot",
  "promotion_redemption_snapshot",
  /** Canonical payment_records creation-time snapshot (Phase 2B writers). */
  "payment_record_snapshot",
  "current_package_catalog_price",
  "current_schedule_price",
  "current_single_class_setting",
  "unavailable",
  "not_applicable_credit_only",
] as const;
export type FinanceAmountSource = (typeof FINANCE_AMOUNT_SOURCES)[number];

/**
 * Single, centralized trust label. Every Finance surface (table badge, detail
 * drawer, export column) renders this instead of inventing its own wording.
 */
export const FINANCE_RELIABILITY_BADGES = [
  /** Admin recorded an in-person collection. Not cash-drawer reconciled. */
  "recorded_collection",
  /** A refund lifecycle completed with a stored refunded amount. */
  "recorded_refund",
  /** A discount amount was stored at redemption time. */
  "recorded_discount",
  /** Amount re-derived from current pricing — not a historical amount. */
  "estimated_operational",
  /** Admin tagged a payment method the system cannot independently verify. */
  "unverified_admin_tag",
  /** Legacy classification retained for display only. */
  "legacy_display_only",
  /** Session units, not money. */
  "service_credit_unit",
  /** No amount could be resolved. */
  "unknown_amount",
] as const;
export type FinanceReliabilityBadge = (typeof FINANCE_RELIABILITY_BADGES)[number];

export const FINANCE_SOURCE_TABLES = [
  "package_orders",
  "bookings",
  "ballet_payments",
  "ballet_refunds",
  "payment_refunds",
  "promotion_redemptions",
  "credit_transactions",
] as const;
export type FinanceSourceTable = (typeof FINANCE_SOURCE_TABLES)[number];

export const FINANCE_PAYMENT_STATUSES = [
  "pending",
  "paid",
  "refunded",
  "rejected",
  "failed",
  "not_required",
] as const;
export type FinancePaymentStatus = (typeof FINANCE_PAYMENT_STATUSES)[number];

export const FINANCE_REFUND_STATUSES = [
  "underReview",
  "approved",
  "rejected",
  "processing",
  "refunded",
  "failed",
  "withdrawn",
] as const;
export type FinanceRefundStatus = (typeof FINANCE_REFUND_STATUSES)[number];

export const FINANCE_PAYMENT_METHODS = [
  "in_person",
  "kashier",
  "bank_transfer",
  "pay_at_studio",
  "online_payment",
  "package_credit",
  // Finance Batch 1: canonical payment_records.confirmed_payment_method
  // vocabulary — a real admin-confirmed collection method, distinct from
  // "in_person" (a Ballet-payments raw value with different provenance).
  "cash",
  "card",
  "unknown",
] as const;
export type FinanceNormalizedPaymentMethod = (typeof FINANCE_PAYMENT_METHODS)[number];

/**
 * Monetary figures for one event, all in whole EGP.
 *
 * `null` means "not known / not applicable" and must never be coerced to 0
 * for display, export, or aggregation.
 */
export interface UnifiedFinanceAmounts {
  amountEgp: number | null;
  grossAmountEgp: number | null;
  discountAmountEgp: number | null;

  /** Refund lifecycle amounts, kept separate — see ballet_refunds. */
  requestedRefundAmountEgp: number | null;
  approvedRefundAmountEgp: number | null;
  /** Only populated once a refund actually completed. */
  refundedAmountEgp: number | null;

  netAmountEgp: number | null;
  currency: "EGP";
}

/** Session-unit movement for credit events. Null on monetary events. */
export interface UnifiedFinanceCredit {
  unitDelta: number | null;
  balanceBefore: number | null;
  balanceAfter: number | null;
}

export interface UnifiedFinanceCustomer {
  studentId: number | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  /** Who actually attends: the account owner, a child, or unresolved. */
  participantScope: "self" | "child" | "unknown";
  childId: number | null;
  childName: string | null;
}

/** Back-references into the operational records this event came from. */
export interface UnifiedFinanceReferences {
  bookingId: number | null;
  attendanceId: number | null;

  packageOrderId: number | null;
  packageId: number | null;
  packageName: string | null;

  balletApplicationId: number | null;
  balletPaymentId: number | null;
  balletRefundId: number | null;

  /** Present for package refunds sourced from payment_refunds. */
  paymentRefundId?: number | null;

  promotionRedemptionId: number | null;
  creditTransactionId: number | null;
}

/** Read-only lifecycle evidence carried by refund events. */
export interface UnifiedFinanceRefundDetails {
  reason: string | null;
  requestedAt: string | null;
  approvedAt: string | null;
  completedAt: string | null;
}

export interface UnifiedFinanceScheduleContext {
  classId: number | null;
  classTitle: string | null;
  scheduleId: number | null;
  occurrenceDate: string | null;
}

/**
 * The admin the current records prove was involved. Left null rather than
 * guessed — a check-in timestamp is not proof of who collected money.
 */
export interface UnifiedFinanceActor {
  adminId: number | null;
  adminEmail: string | null;
}

export interface UnifiedFinanceReliability {
  badge: FinanceReliabilityBadge;
  /** Plain-language statement of exactly what this figure does and does not prove. */
  explanation: string;
}

/**
 * One normalized, read-only financial event.
 *
 * `id` is a synthetic, stable event id of the form `<sourcePrefix>:<sourceId>`
 * (e.g. `bp:41`) — it is the deterministic secondary sort key and the value
 * exposed for search, so a row stays addressable across pages even though the
 * underlying tables have independent id sequences.
 */
export interface UnifiedFinanceTransaction {
  id: string;

  eventType: FinanceEventType;
  eventNature: FinanceEventNature;

  sourceTable: FinanceSourceTable;
  sourceId: number;

  amounts: UnifiedFinanceAmounts;
  amountAvailability: FinanceAmountAvailability;
  amountSource: FinanceAmountSource;

  credit: UnifiedFinanceCredit;

  /**
   * Normalized payment status. `null` for events where the source row's status
   * does not prove anything about payment — notably package purchases, whose
   * active/fullyUsed/expired status must never be read as "paid".
   */
  paymentStatus: FinancePaymentStatus | null;
  refundStatus: FinanceRefundStatus | null;

  /** Verbatim status from the source table, for audit/debugging. */
  rawSourceStatus: string | null;
  /** Verbatim payment method from the source table. */
  rawPaymentMethod: string | null;
  normalizedPaymentMethod: FinanceNormalizedPaymentMethod | null;

  occurredAt: string;
  /** Only set when an explicit payment timestamp exists on the source row. */
  paidAt: string | null;
  refundedAt: string | null;

  customer: UnifiedFinanceCustomer;
  references: UnifiedFinanceReferences;
  scheduleContext: UnifiedFinanceScheduleContext | null;
  actor: UnifiedFinanceActor | null;

  /**
   * A real provider/transaction reference from the source row only. Free-text
   * admin notes are NOT provider references and never appear here.
   */
  providerReference: string | null;

  /** Refund-only audit metadata; omitted for non-refund events. */
  refundDetails?: UnifiedFinanceRefundDetails | null;

  reliability: UnifiedFinanceReliability;

  /** Route into the existing operational page that owns this record. */
  sourceDeepLink: string | null;
}

// ─── Event source families (permission gating unit) ───────────────────────────

/**
 * Permission-gating groups. The unified endpoint filters by family BEFORE
 * counting and paginating, so an admin never receives — or is counted a total
 * for — a family they cannot view.
 */
export const FINANCE_SOURCE_FAMILIES = [
  "package_purchases",
  "class_payments",
  "walkin_payments",
  "ballet_payments",
  "ballet_refunds",
  "package_refunds",
  "discounts",
  "package_credits",
] as const;
export type FinanceSourceFamily = (typeof FINANCE_SOURCE_FAMILIES)[number];

/** Which permission (module, action) each family requires. */
export const FINANCE_FAMILY_PERMISSIONS: Readonly<
  Record<FinanceSourceFamily, readonly [module: string, action: string]>
> = {
  package_purchases: ["packageOrders", "view"],
  class_payments: ["bookings", "view"],
  walkin_payments: ["attendance", "view"],
  ballet_payments: ["ballet.payments", "view"],
  ballet_refunds: ["ballet.payments", "view"],
  package_refunds: ["packageOrders", "view"],
  discounts: ["promotions", "view"],
  package_credits: ["credits", "history"],
};

/** Which event types each family emits — used to intersect type filters. */
export const FINANCE_FAMILY_EVENT_TYPES: Readonly<
  Record<FinanceSourceFamily, readonly FinanceEventType[]>
> = {
  package_purchases: ["package_purchase"],
  class_payments: ["single_class_payment"],
  walkin_payments: ["studio_walkin_payment"],
  ballet_payments: ["ballet_payment"],
  ballet_refunds: ["ballet_refund"],
  package_refunds: ["package_refund"],
  discounts: ["promotion_discount"],
  package_credits: [
    "package_credit_issuance",
    "package_credit_consumption",
    "future_manual_adjustment",
  ],
};

// ─── Overview response ───────────────────────────────────────────────────────

/**
 * Finance Overview. Three deliberately separate sections so a recorded figure
 * can never be silently added to an estimated one.
 *
 * `hybrid` exists only because the current Dashboard already shows a blended
 * total and Phase 1 must stay backward compatible. Hybrid values are
 * indicators, not audited revenue, and must always render inside a section
 * that says so.
 */
export interface FinanceOverviewResponse {
  generatedAt: string;
  /** Mandatory, user-visible caveats. Never suppress these in the UI. */
  warnings: string[];

  recorded: {
    balletGrossRecordedEgp: number;
    balletCompletedRefundsEgp: number;
    balletNetRecordedEgp: number;
    balletInPersonRecordedEgp: number;
    /** Admin-recorded Kashier *method*, not verified provider settlement. */
    balletKashierAdminRecordedEgp: number;
    balletLegacyBankTransferEgp: number;
    /** Approved/processing refunds not yet paid out. Not a completed refund. */
    approvedRefundExposureEgp: number;
    /** Null when the caller lacks Promotions view permission. */
    discountsRecordedEgp: number | null;
  };

  estimated: {
    genericPackageOperationalEstimateEgp: number;
    genericSingleClassOperationalEstimateEgp: number;
    genericOperationalEstimateEgp: number;
  };

  hybrid: {
    totalGrossHybridIndicatorEgp: number;
    totalNetHybridIndicatorEgp: number;
  };

  limitations: {
    genericHistoricalAmountsStored: false;
    gatewaySettlementVerified: false;
    unifiedMonetaryLedgerAvailable: false;
  };
}

/** Warning text is centralized so API, UI, and exports cannot drift apart. */
export const FINANCE_ESTIMATE_WARNING =
  "Generic Studio amounts are operational estimates derived from current catalog pricing. They are not historically snapshotted payment amounts.";

export const FINANCE_KASHIER_WARNING =
  "Kashier values represent admin-recorded payment methods. Provider settlement is not verified by the current system.";

export const FINANCE_EXPORT_ESTIMATE_WARNING =
  "Generic Studio amounts may be estimated from current catalog pricing and must not be treated as historically verified payment transactions.";

export const FINANCE_EXPORT_KASHIER_WARNING =
  "Kashier values are admin-recorded method classifications; provider settlement is not verified.";

/** The one approved name for the Finance export. */
export const FINANCE_EXPORT_TITLE = "Unified Finance Activity Export";

// ─── Transactions list response ──────────────────────────────────────────────

export interface FinanceTransactionsResponse {
  data: UnifiedFinanceTransaction[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
  /** Families the caller is permitted to see — drives UI filter options. */
  visibleFamilies: FinanceSourceFamily[];
}

// ─── Presentation labels ──────────────────────────────────────────────────────
// Centralized so the Admin table, the detail drawer, and the export all render
// identical wording for an event type, nature, reliability badge, or payment
// method. A label must never be re-spelled at a call site.

export const FINANCE_EVENT_TYPE_LABELS: Readonly<Record<FinanceEventType, string>> = {
  package_purchase: "Package Purchase",
  single_class_payment: "Single Class Payment",
  studio_walkin_payment: "Studio Walk-in Payment",
  ballet_payment: "Ballet Payment",
  ballet_refund: "Ballet Refund",
  package_refund: "Package Refund",
  promotion_discount: "Promotion Discount",
  package_credit_issuance: "Package Credit Issued",
  package_credit_consumption: "Package Credit Used",
  future_manual_adjustment: "Manual Credit Adjustment",
};

export const FINANCE_EVENT_NATURE_LABELS: Readonly<Record<FinanceEventNature, string>> = {
  cash_inflow: "Cash Inflow",
  cash_outflow: "Cash Outflow",
  operational_estimate: "Operational Estimate",
  discount: "Discount",
  service_credit: "Service Credit",
};

export const FINANCE_RELIABILITY_LABELS: Readonly<Record<FinanceReliabilityBadge, string>> = {
  recorded_collection: "Recorded Collection",
  recorded_refund: "Recorded Refund",
  recorded_discount: "Recorded Discount",
  estimated_operational: "Estimated (Operational)",
  // Never "Verified" — the system cannot verify provider settlement.
  unverified_admin_tag: "Unverified Admin Tag",
  legacy_display_only: "Legacy (Display Only)",
  service_credit_unit: "Service Credit Unit",
  unknown_amount: "Unknown Amount",
};

export const FINANCE_PAYMENT_METHOD_LABELS: Readonly<
  Record<FinanceNormalizedPaymentMethod, string>
> = {
  in_person: "In Person",
  // The qualifier is part of the label so a screenshot of the table alone
  // cannot be read as a settled gateway receipt.
  kashier: "Kashier (admin-recorded)",
  bank_transfer: "Bank Transfer (legacy)",
  pay_at_studio: "Pay at Studio",
  online_payment: "Online Payment",
  package_credit: "Package Credit",
  cash: "Cash",
  card: "Card",
  unknown: "Unknown",
};

export const FINANCE_SOURCE_FAMILY_LABELS: Readonly<Record<FinanceSourceFamily, string>> = {
  package_purchases: "Package Purchases",
  class_payments: "Class Payments",
  walkin_payments: "Studio Walk-ins",
  ballet_payments: "Ballet Payments",
  ballet_refunds: "Ballet Refunds",
  package_refunds: "Package Refunds",
  discounts: "Discounts",
  package_credits: "Package Credits",
};

export const FINANCE_AMOUNT_AVAILABILITY_LABELS: Readonly<
  Record<FinanceAmountAvailability, string>
> = {
  exact: "Exact (stored amount)",
  estimated: "Estimated (current pricing)",
  unknown: "Unknown",
  not_applicable: "Not applicable (credits)",
};
