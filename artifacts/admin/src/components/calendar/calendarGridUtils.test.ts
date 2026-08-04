import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  calculateCalendarTimeRange,
  formatHourLabel,
  getCardSizeTier,
  GRID_START_MIN,
  GRID_END_MIN,
} from "./CalendarOccurrenceCard";

test("calculateCalendarTimeRange — returns default fallback (720 to 1440) when occurrences is empty", () => {
  const result = calculateCalendarTimeRange([]);
  assert.equal(result.startMinute, GRID_START_MIN);
  assert.equal(result.endMinute, GRID_END_MIN);
});

test("calculateCalendarTimeRange — expands start time to 30 mins before earliest event start", () => {
  const result = calculateCalendarTimeRange([
    {
      source: "class",
      scheduleId: 1,
      occurrenceDate: "2026-08-03",
      startTime: "08:00",
      endTime: "09:00",
      bookingCount: 5,
    },
  ]);
  assert.equal(result.startMinute, 450);
  assert.equal(result.endMinute, 930);
});

test("calculateCalendarTimeRange — computes full dynamic range for morning, afternoon, and late night events", () => {
  const result = calculateCalendarTimeRange([
    {
      source: "class",
      scheduleId: 1,
      occurrenceDate: "2026-08-03",
      startTime: "08:00",
      endTime: "09:00",
      bookingCount: 2,
    },
    {
      source: "ballet",
      scheduleId: 2,
      occurrenceDate: "2026-08-03",
      startTime: "14:00",
      endTime: "15:30",
      bookingCount: 0,
    },
    {
      source: "reservation",
      scheduleId: 3,
      occurrenceDate: "2026-08-03",
      startTime: "22:00",
      endTime: "23:00",
      bookingCount: 0,
    },
  ]);

  assert.equal(result.startMinute, 450);
  assert.equal(result.endMinute, 1410);
});

test("calculateCalendarTimeRange — clamps start time to 0 and end time to 1440 while preserving 8h minimum window", () => {
  const earlyResult = calculateCalendarTimeRange([
    {
      source: "class",
      scheduleId: 1,
      occurrenceDate: "2026-08-03",
      startTime: "00:15",
      endTime: "01:00",
      bookingCount: 1,
    },
  ]);
  assert.equal(earlyResult.startMinute, 0);
  assert.equal(earlyResult.endMinute, 480);

  const lateResult = calculateCalendarTimeRange([
    {
      source: "reservation",
      scheduleId: 2,
      occurrenceDate: "2026-08-03",
      startTime: "23:15",
      endTime: "23:45",
      bookingCount: 0,
    },
  ]);
  assert.equal(lateResult.endMinute, 1440);
  assert.equal(lateResult.startMinute, 960);
});

test("formatHourLabel — formats both whole hours and half hours correctly", () => {
  assert.equal(formatHourLabel(720), "12 PM");
  assert.equal(formatHourLabel(450), "7:30 AM");
  assert.equal(formatHourLabel(810), "1:30 PM");
  assert.equal(formatHourLabel(1410), "11:30 PM");
  assert.equal(formatHourLabel(1440), "12 AM");
});

// Phase 6F — minimal scanning cards. getCardSizeTier is the single source of
// truth for how much secondary text a card shows; test the pure function
// directly rather than the JSX (no React rendering harness in this app).
test("getCardSizeTier — small tier below 40px shows title only", () => {
  assert.equal(getCardSizeTier(24), "small");
  assert.equal(getCardSizeTier(39), "small");
});

test("getCardSizeTier — medium tier is 40px through 70px inclusive", () => {
  assert.equal(getCardSizeTier(40), "medium");
  assert.equal(getCardSizeTier(55), "medium");
  assert.equal(getCardSizeTier(70), "medium");
});

test("getCardSizeTier — large tier is above 70px", () => {
  assert.equal(getCardSizeTier(71), "large");
  assert.equal(getCardSizeTier(200), "large");
});

test("CalendarOccurrenceCard source — renders title unconditionally, and secondary text is gated on size tier only", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  // Title has no conditional guard around it.
  assert.match(cardSource, /\{displayTitle\}/);
  // Medium shows the time range only; large shows instructor/organizer only.
  assert.match(cardSource, /size === "medium"[\s\S]{0,200}occurrence\.startTime\}–\{occurrence\.endTime\}/);
  assert.match(cardSource, /size === "large"[\s\S]{0,200}organizerOrInstructor/);
});

test("CalendarOccurrenceCard source — never renders location or booking count on-card (moved to detail sheets)", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  // occurrence.branchName/roomName/bookingCount must not drive any visible
  // card content. conflict.branchName/roomName still appear inside
  // formatConflictSummary — that only feeds the native `title` tooltip
  // attribute, not on-card JSX, so it's excluded from this check.
  assert.doesNotMatch(cardSource, /occurrence\.branchName/);
  assert.doesNotMatch(cardSource, /occurrence\.roomName/);
  assert.doesNotMatch(cardSource, /occurrence\.bookingCount/);
  assert.doesNotMatch(cardSource, />\s*\{occurrence\.bookingCount\}|booked</);
});

test("CalendarOccurrenceCard source — keeps conflict indicator and category color tokens", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /calendar-conflict-badge-/);
  assert.match(cardSource, /getCalendarCategoryTokens/);
  assert.match(cardSource, /border-destructive/);
});

test("CalendarOccurrenceCard source — title uses the category text token, not opacity, for contrast", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /text-xs font-semibold leading-tight pr-4 " \+ tokens\.text/);
});
