import assert from "node:assert/strict";
import test from "node:test";

// These tests intentionally cover the pure aggregate math layer only. They do
// not import @workspace/db and therefore do not create a pool/client that needs
// teardown. Database-backed aggregate coverage belongs in route/DB tests.

test("paid Ballet payment is included once and linked package order is excluded from generic total", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 2500,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 2500,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.grossBalletRevenueEgp, 2500);
  assert.equal(result.grossGenericPackageRevenueEgp, 0);
  assert.equal(result.totalGrossRevenueEgp, 2500);
  assert.equal(result.totalNetRevenueEgp, 2500);
});

test("refunded Ballet payment with paidAt remains in gross receipts and nets to zero", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 3000,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 3000,
    balletPayAtStudioRevenueEgp: 3000,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.grossBalletRevenueEgp, 3000);
  assert.equal(result.balletCompletedRefundsEgp, 3000);
  assert.equal(result.balletNetRevenueEgp, 0);
  assert.equal(result.balletPayAtStudioRevenueEgp, 3000);
});

test("mixed paid and refunded Ballet payments keep gross receipts and subtract completed legacy refunds", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 5500,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 2500,
    balletPayAtStudioRevenueEgp: 2500,
    balletOnlineRevenueEgp: 3000,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.grossBalletRevenueEgp, 5500);
  assert.equal(result.balletCompletedRefundsEgp, 2500);
  assert.equal(result.balletNetRevenueEgp, 3000);
  assert.equal(result.totalGrossRevenueEgp, 5500);
  assert.equal(result.totalNetRevenueEgp, 3000);
});

test("pending and rejected Ballet payments are excluded before aggregation input", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 0,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 0,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.grossBalletRevenueEgp, 0);
  assert.equal(result.balletNetRevenueEgp, 0);
});

test("Ballet method split keeps inPerson, kashier, and legacy bankTransfer separate", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 6000,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 1000,
    balletOnlineRevenueEgp: 2000,
    balletLegacyBankTransferRevenueEgp: 3000,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.balletPayAtStudioRevenueEgp, 1000);
  assert.equal(result.balletOnlineRevenueEgp, 2000);
  assert.equal(result.balletLegacyBankTransferRevenueEgp, 3000);
});

test("Ballet method split includes original receipts from later-refunded payments", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 9000,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 6000,
    balletPayAtStudioRevenueEgp: 3000,
    balletOnlineRevenueEgp: 3000,
    balletLegacyBankTransferRevenueEgp: 3000,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.balletPayAtStudioRevenueEgp, 3000);
  assert.equal(result.balletOnlineRevenueEgp, 3000);
  assert.equal(result.balletLegacyBankTransferRevenueEgp, 3000);
  assert.equal(result.balletNetRevenueEgp, 3000);
});

test("missing paidAt or invalid amount is exposed as incomplete tracking", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 0,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 0,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 2,
  });

  assert.equal(result.revenueTrackingComplete, false);
  assert.equal(
    result.legacyRevenueTrackingLimitations.some((item) => item.code === "BALLET_PAYMENT_AMOUNT_OR_DATE_INVALID"),
    true,
  );
});

test("refunds exceeding identified gross receipts are not clamped and are reported", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 1000,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 1500,
    balletPayAtStudioRevenueEgp: 1000,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.balletNetRevenueEgp, -500);
  assert.equal(
    result.legacyRevenueTrackingLimitations.some((item) => item.code === "BALLET_REFUNDS_EXCEED_IDENTIFIED_GROSS_RECEIPTS"),
    true,
  );
});

test("refunded payment missing paidAt is not treated as a valid collected receipt", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 0,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 3000,
    balletPayAtStudioRevenueEgp: 0,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
    refundedBalletPaymentsMissingPaidAt: 1,
  });

  assert.equal(result.grossBalletRevenueEgp, 0);
  assert.equal(result.balletCompletedRefundsEgp, 3000);
  assert.equal(result.balletNetRevenueEgp, -3000);
  assert.equal(
    result.legacyRevenueTrackingLimitations.some((item) => item.code === "BALLET_REFUNDED_PAYMENT_MISSING_PAID_AT"),
    true,
  );
});

test("dashboard backward compatibility keeps legacy total separate from new gross/net totals", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 500,
    grossGenericPackageRevenueEgp: 1000,
    grossBalletRevenueEgp: 2500,
    completedLedgerRefundsEgp: 0,
    pendingLedgerRefundExposureEgp: 0,
    legacyBalletRefundedPaymentsEgp: 500,
    balletPayAtStudioRevenueEgp: 2500,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.totalGrossRevenueEgp, 4000);
  assert.equal(result.totalNetRevenueEgp, 3500);
  assert.equal(result.balletCompletedRefundsEgp, 500);
});

test("package-order double-count prevention applies to every Ballet payment status", async () => {
  const { shouldExcludePackageOrderLinkedToBalletPayment } = await import("./financialAggregateMath.ts");

  assert.equal(shouldExcludePackageOrderLinkedToBalletPayment("paid"), true);
  assert.equal(shouldExcludePackageOrderLinkedToBalletPayment("refunded"), true);
  assert.equal(shouldExcludePackageOrderLinkedToBalletPayment("pending"), true);
  assert.equal(shouldExcludePackageOrderLinkedToBalletPayment("rejected"), true);
});

test("completed ledger refunds and pending exposure are calculated separately", async () => {
  const { buildFinancialAggregates } = await import("./financialAggregateMath.ts");
  const result = buildFinancialAggregates({
    grossGenericBookingRevenueEgp: 0,
    grossGenericPackageRevenueEgp: 0,
    grossBalletRevenueEgp: 5000,
    completedLedgerRefundsEgp: 1250,
    pendingLedgerRefundExposureEgp: 750,
    legacyBalletRefundedPaymentsEgp: 0,
    balletPayAtStudioRevenueEgp: 5000,
    balletOnlineRevenueEgp: 0,
    balletLegacyBankTransferRevenueEgp: 0,
    unknownGenericRevenueItems: 0,
    invalidBalletPaidPaymentItems: 0,
  });

  assert.equal(result.balletCompletedRefundsEgp, 1250);
  assert.equal(result.balletPendingRefundExposureEgp, 750);
  assert.equal(result.balletNetRevenueEgp, 3750);
});

test("manual Ballet payment creation only supports Pay at Studio while legacy methods remain labelable", async () => {
  const { formatBalletPaymentMethodLabel, isSupportedManualBalletPaymentMethod } = await import("./financialAggregateMath.ts");

  assert.equal(isSupportedManualBalletPaymentMethod("inPerson"), true);
  assert.equal(isSupportedManualBalletPaymentMethod("kashier"), false);
  assert.equal(isSupportedManualBalletPaymentMethod("bankTransfer"), false);
  assert.equal(formatBalletPaymentMethodLabel("bankTransfer"), "Legacy Bank Transfer");
  assert.equal(formatBalletPaymentMethodLabel("kashier"), "Online Payment");
});
