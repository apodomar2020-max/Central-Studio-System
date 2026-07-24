/**
 * Source-invariant checks for POST /attendance's no-booking (Walk-in) path —
 * proves it delegates to the canonical Studio Walk-in engine rather than
 * re-implementing a second, divergent business engine (Blocker C).
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./attendance.ts", import.meta.url), "utf8");

test("no-booking Walk-in requires a canonical scheduleId and a resolved studentId", () => {
  assert.match(source, /if \(scheduleId == null \|\| studentId == null\)/);
  assert.match(source, /error:\s*"deprecated_contract"/);
});

test("no-booking Walk-in delegates to performStudioWalkInCheckIn — no second write engine", () => {
  assert.match(source, /import \{ listStudioWalkInOptions, performStudioWalkInCheckIn, type StudioWalkInPaymentDecision \} from "\.\.\/lib\/studioWalkIn"/);
  assert.match(source, /await performStudioWalkInCheckIn\(\{/);
  // The old hand-rolled engine must be gone: no direct attendance insert,
  // no direct package_orders credit deduction, and no direct notification
  // call in this route file — all of that now lives exclusively in
  // studioWalkIn.ts / checkInService.ts.
  assert.doesNotMatch(source, /\.insert\(attendanceTable\)/);
  assert.doesNotMatch(source, /\.insert\(creditTransactionsTable\)/);
  assert.doesNotMatch(source, /createStudentNotification/);
});

test("the booking-based path still delegates unchanged to performBookingCheckIn", () => {
  assert.match(source, /if \(bookingId != null\) \{/);
  assert.match(source, /return performBookingCheckIn\(tx, \{/);
});
