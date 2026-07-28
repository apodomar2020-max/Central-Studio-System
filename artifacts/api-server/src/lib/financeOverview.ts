/**
 * financeOverview — Finance Phase 1 overview aggregation.
 *
 * Deliberately thin: it reuses getFinancialAggregates() as the canonical
 * Finance math instead of re-deriving any formula. The only thing this module adds is
 * CLASSIFICATION — splitting the existing numbers into recorded / estimated /
 * hybrid buckets and attaching the mandatory caveats.
 *
 * Discounts are the one figure not already produced by the shared aggregate, so they
 * are queried here — and only when the caller may view Promotions, otherwise
 * the field stays null rather than 0 (0 would read as "no discounts granted").
 */
import { sql } from "drizzle-orm";
import { db, promotionRedemptionsTable } from "@workspace/db";
import {
  FINANCE_ESTIMATE_WARNING,
  FINANCE_KASHIER_WARNING,
  type FinanceOverviewResponse,
} from "@workspace/api-zod";
import { getFinancialAggregates } from "./financialAggregates";
// Imported from the math module rather than through financialAggregates.ts:
// that module re-exports the type without bringing it into its own scope, so
// its own annotations degrade to `any`. Importing the source keeps Finance
// strictly typed without touching the existing file.
import type { LegacyRevenueTrackingLimitation } from "./financialAggregateMath";

export interface FinanceOverviewOptions {
  /** Only true when the caller holds the existing Promotions view permission. */
  includeDiscounts: boolean;
}

/**
 * Total recorded discount amount. `discount_amount` is stored at redemption
 * time, so this is an exact recorded figure — but it is neither cash in nor
 * cash out and is reported in its own field for that reason.
 */
async function sumRecordedDiscountsEgp(): Promise<number> {
  const [row] = await db
    .select({
      total: sql<number>`coalesce(sum(${promotionRedemptionsTable.discountAmount}), 0)::int`,
    })
    .from(promotionRedemptionsTable);
  return Number(row?.total ?? 0);
}

export async function buildFinanceOverview(
  options: FinanceOverviewOptions,
): Promise<FinanceOverviewResponse> {
  const [aggregates, discountsRecordedEgp] = await Promise.all([
    getFinancialAggregates(),
    options.includeDiscounts ? sumRecordedDiscountsEgp() : Promise.resolve(null),
  ]);

  const genericPackageOperationalEstimateEgp = aggregates.grossGenericPackageRevenueEgp;
  const genericSingleClassOperationalEstimateEgp = aggregates.grossGenericBookingRevenueEgp;

  // Mandatory caveats first, then any data-quality limitations the existing
  // aggregate already detected (missing prices, invalid Ballet rows…). They are
  // surfaced verbatim rather than summarized so nothing is lost in translation.
  const warnings = [
    FINANCE_ESTIMATE_WARNING,
    FINANCE_KASHIER_WARNING,
    ...(aggregates.legacyRevenueTrackingLimitations as LegacyRevenueTrackingLimitation[]).map(
      (limitation) => limitation.message,
    ),
  ];

  return {
    generatedAt: new Date().toISOString(),
    warnings,

    recorded: {
      balletGrossRecordedEgp: aggregates.grossBalletRevenueEgp,
      balletCompletedRefundsEgp: aggregates.balletCompletedRefundsEgp,
      balletNetRecordedEgp: aggregates.balletNetRevenueEgp,
      balletInPersonRecordedEgp: aggregates.balletPayAtStudioRevenueEgp,
      // Named "AdminRecorded" on purpose: this is a method classification an
      // admin selected, not a settled provider receipt.
      balletKashierAdminRecordedEgp: aggregates.balletOnlineRevenueEgp,
      balletLegacyBankTransferEgp: aggregates.balletLegacyBankTransferRevenueEgp,
      // Approved/processing refunds — exposure, not money already paid out.
      approvedRefundExposureEgp: aggregates.balletPendingRefundExposureEgp,
      discountsRecordedEgp,
    },

    estimated: {
      genericPackageOperationalEstimateEgp,
      genericSingleClassOperationalEstimateEgp,
      genericOperationalEstimateEgp:
        genericPackageOperationalEstimateEgp + genericSingleClassOperationalEstimateEgp,
    },

    hybrid: {
      // Same values the Dashboard already shows, relabelled as indicators
      // because they blend recorded Ballet amounts with generic estimates.
      totalGrossHybridIndicatorEgp: aggregates.totalGrossRevenueEgp,
      totalNetHybridIndicatorEgp: aggregates.totalNetRevenueEgp,
    },

    limitations: {
      genericHistoricalAmountsStored: false,
      gatewaySettlementVerified: false,
      unifiedMonetaryLedgerAvailable: false,
    },
  };
}
