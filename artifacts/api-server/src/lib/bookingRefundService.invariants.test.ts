/**
 * Wave 3 — static invariant coverage for bookingRefundService.ts.
 *
 * The full request -> approve -> complete lifecycle is transactional and
 * DB-backed (mirrors packageRefundService.ts's own shape, which is itself
 * only covered by integration tests elsewhere in this repo) — this file
 * proves, by source inspection, the specific safety invariants the owner
 * policy requires, without needing a live database:
 *   - the refundable amount is always paidAmountMinor - refundedAmountMinor
 *     (never admin-discretionary, never a partial figure)
 *   - a refund can never exceed the amount actually paid
 *   - completion is idempotent (completionIdempotencyKey checked)
 *   - request opening is idempotent (booking_refund:{bookingId} key)
 *   - the original captured amount fields are never written by this file
 *   - no payment record with status other than paid/partially_refunded is
 *     ever treated as refund-eligible (no refund fabricated for
 *     never-collected money)
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const FILE = "artifacts/api-server/src/lib/bookingRefundService.ts";
const source = readFileSync(resolve(process.cwd(), FILE), "utf8");

test("refundable amount is always the full remaining paid balance, never a partial/discretionary figure", () => {
  const occurrences = source.match(/Math\.max\(0, record\.paidAmountMinor - record\.refundedAmountMinor\)/g) ?? [];
  assert.ok(occurrences.length >= 3, "expected the same paidAmountMinor - refundedAmountMinor ceiling computed consistently across eligibility/request/approve/complete");
});

test("a refund can never exceed the amount actually paid — explicit guard before the payment_records write", () => {
  assert.match(source, /if \(refundedAmountMinor > record\.paidAmountMinor\)/);
  assert.match(source, /PAYMENT_REFUND_EXCEEDS_PAID/);
});

test("completion is idempotent via completionIdempotencyKey, matching an existing 'refunded' refund verbatim before replaying", () => {
  assert.match(source, /if \(refund\.status === "refunded"\) \{/);
  assert.match(source, /refund\.completionIdempotencyKey !== params\.completionIdempotencyKey \|\| refund\.transactionReference !== params\.transactionReference/);
  assert.match(source, /REFUND_ALREADY_COMPLETED/);
});

test("opening a refund request is idempotent, keyed to the specific booking (never opens two refunds for one cancellation)", () => {
  assert.match(source, /const requestIdempotencyKey = `booking_refund:\$\{params\.bookingId\}`;/);
});

test("only a paid or partially_refunded payment record is ever treated as refund-eligible", () => {
  assert.match(source, /record\.status !== "paid" && record\.status !== "partially_refunded"/);
});

test("the original captured amount fields are never written by this service — only refundedAmountMinor/status", () => {
  assert.equal(/grossAmountMinor:|finalPayableAmountMinor:|paidAmountMinor:\s*\w/.test(source), false);
  assert.match(source, /await tx\.update\(paymentRecordsTable\)\.set\(\{\s*refundedAmountMinor,\s*status: paymentStatus,\s*updatedAt: nowIso,\s*\}\)/);
});

test("a student self-cancellation opens the refund with no admin actor (requestedByAdminId: null)", () => {
  assert.match(source, /requestedByAdminId: null, \/\/ student self-cancellation, not admin-initiated/);
});

test("eligibility never treats a booking-flow payment record from a different flow type as eligible", () => {
  assert.match(source, /eq\(paymentRecordsTable\.flowType, "single_class_booking"\)/);
});
