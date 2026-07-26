/**
 * Finance Phase 2D-1 — historical backfill classifier.
 *
 * ONE canonical, read-only (SELECT-only, no writes) classifier used today by
 * the zero-write dry-run planner (financeBackfillDryRun.ts) and, later, by a
 * Phase 2D-2 writer. Every exported `classify*` function is a pure function:
 * it takes already-fetched, minimal row shapes and returns a
 * FinanceBackfillClassification — it never touches the database itself, so
 * it is trivially unit-testable without a Postgres instance.
 *
 * Source tables (package_orders, bookings) have NO amount columns — amounts
 * only ever exist in payment_records, written by the live-capture paths
 * (Finance Phase 2B/2C). That means `exact_evidence_eligible` requires an
 * exact source-time amount snapshot that, for historical rows created
 * before Phase 2B existed, essentially never exists. This module still
 * implements that code path correctly (a future source table could carry
 * one, or a caller could supply one from an immutable historical record) —
 * it is simply expected to be rare-to-empty against real data today.
 *
 * writable is ALWAYS hardcoded `false` in this phase. No caller of this
 * module may treat any classification result as authorization to write.
 */
import {
  type AmountReliability as AmountTier,
  type DiscountReliability as DiscountTier,
  type PaymentStatusReliability as PaymentStatusTier,
  type PaymentMethodReliability as PaymentMethodTier,
  type TimestampReliability as TimestampTier,
  type ActorReliability as ActorTier,
  isExactAmountReliability as isExactAmountTier,
  isExactDiscountReliability as isExactDiscountTier,
  isExactTimestampReliability as isExactTimestampTier,
} from "./financeReliabilityTaxonomy";

// ── Stable reason code vocabulary ──────────────────────────────────────────
export const FINANCE_BACKFILL_REASON_CODES = [
  "already_canonical",
  "exact_evidence_eligible",
  "estimated_amount_manual_review",
  "unknown_amount_manual_review",
  "legacy_pending_booking_manual_review",
  "legacy_pending_package_manual_review",
  "historical_fulfilled_unverified",
  "package_credit_excluded",
  "free_mode_excluded",
  "studio_walkin_reporting_only",
  "cancelled_or_rejected_excluded",
  "multiple_finance_records_corrupt",
  "mismatched_finance_record_corrupt",
  "missing_schedule_or_class_ambiguous",
  "ambiguous_historical_payment_state",
  "source_link_integrity_error",
] as const;
export type FinanceBackfillReasonCode = (typeof FINANCE_BACKFILL_REASON_CODES)[number];

// ── Classification codes per source family ─────────────────────────────────
export const PACKAGE_ORDER_CLASSIFICATION_CODES = [
  "already_canonical",
  "exact_evidence_eligible",
  "estimated_amount_manual_review",
  "unknown_amount_manual_review",
  "legacy_pending_package_manual_review",
  "historical_fulfilled_unverified",
  "cancelled_or_rejected_excluded",
  "multiple_finance_records_corrupt",
  "mismatched_finance_record_corrupt",
  "activation_credit_without_finance_record",
  "ambiguous_historical_payment_state",
] as const;
export type PackageOrderClassificationCode = (typeof PACKAGE_ORDER_CLASSIFICATION_CODES)[number];

export const BOOKING_CLASSIFICATION_CODES = [
  "already_canonical",
  "exact_evidence_eligible",
  "estimated_amount_manual_review",
  "unknown_amount_manual_review",
  "legacy_pending_booking_manual_review",
  "historical_fulfilled_unverified",
  "cancelled_or_rejected_excluded",
  "package_credit_excluded",
  "free_mode_excluded",
  "studio_walkin_reporting_only",
  "missing_schedule_or_class_ambiguous",
  "multiple_finance_records_corrupt",
  "mismatched_finance_record_corrupt",
] as const;
export type BookingClassificationCode = (typeof BOOKING_CLASSIFICATION_CODES)[number];

export const STUDIO_WALKIN_CLASSIFICATION_CODES = [
  "already_canonical",
  "canonical_paid",
  "canonical_package_credit",
  "canonical_not_paid_abort",
  "historical_attendance_paid_evidence",
  "historical_attendance_package_credit_evidence",
  "historical_attendance_ambiguous",
  "corrupt_mismatched",
] as const;
export type StudioWalkinClassificationCode = (typeof STUDIO_WALKIN_CLASSIFICATION_CODES)[number];

export type FinanceBackfillClassificationCode =
  | PackageOrderClassificationCode
  | BookingClassificationCode
  | StudioWalkinClassificationCode;

export const ELIGIBILITY_CLASSES = [
  "automatic_exact",
  "manual_review",
  "excluded",
  "already_canonical",
  "corrupt",
] as const;
export type EligibilityClass = (typeof ELIGIBILITY_CLASSES)[number];

export const SOURCE_FAMILIES = ["package_orders", "bookings", "studio_walkins"] as const;
export type SourceFamily = (typeof SOURCE_FAMILIES)[number];

export type TargetFlowType = "package_purchase" | "single_class_booking" | "studio_walkin" | null;
export type TargetEventType = "legacy_created" | null;

/**
 * Canonical, sensitive-data-safe classification result. No PII (student
 * name/email/phone) is ever placed on this type — only internal numeric IDs
 * and operational metadata safe for aggregate reporting.
 */
export interface FinanceBackfillClassification {
  sourceFamily: SourceFamily;
  sourceKind: string;
  sourceId: number;

  classificationCode: FinanceBackfillClassificationCode;
  eligibility: EligibilityClass;
  evidenceClass: "confirmed" | "legacy_operational_status" | "unknown";
  amountAvailability: "exact" | "estimated_backfill" | "unknown";
  amountSource: "creation_snapshot" | "catalog_price_at_backfill_time" | "unresolvable";

  grossAmountMinor: number | null;
  discountAmountMinor: number | null;
  finalPayableAmountMinor: number | null;
  currency: "EGP" | null;

  operationalSourceStatus: string;
  inferredFinanceTargetStatus: string | null;
  targetFlowType: TargetFlowType;
  targetEventType: TargetEventType;

  sourceCreatedAt: string;
  paidTimestampEvidenceClass: TimestampTier;
  paymentMethodEvidenceClass: PaymentMethodTier;
  actorEvidenceClass: ActorTier;

  reasonCodes: FinanceBackfillReasonCode[];
  warningCodes: FinanceBackfillReasonCode[];

  /** Separately labelled — MUST NOT be summed into an authoritative total. */
  currentPriceEstimateMinor: number | null;

  isExactEvidenceEligible: boolean;
  /** Hardcoded false throughout Phase 2D-1 — no writer exists yet. */
  writable: false;

  amountTier: AmountTier;
  discountTier: DiscountTier;
  paymentStatusTier: PaymentStatusTier;
}

// ── Minimal input shapes (no PII fields — callers project rows down to these) ──
export interface PaymentRecordSummaryInput {
  id: number;
  flowType: string;
  packageOrderId: number | null;
  bookingId: number | null;
  status: string;
}

export interface PackageOrderClassifyInput {
  id: number;
  status: string;
  activatedAt: string | null;
  createdAt: string;
  packageId: number | null;
}

export interface BookingClassifyInput {
  id: number;
  bookingStatus: string;
  paymentStatus: string;
  paymentMode: string | null;
  scheduleId: number | null;
  classId: number | null;
  balletScheduleId: number | null;
  createdAt: string;
  isStudioWalkinLinked: boolean;
}

export interface AttendanceClassifyInput {
  id: number;
  bookingId: number | null;
  creditDeducted: boolean;
  status: string;
  checkedInAt: string;
}

function findExactlyOneMatch(records: PaymentRecordSummaryInput[]): {
  match: PaymentRecordSummaryInput | null;
  multiple: boolean;
} {
  if (records.length === 0) return { match: null, multiple: false };
  if (records.length > 1) return { match: null, multiple: true };
  return { match: records[0], multiple: false };
}

function baseResult(
  sourceFamily: SourceFamily,
  sourceKind: string,
  sourceId: number,
  sourceCreatedAt: string,
): Omit<
  FinanceBackfillClassification,
  | "classificationCode"
  | "eligibility"
  | "evidenceClass"
  | "amountAvailability"
  | "amountSource"
  | "operationalSourceStatus"
  | "inferredFinanceTargetStatus"
  | "targetFlowType"
  | "targetEventType"
  | "reasonCodes"
  | "warningCodes"
  | "amountTier"
  | "discountTier"
  | "paymentStatusTier"
> {
  return {
    sourceFamily,
    sourceKind,
    sourceId,
    grossAmountMinor: null,
    discountAmountMinor: null,
    finalPayableAmountMinor: null,
    currency: null,
    sourceCreatedAt,
    paidTimestampEvidenceClass: "unknown",
    paymentMethodEvidenceClass: "unknown",
    actorEvidenceClass: "unknown_historical_actor",
    currentPriceEstimateMinor: null,
    isExactEvidenceEligible: false,
    writable: false,
  };
}

// ── Package orders ──────────────────────────────────────────────────────────

export function classifyPackageOrder(
  order: PackageOrderClassifyInput,
  existingRecords: PaymentRecordSummaryInput[],
  catalogPriceMinor: number | null,
): FinanceBackfillClassification {
  const base = baseResult("package_orders", "package_order", order.id, order.createdAt);
  const own = existingRecords.filter((r) => r.flowType === "package_purchase" && r.packageOrderId === order.id);
  const foreign = existingRecords.filter((r) => r.packageOrderId === order.id && r.flowType !== "package_purchase");
  const { match, multiple } = findExactlyOneMatch(own);

  if (foreign.length > 0 || multiple) {
    return {
      ...base,
      classificationCode: multiple ? "multiple_finance_records_corrupt" : "mismatched_finance_record_corrupt",
      eligibility: "corrupt",
      evidenceClass: "unknown",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: order.status,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: [multiple ? "multiple_finance_records_corrupt" : "mismatched_finance_record_corrupt"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "ambiguous",
    };
  }

  if (match) {
    return {
      ...base,
      classificationCode: "already_canonical",
      eligibility: "already_canonical",
      evidenceClass: "confirmed",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: order.status,
      inferredFinanceTargetStatus: match.status,
      targetFlowType: "package_purchase",
      targetEventType: null,
      reasonCodes: ["already_canonical"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "confirmed_operationally",
    };
  }

  if (order.status === "cancelled" || order.status === "rejected") {
    return {
      ...base,
      classificationCode: "cancelled_or_rejected_excluded",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: order.status,
      inferredFinanceTargetStatus: "cancelled",
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["cancelled_or_rejected_excluded"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "cancelled_or_rejected",
    };
  }

  const warnings: FinanceBackfillReasonCode[] = [];
  if (order.status === "active" && order.activatedAt) {
    warnings.push("ambiguous_historical_payment_state");
  }

  // No exact source-time snapshot exists on package_orders today, so the
  // strongest amount evidence achievable here is a catalog-price estimate.
  const amountTier: AmountTier = catalogPriceMinor != null ? "estimated_operational" : "unknown_amount";
  const isExact = false; // package_orders never carries an exact-source-time amount snapshot today.

  if (order.status === "pendingPayment") {
    return {
      ...base,
      classificationCode: "legacy_pending_package_manual_review",
      eligibility: "manual_review",
      evidenceClass: "unknown",
      amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
      amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
      operationalSourceStatus: order.status,
      inferredFinanceTargetStatus: "unpaid",
      targetFlowType: "package_purchase",
      targetEventType: "legacy_created",
      currentPriceEstimateMinor: catalogPriceMinor,
      reasonCodes: ["legacy_pending_package_manual_review"],
      warningCodes: warnings,
      isExactEvidenceEligible: isExact,
      amountTier,
      discountTier: "unknown_discount",
      paymentStatusTier: "operational_pending",
    } as FinanceBackfillClassification;
  }

  if (order.status === "active") {
    if (!order.activatedAt) {
      return {
        ...base,
        classificationCode: "activation_credit_without_finance_record",
        eligibility: "manual_review",
        evidenceClass: "legacy_operational_status",
        amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
        amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
        operationalSourceStatus: order.status,
        inferredFinanceTargetStatus: "legacy_unverified",
        targetFlowType: "package_purchase",
        targetEventType: "legacy_created",
        currentPriceEstimateMinor: catalogPriceMinor,
        reasonCodes: ["ambiguous_historical_payment_state"],
        warningCodes: ["ambiguous_historical_payment_state"],
        amountTier,
        discountTier: "unknown_discount",
        paymentStatusTier: "ambiguous",
      } as FinanceBackfillClassification;
    }

    const code: PackageOrderClassificationCode =
      amountTier === "unknown_amount" ? "unknown_amount_manual_review" : "estimated_amount_manual_review";
    return {
      ...base,
      classificationCode: code,
      eligibility: "manual_review",
      evidenceClass: "legacy_operational_status",
      amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
      amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
      operationalSourceStatus: order.status,
      inferredFinanceTargetStatus: "legacy_unverified",
      targetFlowType: "package_purchase",
      targetEventType: "legacy_created",
      currentPriceEstimateMinor: catalogPriceMinor,
      reasonCodes: [code === "estimated_amount_manual_review" ? "estimated_amount_manual_review" : "unknown_amount_manual_review"],
      warningCodes: warnings,
      amountTier,
      discountTier: "unknown_discount",
      paymentStatusTier: "fulfilled_unverified",
    } as FinanceBackfillClassification;
  }

  // Any other/unrecognized status: fulfilled-unverified fallback, never invented as canonical.
  return {
    ...base,
    classificationCode: "historical_fulfilled_unverified",
    eligibility: "manual_review",
    evidenceClass: "legacy_operational_status",
    amountAvailability: "unknown",
    amountSource: "unresolvable",
    operationalSourceStatus: order.status,
    inferredFinanceTargetStatus: "legacy_unverified",
    targetFlowType: "package_purchase",
    targetEventType: "legacy_created",
    reasonCodes: ["historical_fulfilled_unverified"],
    warningCodes: [],
    amountTier: "unknown_amount",
    discountTier: "unknown_discount",
    paymentStatusTier: "unknown",
  } as FinanceBackfillClassification;
}

// ── Bookings ────────────────────────────────────────────────────────────────

export function classifyBooking(
  booking: BookingClassifyInput,
  existingRecords: PaymentRecordSummaryInput[],
  catalogPriceMinor: number | null,
): FinanceBackfillClassification {
  const base = baseResult("bookings", "booking", booking.id, booking.createdAt);
  const own = existingRecords.filter(
    (r) => (r.flowType === "single_class_booking" || r.flowType === "studio_walkin") && r.bookingId === booking.id,
  );
  const { match, multiple } = findExactlyOneMatch(own);

  if (multiple) {
    return {
      ...base,
      classificationCode: "multiple_finance_records_corrupt",
      eligibility: "corrupt",
      evidenceClass: "unknown",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["multiple_finance_records_corrupt"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "ambiguous",
    };
  }

  if (match && match.flowType === "studio_walkin") {
    return {
      ...base,
      classificationCode: "mismatched_finance_record_corrupt",
      eligibility: "corrupt",
      evidenceClass: "unknown",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: match.status,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["mismatched_finance_record_corrupt"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "ambiguous",
    };
  }

  if (match) {
    return {
      ...base,
      classificationCode: "already_canonical",
      eligibility: "already_canonical",
      evidenceClass: "confirmed",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: match.status,
      targetFlowType: "single_class_booking",
      targetEventType: null,
      reasonCodes: ["already_canonical"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "confirmed_operationally",
    };
  }

  if (booking.isStudioWalkinLinked) {
    return {
      ...base,
      classificationCode: "studio_walkin_reporting_only",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["studio_walkin_reporting_only"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "unknown",
    };
  }

  if (booking.bookingStatus === "cancelled" || booking.bookingStatus === "rejected") {
    return {
      ...base,
      classificationCode: "cancelled_or_rejected_excluded",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: "cancelled",
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["cancelled_or_rejected_excluded"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "cancelled_or_rejected",
    };
  }

  if (booking.paymentMode === "package_credit") {
    return {
      ...base,
      classificationCode: "package_credit_excluded",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["package_credit_excluded"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "unknown",
    };
  }

  if (booking.paymentMode === "free") {
    return {
      ...base,
      classificationCode: "free_mode_excluded",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["free_mode_excluded"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "unknown",
    };
  }

  if (booking.scheduleId == null && booking.classId == null && booking.balletScheduleId == null) {
    return {
      ...base,
      classificationCode: "missing_schedule_or_class_ambiguous",
      eligibility: "manual_review",
      evidenceClass: "unknown",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: "legacy_unverified",
      targetFlowType: "single_class_booking",
      targetEventType: "legacy_created",
      reasonCodes: ["missing_schedule_or_class_ambiguous"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "unknown",
    };
  }

  const amountTier: AmountTier = catalogPriceMinor != null ? "estimated_operational" : "unknown_amount";

  if (booking.paymentStatus === "pending_payment" || booking.paymentStatus === "not_required") {
    return {
      ...base,
      classificationCode: "legacy_pending_booking_manual_review",
      eligibility: "manual_review",
      evidenceClass: "unknown",
      amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
      amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: "unpaid",
      targetFlowType: "single_class_booking",
      targetEventType: "legacy_created",
      currentPriceEstimateMinor: catalogPriceMinor,
      reasonCodes: ["legacy_pending_booking_manual_review"],
      warningCodes: [],
      amountTier,
      discountTier: "unknown_discount",
      paymentStatusTier: "operational_pending",
    } as FinanceBackfillClassification;
  }

  if (booking.paymentStatus === "paid") {
    const code: BookingClassificationCode =
      amountTier === "unknown_amount" ? "unknown_amount_manual_review" : "estimated_amount_manual_review";
    return {
      ...base,
      classificationCode: code,
      eligibility: "manual_review",
      evidenceClass: "legacy_operational_status",
      amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
      amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
      operationalSourceStatus: booking.bookingStatus,
      inferredFinanceTargetStatus: "legacy_unverified",
      targetFlowType: "single_class_booking",
      targetEventType: "legacy_created",
      currentPriceEstimateMinor: catalogPriceMinor,
      reasonCodes: [code],
      warningCodes: [],
      amountTier,
      discountTier: "unknown_discount",
      paymentStatusTier: "fulfilled_unverified",
    } as FinanceBackfillClassification;
  }

  return {
    ...base,
    classificationCode: "historical_fulfilled_unverified",
    eligibility: "manual_review",
    evidenceClass: "legacy_operational_status",
    amountAvailability: amountTier === "unknown_amount" ? "unknown" : "estimated_backfill",
    amountSource: amountTier === "unknown_amount" ? "unresolvable" : "catalog_price_at_backfill_time",
    operationalSourceStatus: booking.bookingStatus,
    inferredFinanceTargetStatus: "legacy_unverified",
    targetFlowType: "single_class_booking",
    targetEventType: "legacy_created",
    currentPriceEstimateMinor: catalogPriceMinor,
    reasonCodes: ["historical_fulfilled_unverified"],
    warningCodes: [],
    amountTier,
    discountTier: "unknown_discount",
    paymentStatusTier: "fulfilled_unverified",
  } as FinanceBackfillClassification;
}

// ── Studio walk-ins (attendance rows) — REPORTING ONLY, writable always false ──

export function classifyStudioWalkinAttendance(
  attendance: AttendanceClassifyInput,
  linkedBooking: BookingClassifyInput | null,
  existingRecords: PaymentRecordSummaryInput[],
): FinanceBackfillClassification {
  const base = baseResult("studio_walkins", "attendance", attendance.id, attendance.checkedInAt);

  if (linkedBooking) {
    const own = existingRecords.filter((r) => r.flowType === "studio_walkin" && r.bookingId === linkedBooking.id);
    const { match, multiple } = findExactlyOneMatch(own);

    if (multiple) {
      return {
        ...base,
        classificationCode: "corrupt_mismatched",
        eligibility: "corrupt",
        evidenceClass: "unknown",
        amountAvailability: "unknown",
        amountSource: "unresolvable",
        operationalSourceStatus: attendance.status,
        inferredFinanceTargetStatus: null,
        targetFlowType: null,
        targetEventType: null,
        reasonCodes: ["multiple_finance_records_corrupt"],
        warningCodes: [],
        amountTier: "unknown_amount",
        discountTier: "unknown_discount",
        paymentStatusTier: "ambiguous",
      };
    }

    if (match) {
      const code: StudioWalkinClassificationCode =
        match.status === "paid" ? "canonical_paid" : "already_canonical";
      return {
        ...base,
        classificationCode: code,
        eligibility: "already_canonical",
        evidenceClass: "confirmed",
        amountAvailability: "unknown",
        amountSource: "unresolvable",
        operationalSourceStatus: attendance.status,
        inferredFinanceTargetStatus: match.status,
        targetFlowType: "studio_walkin",
        targetEventType: null,
        reasonCodes: ["already_canonical"],
        warningCodes: [],
        amountTier: "unknown_amount",
        discountTier: "unknown_discount",
        paymentStatusTier: "confirmed_operationally",
      };
    }
  }

  // No linked booking / no matching payment record: this is a pre-Finance
  // historical walk-in attendance row. Reporting only — never writable.
  if (attendance.creditDeducted) {
    return {
      ...base,
      classificationCode: "historical_attendance_package_credit_evidence",
      eligibility: "excluded",
      evidenceClass: "legacy_operational_status",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: attendance.status,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["studio_walkin_reporting_only", "package_credit_excluded"],
      warningCodes: [],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "unknown",
    };
  }

  if (attendance.status === "cancelled" || attendance.status === "absent") {
    return {
      ...base,
      classificationCode: "historical_attendance_ambiguous",
      eligibility: "excluded",
      evidenceClass: "unknown",
      amountAvailability: "unknown",
      amountSource: "unresolvable",
      operationalSourceStatus: attendance.status,
      inferredFinanceTargetStatus: null,
      targetFlowType: null,
      targetEventType: null,
      reasonCodes: ["ambiguous_historical_payment_state"],
      warningCodes: ["ambiguous_historical_payment_state"],
      amountTier: "unknown_amount",
      discountTier: "unknown_discount",
      paymentStatusTier: "ambiguous",
    };
  }

  // checked_in / late with no linked booking and no credit deduction: some
  // legacy admin-recorded walk-ins imply a cash payment was taken at the
  // door without any Finance capture existing at the time.
  return {
    ...base,
    classificationCode: "historical_attendance_paid_evidence",
    eligibility: "manual_review",
    evidenceClass: "legacy_operational_status",
    amountAvailability: "unknown",
    amountSource: "unresolvable",
    operationalSourceStatus: attendance.status,
    inferredFinanceTargetStatus: "legacy_unverified",
    targetFlowType: "studio_walkin",
    targetEventType: "legacy_created",
    reasonCodes: ["studio_walkin_reporting_only", "historical_fulfilled_unverified"],
    warningCodes: [],
    amountTier: "unknown_amount",
    discountTier: "unknown_discount",
    paymentStatusTier: "fulfilled_unverified",
  } as FinanceBackfillClassification;
}

/** Re-derives isExactEvidenceEligible per the Phase 2D-1 spec's AND-of-all-conditions rule. */
export function computeIsExactEvidenceEligible(input: {
  hasExactSourceLinkage: boolean;
  amountTier: AmountTier;
  discountTier: DiscountTier;
  currency: "EGP" | null;
  timestampTier: TimestampTier;
  existingFinanceRecordCount: number;
  hasSourceMismatch: boolean;
  hasPackageCreditOrFreeOrNotPaidAmbiguity: boolean;
  hasConflictingOperationalEvidence: boolean;
}): boolean {
  return (
    input.hasExactSourceLinkage &&
    isExactAmountTier(input.amountTier) &&
    isExactDiscountTier(input.discountTier) &&
    input.currency === "EGP" &&
    isExactTimestampTier(input.timestampTier) &&
    input.existingFinanceRecordCount === 0 &&
    !input.hasSourceMismatch &&
    !input.hasPackageCreditOrFreeOrNotPaidAmbiguity &&
    !input.hasConflictingOperationalEvidence
  );
}

export const CLASSIFIER_VERSION = "2d1.0.0";
