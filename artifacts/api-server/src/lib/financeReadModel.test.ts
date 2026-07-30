/**
 * Finance Phase 1 — source→normalized mapping tests.
 *
 * Pure mapping layer only: no @workspace/db import, so no pool is created and
 * nothing needs teardown (same contract as financialAggregates.test.ts).
 *
 * These tests exist to pin the LOCKED FINANCIAL MODEL, not the implementation.
 * Each one corresponds to a claim Finance makes to an administrator about what
 * a number does and does not prove.
 */
import assert from "node:assert/strict";
import test from "node:test";

const load = () => import("./financeReadModel");

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function packageOrderRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 12,
    status: "active",
    packageId: 3,
    packageName: "8-Class Pack",
    studentId: 55,
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    studentPhone: "+20 100 000 0000",
    currentCatalogPriceEgp: 2400,
    activatedAt: "2026-06-01T10:00:00.000Z",
    createdAt: "2026-05-30T09:00:00.000Z",
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof load>>["mapPackagePurchase"]>[0];
}

function bookingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 77,
    paymentStatus: "paid",
    paymentMode: "pay_at_studio",
    bookingStatus: "confirmed",
    bookedAt: "2026-06-10T17:00:00.000Z",
    occurrenceDate: "2026-06-10",
    classId: 5,
    classTitle: "Contemporary",
    scheduleId: 9,
    schedulePriceEgp: 350,
    singleClassSettingEgp: 300,
    accountOwnerStudentId: 55,
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    studentPhone: "+20 100 000 0000",
    bookingScope: "self",
    participantChildId: null,
    childName: null,
    ownerName: "Nour Hassan",
    ownerEmail: "nour@example.com",
    ownerPhone: "+20 100 000 0000",
    attendanceId: null,
    walkInActorAdminId: null,
    walkInActorEmail: null,
    isWalkIn: false,
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof load>>["mapBookingPayment"]>[0];
}

function balletPaymentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 41,
    applicationId: 8,
    packageOrderId: null,
    amountEgp: 3000,
    status: "paid",
    paymentMethod: "inPerson",
    paidAt: "2026-06-02T12:00:00.000Z",
    refundedAt: null,
    createdAt: "2026-06-01T12:00:00.000Z",
    parentStudentId: 70,
    parentName: "Mona Adel",
    parentEmail: "mona@example.com",
    parentPhone: "+20 111 111 1111",
    childId: 12,
    childName: "Layla Adel",
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof load>>["mapBalletPayment"]>[0];
}

function balletRefundRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 5,
    applicationId: 8,
    paymentId: 41,
    status: "refunded",
    requestedAmountEgp: 3000,
    approvedAmountEgp: 2500,
    refundedAmountEgp: 2500,
    transactionReference: "REF-88213",
    processedAt: "2026-06-20T09:00:00.000Z",
    reviewedAt: "2026-06-18T09:00:00.000Z",
    createdAt: "2026-06-17T09:00:00.000Z",
    processedByAdminId: 2,
    reviewedByAdminId: 3,
    processedByAdminEmail: "finance@central.studio",
    reviewedByAdminEmail: "ops@central.studio",
    parentStudentId: 70,
    parentName: "Mona Adel",
    parentEmail: "mona@example.com",
    parentPhone: "+20 111 111 1111",
    childId: 12,
    childName: "Layla Adel",
    originalPaymentMethod: "inPerson",
    originalPaymentAmountEgp: 3000,
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof load>>["mapBalletRefund"]>[0];
}

function creditRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 300,
    packageOrderId: 12,
    studentId: 55,
    participantType: "self",
    participantChildId: null,
    type: "package_activated",
    delta: 8,
    balanceBefore: 0,
    balanceAfter: 8,
    referenceId: null,
    referenceType: null,
    createdAt: "2026-06-01T10:00:00.000Z",
    createdBy: "system",
    packageName: "8-Class Pack",
    packageId: 3,
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    studentPhone: "+20 100 000 0000",
    participantName: "Nour Hassan",
    childName: null,
    ...overrides,
  } as Parameters<Awaited<ReturnType<typeof load>>["mapCreditTransaction"]>[0];
}

test("credit transactions preserve payer and participant attribution without changing service-credit semantics", async () => {
  const { mapCreditTransaction } = await load();
  const childEvent = mapCreditTransaction(creditRow({
    participantType: "child",
    participantChildId: 7,
    participantName: "Purchase-time child",
    childName: "Current child",
  }));
  assert.equal(childEvent.customer.studentId, 55);
  assert.equal(childEvent.customer.participantScope, "child");
  assert.equal(childEvent.customer.childId, 7);
  assert.equal(childEvent.customer.childName, "Current child");
  assert.equal(childEvent.eventNature, "service_credit");
  assert.equal(childEvent.amounts.amountEgp, null);

  const selfEvent = mapCreditTransaction(creditRow());
  assert.equal(selfEvent.customer.participantScope, "self");
  assert.equal(selfEvent.customer.childId, null);
});

// ─── 1. Active package order proves activation, not payment ───────────────────

test("active package order: paymentStatus is null, nature is operational estimate, price is estimated", async () => {
  const { mapPackagePurchase } = await load();
  const event = mapPackagePurchase(packageOrderRow({ status: "active" }));

  assert.equal(event.eventType, "package_purchase");
  assert.equal(event.eventNature, "operational_estimate");
  // The central rule: an active/fullyUsed/expired status must NEVER read "paid".
  assert.equal(event.paymentStatus, null);
  assert.equal(event.rawSourceStatus, "active");
  assert.equal(event.amounts.amountEgp, 2400);
  assert.equal(event.amountAvailability, "estimated");
  assert.equal(event.amountSource, "current_package_catalog_price");
  assert.equal(event.reliability.badge, "estimated_operational");
  assert.match(
    event.reliability.explanation,
    /payment collection is not independently recorded/i,
  );
  assert.match(event.reliability.explanation, /credit issuance/i);
  // No package order column records when money was taken.
  assert.equal(event.paidAt, null);
});

test("fullyUsed and expired package orders are also never normalized to paid", async () => {
  const { mapPackagePurchase } = await load();
  for (const status of ["fullyUsed", "expired", "pendingPayment", "cancelled"]) {
    const event = mapPackagePurchase(packageOrderRow({ status }));
    assert.equal(event.paymentStatus, null, `status ${status} must not produce a payment status`);
    assert.equal(event.rawSourceStatus, status);
  }
});

// ─── 2. Package order with no resolvable catalog price ────────────────────────

test("package order with missing catalog price: amounts null, unknown availability, unknown_amount badge", async () => {
  const { mapPackagePurchase } = await load();
  const event = mapPackagePurchase(packageOrderRow({ currentCatalogPriceEgp: null, packageId: null }));

  // Explicitly NOT zero — zero would read as "this package was free".
  assert.equal(event.amounts.amountEgp, null);
  assert.equal(event.amounts.grossAmountEgp, null);
  assert.equal(event.amounts.netAmountEgp, null);
  assert.equal(event.amountAvailability, "unknown");
  assert.equal(event.amountSource, "unavailable");
  assert.equal(event.reliability.badge, "unknown_amount");
});

// ─── 2b. Package order WITH a canonical payment_records row (Finance Batch 1) ─

test("package order with a canonical paid payment record: exact amount, Paid status, Cash method, recorded_collection", async () => {
  const { mapPackagePurchase } = await load();
  const event = mapPackagePurchase(packageOrderRow({
    status: "active",
    paymentRecordStatus: "paid",
    paymentRecordConfirmedMethod: "cash",
    paymentRecordFinalPayableAmountMinor: 240000,
    paymentRecordPaidAmountMinor: 240000,
    paymentRecordRefundedAmountMinor: 0,
    paymentRecordDiscountAmountMinor: 0,
    paymentRecordPaidAt: "2026-06-01T10:05:00.000Z",
  }));

  assert.equal(event.paymentStatus, "paid");
  assert.equal(event.rawSourceStatus, "paid");
  assert.equal(event.rawPaymentMethod, "cash");
  assert.equal(event.normalizedPaymentMethod, "cash");
  assert.equal(event.amounts.amountEgp, 2400);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.amountSource, "payment_record_snapshot");
  assert.equal(event.reliability.badge, "recorded_collection");
  assert.equal(event.paidAt, "2026-06-01T10:05:00.000Z");
  // Cash collection must never be re-labeled as a credit/service-unit concept.
  assert.notEqual(event.reliability.badge, "service_credit_unit");
});

test("package order with a pending_confirmation payment record: no blank status, not marked Paid", async () => {
  const { mapPackagePurchase } = await load();
  const event = mapPackagePurchase(packageOrderRow({
    status: "pendingPayment",
    paymentRecordStatus: "pending_confirmation",
    paymentRecordConfirmedMethod: null,
    paymentRecordFinalPayableAmountMinor: 240000,
    paymentRecordPaidAmountMinor: 0,
    paymentRecordRefundedAmountMinor: 0,
    paymentRecordDiscountAmountMinor: 0,
    paymentRecordPaidAt: null,
  }));

  // Status must be a real, non-blank value — never null/blank for a row that
  // has a canonical payment record, even before confirmation.
  assert.equal(event.paymentStatus, "pending");
  assert.notEqual(event.paymentStatus, null);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.amounts.amountEgp, 2400);
  assert.notEqual(event.reliability.badge, "recorded_collection");
});

test("legacy package order with NO payment_records row still uses the estimate fallback unchanged", async () => {
  const { mapPackagePurchase } = await load();
  const event = mapPackagePurchase(packageOrderRow({ status: "active" }));

  assert.equal(event.paymentStatus, null);
  assert.equal(event.amountAvailability, "estimated");
  assert.equal(event.amountSource, "current_package_catalog_price");
  assert.equal(event.reliability.badge, "estimated_operational");
});

// ─── 3. Paid generic class booking ────────────────────────────────────────────

test("paid generic class booking: current schedule price is marked estimated with no cash claim", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(bookingRow());

  assert.equal(event.eventType, "single_class_payment");
  assert.equal(event.eventNature, "operational_estimate");
  // The booking's real payment status IS preserved (unlike package orders).
  assert.equal(event.paymentStatus, "paid");
  assert.equal(event.rawSourceStatus, "paid");
  assert.equal(event.amounts.amountEgp, 350);
  assert.equal(event.amountAvailability, "estimated");
  assert.equal(event.amountSource, "current_schedule_price");
  assert.equal(event.reliability.badge, "estimated_operational");
  // "paid" must not be dressed up as a historically collected amount.
  assert.match(event.reliability.explanation, /not a recorded collection/i);
  assert.equal(event.paidAt, null);
  assert.equal(event.id, "bk:77");
});

test("booking falls back to the global single-class setting, then to unknown", async () => {
  const { mapBookingPayment } = await load();

  const fallback = mapBookingPayment(bookingRow({ schedulePriceEgp: null }));
  assert.equal(fallback.amounts.amountEgp, 300);
  assert.equal(fallback.amountSource, "current_single_class_setting");
  assert.equal(fallback.amountAvailability, "estimated");

  const unknown = mapBookingPayment(
    bookingRow({ schedulePriceEgp: null, singleClassSettingEgp: null }),
  );
  assert.equal(unknown.amounts.amountEgp, null);
  assert.equal(unknown.amountAvailability, "unknown");
  assert.equal(unknown.amountSource, "unavailable");
  assert.equal(unknown.reliability.badge, "unknown_amount");
});

test("booking pending_payment normalizes to pending while keeping the raw status", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(bookingRow({ paymentStatus: "pending_payment" }));
  assert.equal(event.paymentStatus, "pending");
  assert.equal(event.rawSourceStatus, "pending_payment");
});

// ─── 4. Paid studio walk-in ───────────────────────────────────────────────────

test("paid walk-in: identified by canonical audit evidence, estimated price, no invented paidAt", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(
    bookingRow({
      id: 91,
      isWalkIn: true,
      walkInActorAdminId: 4,
      walkInActorEmail: "desk@central.studio",
      attendanceId: 610,
      notes: "Walk-in — paid at studio",
    }),
  );

  assert.equal(event.eventType, "studio_walkin_payment");
  assert.equal(event.eventNature, "operational_estimate");
  assert.equal(event.paymentStatus, "paid");
  assert.equal(event.amounts.amountEgp, 350);
  assert.equal(event.amountAvailability, "estimated");
  assert.equal(event.reliability.badge, "estimated_operational");
  // An attendance check-in time must never become a payment time.
  assert.equal(event.paidAt, null);
  assert.equal(event.references.attendanceId, 610);
  // Actor is populated only because the audit log proves the recording admin.
  assert.deepEqual(event.actor, { adminId: 4, adminEmail: "desk@central.studio" });
  // Distinct synthetic prefix so a walk-in and a booking never collide.
  assert.equal(event.id, "wi:91");
});

test("walk-in classification ignores booking notes text entirely", async () => {
  const { mapBookingPayment } = await load();
  // notes is client-settable through CreateBookingBody, so a forged note must
  // not be able to make an ordinary booking present itself as a walk-in.
  const forged = mapBookingPayment(
    bookingRow({ isWalkIn: false, notes: "Walk-in — paid at studio" }),
  );
  assert.equal(forged.eventType, "single_class_payment");
  assert.equal(forged.actor, null);
});

test("walk-in with no proven admin leaves actor null rather than guessing", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(
    bookingRow({ isWalkIn: true, walkInActorAdminId: null, walkInActorEmail: null }),
  );
  assert.equal(event.actor, null);
});

// ─── 4b. Booking/walk-in WITH a canonical payment_records row (Batch 1) ───────

test("paid Studio Walk-in with a canonical payment record: exact recorded amount, no estimate warning", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(bookingRow({
    id: 91,
    isWalkIn: true,
    paymentRecordStatus: "paid",
    paymentRecordConfirmedMethod: "cash",
    paymentRecordGrossAmountMinor: 35000,
    paymentRecordDiscountAmountMinor: 0,
    paymentRecordFinalPayableAmountMinor: 35000,
    paymentRecordPaidAmountMinor: 35000,
    paymentRecordRefundedAmountMinor: 0,
    paymentRecordPaidAt: "2026-07-01T12:00:00.000Z",
  }));

  assert.equal(event.paymentStatus, "paid");
  assert.equal(event.amounts.amountEgp, 350);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.amountSource, "payment_record_snapshot");
  assert.equal(event.reliability.badge, "recorded_collection");
  assert.equal(event.paidAt, "2026-07-01T12:00:00.000Z");
  // Must not carry the historical-estimate explanation text.
  assert.doesNotMatch(event.reliability.explanation, /re-derived from current pricing/i);
});

test("direct-payment booking with a canonical payment record shows the exact stored amount, immune to later price changes", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(bookingRow({
    schedulePriceEgp: 500, // price changed AFTER the booking was captured
    paymentRecordStatus: "paid",
    paymentRecordConfirmedMethod: "cash",
    paymentRecordGrossAmountMinor: 35000, // captured at the ORIGINAL price
    paymentRecordDiscountAmountMinor: 0,
    paymentRecordFinalPayableAmountMinor: 35000,
    paymentRecordPaidAmountMinor: 35000,
    paymentRecordRefundedAmountMinor: 0,
    paymentRecordPaidAt: "2026-07-01T12:00:00.000Z",
  }));

  // The later schedulePriceEgp change (500) must NOT alter the amount shown.
  assert.equal(event.amounts.amountEgp, 350);
  assert.equal(event.amountSource, "payment_record_snapshot");
});

test("legacy booking with NO payment_records row still shows the estimate caveat", async () => {
  const { mapBookingPayment } = await load();
  const event = mapBookingPayment(bookingRow());

  assert.equal(event.amountSource, "current_schedule_price");
  assert.equal(event.reliability.badge, "estimated_operational");
  assert.match(event.reliability.explanation, /not a recorded collection/i);
});

test("package-credit issuance never appears as a cash payment status even when a payment record exists for a different booking", async () => {
  const { mapCreditTransaction } = await load();
  const creditEvent = mapCreditTransaction(creditRow({ type: "package_activated" }));
  // Credit events carry a unit delta, never a money amount or payment status.
  assert.equal(creditEvent.amounts.amountEgp, null);
  assert.equal(creditEvent.paymentStatus, null);
  assert.notEqual(creditEvent.credit.unitDelta, null);
});

// ─── 5. Package-credit walk-in is not a cash event ────────────────────────────

test("package-credit bookings are not monetary and their credit event stays a service credit", async () => {
  const { isMonetaryBookingPaymentMode, mapCreditTransaction } = await load();

  // The query layer uses this predicate to exclude the booking entirely, so no
  // cash payment event is ever produced for a package-credit walk-in.
  assert.equal(isMonetaryBookingPaymentMode("package_credit"), false);
  assert.equal(isMonetaryBookingPaymentMode("free"), false);
  assert.equal(isMonetaryBookingPaymentMode(null), false);
  assert.equal(isMonetaryBookingPaymentMode("pay_at_studio"), true);
  assert.equal(isMonetaryBookingPaymentMode("online_payment"), true);

  // The deduction appears once, as a credit consumption with no money.
  const consumption = mapCreditTransaction(
    creditRow({
      id: 301,
      type: "attendance_deduction",
      delta: -1,
      balanceBefore: 8,
      balanceAfter: 7,
      referenceId: 610,
      referenceType: "attendance",
      createdBy: "mobile:check-in",
    }),
  );
  assert.equal(consumption.eventType, "package_credit_consumption");
  assert.equal(consumption.eventNature, "service_credit");
  assert.equal(consumption.amounts.amountEgp, null);
  assert.equal(consumption.amountAvailability, "not_applicable");
  assert.equal(consumption.credit.unitDelta, -1);
  assert.equal(consumption.references.attendanceId, 610);
});

// ─── 6–8. Ballet payment methods ──────────────────────────────────────────────

test("Ballet in-person payment: stored amount is exact and badged recorded_collection", async () => {
  const { mapBalletPayment } = await load();
  const event = mapBalletPayment(balletPaymentRow({ paymentMethod: "inPerson" }));

  assert.equal(event.eventType, "ballet_payment");
  assert.equal(event.eventNature, "cash_inflow");
  assert.equal(event.amounts.amountEgp, 3000);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.amountSource, "ballet_payment_snapshot");
  assert.equal(event.reliability.badge, "recorded_collection");
  assert.equal(event.normalizedPaymentMethod, "in_person");
  assert.equal(event.paidAt, "2026-06-02T12:00:00.000Z");
  assert.match(event.reliability.explanation, /not independently reconciled through a cash drawer/i);
});

test("Ballet Kashier payment: amount exact but settlement explicitly unverified", async () => {
  const { mapBalletPayment } = await load();
  const event = mapBalletPayment(balletPaymentRow({ paymentMethod: "kashier" }));

  assert.equal(event.amounts.amountEgp, 3000);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.reliability.badge, "unverified_admin_tag");
  assert.equal(
    event.reliability.explanation,
    "Payment method was recorded as Kashier, but provider settlement is not verified by the current system.",
  );
  // notes are never promoted to a provider reference.
  assert.equal(event.providerReference, null);
});

test("Ballet payment reliability wording never claims verified settlement", async () => {
  const { FINANCE_RELIABILITY_EXPLANATIONS } = await load();
  const forbidden = /verified cash|verified gateway|bank-settled|full financial ledger/i;
  for (const [badge, explanation] of Object.entries(FINANCE_RELIABILITY_EXPLANATIONS)) {
    assert.doesNotMatch(explanation, forbidden, `${badge} explanation uses forbidden wording`);
  }
});

test("Ballet bank transfer is legacy display-only", async () => {
  const { mapBalletPayment } = await load();
  const event = mapBalletPayment(balletPaymentRow({ paymentMethod: "bankTransfer" }));
  assert.equal(event.reliability.badge, "legacy_display_only");
  assert.equal(event.normalizedPaymentMethod, "bank_transfer");
  assert.match(event.reliability.explanation, /display only/i);
});

test("Ballet payment with no recorded method is an unverified tag, not a collection", async () => {
  const { mapBalletPayment } = await load();
  const event = mapBalletPayment(balletPaymentRow({ paymentMethod: null }));
  assert.equal(event.reliability.badge, "unverified_admin_tag");
  assert.equal(event.normalizedPaymentMethod, null);
});

// ─── 9. Ballet refunds ────────────────────────────────────────────────────────

test("completed Ballet refund: badge recorded_refund and the completed amount is counted", async () => {
  const { mapBalletRefund } = await load();
  const event = mapBalletRefund(balletRefundRow());

  assert.equal(event.eventType, "ballet_refund");
  assert.equal(event.eventNature, "cash_outflow");
  assert.equal(event.refundStatus, "refunded");
  assert.equal(event.amounts.requestedRefundAmountEgp, 3000);
  assert.equal(event.amounts.approvedRefundAmountEgp, 2500);
  assert.equal(event.amounts.refundedAmountEgp, 2500);
  // Signed negative so summing netAmountEgp can never read a payout as income.
  assert.equal(event.amounts.netAmountEgp, -2500);
  assert.equal(event.reliability.badge, "recorded_refund");
  assert.equal(event.providerReference, "REF-88213");
  assert.equal(event.refundedAt, "2026-06-20T09:00:00.000Z");
});

test("pending and approved refunds keep exact stored amounts but contribute no completed cash", async () => {
  const { mapBalletRefund, isCompletedBalletRefund } = await load();

  for (const status of ["underReview", "approved", "processing", "rejected", "withdrawn", "failed"]) {
    const row = balletRefundRow({ status, processedAt: null, refundedAmountEgp: null });
    assert.equal(isCompletedBalletRefund(row), false, `${status} must not count as completed`);

    const event = mapBalletRefund(row);
    assert.equal(event.amounts.requestedRefundAmountEgp, 3000);
    assert.equal(event.amounts.approvedRefundAmountEgp, 2500);
    // The three fields a caller might sum as cash paid out stay null.
    assert.equal(event.amounts.refundedAmountEgp, null);
    assert.equal(event.amounts.amountEgp, null);
    assert.equal(event.amounts.netAmountEgp, null);
    assert.equal(event.refundedAt, null);
    assert.match(event.reliability.explanation, /no cash has been paid out yet/i);
  }
});

test("refund completion requires status, processedAt and a positive amount together", async () => {
  const { isCompletedBalletRefund } = await load();
  assert.equal(
    isCompletedBalletRefund({ status: "refunded", processedAt: "2026-06-20T09:00:00.000Z", refundedAmountEgp: 2500 }),
    true,
  );
  assert.equal(
    isCompletedBalletRefund({ status: "refunded", processedAt: null, refundedAmountEgp: 2500 }),
    false,
  );
  assert.equal(
    isCompletedBalletRefund({ status: "refunded", processedAt: "2026-06-20T09:00:00.000Z", refundedAmountEgp: 0 }),
    false,
  );
  assert.equal(
    isCompletedBalletRefund({ status: "approved", processedAt: "2026-06-20T09:00:00.000Z", refundedAmountEgp: 2500 }),
    false,
  );
});

test("refund actor prefers the processing admin and falls back to the reviewer", async () => {
  const { mapBalletRefund } = await load();

  const processed = mapBalletRefund(balletRefundRow());
  assert.deepEqual(processed.actor, { adminId: 2, adminEmail: "finance@central.studio" });

  const reviewedOnly = mapBalletRefund(
    balletRefundRow({ status: "approved", processedAt: null, processedByAdminId: null, processedByAdminEmail: null }),
  );
  assert.deepEqual(reviewedOnly.actor, { adminId: 3, adminEmail: "ops@central.studio" });
});

// ─── 10. Promotion discount ───────────────────────────────────────────────────

test("promotion redemption is a discount — never cash inflow or outflow", async () => {
  const { mapPromotionDiscount } = await load();
  const event = mapPromotionDiscount({
    id: 21,
    promotionId: 4,
    promotionName: "Summer 20%",
    studentId: 55,
    bookingId: null,
    packageOrderId: 12,
    discountAmount: 480,
    originalSubtotal: 2400,
    finalSubtotal: 1920,
    redeemedAt: "2026-06-01T09:30:00.000Z",
    studentName: "Nour Hassan",
    studentEmail: "nour@example.com",
    studentPhone: "+20 100 000 0000",
  });

  assert.equal(event.eventType, "promotion_discount");
  assert.equal(event.eventNature, "discount");
  assert.notEqual(event.eventNature, "cash_inflow");
  assert.notEqual(event.eventNature, "cash_outflow");
  assert.equal(event.amounts.discountAmountEgp, 480);
  assert.equal(event.amounts.grossAmountEgp, 2400);
  assert.equal(event.amounts.netAmountEgp, 1920);
  assert.equal(event.amountAvailability, "exact");
  assert.equal(event.amountSource, "promotion_redemption_snapshot");
  assert.equal(event.reliability.badge, "recorded_discount");
  assert.match(event.reliability.explanation, /not cash received or cash paid out/i);
  // Linked to the order it discounted.
  assert.equal(event.references.packageOrderId, 12);
  assert.equal(event.sourceDeepLink, "/package-orders");
});

// ─── 11. Credit issuance and consumption ──────────────────────────────────────

test("credit issuance and consumption carry null money and not_applicable availability", async () => {
  const { mapCreditTransaction } = await load();

  const issuance = mapCreditTransaction(creditRow());
  assert.equal(issuance.eventType, "package_credit_issuance");
  assert.equal(issuance.eventNature, "service_credit");
  assert.equal(issuance.amountAvailability, "not_applicable");
  assert.equal(issuance.amountSource, "not_applicable_credit_only");
  assert.equal(issuance.reliability.badge, "service_credit_unit");
  assert.equal(issuance.credit.unitDelta, 8);
  assert.equal(issuance.credit.balanceBefore, 0);
  assert.equal(issuance.credit.balanceAfter, 8);
  // Every monetary field must be null — credits are never valued in EGP.
  for (const [field, value] of Object.entries(issuance.amounts)) {
    if (field === "currency") continue;
    assert.equal(value, null, `amounts.${field} must be null for a credit event`);
  }

  const consumption = mapCreditTransaction(
    creditRow({ id: 302, type: "attendance_deduction", delta: -1, balanceBefore: 8, balanceAfter: 7 }),
  );
  assert.equal(consumption.eventType, "package_credit_consumption");
  assert.equal(consumption.credit.unitDelta, -1);
  assert.equal(consumption.amounts.netAmountEgp, null);
});

test("credit transaction types are classified from the values the codebase actually writes", async () => {
  const { classifyCreditTransaction } = await load();

  assert.equal(classifyCreditTransaction("package_activated", 8), "package_credit_issuance");
  assert.equal(classifyCreditTransaction("package_bonus", 2), "package_credit_issuance");
  assert.equal(classifyCreditTransaction("package_refund", 1), "package_credit_issuance");
  assert.equal(classifyCreditTransaction("attendance_deduction", -1), "package_credit_consumption");
  // manual_adjustment rows genuinely exist (adminCredits.ts), so the reserved
  // event type describes real data rather than a synthesized event.
  assert.equal(classifyCreditTransaction("manual_adjustment", 5), "future_manual_adjustment");
  assert.equal(classifyCreditTransaction("manual_adjustment", -5), "future_manual_adjustment");
  // Unknown future type degrades by sign instead of vanishing from Finance.
  assert.equal(classifyCreditTransaction("some_new_type", -3), "package_credit_consumption");
  assert.equal(classifyCreditTransaction("some_new_type", 3), "package_credit_issuance");
});

test("credit createdBy is only treated as an admin actor when it is an email", async () => {
  const { mapCreditTransaction } = await load();
  assert.equal(mapCreditTransaction(creditRow({ createdBy: "system" })).actor, null);
  assert.equal(mapCreditTransaction(creditRow({ createdBy: "mobile:check-in" })).actor, null);
  assert.deepEqual(
    mapCreditTransaction(creditRow({ createdBy: "admin@central.studio" })).actor,
    { adminId: null, adminEmail: "admin@central.studio" },
  );
});

test("credit reference pointers are only trusted when referenceType names the table", async () => {
  const { mapCreditTransaction } = await load();

  const attendance = mapCreditTransaction(creditRow({ referenceId: 99, referenceType: "attendance" }));
  assert.equal(attendance.references.attendanceId, 99);
  assert.equal(attendance.references.bookingId, null);

  const booking = mapCreditTransaction(creditRow({ referenceId: 99, referenceType: "booking" }));
  assert.equal(booking.references.bookingId, 99);
  assert.equal(booking.references.attendanceId, null);

  const untyped = mapCreditTransaction(creditRow({ referenceId: 99, referenceType: null }));
  assert.equal(untyped.references.attendanceId, null);
  assert.equal(untyped.references.bookingId, null);
});

// ─── Cross-cutting invariants ─────────────────────────────────────────────────

test("no mapper ever uses 0 to represent an unknown amount", async () => {
  const {
    mapPackagePurchase, mapBookingPayment, mapBalletPayment, mapBalletRefund, mapPromotionDiscount,
  } = await load();

  const unknowns = [
    mapPackagePurchase(packageOrderRow({ currentCatalogPriceEgp: null })),
    mapBookingPayment(bookingRow({ schedulePriceEgp: null, singleClassSettingEgp: null })),
    mapBalletPayment(balletPaymentRow({ amountEgp: null })),
    mapBalletRefund(
      balletRefundRow({
        status: "withdrawn",
        processedAt: null,
        requestedAmountEgp: null,
        approvedAmountEgp: null,
        refundedAmountEgp: null,
        originalPaymentAmountEgp: null,
      }),
    ),
    mapPromotionDiscount({
      id: 22, promotionId: 4, promotionName: null, studentId: 55, bookingId: null,
      packageOrderId: null, discountAmount: null, originalSubtotal: null, finalSubtotal: null,
      redeemedAt: "2026-06-01T09:30:00.000Z", studentName: null, studentEmail: null, studentPhone: null,
    }),
  ];

  for (const event of unknowns) {
    assert.equal(event.amounts.amountEgp, null, `${event.id} amountEgp must be null, not 0`);
    assert.equal(event.amountAvailability, "unknown");
    assert.equal(event.reliability.badge, "unknown_amount");
  }
});

test("event nature is a pure function of event type across every mapper", async () => {
  const {
    mapPackagePurchase, mapBookingPayment, mapBalletPayment, mapBalletRefund,
    mapPromotionDiscount, mapCreditTransaction, familyForEventType,
  } = await load();

  const expected: Record<string, string> = {
    package_purchase: "operational_estimate",
    single_class_payment: "operational_estimate",
    studio_walkin_payment: "operational_estimate",
    ballet_payment: "cash_inflow",
    ballet_refund: "cash_outflow",
    promotion_discount: "discount",
    package_credit_issuance: "service_credit",
    package_credit_consumption: "service_credit",
    future_manual_adjustment: "service_credit",
  };

  const events = [
    mapPackagePurchase(packageOrderRow()),
    mapBookingPayment(bookingRow()),
    mapBookingPayment(bookingRow({ isWalkIn: true })),
    mapBalletPayment(balletPaymentRow()),
    mapBalletRefund(balletRefundRow()),
    mapPromotionDiscount({
      id: 23, promotionId: 4, promotionName: "X", studentId: 55, bookingId: 1, packageOrderId: null,
      discountAmount: 10, originalSubtotal: 100, finalSubtotal: 90,
      redeemedAt: "2026-06-01T00:00:00.000Z", studentName: "A", studentEmail: "a@b.c", studentPhone: null,
    }),
    mapCreditTransaction(creditRow()),
    mapCreditTransaction(creditRow({ type: "attendance_deduction", delta: -1 })),
    mapCreditTransaction(creditRow({ type: "manual_adjustment", delta: 3 })),
  ];

  for (const event of events) {
    assert.equal(event.eventNature, expected[event.eventType]);
    // Every event must resolve to exactly one permission family.
    assert.ok(familyForEventType(event.eventType));
  }
});

test("synthetic event ids are unique per source and stable", async () => {
  const {
    mapPackagePurchase, mapBookingPayment, mapBalletPayment, mapBalletRefund, mapCreditTransaction,
  } = await load();

  // Same numeric id in five different tables must not collide.
  const ids = [
    mapPackagePurchase(packageOrderRow({ id: 1 })).id,
    mapBookingPayment(bookingRow({ id: 1 })).id,
    mapBookingPayment(bookingRow({ id: 1, isWalkIn: true })).id,
    mapBalletPayment(balletPaymentRow({ id: 1 })).id,
    mapBalletRefund(balletRefundRow({ id: 1 })).id,
    mapCreditTransaction(creditRow({ id: 1 })).id,
  ];
  assert.equal(new Set(ids).size, ids.length);
  assert.deepEqual(ids, ["po:1", "bk:1", "wi:1", "bp:1", "br:1", "ct:1"]);
});

test("deep links only point at operational routes that already exist", async () => {
  const {
    mapPackagePurchase, mapBookingPayment, mapBalletPayment, mapBalletRefund, mapCreditTransaction,
  } = await load();

  // Every target is a real Admin route (see artifacts/admin/src/App.tsx).
  const KNOWN_ROUTES = [
    "/package-orders", "/bookings", "/attendance", "/promotions",
    "/ballet/payments", "/ballet/refunds",
  ];
  const events = [
    mapPackagePurchase(packageOrderRow()),
    mapBookingPayment(bookingRow()),
    mapBookingPayment(bookingRow({ isWalkIn: true })),
    mapBalletPayment(balletPaymentRow()),
    mapBalletRefund(balletRefundRow()),
    mapCreditTransaction(creditRow()),
    mapCreditTransaction(creditRow({ referenceType: "attendance", referenceId: 5 })),
  ];

  for (const event of events) {
    assert.ok(event.sourceDeepLink, `${event.id} must have a deep link`);
    const path = event.sourceDeepLink!.split("?")[0];
    assert.ok(KNOWN_ROUTES.includes(path!), `${event.sourceDeepLink} is not a known Admin route`);
  }

  // Query params are only used where the target page already reads them.
  assert.equal(
    mapBalletPayment(balletPaymentRow()).sourceDeepLink,
    "/ballet/payments?applicationId=8",
  );
  assert.equal(
    mapBookingPayment(bookingRow()).sourceDeepLink,
    "/bookings?studentEmail=nour%40example.com",
  );
});

test("payment method normalization is total and never invents a trusted method", async () => {
  const { normalizePaymentMethod } = await load();

  assert.equal(normalizePaymentMethod("inPerson"), "in_person");
  assert.equal(normalizePaymentMethod("kashier"), "kashier");
  assert.equal(normalizePaymentMethod("bankTransfer"), "bank_transfer");
  assert.equal(normalizePaymentMethod("pay_at_studio"), "pay_at_studio");
  assert.equal(normalizePaymentMethod("online_payment"), "online_payment");
  assert.equal(normalizePaymentMethod("package_credit"), "package_credit");
  assert.equal(normalizePaymentMethod(null), null);
  assert.equal(normalizePaymentMethod("   "), null);
  // A method the current code does not know degrades to unknown.
  assert.equal(normalizePaymentMethod("crypto"), "unknown");
});

test("egpOrNull keeps stored integers exact and refuses to invent zero", async () => {
  const { egpOrNull } = await load();
  assert.equal(egpOrNull(2400), 2400);
  assert.equal(egpOrNull(0), 0);          // a real zero stays zero
  assert.equal(egpOrNull(null), null);    // unknown stays null
  assert.equal(egpOrNull(undefined), null);
  assert.equal(egpOrNull("not a number"), null);
  assert.equal(egpOrNull(Number.NaN), null);
  // `real` columns (price_packages.price_egp) round to whole EGP.
  assert.equal(egpOrNull(2399.6), 2400);
});
