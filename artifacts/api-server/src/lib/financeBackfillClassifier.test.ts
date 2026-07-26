/**
 * Finance Phase 2D-1A — historical backfill classifier + reliability taxonomy tests.
 *
 * Pure unit tests: no database, no network. Every classify* function is a pure
 * function over plain-object fixtures, so these run under plain node:test.
 */
import assert from "node:assert/strict";
import test from "node:test";

import {
  classifyPackageOrder,
  classifyBooking,
  classifyStudioWalkinAttendance,
  computeIsExactEvidenceEligible,
  type PackageOrderClassifyInput,
  type BookingClassifyInput,
  type AttendanceClassifyInput,
  type PaymentRecordSummaryInput,
} from "./financeBackfillClassifier";
import {
  AMOUNT_RELIABILITIES,
  DISCOUNT_RELIABILITIES,
  PAYMENT_STATUS_RELIABILITIES,
  PAYMENT_METHOD_RELIABILITIES,
  TIMESTAMP_RELIABILITIES,
  ACTOR_RELIABILITIES,
  isExactAmountReliability,
  isExactDiscountReliability,
  isExactTimestampReliability,
} from "./financeReliabilityTaxonomy";

function order(overrides: Partial<PackageOrderClassifyInput> = {}): PackageOrderClassifyInput {
  return {
    id: 1,
    status: "active",
    activatedAt: "2024-01-01T00:00:00Z",
    createdAt: "2023-12-01T00:00:00Z",
    packageId: 10,
    ...overrides,
  };
}

function booking(overrides: Partial<BookingClassifyInput> = {}): BookingClassifyInput {
  return {
    id: 1,
    bookingStatus: "confirmed",
    paymentStatus: "paid",
    paymentMode: "card",
    scheduleId: 5,
    classId: null,
    balletScheduleId: null,
    createdAt: "2023-12-01T00:00:00Z",
    isStudioWalkinLinked: false,
    ...overrides,
  };
}

function attendance(overrides: Partial<AttendanceClassifyInput> = {}): AttendanceClassifyInput {
  return {
    id: 1,
    bookingId: null,
    creditDeducted: false,
    status: "checked_in",
    checkedInAt: "2023-12-01T00:00:00Z",
    ...overrides,
  };
}

function paymentRecord(overrides: Partial<PaymentRecordSummaryInput> = {}): PaymentRecordSummaryInput {
  return {
    id: 100,
    flowType: "package_purchase",
    packageOrderId: null,
    bookingId: null,
    status: "confirmed",
    ...overrides,
  };
}

// ── Reliability taxonomy ────────────────────────────────────────────────────

test("taxonomy: every reliability bucket is a non-empty stable literal union", () => {
  for (const list of [
    AMOUNT_RELIABILITIES,
    DISCOUNT_RELIABILITIES,
    PAYMENT_STATUS_RELIABILITIES,
    PAYMENT_METHOD_RELIABILITIES,
    TIMESTAMP_RELIABILITIES,
    ACTOR_RELIABILITIES,
  ]) {
    assert.ok(Array.isArray(list) && list.length > 0);
  }
});

test("taxonomy: only source-time snapshot amount tiers are exact", () => {
  assert.equal(isExactAmountReliability("exact_source_snapshot"), true);
  assert.equal(isExactAmountReliability("exact_order_snapshot"), true);
  assert.equal(isExactAmountReliability("exact_schedule_snapshot"), true);
  assert.equal(isExactAmountReliability("estimated_operational"), false);
  assert.equal(isExactAmountReliability("unknown_amount"), false);
});

test("taxonomy: discount and timestamp exactness never include estimated/unknown tiers", () => {
  assert.equal(isExactDiscountReliability("exact_stored_discount"), true);
  assert.equal(isExactDiscountReliability("estimated_discount"), false);
  assert.equal(isExactDiscountReliability("unknown_discount"), false);
  assert.equal(isExactTimestampReliability("exact_payment_timestamp"), true);
  assert.equal(isExactTimestampReliability("source_updated_at_proxy"), false);
  assert.equal(isExactTimestampReliability("unknown"), false);
});

// ── Contract rules ──────────────────────────────────────────────────────────

test("contract: estimated evidence never qualifies as exact-eligible", () => {
  const eligible = computeIsExactEvidenceEligible({
    hasExactSourceLinkage: true,
    amountTier: "estimated_operational",
    discountTier: "exact_stored_discount",
    currency: "EGP",
    timestampTier: "exact_payment_timestamp",
    existingFinanceRecordCount: 0,
    hasSourceMismatch: false,
    hasPackageCreditOrFreeOrNotPaidAmbiguity: false,
    hasConflictingOperationalEvidence: false,
  });
  assert.equal(eligible, false);
});

test("contract: unknown amount never qualifies as exact-eligible", () => {
  const eligible = computeIsExactEvidenceEligible({
    hasExactSourceLinkage: true,
    amountTier: "unknown_amount",
    discountTier: "exact_stored_discount",
    currency: "EGP",
    timestampTier: "exact_payment_timestamp",
    existingFinanceRecordCount: 0,
    hasSourceMismatch: false,
    hasPackageCreditOrFreeOrNotPaidAmbiguity: false,
    hasConflictingOperationalEvidence: false,
  });
  assert.equal(eligible, false);
});

test("contract: all-exact evidence with zero existing Finance rows is exact-eligible", () => {
  const eligible = computeIsExactEvidenceEligible({
    hasExactSourceLinkage: true,
    amountTier: "exact_source_snapshot",
    discountTier: "exact_stored_discount",
    currency: "EGP",
    timestampTier: "exact_payment_timestamp",
    existingFinanceRecordCount: 0,
    hasSourceMismatch: false,
    hasPackageCreditOrFreeOrNotPaidAmbiguity: false,
    hasConflictingOperationalEvidence: false,
  });
  assert.equal(eligible, true);
});

test("contract: every classification result is writable=false in Phase 2D-1A", () => {
  const results = [
    classifyPackageOrder(order(), [], null),
    classifyBooking(booking(), [], null),
    classifyStudioWalkinAttendance(attendance(), null, []),
  ];
  for (const r of results) {
    assert.equal(r.writable, false);
  }
});

test("contract: target status/event are informational only, never authoritative paid", () => {
  const r = classifyBooking(booking({ paymentStatus: "paid" }), [], 5000);
  assert.notEqual(r.inferredFinanceTargetStatus, "paid");
  assert.equal(r.inferredFinanceTargetStatus, "legacy_unverified");
});

test("contract: safe summaries contain no PII fields (only ids and codes)", () => {
  const r = classifyBooking(booking(), [], null);
  assert.match(r.safeSummary, /^bookings#\d+ -> /);
  assert.ok(!/@/.test(r.safeSummary));
});

test("contract: reason codes are drawn from the stable literal vocabulary", () => {
  const r = classifyPackageOrder(order({ status: "cancelled" }), [], null);
  assert.deepEqual(r.reasonCodes, ["cancelled_or_rejected_excluded"]);
});

// ── Package orders ───────────────────────────────────────────────────────────

test("package order: exact-evidence eligible flag stays false without a source-time snapshot path", () => {
  const r = classifyPackageOrder(order({ status: "active", activatedAt: "2024-01-01T00:00:00Z" }), [], 5000);
  assert.equal(r.isExactEvidenceEligible, false);
  assert.equal(r.classificationCode, "estimated_amount_manual_review");
  assert.equal(r.eligibility, "manual_review");
});

test("package order: estimated-only uses catalog price and manual review", () => {
  const r = classifyPackageOrder(order({ status: "active" }), [], 5000);
  assert.equal(r.amountTier, "estimated_operational");
  assert.equal(r.amountAvailability, "estimated_backfill");
  assert.equal(r.currentPriceEstimateMinor, 5000);
  assert.equal(r.classificationCode, "estimated_amount_manual_review");
});

test("package order: unknown amount when no catalog price is available", () => {
  const r = classifyPackageOrder(order({ status: "active" }), [], null);
  assert.equal(r.amountTier, "unknown_amount");
  assert.equal(r.classificationCode, "unknown_amount_manual_review");
  assert.equal(r.amountAvailability, "unknown");
});

test("package order: legacy pending manual review", () => {
  const r = classifyPackageOrder(order({ status: "pendingPayment" }), [], null);
  assert.equal(r.classificationCode, "legacy_pending_package_manual_review");
  assert.equal(r.eligibility, "manual_review");
  assert.equal(r.paymentStatusTier, "operational_pending");
});

test("package order: active/fulfilled unverified never becomes paid", () => {
  const r = classifyPackageOrder(order({ status: "active" }), [], 5000);
  assert.notEqual(r.inferredFinanceTargetStatus, "paid");
  assert.equal(r.inferredFinanceTargetStatus, "legacy_unverified");
});

test("package order: rejected/cancelled is excluded", () => {
  const r = classifyPackageOrder(order({ status: "rejected" }), [], null);
  assert.equal(r.classificationCode, "cancelled_or_rejected_excluded");
  assert.equal(r.eligibility, "excluded");
});

test("package order: already canonical when a matching Finance record exists", () => {
  const r = classifyPackageOrder(
    order(),
    [paymentRecord({ flowType: "package_purchase", packageOrderId: 1 })],
    null,
  );
  assert.equal(r.classificationCode, "already_canonical");
  assert.equal(r.eligibility, "already_canonical");
});

test("package order: multiple Finance records is corrupt", () => {
  const r = classifyPackageOrder(
    order(),
    [
      paymentRecord({ id: 100, flowType: "package_purchase", packageOrderId: 1 }),
      paymentRecord({ id: 101, flowType: "package_purchase", packageOrderId: 1 }),
    ],
    null,
  );
  assert.equal(r.classificationCode, "multiple_finance_records_corrupt");
  assert.equal(r.eligibility, "corrupt");
});

test("package order: mismatched Finance record (wrong flow type linked) is corrupt", () => {
  const r = classifyPackageOrder(
    order(),
    [paymentRecord({ flowType: "single_class_booking", packageOrderId: 1 })],
    null,
  );
  assert.equal(r.classificationCode, "mismatched_finance_record_corrupt");
  assert.equal(r.eligibility, "corrupt");
});

test("package order: activation credit evidence without a Finance record", () => {
  const r = classifyPackageOrder(order({ status: "active", activatedAt: null }), [], null);
  assert.equal(r.classificationCode, "activation_credit_without_finance_record");
  assert.equal(r.eligibility, "manual_review");
});

// ── Bookings ─────────────────────────────────────────────────────────────────

test("booking: exact-evidence eligible flag stays false without a source-time snapshot path", () => {
  const r = classifyBooking(booking({ paymentStatus: "paid" }), [], 5000);
  assert.equal(r.isExactEvidenceEligible, false);
});

test("booking: estimated-only uses catalog price", () => {
  const r = classifyBooking(booking({ paymentStatus: "paid" }), [], 5000);
  assert.equal(r.amountTier, "estimated_operational");
  assert.equal(r.classificationCode, "estimated_amount_manual_review");
});

test("booking: unknown amount when no catalog price available", () => {
  const r = classifyBooking(booking({ paymentStatus: "paid" }), [], null);
  assert.equal(r.amountTier, "unknown_amount");
  assert.equal(r.classificationCode, "unknown_amount_manual_review");
});

test("booking: pending-payment manual review — the known 11 legacy bookings", () => {
  const r = classifyBooking(booking({ paymentStatus: "pending_payment" }), [], null);
  assert.equal(r.classificationCode, "legacy_pending_booking_manual_review");
  assert.equal(r.eligibility, "manual_review");
});

test("booking: not_required payment status also routes to legacy pending manual review", () => {
  const r = classifyBooking(booking({ paymentStatus: "not_required" }), [], null);
  assert.equal(r.classificationCode, "legacy_pending_booking_manual_review");
});

test("booking: paid/fulfilled unverified never becomes paid target status", () => {
  const r = classifyBooking(booking({ paymentStatus: "paid" }), [], 5000);
  assert.notEqual(r.inferredFinanceTargetStatus, "paid");
  assert.equal(r.inferredFinanceTargetStatus, "legacy_unverified");
});

test("booking: cancelled/rejected is excluded", () => {
  const r = classifyBooking(booking({ bookingStatus: "cancelled" }), [], null);
  assert.equal(r.classificationCode, "cancelled_or_rejected_excluded");
  assert.equal(r.eligibility, "excluded");
});

test("booking: package-credit payment mode is excluded", () => {
  const r = classifyBooking(booking({ paymentMode: "package_credit" }), [], null);
  assert.equal(r.classificationCode, "package_credit_excluded");
  assert.equal(r.eligibility, "excluded");
});

test("booking: free payment mode is excluded", () => {
  const r = classifyBooking(booking({ paymentMode: "free" }), [], null);
  assert.equal(r.classificationCode, "free_mode_excluded");
  assert.equal(r.eligibility, "excluded");
});

test("booking: Studio walk-in-linked booking is excluded from booking classification", () => {
  const r = classifyBooking(booking({ isStudioWalkinLinked: true }), [], null);
  assert.equal(r.classificationCode, "studio_walkin_reporting_only");
  assert.equal(r.eligibility, "excluded");
});

test("booking: missing schedule/class linkage is ambiguous manual review", () => {
  const r = classifyBooking(
    booking({ scheduleId: null, classId: null, balletScheduleId: null }),
    [],
    null,
  );
  assert.equal(r.classificationCode, "missing_schedule_or_class_ambiguous");
  assert.equal(r.eligibility, "manual_review");
});

test("booking: already canonical when a matching Finance record exists", () => {
  const r = classifyBooking(
    booking(),
    [paymentRecord({ flowType: "single_class_booking", bookingId: 1 })],
    null,
  );
  assert.equal(r.classificationCode, "already_canonical");
  assert.equal(r.eligibility, "already_canonical");
});

test("booking: multiple Finance records is corrupt", () => {
  const r = classifyBooking(
    booking(),
    [
      paymentRecord({ id: 100, flowType: "single_class_booking", bookingId: 1 }),
      paymentRecord({ id: 101, flowType: "single_class_booking", bookingId: 1 }),
    ],
    null,
  );
  assert.equal(r.classificationCode, "multiple_finance_records_corrupt");
  assert.equal(r.eligibility, "corrupt");
});

test("booking: mismatched Finance record (studio_walkin flow linked to a plain booking) is corrupt", () => {
  const r = classifyBooking(booking(), [paymentRecord({ flowType: "studio_walkin", bookingId: 1 })], null);
  assert.equal(r.classificationCode, "mismatched_finance_record_corrupt");
  assert.equal(r.eligibility, "corrupt");
});

// ── Studio walk-ins ──────────────────────────────────────────────────────────

test("studio walk-in: canonical paid when linked booking has a paid Finance record", () => {
  const linked = booking({ id: 2 });
  const r = classifyStudioWalkinAttendance(
    attendance({ bookingId: 2 }),
    linked,
    [paymentRecord({ flowType: "studio_walkin", bookingId: 2, status: "paid" })],
  );
  assert.equal(r.classificationCode, "canonical_paid");
  assert.equal(r.eligibility, "already_canonical");
});

test("studio walk-in: package-credit evidence with no Finance record is reporting-only, excluded", () => {
  const r = classifyStudioWalkinAttendance(attendance({ creditDeducted: true }), null, []);
  assert.equal(r.classificationCode, "historical_attendance_package_credit_evidence");
  assert.equal(r.eligibility, "excluded");
  assert.equal(r.writable, false);
});

test("studio walk-in: Not Paid / absent attendance aborts as ambiguous, excluded", () => {
  const r = classifyStudioWalkinAttendance(attendance({ status: "absent" }), null, []);
  assert.equal(r.classificationCode, "historical_attendance_ambiguous");
  assert.equal(r.eligibility, "excluded");
});

test("studio walk-in: historical attendance-only with paid evidence is manual review, never writable", () => {
  const r = classifyStudioWalkinAttendance(attendance({ status: "checked_in" }), null, []);
  assert.equal(r.classificationCode, "historical_attendance_paid_evidence");
  assert.equal(r.eligibility, "manual_review");
  assert.equal(r.writable, false);
});

test("studio walk-in: historical attendance-only ambiguous (cancelled)", () => {
  const r = classifyStudioWalkinAttendance(attendance({ status: "cancelled" }), null, []);
  assert.equal(r.classificationCode, "historical_attendance_ambiguous");
  assert.equal(r.eligibility, "excluded");
});

test("studio walk-in: already canonical when linked booking's Finance record is not paid", () => {
  const linked = booking({ id: 3 });
  const r = classifyStudioWalkinAttendance(
    attendance({ bookingId: 3 }),
    linked,
    [paymentRecord({ flowType: "studio_walkin", bookingId: 3, status: "confirmed" })],
  );
  assert.equal(r.classificationCode, "already_canonical");
  assert.equal(r.eligibility, "already_canonical");
});

test("studio walk-in: corrupt/mismatched on multiple Finance records for the linked booking", () => {
  const linked = booking({ id: 4 });
  const r = classifyStudioWalkinAttendance(
    attendance({ bookingId: 4 }),
    linked,
    [
      paymentRecord({ id: 100, flowType: "studio_walkin", bookingId: 4 }),
      paymentRecord({ id: 101, flowType: "studio_walkin", bookingId: 4 }),
    ],
  );
  assert.equal(r.classificationCode, "corrupt_mismatched");
  assert.equal(r.eligibility, "corrupt");
});
