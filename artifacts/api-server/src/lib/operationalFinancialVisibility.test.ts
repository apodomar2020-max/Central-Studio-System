import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  canViewFinanceAmounts,
  canViewPaymentActionAmount,
  canViewRefundActionAmount,
  redactFinancialFields,
} from "./financialVisibility.ts";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const none = { isSuperAdmin: false, permissions: {} };
const view = { isSuperAdmin: false, permissions: { finance: { view: true } } };
const confirm = { isSuperAdmin: false, permissions: { finance: { paymentsConfirm: true } } };
const refund = { isSuperAdmin: false, permissions: { finance: { refundsManage: true } } };
const superAdmin = { isSuperAdmin: true, permissions: {} };

test("canonical visibility policy keeps broad and action-only access separate", () => {
  assert.equal(canViewFinanceAmounts(none), false);
  assert.equal(canViewFinanceAmounts(confirm), false);
  assert.equal(canViewFinanceAmounts(refund), false);
  assert.equal(canViewFinanceAmounts(view), true);
  assert.equal(canViewFinanceAmounts(superAdmin), true);
  assert.equal(canViewPaymentActionAmount(confirm), true);
  assert.equal(canViewPaymentActionAmount(refund), false);
  assert.equal(canViewRefundActionAmount(refund), true);
  assert.equal(canViewRefundActionAmount(confirm), false);
});

test("redaction uses null and preserves operational fields", () => {
  const row = { id: 7, status: "pending", amountEgp: 450, priceEgp: 500 };
  assert.deepEqual(
    redactFinancialFields(row, ["amountEgp", "priceEgp"], false),
    { id: 7, status: "pending", amountEgp: null, priceEgp: null },
  );
  assert.deepEqual(redactFinancialFields(row, ["amountEgp"], true), row);
});

test("booking and package general lists redact while dedicated action endpoints are permission gated", () => {
  const bookings = read("artifacts/api-server/src/routes/bookings.ts");
  const packages = read("artifacts/api-server/src/routes/packageOrders.ts");
  assert.match(bookings, /schedulePriceEgp:[\s\S]*?canViewFinanceAmounts\(req\.adminUser\)[\s\S]*?: null/);
  assert.match(packages, /serializePackageOrderRows[\s\S]*?priceEgp: null/);
  for (const source of [bookings, packages]) {
    assert.match(source, /payment-confirmation-amount/);
    assert.match(source, /requireAdminPermission\("finance", "paymentsConfirm"\)/);
  }
});

test("walk-in discovery never returns amounts to payment-confirm-only users", () => {
  const route = read("artifacts/api-server/src/routes/adminAttendanceGateway.ts");
  const attendancePage = read("artifacts/admin/src/pages/attendance.tsx");
  const unifiedDialog = read("artifacts/admin/src/components/unified-attendance-dialog.tsx");
  const scanDialog = read("artifacts/admin/src/components/scan-check-in-dialog.tsx");
  assert.match(route, /if \(!canViewFinanceAmounts\(req\.adminUser\)\)[\s\S]*?walkinPriceEgp: null/);
  assert.match(route, /"\/admin\/attendance\/walkin-payment-amount"[\s\S]*?requireAdminPermission\("finance", "paymentsConfirm"\)/);
  assert.match(attendancePage, /const canConfirmPayments = can\("finance", "paymentsConfirm"\)/);
  assert.match(unifiedDialog, /canConfirmPayments && <button[\s\S]*?Pay at Studio/);
  assert.match(scanDialog, /canConfirmPayments && <button[\s\S]*?Pay at Studio/);
});

test("Dashboard and Admin rendering never substitute redacted finance values with zero", () => {
  const route = read("artifacts/api-server/src/routes/dashboard.ts");
  const page = read("artifacts/admin/src/pages/dashboard.tsx");
  assert.doesNotMatch(route, /totalRevenue:\s*0/);
  assert.match(route, /totalRevenue:\s*null/);
  assert.match(page, /value == null \? "Restricted"/);
  assert.match(page, /canViewFinance \? \[\{ title: "Approved\/Processing Exposure"/);
});

test("Ballet detail and PDF paths enforce field-level and export authorization", () => {
  const route = read("artifacts/api-server/src/routes/adminBallet.ts");
  assert.match(route, /visiblePayments[\s\S]*?redactFinancialFields\(payment, \["amountEgp"\]/);
  assert.match(route, /applications\/:id\/export\.pdf[\s\S]*?requireAdminPermission\("finance", "view"\)[\s\S]*?requireAdminPermission\("finance", "exports"\)/);
});

test("activity logs redact financial keys and cannot search amount-bearing summaries without finance.view", () => {
  const route = read("artifacts/api-server/src/routes/adminActivityLogs.ts");
  assert.match(route, /FINANCIAL_KEY/);
  assert.match(route, /canViewAmounts \? \[ilike\(adminActivityLogsTable\.summary/);
  assert.match(route, /before: redactFinancialLogValue\(row\.before\)/);
});
