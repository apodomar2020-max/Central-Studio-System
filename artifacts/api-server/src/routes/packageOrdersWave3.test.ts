/**
 * Wave 3 — static wiring coverage for packageOrders.ts: the bare-cancel
 * safety guard (paid/active order cannot bare-cancel; must use the refund
 * workflow) and the new pendingPayment-only student self-cancel route.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const FILE = "artifacts/api-server/src/routes/packageOrders.ts";
const source = readFileSync(resolve(process.cwd(), FILE), "utf8");

test("bare-cancel is blocked for any order not still pendingPayment — must use the refund workflow instead", () => {
  assert.match(source, /if \(parsed\.data\.status === "cancelled" && current\.status !== "pendingPayment"\) \{/);
  assert.match(source, /PACKAGE_ORDER_REQUIRES_REFUND_WORKFLOW/);
  assert.match(source, /POST \/admin\/package-orders\/:id\/refunds/);
});

test("the bare-cancel guard runs under the same row lock as the write, closing the race window", () => {
  const guardBlock = source.slice(
    source.indexOf('const [current] = await tx\n        .select()\n        .from(packageOrdersTable)\n        .where(eq(packageOrdersTable.id, params.data.id))\n        .for("update");'),
    source.indexOf('PACKAGE_ORDER_REQUIRES_REFUND_WORKFLOW'),
  );
  assert.ok(guardBlock.length > 0 && guardBlock.includes('current.status !== "pendingPayment"'), "expected the guard to read the locked `current` row, not a separate unlocked pre-check");
});

test("a customer self-cancel route exists, scoped to student auth + ownership + pendingPayment only", () => {
  assert.match(source, /router\.patch\(\s*"\/package-orders\/:id\/cancel",\s*requireStudentAuth,\s*requireVerifiedStudent,/);
  assert.match(source, /if \(existing\.status !== "pendingPayment"\) \{\s*return \{ kind: "not_cancellable" as const, status: existing\.status \};/);
});

test("the self-cancel route never fabricates a refund — it only exists for the pendingPayment (never-paid) case", () => {
  const routeStart = source.indexOf('router.patch(\n  "/package-orders/:id/cancel"');
  const routeEnd = source.indexOf("export default router", routeStart);
  const routeBody = source.slice(routeStart, routeEnd > 0 ? routeEnd : routeStart + 3000);
  assert.equal(/requestPackageRefund|paymentRefundsTable/.test(routeBody), false, "the pendingPayment self-cancel path must never touch the refund machinery — nothing was ever collected");
});
