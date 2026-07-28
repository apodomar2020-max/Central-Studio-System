# Admin Dashboard Total Revenue Removal Report

## Starting production commit

`20912d822d2cf48a8463e92ea34222469d4de9cb`

## Previous Dashboard behavior

The general Admin Dashboard rendered a permission-gated Total Revenue hero, a six-card Financial Overview, a three-card Ballet payment-method split, and an approved/processing refund exposure amount. Its `/api/dashboard` route always executed `getFinancialAggregates()` and returned sixteen revenue, refund-amount, payment-method, and tracking-limitation fields. Users without `finance.view` received those fields as `null`; Finance viewers and Super Admin received the values.

No non-financial Dashboard feature depended on those amounts. Operational booking, attendance, student, class, schedule, package-status, cancellation, and refund-workflow counts use separate queries and fields.

## Removed UI components

- Total Revenue hero, value, explanatory copy, limitation copy, icon, and loading skeleton.
- Financial Overview and all six monetary cards.
- Ballet Payment Method Split and all three monetary cards.
- Approved/Processing Exposure monetary card.
- Dashboard-only Finance permission branching and money formatter.

The Live Today section now uses a direct responsive three-card grid for Today's Bookings, Today's Classes, and Today's Check-ins. There is no reserved revenue slot or permission-dependent gap.

## Removed API and schema fields

The Dashboard response no longer contains:

- `totalRevenue`
- `revenueTrackingComplete`
- `grossGenericBookingRevenueEgp`
- `grossGenericPackageRevenueEgp`
- `grossBalletRevenueEgp`
- `balletCompletedRefundsEgp`
- `legacyBalletRefundedPaymentsEgp`
- `balletPendingRefundExposureEgp`
- `balletNetRevenueEgp`
- `totalGrossRevenueEgp`
- `totalNetRevenueEgp`
- `balletPayAtStudioRevenueEgp`
- `balletOnlineRevenueEgp`
- `balletLegacyBankTransferRevenueEgp`
- `legacyRevenueTrackingLimitations`
- `approvedProcessingRefundExposureEgp`

The same fields were removed from the OpenAPI contract, shared Zod response, and generated Admin client type.

## Removed backend computations

The Dashboard route no longer imports or calls `getFinancialAggregates()`. It also no longer sums approved/processing refund amounts. Therefore the general Dashboard does not calculate, serialize, redact, cache, or expose revenue merely to omit it in the UI.

## Related monetary fields retained or removed

All monetary fields previously returned by `/api/dashboard` were part of the removed revenue/payment/refund-amount presentation and were removed.

The following non-monetary operational counts remain:

- pending-payment Booking count
- refunded Booking count
- refunds-under-review count
- completed full-refund count
- completed partial-refund count

They contain no price, amount, total, or revenue value and support independent operational workload/lifecycle cards.

## Finance behavior confirmation

Finance routes, permissions, calculations, exports, and UI were not changed. Finance Overview retains its recorded Ballet gross/net amounts and hybrid gross/net indicators, built through the existing `getFinancialAggregates()` path. Finance remains the canonical location for revenue.

## Files changed

- `ADMIN_DASHBOARD_TOTAL_REVENUE_REMOVAL_REPORT.md`
- `artifacts/admin/src/pages/dashboard.tsx`
- `artifacts/api-server/src/routes/dashboard.ts`
- `artifacts/api-server/src/lib/dashboardTotalRevenueRemoval.test.ts`
- `artifacts/api-server/src/lib/financeOverview.ts` (documentation comment only)
- `artifacts/api-server/src/lib/financeRolesPermissions.test.ts`
- `artifacts/api-server/src/lib/operationalFinancialVisibility.test.ts`
- `artifacts/api-server/src/routes/financeRolesPermissions.integration.test.ts`
- `lib/api-spec/openapi.yaml`
- `lib/api-zod/src/generated/api.ts`
- `lib/api-client-react/src/generated/api.schemas.ts`

No Central mobile file changed.

## Test results

Feature-state verification passed 87 assertions with zero failures and zero skips:

- 76 Dashboard removal, shared-contract, Finance UI, navigation, permission, and operational-redaction assertions.
- 11 real-built-server Dashboard/Finance authorization, export, authentication, and Super Admin assertions.

The real Dashboard response test covers no-Finance, `finance.view`, and Super Admin identities and proves every removed financial key is absent while operational metrics remain.

## Typecheck and build results

- `pnpm install --frozen-lockfile`: passed.
- Library typecheck: passed.
- Admin typecheck: passed after the required library build completed.
- API production build: passed.
- Admin production build: passed.
- Native browser alert scan: passed across 134 Central files.
- Repository-wide API baseline at starting production: 122 known errors.
- Feature-state repository-wide API count: 121 known errors.
- Errors in changed files: zero.
- New errors relative to baseline: zero.

## Manual UAT checklist

- Open the general Dashboard as Super Admin and confirm no revenue content or empty slot exists.
- Repeat with a `finance.view` role and a role without Finance access.
- Confirm Live Today reflows to three operational cards across desktop and mobile-width Admin layouts.
- Confirm operational Dashboard cards and charts still load.
- Open Finance Overview and confirm its revenue indicators remain available.

These browser checks are deferred to the owner and must not be marked passed without an authenticated UAT session.

## Deployment plan

Merge the verified feature branch with `--no-ff` into a clean worktree based on the latest `origin/main`, rerun affected verification, push through the normal repository process, and monitor Railway API, Railway Worker, and Vercel Admin. Central mobile is excluded.

## Rollback plan

Revert the production release merge and redeploy the prior `origin/main`. No database migration or data rollback is required.

## Remaining Dashboard work

No monetary amount remains in the general Dashboard response or UI. Any future product change to the retained non-monetary payment/refund workload counts should be handled as a separate explicit Dashboard decision.
