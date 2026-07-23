/**
 * Pure unit tests for the strict Cairo attendance-window helper (see
 * lib/occurrence.ts's checkInWindowState). No DB, no network — exercises the
 * exact boundary example from the locked business rules: a 5:00 PM–6:00 PM
 * class, checked at various points around the 120-minute pre-class window
 * and the strict end-time cutoff, plus cross-midnight occurrences and
 * seasonal Cairo UTC-offset correctness (no hardcoded GMT+2/GMT+3).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attendanceOccurrenceDateForWeeklySchedule,
  checkInWindowState,
  isWithinCheckInWindow,
  cairoDateTimeToUtcMs,
  CHECK_IN_GRACE_MINUTES,
} from "./occurrence.ts";

const OCCURRENCE_DATE = "2026-07-23";
const SCHEDULE = { startTime: "17:00", endTime: "18:00" };

/** Builds the real UTC instant for a Cairo wall-clock date+time, via the
 *  SAME canonical helper checkInWindowState itself uses internally — never a
 *  hardcoded offset. */
function cairoInstant(date: string, time: string): Date {
  return new Date(cairoDateTimeToUtcMs(date, time));
}

test("120-minute pre-class grace window is the documented constant", () => {
  assert.equal(CHECK_IN_GRACE_MINUTES, 120);
});

test("121 minutes before start (14:58) is too_early", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "14:58")), "too_early");
});

test("exactly 120 minutes before start (15:00) is open", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "15:00")), "open");
});

test("at class start (17:00) is open", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "17:00")), "open");
});

test("one minute before end (17:59) is open", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "17:59")), "open");
  assert.equal(isWithinCheckInWindow(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "17:59")), true);
});

test("exactly at end time (18:00) is ended, not open", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "18:00")), "ended");
  assert.equal(isWithinCheckInWindow(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "18:00")), false);
});

test("well after end (20:00) is ended", () => {
  assert.equal(checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "20:00")), "ended");
});

test("missing occurrenceDate is not_today regardless of time", () => {
  assert.equal(checkInWindowState(SCHEDULE, null, cairoInstant(OCCURRENCE_DATE, "17:30")), "not_today");
  assert.equal(checkInWindowState(SCHEDULE, undefined, cairoInstant(OCCURRENCE_DATE, "17:30")), "not_today");
});

test("missing startTime is not_today regardless of occurrenceDate/time", () => {
  assert.equal(checkInWindowState({ startTime: null }, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "17:30")), "not_today");
});

// A different-day occurrenceDate is evaluated on its own real instants, not
// short-circuited to "not_today" — the window helper must never fall back to
// a UTC calendar-date-string shortcut (Section 5's explicit prohibition).
// "now" here is a full day after this occurrence's window would have opened
// or ended, so it resolves to genuinely "ended", exactly as the real Cairo
// clock would judge it.
test("a different-day occurrenceDate is judged on its own instants (no not_today shortcut)", () => {
  assert.equal(checkInWindowState(SCHEDULE, "2026-07-22", cairoInstant(OCCURRENCE_DATE, "17:30")), "ended");
});

test("omitting endTime preserves the legacy stays-open-all-day behavior", () => {
  const startOnly = { startTime: "17:00" };
  assert.equal(checkInWindowState(startOnly, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "23:59")), "open");
});

test("ended takes precedence over too_early only when genuinely past end (sanity: never both)", () => {
  const state = checkInWindowState(SCHEDULE, OCCURRENCE_DATE, cairoInstant(OCCURRENCE_DATE, "18:00"));
  assert.notEqual(state, "too_early");
});

// ─── Cross-midnight occurrences (Section 5's locked example) ───────────────
// A Tuesday 01:00–02:00 Cairo class: window opens 120 minutes before start,
// i.e. Monday 23:00 Cairo — never clamped to Tuesday 00:00.
const MIDNIGHT_SCHEDULE = { startTime: "01:00", endTime: "02:00" };
const MONDAY = "2026-07-27"; // a Monday
const TUESDAY = "2026-07-28"; // the following Tuesday

test("cross-midnight: Monday 22:59 Cairo is too_early (one minute before the window opens)", () => {
  assert.equal(checkInWindowState(MIDNIGHT_SCHEDULE, TUESDAY, cairoInstant(MONDAY, "22:59")), "too_early");
});

test("cross-midnight: Monday 23:00 Cairo is open (window opens the PRIOR calendar day, not clamped to midnight)", () => {
  assert.equal(checkInWindowState(MIDNIGHT_SCHEDULE, TUESDAY, cairoInstant(MONDAY, "23:00")), "open");
});

test("cross-midnight: Tuesday 01:59:59 Cairo is open (mid-occurrence, after the calendar date has rolled over)", () => {
  const nearEnd = new Date(cairoDateTimeToUtcMs(TUESDAY, "01:59") + 59_000);
  assert.equal(checkInWindowState(MIDNIGHT_SCHEDULE, TUESDAY, nearEnd), "open");
});

test("cross-midnight: Tuesday 02:00 Cairo is ended (exactly at the occurrence's real end instant)", () => {
  assert.equal(checkInWindowState(MIDNIGHT_SCHEDULE, TUESDAY, cairoInstant(TUESDAY, "02:00")), "ended");
});

const TUESDAY_MIDNIGHT_SCHEDULE = { dayOfWeek: 2, ...MIDNIGHT_SCHEDULE };

test("resolver occurrence: Monday 22:59 does not expose Tuesday's occurrence", () => {
  assert.equal(attendanceOccurrenceDateForWeeklySchedule(TUESDAY_MIDNIGHT_SCHEDULE, cairoInstant(MONDAY, "22:59")), null);
});

test("resolver occurrence: Monday 23:00 exposes Tuesday and preserves Tuesday as classDate", () => {
  assert.equal(attendanceOccurrenceDateForWeeklySchedule(TUESDAY_MIDNIGHT_SCHEDULE, cairoInstant(MONDAY, "23:00")), TUESDAY);
});

test("resolver occurrence: Tuesday remains canonical through 01:59:59 and at its strict end boundary", () => {
  const nearEnd = new Date(cairoDateTimeToUtcMs(TUESDAY, "01:59") + 59_000);
  assert.equal(attendanceOccurrenceDateForWeeklySchedule(TUESDAY_MIDNIGHT_SCHEDULE, nearEnd), TUESDAY);
  assert.equal(attendanceOccurrenceDateForWeeklySchedule(TUESDAY_MIDNIGHT_SCHEDULE, cairoInstant(TUESDAY, "02:00")), TUESDAY);
});

// ─── Seasonal Cairo UTC-offset correctness (Section 5 — no hardcoded offset) ─
// Derives the expected offset independently via the same ICU technique
// (Intl.DateTimeFormat with shortOffset) the production helper uses
// internally, rather than hardcoding a specific real-world value — this
// verifies the BOUNDARY MATH is correct for whatever offset Cairo actually
// observes at test-run time, in both July and January, without assuming
// which one is "summer"/"winter" for Egypt specifically.
function icuCairoOffsetMinutes(approxUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Africa/Cairo", timeZoneName: "shortOffset" }).formatToParts(approxUtc);
  const offsetText = parts.find((p) => p.type === "timeZoneName")?.value ?? "";
  const match = /GMT([+-]\d+)(?::(\d+))?/.exec(offsetText);
  if (!match) throw new Error(`Could not derive Cairo offset from "${offsetText}"`);
  const hours = Number(match[1]);
  const minutes = Number(match[2] ?? "0");
  return hours * 60 + (hours < 0 ? -minutes : minutes);
}

for (const [label, date] of [["July", "2026-07-15"], ["January", "2027-01-15"]] as const) {
  test(`${label}: occurrence start instant matches the ICU-derived Cairo offset for that date, not a hardcoded one`, () => {
    const approxUtc = new Date(`${date}T17:00:00.000Z`);
    const offsetMinutes = icuCairoOffsetMinutes(approxUtc);
    const expectedStartMs = approxUtc.getTime() - offsetMinutes * 60_000;
    assert.equal(cairoDateTimeToUtcMs(date, "17:00"), expectedStartMs);

    // The 120-minute grace window opens exactly at (derived start - 120m);
    // one minute earlier must be too_early — proves checkInWindowState uses
    // this same ICU-derived offset, whatever it is this month, rather than a
    // fixed GMT+2/GMT+3 assumption.
    const openMs = expectedStartMs - CHECK_IN_GRACE_MINUTES * 60_000;
    assert.equal(checkInWindowState(SCHEDULE, date, new Date(openMs - 60_000)), "too_early");
    assert.equal(checkInWindowState(SCHEDULE, date, new Date(openMs)), "open");
  });
}
