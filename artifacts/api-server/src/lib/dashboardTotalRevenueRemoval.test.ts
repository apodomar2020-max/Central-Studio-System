import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const dashboardPage = read("artifacts/admin/src/pages/dashboard.tsx");
const dashboardRoute = read("artifacts/api-server/src/routes/dashboard.ts");
const apiSchema = read("lib/api-zod/src/generated/api.ts");
const openapi = read("lib/api-spec/openapi.yaml");
const clientSchema = read("lib/api-client-react/src/generated/api.schemas.ts");
const financeOverviewPage = read("artifacts/admin/src/pages/finance/FinanceOverviewPage.tsx");
const financeOverviewBuilder = read("artifacts/api-server/src/lib/financeOverview.ts");

const removedFinancialFields = [
  "totalRevenue",
  "revenueTrackingComplete",
  "grossGenericBookingRevenueEgp",
  "grossGenericPackageRevenueEgp",
  "grossBalletRevenueEgp",
  "balletCompletedRefundsEgp",
  "legacyBalletRefundedPaymentsEgp",
  "balletPendingRefundExposureEgp",
  "balletNetRevenueEgp",
  "totalGrossRevenueEgp",
  "totalNetRevenueEgp",
  "balletPayAtStudioRevenueEgp",
  "balletOnlineRevenueEgp",
  "balletLegacyBankTransferRevenueEgp",
  "legacyRevenueTrackingLimitations",
  "approvedProcessingRefundExposureEgp",
];

test("general Dashboard renders no revenue content, skeleton, or permission-dependent gap", () => {
  assert.doesNotMatch(dashboardPage, /Total Revenue|Total Net Revenue|Gross Revenue/);
  assert.doesNotMatch(dashboardPage, /Financial Overview|Ballet Payment Method Split/);
  assert.doesNotMatch(dashboardPage, /revenue-hero|revenue-grid|canViewFinance/);
  assert.match(dashboardPage, /grid gap-4 sm:grid-cols-3/);
  assert.match(dashboardPage, /Today's Bookings/);
  assert.match(dashboardPage, /Today's Classes/);
  assert.match(dashboardPage, /Today's Check-ins/);
});

test("Dashboard API no longer computes or serializes revenue", () => {
  assert.doesNotMatch(dashboardRoute, /getFinancialAggregates/);
  assert.doesNotMatch(dashboardRoute, /hasRolePermission/);
  for (const field of removedFinancialFields) {
    assert.doesNotMatch(dashboardRoute, new RegExp(field));
  }
});

test("Dashboard shared contracts expose no removed financial fields", () => {
  for (const field of removedFinancialFields) {
    assert.doesNotMatch(apiSchema, new RegExp(`\\b${field}\\b`));
    assert.doesNotMatch(clientSchema, new RegExp(`\\b${field}\\b`));
    assert.doesNotMatch(openapi, new RegExp(`\\b${field}\\b`));
  }
});

test("Finance Overview retains its canonical revenue indicators and computation", () => {
  assert.match(financeOverviewPage, /Hybrid Gross Indicator/);
  assert.match(financeOverviewPage, /Hybrid Net Indicator/);
  assert.match(financeOverviewPage, /Recorded Ballet Gross Amount/);
  assert.match(financeOverviewPage, /Recorded Ballet Net Amount/);
  assert.match(financeOverviewBuilder, /getFinancialAggregates/);
  assert.match(financeOverviewBuilder, /totalGrossHybridIndicatorEgp/);
  assert.match(financeOverviewBuilder, /totalNetHybridIndicatorEgp/);
});
