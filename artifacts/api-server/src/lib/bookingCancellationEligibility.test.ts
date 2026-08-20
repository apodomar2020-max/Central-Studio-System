/**
 * Wave 3 (F-20) — boundary coverage for the 2-hour self-cancellation
 * cutoff, mandated exactly:
 *   - 2h + 1 second before start -> allowed
 *   - exactly 2h before start -> allowed
 *   - 1h 59m 59s before start -> blocked
 *   - after start -> blocked
 */
import assert from "node:assert/strict";
import test from "node:test";

import { evaluateBookingCancellationEligibility, isBookingSelfCancellable, SELF_CANCEL_CUTOFF_MINUTES } from "./bookingCancellationEligibility";
import { cairoDateTimeToUtcMs } from "./occurrence";

const OCCURRENCE_DATE = "2026-08-25"; // arbitrary Cairo-local calendar date
const START_TIME = "17:00";
const startMs = cairoDateTimeToUtcMs(OCCURRENCE_DATE, START_TIME);

function atOffsetMs(offsetMs: number): Date {
  return new Date(startMs + offsetMs);
}

test("120 minutes (exactly 2h) before start -> allowed", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(-SELF_CANCEL_CUTOFF_MINUTES * 60_000),
  );
  assert.deepEqual(result, { eligible: true });
});

test("2h + 1 second before start -> allowed", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(-(SELF_CANCEL_CUTOFF_MINUTES * 60_000 + 1_000)),
  );
  assert.deepEqual(result, { eligible: true });
});

test("1h 59m 59s before start -> blocked (too_close_to_start)", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(-(SELF_CANCEL_CUTOFF_MINUTES * 60_000 - 1_000)),
  );
  assert.deepEqual(result, { eligible: false, reason: "too_close_to_start" });
});

test("1 second after start -> blocked", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(1_000),
  );
  assert.deepEqual(result, { eligible: false, reason: "too_close_to_start" });
});

test("exactly at start -> blocked", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(0),
  );
  assert.deepEqual(result, { eligible: false, reason: "too_close_to_start" });
});

test("far in advance (1 week before) -> allowed", () => {
  const result = evaluateBookingCancellationEligibility(
    { occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME },
    atOffsetMs(-7 * 24 * 60 * 60_000),
  );
  assert.deepEqual(result, { eligible: true });
});

test("missing occurrenceDate -> blocked (occurrence_unresolvable), never silently allowed", () => {
  const result = evaluateBookingCancellationEligibility({ occurrenceDate: null, startTime: START_TIME }, atOffsetMs(-999_999_999));
  assert.deepEqual(result, { eligible: false, reason: "occurrence_unresolvable" });
});

test("missing startTime -> blocked (occurrence_unresolvable), never silently allowed", () => {
  const result = evaluateBookingCancellationEligibility({ occurrenceDate: OCCURRENCE_DATE, startTime: null }, atOffsetMs(-999_999_999));
  assert.deepEqual(result, { eligible: false, reason: "occurrence_unresolvable" });
});

test("isBookingSelfCancellable convenience boolean matches evaluate()", () => {
  assert.equal(isBookingSelfCancellable({ occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME }, atOffsetMs(-3 * 60 * 60_000)), true);
  assert.equal(isBookingSelfCancellable({ occurrenceDate: OCCURRENCE_DATE, startTime: START_TIME }, atOffsetMs(-60 * 60_000)), false);
});

// Cross-midnight sanity: a very-early-morning class (e.g. 00:30) still
// resolves its cutoff from the REAL instant, not a naive wall-clock string
// comparison that could be fooled by a date rollover.
test("cross-midnight occurrence: cutoff resolves from the real instant, not string comparison", () => {
  const midnightDate = "2026-08-25";
  const midnightStart = "00:30";
  const midnightStartMs = cairoDateTimeToUtcMs(midnightDate, midnightStart);
  const justInsideCutoff = new Date(midnightStartMs - SELF_CANCEL_CUTOFF_MINUTES * 60_000);
  const justOutsideCutoff = new Date(midnightStartMs - (SELF_CANCEL_CUTOFF_MINUTES * 60_000 - 1_000));
  assert.equal(
    evaluateBookingCancellationEligibility({ occurrenceDate: midnightDate, startTime: midnightStart }, justInsideCutoff).eligible,
    true,
  );
  assert.equal(
    evaluateBookingCancellationEligibility({ occurrenceDate: midnightDate, startTime: midnightStart }, justOutsideCutoff).eligible,
    false,
  );
});
