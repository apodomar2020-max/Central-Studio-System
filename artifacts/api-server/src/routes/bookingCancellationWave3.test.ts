/**
 * Wave 3 — static wiring coverage for bookings.ts: the 2-hour cutoff, the
 * auto-opened refund, the extended attended/attendance_reversed
 * state-machine guard, and Super-Admin-restricted hard delete. Mirrors the
 * repo's established source-assertion convention for this file (see
 * bookingPriceBinding.test.ts) — bookings.ts pulls in Express/DB and is not
 * cleanly unit-importable outside a live server process.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const FILE = "artifacts/api-server/src/routes/bookings.ts";
const source = readFileSync(resolve(process.cwd(), FILE), "utf8");

test("the cancel route evaluates the 2-hour cutoff via the shared eligibility helper, not an inline re-derivation", () => {
  assert.match(source, /import \{ evaluateBookingCancellationEligibility \} from "\.\.\/lib\/bookingCancellationEligibility";/);
  assert.match(source, /const eligibility = evaluateBookingCancellationEligibility\(\{/);
  assert.match(source, /if \(!eligibility\.eligible\) \{\s*return \{ kind: "cutoff_blocked" as const, reason: eligibility\.reason \};/);
});

test("the cutoff uses the booking's own locked-in occurrenceDate and the schedule's startTime — the canonical inputs, not a re-derived 'current' occurrence", () => {
  assert.match(source, /occurrenceDate: existing\.occurrenceDate,\s*startTime: scheduleStartTime,/);
});

test("cutoff_blocked returns 409 with a stable error code, distinct from not_cancellable", () => {
  assert.match(source, /code: "cancellation_window_closed"/);
});

test("a paid single-class booking cancellation opens a refund request in the SAME transaction as the seat release, never gated on it", () => {
  assert.match(source, /import \{ requestBookingRefundInTx \} from "\.\.\/lib\/bookingRefundService";/);
  // The refund request happens strictly AFTER the bookingStatus update in
  // source order, but within the same `db.transaction` callback — proving
  // seat release is not conditioned on the refund's own outcome would need
  // a live DB; this at least proves both writes are in one transaction body
  // (no second `db.transaction(` between the update and the refund call).
  const updateIdx = source.indexOf('.set({ bookingStatus: "cancelled", status: "cancelled" })');
  const refundIdx = source.indexOf("requestBookingRefundInTx(tx,");
  assert.ok(updateIdx > 0 && refundIdx > updateIdx, "expected the refund-open call after the bookingStatus write, inside the same transaction");
  const between = source.slice(updateIdx, refundIdx);
  assert.equal(/db\.transaction\(/.test(between), false, "no second transaction boundary between the cancellation write and the refund-open call");
});

test("package-credit bookings never attempt to open a refund (H5: no cash was ever collected pre-attendance for those)", () => {
  assert.match(source, /if \(existing\.packageOrderId == null\) \{\s*const refundResult = await requestBookingRefundInTx/);
});

test("the state-machine guard treats attendance_reversed as terminal in both directions, alongside the existing attended/completed guard", () => {
  assert.match(source, /const wasAttendanceReversed = existing\.bookingStatus === "attendance_reversed";/);
  assert.match(source, /const willBeAttendanceReversed = normalized\.bookingStatus === "attendance_reversed";/);
  assert.match(source, /if \(willBeAttendanceReversed\) \{/);
  assert.match(source, /if \(wasAttendanceReversed\) \{/);
});

test("BOOKING_STATUSES recognizes attendance_reversed, so normalizeBookingWrite's existing-value fallback never silently resets it on an unrelated edit", () => {
  assert.match(source, /const BOOKING_STATUSES = \["pending", "confirmed", "rejected", "cancelled", "attended", "completed", "attendance_reversed"\] as const;/);
});

test("hard delete requires Super Admin on top of the existing bookings:delete permission", () => {
  const deleteBlock = source.slice(source.indexOf('router.delete(\n  "/bookings/:id"'), source.indexOf('router.delete(\n  "/bookings/:id"') + 400);
  assert.match(deleteBlock, /requireAdminPermission\("bookings", "delete"\)/);
  assert.match(deleteBlock, /requireSuperAdmin,/);
});
