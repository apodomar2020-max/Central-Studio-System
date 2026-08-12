/**
 * Source-inspection coverage for Phase 2C — reconciling stale ballet.payments.view
 * UI checks with the actual Finance permission model. Same style as
 * system-users.test.ts / branches.test.ts (this app has no React
 * component-rendering test harness, so existing frontend coverage confirms
 * expected code patterns are present in the real source rather than mounting
 * components). See SYSTEM_USERS_ROLES_PERMISSIONS_PHASE2_INVESTIGATION_REPORT.md
 * (Gap 4) for the full investigation this closes.
 *
 * What this locks in:
 *  - ApplicationDetailPage.tsx's payments-panel-visibility flag (canViewPayments,
 *    which gates the "Open Payment History" deep links to /ballet/payments) now
 *    derives from finance.view — matching that destination page's real gate —
 *    instead of the stale, irrelevant ballet.payments.view.
 *  - ballet.payments.create/edit are UNCHANGED — those remain genuinely
 *    backend-enforced mutation permissions and must not be swept into this fix.
 *  - FinanceOverviewPage.tsx's Ballet Payments/Refunds shortcut buttons now
 *    gate on finance.view, consistent with every other shortcut button in that
 *    same list (packageOrders.view, bookings.view, attendance.view,
 *    promotions.view each match their own destination page).
 *
 * What this file deliberately does NOT touch or assert against:
 *  - The unified Finance Transactions/Export feed's per-family scoping
 *    (routes/finance.ts, lib/financeAccess.ts, FINANCE_FAMILY_PERMISSIONS) —
 *    ballet.payments.view remains the correct, real, backend-enforced gate
 *    there. See financePermissions.test.ts, unchanged by this phase.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const applicationDetailSource = readFileSync(
  new URL("./ballet/ApplicationDetailPage.tsx", import.meta.url),
  "utf8",
);
const financeOverviewSource = readFileSync(
  new URL("./finance/FinanceOverviewPage.tsx", import.meta.url),
  "utf8",
);

// ─── ApplicationDetailPage.tsx ──────────────────────────────────────────────

test("ApplicationDetailPage: payments-panel visibility derives from finance.view, not ballet.payments.view", () => {
  assert.match(
    applicationDetailSource,
    /const canViewPayments = can\("finance", "view"\);/,
  );
  assert.doesNotMatch(
    applicationDetailSource,
    /const canViewPayments = can\("ballet\.payments", "view"\);/,
  );
});

test("ApplicationDetailPage: ballet.payments.create/edit remain untouched — only .view was stale", () => {
  assert.match(
    applicationDetailSource,
    /const canCreatePayments = can\("ballet\.payments", "create"\);/,
  );
  assert.match(
    applicationDetailSource,
    /const canEditPayments = can\("ballet\.payments", "edit"\);/,
  );
});

// ─── FinanceOverviewPage.tsx ────────────────────────────────────────────────

test("FinanceOverviewPage: Ballet Payments/Refunds shortcuts gate on finance.view, matching their destination pages", () => {
  assert.match(
    financeOverviewSource,
    /\{can\("finance", "view"\) && \(\s*\n\s*<>\s*\n\s*<Button asChild variant="outline" size="sm">\s*\n\s*<Link href="\/ballet\/payments">Ballet Payments<\/Link>/,
  );
  assert.match(financeOverviewSource, /<Link href="\/ballet\/refunds">Ballet Refunds<\/Link>/);
});

test("FinanceOverviewPage: no remaining ballet.payments.view check anywhere in the file", () => {
  assert.doesNotMatch(financeOverviewSource, /can\("ballet\.payments",\s*"view"\)/);
});

test("FinanceOverviewPage: the Ballet shortcut now matches the same finance.view pattern as its sibling shortcuts", () => {
  const financeGatedShortcuts = [...financeOverviewSource.matchAll(/\{can\("(\w+(?:\.\w+)?)",\s*"view"\)\s*&&\s*\(/g)]
    .map((m) => m[1]);
  // packageOrders, bookings, attendance, promotions were already correct;
  // this phase adds finance to that same list for the Ballet shortcuts.
  assert.ok(financeGatedShortcuts.includes("finance"), "expected a finance.view-gated shortcut block");
});
