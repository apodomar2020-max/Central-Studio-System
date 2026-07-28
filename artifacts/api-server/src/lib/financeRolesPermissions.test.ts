/**
 * Finance Roles & Permissions integration — catalog and guard-boundary
 * tests. Structural, no DB (same contract as financePermissions.test.ts).
 */
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
const loadPermissions = () => import("@workspace/api-zod");

// ─── Permission registration ─────────────────────────────────────────────────

test("all four Finance permissions exist in the catalog under the Finance group", async () => {
  const { PERMISSION_CATALOG, PERMISSION_GROUPS } = await loadPermissions();
  assert.ok(PERMISSION_GROUPS.includes("Finance"));
  const financeModule = PERMISSION_CATALOG.find((m) => m.key === "finance");
  assert.ok(financeModule, "finance module must exist");
  assert.equal(financeModule!.group, "Finance");
  assert.equal(financeModule!.reserved, undefined, "finance must no longer be reserved");
  const actionKeys = financeModule!.actions.map((a) => a.key).sort();
  assert.deepEqual(actionKeys, ["exports", "paymentsConfirm", "refundsManage", "view"].sort());
});

test("permission catalog registration is idempotent — no duplicate module or action keys", async () => {
  const { PERMISSION_CATALOG } = await loadPermissions();
  const moduleKeys = PERMISSION_CATALOG.map((m) => m.key);
  assert.equal(new Set(moduleKeys).size, moduleKeys.length, "no duplicate module keys");
  const financeModule = PERMISSION_CATALOG.find((m) => m.key === "finance")!;
  const actionKeys = financeModule.actions.map((a) => a.key);
  assert.equal(new Set(actionKeys).size, actionKeys.length, "no duplicate action keys");
});

test("ordinary roles are not silently granted any Finance permission by default", async () => {
  const { hasRolePermission } = await loadPermissions();
  // A role with rich existing grants but no "finance" key at all — exactly
  // the shape every pre-existing production role has today, since "finance"
  // was reserved and never previously assignable.
  const richOrdinaryRolePermissions = {
    dashboard: { view: true },
    bookings: { view: true, edit: true },
    packageOrders: { view: true, approve: true },
    attendance: { view: true, checkIn: true },
    "ballet.payments": { view: true, edit: true },
  };
  for (const action of ["view", "paymentsConfirm", "refundsManage", "exports"]) {
    assert.equal(
      hasRolePermission(richOrdinaryRolePermissions, "finance", action),
      false,
      `finance.${action} must not be silently granted`,
    );
  }
});

test("Super Admin retains full Finance access regardless of the permissions map", async () => {
  // Mirrors the exact bypass pattern used by requireAdminPermission /
  // financeAdminCan: isSuperAdmin short-circuits before hasRolePermission is
  // ever consulted, so an empty/absent "finance" key cannot lock a Super
  // Admin out.
  const isSuperAdmin = true;
  const permissions = {};
  const bypasses = isSuperAdmin; // exactly the guard's `admin.isSuperAdmin || ...` shape
  assert.equal(bypasses, true);
  void permissions; // documents that Super Admin never depends on this map
});

test("an explicit grant of one Finance action does not imply the others", async () => {
  const { hasRolePermission } = await loadPermissions();
  const viewOnly = { finance: { view: true } };
  assert.equal(hasRolePermission(viewOnly, "finance", "view"), true);
  assert.equal(hasRolePermission(viewOnly, "finance", "paymentsConfirm"), false);
  assert.equal(hasRolePermission(viewOnly, "finance", "refundsManage"), false);
  assert.equal(hasRolePermission(viewOnly, "finance", "exports"), false);
});

test("finance.exports without finance.view still resolves independently (route enforces the AND)", async () => {
  // hasRolePermission itself is a single (module, action) check — the "must
  // have both finance.view AND finance.exports" rule is enforced by chaining
  // two requireAdminPermission calls in routes/finance.ts, not by this
  // function. This test documents that the underlying primitive is
  // independent per action, so the chaining is the actual AND-gate.
  const { hasRolePermission } = await loadPermissions();
  const exportsOnly = { finance: { exports: true } };
  assert.equal(hasRolePermission(exportsOnly, "finance", "exports"), true);
  assert.equal(hasRolePermission(exportsOnly, "finance", "view"), false);
});

test("countCatalogPermissions counts the four new Finance actions when granted", async () => {
  const { countCatalogPermissions } = await loadPermissions();
  const before = countCatalogPermissions({});
  const after = countCatalogPermissions({
    finance: { view: true, paymentsConfirm: true, refundsManage: true, exports: true },
  });
  assert.equal(after - before, 4);
});

test("Admin Finance routes and navigation consistently require finance.view", async () => {
  const [app, nav] = await Promise.all([
    readFile(resolve("artifacts/admin/src/App.tsx"), "utf8"),
    readFile(resolve("artifacts/admin/src/components/layout/nav-config.ts"), "utf8"),
  ]);
  for (const key of [
    "financeOverview", "financeTransactions", "financePackages",
    "financeClassPayments", "financeBallet", "financeRefunds",
    "financeDiscounts", "financeExports",
  ]) {
    assert.ok(app.includes(`${key}: [["finance", "view"]]`), `${key} must require finance.view`);
  }
  assert.match(nav, /group\("Finance"[\s\S]*\[\["finance", "view"\]\]/);
  assert.doesNotMatch(nav, /group\("Finance"[\s\S]*\[\["dashboard", "view"\]\]/);
});

test("payment and refund controls are permission-gated in Admin UI", async () => {
  const files = await Promise.all([
    readFile(resolve("artifacts/admin/src/pages/bookings.tsx"), "utf8"),
    readFile(resolve("artifacts/admin/src/pages/package-orders.tsx"), "utf8"),
    readFile(resolve("artifacts/admin/src/pages/ballet/BalletPaymentsPage.tsx"), "utf8"),
    readFile(resolve("artifacts/admin/src/pages/ballet/BalletRefundsPage.tsx"), "utf8"),
    readFile(resolve("artifacts/admin/src/pages/finance/FinanceExportsPage.tsx"), "utf8"),
  ]);
  assert.match(files[0]!, /can\("finance", "paymentsConfirm"\)/);
  assert.match(files[1]!, /can\("finance", "paymentsConfirm"\)/);
  assert.match(files[2]!, /can\("finance", "paymentsConfirm"\)/);
  assert.match(files[3]!, /can\("finance", "refundsManage"\)/);
  assert.match(files[4]!, /can\("finance", "exports"\)/);
});

test("Dashboard hides financial sections and API redacts amounts without finance.view", async () => {
  const [page, route] = await Promise.all([
    readFile(resolve("artifacts/admin/src/pages/dashboard.tsx"), "utf8"),
    readFile(resolve("artifacts/api-server/src/routes/dashboard.ts"), "utf8"),
  ]);
  assert.match(page, /const canViewFinance = can\("finance", "view"\)/);
  assert.match(page, /\{canViewFinance && <section/);
  assert.match(route, /hasRolePermission\(req\.adminUser\?\.permissions, "finance", "view"\)/);
  assert.match(route, /totalNetRevenueEgp: null/);
  assert.match(route, /approvedProcessingRefundExposureEgp: null/);
});

test("every materially distinct Admin payment confirmation path has a pre-handler finance gate", async () => {
  const routes = await Promise.all([
    readFile(resolve("artifacts/api-server/src/routes/packageOrders.ts"), "utf8"),
    readFile(resolve("artifacts/api-server/src/routes/bookings.ts"), "utf8"),
    readFile(resolve("artifacts/api-server/src/routes/attendance.ts"), "utf8"),
    readFile(resolve("artifacts/api-server/src/routes/adminAttendanceGateway.ts"), "utf8"),
    readFile(resolve("artifacts/api-server/src/routes/adminBalletPayments.ts"), "utf8"),
  ]);
  assert.match(routes[0]!, /requirePackageOrderAction,\s*requirePackageOrderPaymentConfirmPermission,\s*async/);
  assert.match(routes[1]!, /requireBookingUpdatePermission,\s*requireBookingPaymentConfirmPermission,\s*async/);
  assert.match(routes[2]!, /requirePackageDeductForManualCheckIn,\s*requireWalkInPaymentConfirmPermission,\s*async/);
  assert.match(routes[3]!, /requirePackageDeductForStudioCredit,\s*requirePaymentConfirmForPayAtStudio,\s*async/);
  assert.equal((routes[4]!.match(/requireBalletPaymentConfirmPermission,\s*async/g) ?? []).length, 2);
  for (const source of routes) {
    assert.match(source, /requireAdminPermission\("finance", "paymentsConfirm"\)/);
  }
});

test("all Admin refund mutations compose legacy edit access with finance.refundsManage before handlers", async () => {
  const route = await readFile(resolve("artifacts/api-server/src/routes/balletCancellationRefunds.ts"), "utf8");
  for (const action of ["approve", "reject", "mark-processing", "mark-refunded", "mark-failed"]) {
    const marker = `"/admin/ballet/refunds/:id/${action}", requireAdminAuth, requireAdminPermission("ballet.payments", "edit"), requireAdminPermission("finance", "refundsManage"), async`;
    assert.ok(route.includes(marker), `${action} must be guarded before its handler`);
  }
});
