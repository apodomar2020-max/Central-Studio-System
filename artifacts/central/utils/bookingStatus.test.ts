/**
 * F-08 regression coverage.
 *
 * Invariant: an unrecognized backend booking status (most notably the
 * backend's real, reachable "attendance_reversed" value — see
 * api-server/src/lib/attendanceReversalService.ts) must NEVER be presented
 * to the customer as "Confirmed". No new business meaning (attended,
 * cancelled, refunded, etc.) is invented for it — it maps to a neutral
 * "unknown" state instead.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { mapApiStatusToLocal } from "./bookingStatus";

test("every currently-known backend status still maps to its same local status", () => {
  assert.equal(mapApiStatusToLocal("pending"), "pending");
  assert.equal(mapApiStatusToLocal("confirmed"), "confirmed");
  assert.equal(mapApiStatusToLocal("pendingPayment"), "pending");
  assert.equal(mapApiStatusToLocal("rejected"), "rejected");
  assert.equal(mapApiStatusToLocal("cancelled"), "cancelled");
  assert.equal(mapApiStatusToLocal("attended"), "attended");
  assert.equal(mapApiStatusToLocal("completed"), "completed");
  assert.equal(mapApiStatusToLocal("noShow"), "noShow");
  assert.equal(mapApiStatusToLocal("no_show"), "noShow");
});

test("attendance_reversed (a real, reachable backend status) never maps to confirmed", () => {
  assert.notEqual(mapApiStatusToLocal("attendance_reversed"), "confirmed");
  assert.equal(mapApiStatusToLocal("attendance_reversed"), "unknown");
});

test("any arbitrary future/unrecognized status never maps to confirmed", () => {
  assert.notEqual(mapApiStatusToLocal("some_future_status_v2"), "confirmed");
  assert.equal(mapApiStatusToLocal("some_future_status_v2"), "unknown");
});
