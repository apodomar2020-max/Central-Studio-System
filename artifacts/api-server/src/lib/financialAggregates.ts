import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  db,
  balletApplicationsTable,
  balletPaymentsTable,
  balletRefundsTable,
  bookingsTable,
  classesTable,
  classPricingSettingsTable,
  packageOrdersTable,
  paymentRecordsTable,
  pricePackagesTable,
  schedulesTable,
} from "@workspace/db";
import { categoryWalkinPriceSql } from "./singleClassPricing";
export {
  buildFinancialAggregates,
  formatBalletPaymentMethodLabel,
  isSupportedManualBalletPaymentMethod,
  money,
  shouldExcludePackageOrderLinkedToBalletPayment,
  type FinancialAggregates,
  type FinancialAggregateInput,
  type LegacyRevenueTrackingLimitation,
} from "./financialAggregateMath";
import {
  buildFinancialAggregates,
  money,
  type FinancialAggregates,
} from "./financialAggregateMath";

export async function getFinancialAggregates(): Promise<FinancialAggregates> {
  const [[classPricing], [bookingAgg], [packageAgg], [balletAgg], [assessmentFeeAgg], [ledgerRefundAgg], [legacyRefundAgg]] = await Promise.all([
    db
      .select({ singleClassPriceEgp: classPricingSettingsTable.singleClassPriceEgp })
      .from(classPricingSettingsTable)
      .where(eq(classPricingSettingsTable.id, 1))
      .limit(1),
    db
      .select({
        // Identical fallback order to BOOKING_RESOLVED_PRICE (financeSources.ts)
        // and resolveSingleClassPriceEgp's live-capture order
        // (singleClassPricing.ts): payment_records snapshot -> schedule
        // override -> class's category price -> legacy single price.
        grossRevenue: sql<number>`
          coalesce(sum(coalesce(
            ${paymentRecordsTable.paidAmountMinor} / 100,
            ${schedulesTable.priceEgp},
            ${categoryWalkinPriceSql(classesTable.pricingCategory, classPricingSettingsTable)},
            ${classPricingSettingsTable.singleClassPriceEgp}
          )), 0)::int
        `,
        unknownItems: sql<number>`
          count(*) filter (
            where ${paymentRecordsTable.paidAmountMinor} is null
              and ${schedulesTable.priceEgp} is null
              and ${categoryWalkinPriceSql(classesTable.pricingCategory, classPricingSettingsTable)} is null
              and ${classPricingSettingsTable.singleClassPriceEgp} is null
          )::int
        `,
      })
      .from(bookingsTable)
      .leftJoin(schedulesTable, eq(bookingsTable.scheduleId, schedulesTable.id))
      .leftJoin(classesTable, eq(bookingsTable.classId, classesTable.id))
      .leftJoin(classPricingSettingsTable, eq(classPricingSettingsTable.id, sql`1`))
      .leftJoin(
        paymentRecordsTable,
        and(
          eq(paymentRecordsTable.bookingId, bookingsTable.id),
          eq(paymentRecordsTable.flowType, "single_class_booking"),
        ),
      )
      .where(and(
        eq(bookingsTable.paymentStatus, "paid"),
        inArray(bookingsTable.paymentMode, ["pay_at_studio", "online_payment"]),
      )),
    db
      .select({
        grossRevenue: sql<number>`
          coalesce(sum(coalesce(
            ${paymentRecordsTable.paidAmountMinor} / 100,
            ${pricePackagesTable.priceEgp}
          )), 0)::int
        `,
        unknownItems: sql<number>`
          count(*) filter (
            where ${paymentRecordsTable.paidAmountMinor} is null
              and ${pricePackagesTable.priceEgp} is null
          )::int
        `,
      })
      .from(packageOrdersTable)
      .leftJoin(pricePackagesTable, eq(packageOrdersTable.packageId, pricePackagesTable.id))
      .leftJoin(
        paymentRecordsTable,
        and(
          eq(paymentRecordsTable.packageOrderId, packageOrdersTable.id),
          eq(paymentRecordsTable.flowType, "package_purchase"),
        ),
      )
      .where(and(
        inArray(packageOrdersTable.status, ["active", "fullyUsed", "expired"]),
        // Double-count prevention: if a generic package_order is referenced by
        // any ballet_payments row, the linked order is a Ballet operational
        // mirror/attachment rather than an independent generic package sale.
        // Exclude it for every Ballet payment status to avoid either double
        // counting paid/refunded Ballet receipts or counting pending/rejected
        // Ballet payment attempts as generic package revenue.
        sql`not exists (
          select 1
          from ballet_payments bp
          where bp.package_order_id = ${packageOrdersTable.id}
        )`,
      )),
    db
      .select({
        grossRevenue: sql<number>`
          coalesce(sum(${balletPaymentsTable.amountEgp}) filter (
            where ${balletPaymentsTable.status} in ('paid', 'refunded')
              and ${balletPaymentsTable.paidAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
          ), 0)::int
        `,
        payAtStudioRevenue: sql<number>`
          coalesce(sum(${balletPaymentsTable.amountEgp}) filter (
            where ${balletPaymentsTable.status} in ('paid', 'refunded')
              and ${balletPaymentsTable.paidAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
              and ${balletPaymentsTable.paymentMethod} = 'inPerson'
          ), 0)::int
        `,
        onlineRevenue: sql<number>`
          coalesce(sum(${balletPaymentsTable.amountEgp}) filter (
            where ${balletPaymentsTable.status} in ('paid', 'refunded')
              and ${balletPaymentsTable.paidAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
              and ${balletPaymentsTable.paymentMethod} = 'kashier'
          ), 0)::int
        `,
        legacyBankTransferRevenue: sql<number>`
          coalesce(sum(${balletPaymentsTable.amountEgp}) filter (
            where ${balletPaymentsTable.status} in ('paid', 'refunded')
              and ${balletPaymentsTable.paidAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
              and ${balletPaymentsTable.paymentMethod} = 'bankTransfer'
          ), 0)::int
        `,
        invalidItems: sql<number>`
          count(*) filter (
            where ${balletPaymentsTable.status} = 'paid'
              and (${balletPaymentsTable.paidAt} is null or ${balletPaymentsTable.amountEgp} <= 0)
          )::int
        `,
        invalidRefundedItems: sql<number>`
          count(*) filter (
            where ${balletPaymentsTable.status} = 'refunded'
              and ${balletPaymentsTable.amountEgp} <= 0
          )::int
        `,
        refundedMissingPaidAt: sql<number>`
          count(*) filter (
            where ${balletPaymentsTable.status} = 'refunded'
              and ${balletPaymentsTable.refundedAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
              and ${balletPaymentsTable.paidAt} is null
          )::int
        `,
      })
      .from(balletPaymentsTable),
    db
      .select({
        recordedRevenue: sql<number>`
          coalesce(sum(${balletApplicationsTable.assessmentFeeAmountEgp}) filter (
            where ${balletApplicationsTable.assessmentFeeStatus} = 'paid'
              and ${balletApplicationsTable.assessmentFeePaidAt} is not null
              and ${balletApplicationsTable.assessmentFeeAmountEgp} > 0
          ), 0)::int
        `,
        invalidItems: sql<number>`
          count(*) filter (
            where ${balletApplicationsTable.assessmentFeeStatus} = 'paid'
              and (
                ${balletApplicationsTable.assessmentFeePaidAt} is null
                or ${balletApplicationsTable.assessmentFeeAmountEgp} is null
                or ${balletApplicationsTable.assessmentFeeAmountEgp} <= 0
              )
          )::int
        `,
      })
      .from(balletApplicationsTable),
    db
      .select({
        completedRefunds: sql<number>`
          coalesce(sum(${balletRefundsTable.refundedAmountEgp}) filter (
            where ${balletRefundsTable.status} = 'refunded'
              and ${balletRefundsTable.processedAt} is not null
              and ${balletRefundsTable.refundedAmountEgp} > 0
          ), 0)::int
        `,
        pendingExposure: sql<number>`
          coalesce(sum(${balletRefundsTable.approvedAmountEgp}) filter (
            where ${balletRefundsTable.status} in ('approved','processing')
              and ${balletRefundsTable.approvedAmountEgp} > 0
          ), 0)::int
        `,
      })
      .from(balletRefundsTable),
    db
      .select({
        legacyRefundedPayments: sql<number>`
          coalesce(sum(${balletPaymentsTable.amountEgp}) filter (
            where ${balletPaymentsTable.status} = 'refunded'
              and ${balletPaymentsTable.refundedAt} is not null
              and ${balletPaymentsTable.amountEgp} > 0
              and not exists (
                select 1
                from ballet_refunds br
                where br.payment_id = ${balletPaymentsTable.id}
                  and br.status = 'refunded'
                  and br.processed_at is not null
              )
          ), 0)::int
        `,
      })
      .from(balletPaymentsTable)
      .where(isNotNull(balletPaymentsTable.refundedAt)),
  ]);

  return buildFinancialAggregates({
    grossGenericBookingRevenueEgp: money(bookingAgg?.grossRevenue),
    grossGenericPackageRevenueEgp: money(packageAgg?.grossRevenue),
    grossBalletRevenueEgp: money(balletAgg?.grossRevenue),
    balletAssessmentFeesRecordedEgp: money(assessmentFeeAgg?.recordedRevenue),
    completedLedgerRefundsEgp: money(ledgerRefundAgg?.completedRefunds),
    pendingLedgerRefundExposureEgp: money(ledgerRefundAgg?.pendingExposure),
    legacyBalletRefundedPaymentsEgp: money(legacyRefundAgg?.legacyRefundedPayments),
    balletPayAtStudioRevenueEgp: money(balletAgg?.payAtStudioRevenue),
    balletOnlineRevenueEgp: money(balletAgg?.onlineRevenue),
    balletLegacyBankTransferRevenueEgp: money(balletAgg?.legacyBankTransferRevenue),
    unknownGenericRevenueItems: money(bookingAgg?.unknownItems) + money(packageAgg?.unknownItems) + (classPricing ? 0 : 0),
    invalidBalletPaidPaymentItems: money(balletAgg?.invalidItems),
    invalidBalletAssessmentFeeItems: money(assessmentFeeAgg?.invalidItems),
    invalidBalletRefundedPaymentItems: money(balletAgg?.invalidRefundedItems),
    refundedBalletPaymentsMissingPaidAt: money(balletAgg?.refundedMissingPaidAt),
  });
}
