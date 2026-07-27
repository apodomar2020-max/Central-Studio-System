import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const source = readFileSync(new URL("./unified-attendance-dialog.tsx", import.meta.url), "utf8");

test("Ballet confirmation submits identity only and never client-controlled occurrence business fields", () => {
  assert.match(source, /body\.balletLevelAssignmentId\s*=\s*candidate\.balletLevelAssignmentId/);
  assert.match(source, /body\.balletScheduleId\s*=\s*candidate\.scheduleId/);
  assert.doesNotMatch(source, /body\.(?:status|occurrenceDate|classDate|durationMinutes)\s*=/);
});

test("resolver results require an explicit candidate pick before confirmation", () => {
  assert.match(source, /function pickCandidate\(account: AccountGroup, candidate: Candidate\)/);
  assert.match(source, /if \(!selected \|\| submitLock\) return;/);
  assert.doesNotMatch(source, /setSelected\([^\n]*candidates\[0\]/);
});

// ─── Finance Batch 1 (Part C) — booked vs Walk-in candidate distinction ──────

test("a booked candidate (real bookingId) and a Walk-in offer (no bookingId) are never labeled identically", () => {
  assert.match(source, /function isBookedCandidate\(candidate: Candidate\): boolean/);
  assert.match(source, /candidate\.bookingId != null \|\| candidate\.program === "ballet"/);
  // The old bug: every "eligible" candidate rendered the identical
  // "Eligible now" label regardless of whether it had a real booking.
  assert.doesNotMatch(source, /label: "Eligible now"/);
  assert.match(source, /label: "Booked for this class"/);
  assert.match(source, /label: "Available as Walk-in"/);
});

test("when at least one participant has a real booking, unbooked family members are not shown as candidates at all", () => {
  // visibleCandidates must resolve to ONLY bookedCandidates whenever any
  // exist — walkInCandidates must never render alongside a real booking for
  // the same account/occurrence (this is exactly the UAT symptom: every
  // family member appearing "eligible" when only one was actually booked).
  assert.match(source, /const bookedCandidates = account\.candidates\.filter\(isBookedCandidate\)/);
  assert.match(source, /const walkInCandidates = account\.candidates\.filter\(\(c\) => !isBookedCandidate\(c\)\)/);
  assert.match(
    source,
    /const visibleCandidates = bookedCandidates\.length > 0 \? bookedCandidates : walkInCandidates/,
  );
});

test("a not-eligible candidate never falls through to the generic eligibility string as a label", () => {
  // Case 4 (Not eligible): every switch branch must resolve to a concrete,
  // concise label — never the raw internal eligibility enum value leaking
  // into the UI (e.g. "no_active_subscription" shown verbatim).
  assert.doesNotMatch(source, /default: return \{ label: candidate\.reason \?\? candidate\.eligibility/);
  assert.match(source, /default: return \{ label: candidate\.reason \?\? "Not eligible", color: RED \};/);
});

// ─── Studio Walk-in Explicit Settlement hotfix ───────────────────────────────

test("pickCandidate never pre-selects a settlement mode for a Walk-in, even when a valid package credit exists", () => {
  // The old bug: paymentMode defaulted to "package_credit" automatically
  // whenever candidate.hasPackageCredit was true, so package availability
  // silently made the choice for the Admin. Package availability must never
  // decide this — the Admin must click one of the settlement buttons.
  assert.doesNotMatch(source, /candidate\.hasPackageCredit\s*\?\s*"package_credit"/);
  assert.match(source, /setPaymentMode\(isWalkIn \? null : "pay_at_studio"\)/);
});

test("Confirm Attendance is disabled for a Studio candidate until an explicit settlement mode is chosen", () => {
  assert.match(source, /paymentMode == null \|\|/);
});
