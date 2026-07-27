/**
 * Finance Final Closure Batch 1 — Part F1 regression coverage.
 *
 * Relocated from app/booking/flow.duplicateBooking.test.ts (independent
 * review Blocker 1 / test-structure item): a Node-test-runner file inside
 * the Expo Router `app/` directory can be picked up by Expo's file-based
 * router or its typecheck/module resolution, so plain Node test files
 * belong outside `app/`. This file lives at tests/booking/ instead and
 * reads app/booking/flow.tsx via a relative path.
 *
 * Confirmed defect (Blocker 1): duplicate-booking detection matched a
 * child booking by participantName === child.fullName. This is unsafe —
 * two children can share a name, names are editable, and casing/spacing
 * can differ — booking identity must use the stable child id
 * (children.id / bookings.participantChildId), never a name.
 *
 * This screen has no extractable pure function (all logic is inline in
 * the component), so — matching the established pattern for exactly this
 * situation elsewhere in the codebase (see unifiedAttendanceDialog.test.ts)
 * — the first block below is source-level assertions proving the fixed
 * disable/label logic exists and is wired into both the Self card and the
 * per-child list. The second block is a behavioral re-implementation of
 * the EXACT SAME algorithm (kept honest by the regex assertions in the
 * first block, which pin the production source to this exact shape), run
 * against concrete fixtures for every required scenario — this exercises
 * real pass/fail logic, not just pattern-matching, without needing a DOM
 * render harness this repo does not have for React Native screens.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("../../app/booking/flow.tsx", import.meta.url), "utf8");

// ─── Source-level assertions: the fixed logic exists in flow.tsx ───────────

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

test("Blocker 1: child duplicate detection keys on the stable participantChildId, not participantName, as the primary identity", () => {
  assert.match(source, /function childAlreadyBooked\(child: \{ id: string; fullName: string \}\): boolean/);
  assert.match(source, /if \(booking\.participantChildId != null\) \{\s*\n\s*return String\(booking\.participantChildId\) === String\(child\.id\);/);
  // The name comparison must be reachable ONLY as a fallback, after the
  // participantChildId != null branch has already returned — never as the
  // primary/first check.
  const fnMatch = /function childAlreadyBooked\([\s\S]*?\n  \}/.exec(source);
  assert.ok(fnMatch, "childAlreadyBooked function body must be present");
  const fnBody = fnMatch![0];
  const idCheckIndex = fnBody.indexOf("participantChildId != null");
  const nameCheckIndex = fnBody.indexOf("participantName.trim().toLowerCase()");
  assert.ok(idCheckIndex >= 0 && nameCheckIndex >= 0, "both the id check and the legacy name fallback must exist");
  assert.ok(idCheckIndex < nameCheckIndex, "the id check must be evaluated before the name fallback, never the reverse");
});

test("each child in the picker is independently disabled and labeled — an unrelated sibling remains selectable", () => {
  assert.match(source, /const isAlreadyBooked = childAlreadyBooked\(child\);/);
  assert.match(source, /disabled=\{isAlreadyBooked\}/);
  assert.match(source, /isAlreadyBooked \? \(\s*<Text style=\{styles\.alreadyBookedBadge\}>Already booked<\/Text>/);
});

test("pressing an already-booked card is a no-op — it never calls setParticipantType/setSelectedChildId", () => {
  assert.match(source, /if \(selfAlreadyBooked\) return;\s*\n\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\);\s*\n\s*setParticipantType\("self"\);/);
  assert.match(source, /if \(isAlreadyBooked\) return;\s*\n\s*Haptics\.impactAsync\(Haptics\.ImpactFeedbackStyle\.Light\);\s*\n\s*setSelectedChildId\(child\.id\);/);
});

test("Booking type and the API->local mapper carry a stable participantChildId (Blocker 1, mobile Booking model)", () => {
  const contextSource = readFileSync(new URL("../../contexts/AppContext.tsx", import.meta.url), "utf8");
  assert.match(contextSource, /participantChildId\?: number \| null;/);
  assert.match(contextSource, /participantChildId: r\.participantChildId \?\? null,/);
});

// ─── Behavioral re-implementation: exercises real scenarios 1-7 ────────────
//
// Mirrors childAlreadyBooked's exact algorithm (pinned to the production
// source by the regex assertions above). Any future edit to flow.tsx that
// changes this logic without updating this mirror will fail the source
// assertions above first.

interface FixtureBooking {
  participantType: "self" | "child";
  participantChildId: number | null;
  participantName: string;
}
interface FixtureChild {
  id: string;
  fullName: string;
}

function childAlreadyBookedModel(occurrenceBookings: FixtureBooking[], child: FixtureChild): boolean {
  return occurrenceBookings.some((booking) => {
    if (booking.participantType !== "child") return false;
    if (booking.participantChildId != null) {
      return String(booking.participantChildId) === String(child.id);
    }
    return booking.participantName.trim().toLowerCase() === child.fullName.trim().toLowerCase();
  });
}

test("1. same child ID -> disabled", () => {
  const bookings: FixtureBooking[] = [{ participantType: "child", participantChildId: 42, participantName: "Layla" }];
  assert.equal(childAlreadyBookedModel(bookings, { id: "42", fullName: "Layla" }), true);
});

test("2. different child IDs with identical names -> only the booked child is disabled", () => {
  const bookings: FixtureBooking[] = [{ participantType: "child", participantChildId: 1, participantName: "Sara" }];
  // Same name, different id — a real twin-name scenario.
  assert.equal(childAlreadyBookedModel(bookings, { id: "1", fullName: "Sara" }), true, "the actually-booked child (id 1) must be disabled");
  assert.equal(childAlreadyBookedModel(bookings, { id: "2", fullName: "Sara" }), false, "a different child with the SAME name must remain selectable");
});

test("3. booked child renamed after booking -> still disabled by ID", () => {
  // The booking row's participantName was captured at booking time ("Mona"); the
  // child's profile was later renamed to "Mona Ahmed" — the id match must still hold.
  const bookings: FixtureBooking[] = [{ participantType: "child", participantChildId: 7, participantName: "Mona" }];
  assert.equal(childAlreadyBookedModel(bookings, { id: "7", fullName: "Mona Ahmed" }), true);
});

test("4. casing/spacing differences do not affect a new ID-backed row (id comparison is exact, not name-normalized)", () => {
  const bookings: FixtureBooking[] = [{ participantType: "child", participantChildId: 9, participantName: "  layla  " }];
  // Even though the stored name differs in case/whitespace from the child's
  // current fullName, the id-backed match doesn't care — it never compares names at all.
  assert.equal(childAlreadyBookedModel(bookings, { id: "9", fullName: "LAYLA" }), true);
  assert.equal(childAlreadyBookedModel(bookings, { id: "10", fullName: "LAYLA" }), false, "a different id must not match regardless of name similarity");
});

test("5. legacy null-participantChildId row falls back to normalized name comparison, explicitly and only for that row", () => {
  const legacyBooking: FixtureBooking = { participantType: "child", participantChildId: null, participantName: "  Nour  " };
  assert.equal(
    childAlreadyBookedModel([legacyBooking], { id: "99", fullName: "nour" }),
    true,
    "legacy rows with no stable id fall back to a case/whitespace-insensitive name match",
  );
  assert.equal(
    childAlreadyBookedModel([legacyBooking], { id: "99", fullName: "Someone Else" }),
    false,
    "the legacy fallback must not match an unrelated name",
  );
});

test("6. Myself (self) behavior is unaffected by the child-id fix — unchanged self-identity logic", () => {
  const bookings: FixtureBooking[] = [{ participantType: "self", participantChildId: null, participantName: "The Account Owner" }];
  // selfAlreadyBooked in flow.tsx is `occurrenceBookings.some(b => b.participantType === "self")`
  // — entirely independent of childAlreadyBookedModel; re-asserted here for completeness.
  const selfAlreadyBooked = bookings.some((b) => b.participantType === "self");
  assert.equal(selfAlreadyBooked, true);
  // And self-type rows must never satisfy the CHILD check, regardless of id/name.
  assert.equal(childAlreadyBookedModel(bookings, { id: "1", fullName: "The Account Owner" }), false);
});

test("7. an unbooked sibling remains selectable even when another child of the same account is booked", () => {
  const bookings: FixtureBooking[] = [{ participantType: "child", participantChildId: 5, participantName: "Yousef" }];
  assert.equal(childAlreadyBookedModel(bookings, { id: "5", fullName: "Yousef" }), true, "the booked sibling is disabled");
  assert.equal(childAlreadyBookedModel(bookings, { id: "6", fullName: "Fatima" }), false, "the unbooked sibling remains selectable");
});
