export interface LegacyRevenueTrackingLimitation {
  code: string;
  message: string;
}

export interface FinancialAggregates {
  grossGenericBookingRevenueEgp: number;
  grossGenericPackageRevenueEgp: number;
  grossBalletRevenueEgp: number;
  balletAssessmentFeesRecordedEgp: number;
  balletCompletedRefundsEgp: number;
  legacyBalletRefundedPaymentsEgp: number;
  balletPendingRefundExposureEgp: number;
  balletNetRevenueEgp: number;
  totalGrossRevenueEgp: number;
  totalNetRevenueEgp: number;
  balletPayAtStudioRevenueEgp: number;
  balletOnlineRevenueEgp: number;
  balletLegacyBankTransferRevenueEgp: number;
  revenueTrackingComplete: boolean;
  legacyRevenueTrackingLimitations: LegacyRevenueTrackingLimitation[];
}

export interface FinancialAggregateInput {
  grossGenericBookingRevenueEgp: number;
  grossGenericPackageRevenueEgp: number;
  /** Ballet package/subscription receipts, before assessment fees are added. */
  grossBalletRevenueEgp: number;
  balletAssessmentFeesRecordedEgp?: number;
  legacyBalletRefundedPaymentsEgp: number;
  completedLedgerRefundsEgp: number;
  pendingLedgerRefundExposureEgp: number;
  balletPayAtStudioRevenueEgp: number;
  balletOnlineRevenueEgp: number;
  balletLegacyBankTransferRevenueEgp: number;
  unknownGenericRevenueItems: number;
  invalidBalletPaidPaymentItems: number;
  invalidBalletAssessmentFeeItems?: number;
  invalidBalletRefundedPaymentItems?: number;
  refundedBalletPaymentsMissingPaidAt?: number;
}

export function money(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function isSupportedManualBalletPaymentMethod(method: string | null | undefined): method is "inPerson" {
  return method === "inPerson";
}

export function formatBalletPaymentMethodLabel(method: string | null | undefined): string | null {
  if (!method) return null;
  if (method === "inPerson") return "Pay at Studio";
  if (method === "kashier") return "Online Payment";
  if (method === "bankTransfer") return "Legacy Bank Transfer";
  return method;
}

export function shouldExcludePackageOrderLinkedToBalletPayment(_paymentStatus: string | null | undefined): boolean {
  // A package_order referenced by ballet_payments.package_order_id is an
  // operational mirror/attachment of a Ballet payment workflow, not an
  // independent generic package sale for dashboard revenue. Exclude it for
  // every Ballet payment status so pending/rejected/refunded rows cannot be
  // counted as generic revenue while paid/refunded rows are counted from
  // ballet_payments under the Ballet source of truth.
  return true;
}

export function buildFinancialAggregates(input: FinancialAggregateInput): FinancialAggregates {
  const grossGenericBookingRevenueEgp = money(input.grossGenericBookingRevenueEgp);
  const grossGenericPackageRevenueEgp = money(input.grossGenericPackageRevenueEgp);
  const balletAssessmentFeesRecordedEgp = money(input.balletAssessmentFeesRecordedEgp);
  const grossBalletRevenueEgp = money(input.grossBalletRevenueEgp) + balletAssessmentFeesRecordedEgp;
  const completedLedgerRefundsEgp = money(input.completedLedgerRefundsEgp);
  const legacyBalletRefundedPaymentsEgp = money(input.legacyBalletRefundedPaymentsEgp);

  // New refunds are ledger-backed. Historical payment rows with
  // status="refunded" are surfaced through the legacy metric only when no
  // completed ledger refund exists for that payment.
  const balletCompletedRefundsEgp = completedLedgerRefundsEgp + legacyBalletRefundedPaymentsEgp;
  const balletPendingRefundExposureEgp = money(input.pendingLedgerRefundExposureEgp);
  const balletNetRevenueEgp = grossBalletRevenueEgp - balletCompletedRefundsEgp;
  const totalGrossRevenueEgp = grossGenericBookingRevenueEgp + grossGenericPackageRevenueEgp + grossBalletRevenueEgp;
  const totalNetRevenueEgp = grossGenericBookingRevenueEgp + grossGenericPackageRevenueEgp + balletNetRevenueEgp;

  const legacyRevenueTrackingLimitations: LegacyRevenueTrackingLimitation[] = [
    {
      code: "GENERIC_REVENUE_NOT_CASH_BASIS",
      message: "Generic booking and package revenue still use existing operational status/price rules, not a complete cash-basis payment ledger.",
    },
    {
      code: "BALLET_REFUND_LEDGER_PENDING",
      message: "Ballet refunds use the ballet_refunds ledger for new refunds; historical refunded payment status is included only when no completed ledger refund exists for that payment.",
    },
  ];

  if (input.unknownGenericRevenueItems > 0) {
    legacyRevenueTrackingLimitations.push({
      code: "GENERIC_PRICE_MISSING",
      message: `${input.unknownGenericRevenueItems} generic revenue item(s) are missing a resolvable price.`,
    });
  }

  if (input.invalidBalletPaidPaymentItems > 0) {
    legacyRevenueTrackingLimitations.push({
      code: "BALLET_PAYMENT_AMOUNT_OR_DATE_INVALID",
      message: `${input.invalidBalletPaidPaymentItems} paid Ballet payment(s) are missing a positive amount or paidAt timestamp and were excluded.`,
    });
  }

  if ((input.invalidBalletAssessmentFeeItems ?? 0) > 0) {
    legacyRevenueTrackingLimitations.push({
      code: "BALLET_ASSESSMENT_FEE_AMOUNT_OR_DATE_INVALID",
      message: `${input.invalidBalletAssessmentFeeItems} paid Ballet assessment fee(s) are missing a positive stored amount or paidAt timestamp and were excluded.`,
    });
  }

  if ((input.invalidBalletRefundedPaymentItems ?? 0) > 0) {
    legacyRevenueTrackingLimitations.push({
      code: "BALLET_REFUNDED_PAYMENT_AMOUNT_INVALID",
      message: `${input.invalidBalletRefundedPaymentItems} refunded Ballet payment(s) are missing a positive amount and were excluded from legacy refund totals.`,
    });
  }

  if ((input.refundedBalletPaymentsMissingPaidAt ?? 0) > 0) {
    legacyRevenueTrackingLimitations.push({
      code: "BALLET_REFUNDED_PAYMENT_MISSING_PAID_AT",
      message: `${input.refundedBalletPaymentsMissingPaidAt} refunded Ballet payment(s) have no paidAt timestamp, so the refund is visible but the original receipt is not counted in gross revenue.`,
    });
  }

  if (balletCompletedRefundsEgp > grossBalletRevenueEgp) {
    legacyRevenueTrackingLimitations.push({
      code: "BALLET_REFUNDS_EXCEED_IDENTIFIED_GROSS_RECEIPTS",
      message: "Completed legacy Ballet refunds exceed identified gross Ballet receipts. Historical payment data needs review before relying on net Ballet revenue.",
    });
  }

  return {
    grossGenericBookingRevenueEgp,
    grossGenericPackageRevenueEgp,
    grossBalletRevenueEgp,
    balletAssessmentFeesRecordedEgp,
    balletCompletedRefundsEgp,
    legacyBalletRefundedPaymentsEgp,
    balletPendingRefundExposureEgp,
    balletNetRevenueEgp,
    totalGrossRevenueEgp,
    totalNetRevenueEgp,
    balletPayAtStudioRevenueEgp: money(input.balletPayAtStudioRevenueEgp),
    balletOnlineRevenueEgp: money(input.balletOnlineRevenueEgp),
    balletLegacyBankTransferRevenueEgp: money(input.balletLegacyBankTransferRevenueEgp),
    revenueTrackingComplete: legacyRevenueTrackingLimitations.length === 0,
    legacyRevenueTrackingLimitations,
  };
}
