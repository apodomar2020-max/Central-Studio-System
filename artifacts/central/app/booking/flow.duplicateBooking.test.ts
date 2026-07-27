/**
 * Finance Final Closure Batch 1 — Part F1 regression coverage.
 *
 * Confirmed bug: the mobile participant selector never checked the app's
 * existing `bookings` list before rendering Self/Child cards, so an
 * already-booked participant remained fully selectable, only failing after
 * submission via the server's duplicate_booking error. This screen has no
 * extractable pure function (all logic is inline in the component), so —
 * matching the established pattern for exactly this situation elsewhere in
 * the codebase (see unifiedAttendanceDialog.test.ts) — these are
 * source-level assertions proving the disable/label logic exists and is
 * wired into both the Self card and the per-child list.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./flow.tsx", import.meta.url), "utf8");

test("duplicate detection is scoped to the exact schedule + occurrence, and only pending/confirmed bookings block re-selection", () => {
  assert.match(source, /String\(b\.scheduleId\) === String\(cls\.scheduleId\)/);
  assert.match(source, /\(b\.occurrenceDate \?\? b\.date\) === cls\.date/);
  assert.match(source, /b\.bookingStatus === "pending" \|\| b\.bookingStatus === "confirmed"/);
});

test("the Self card is disabled and labeled Already booked when the account already has an active booking for this occurrence", () => {
  assert.match(source, /const selfAlreadyBooked = occurrenceBookings\.some\(\(b\) => b\.participantType === "self"\)/);
  assert.match(source, /disabled=\{selfAlreadyBooked\}/);
  assert.match(source, /selfAlreadyBooked \? \(\s*<Text style=\{styles\.alreadyBookedBadge\}>Already booked<\/Text>/);
});

test("each child in the picker is independently disabled and labeled — an unrelated sibling remains selectable", () => {
  assert.match(source, /function childAlreadyBooked\(child: \{ fullName: string \}\): boolean/);
  assert.match(source, /const isAlreadyBooked = childAlreadyBooked\(child\);/);
  assert.match(source, /disabled=\{isAlreadyBooked\}/);
  assert.match(source, /isAlreadyBooked \? \(\s*<Text style=\{styles\.alreadyBookedBadge\}>Already booked<\/Text>/);
});

test("pressing an already-booked card is a no-op — it never calls setParticipantType/setSelectedChildId", () => {
  assert.match(source, /if \(selfAlreadyBooked\) return;\s*\n\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\);\s*\n\s*setParticipantType\("self"\);/);
  assert.match(source, /if \(isAlreadyBooked\) return;\s*\n\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\);\s*\n\s*setSelectedChildId\(child\.id\);/);
});
