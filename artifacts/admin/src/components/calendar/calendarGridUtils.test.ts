import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import {
  calculateCalendarTimeRange,
  formatHourLabel,
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

test("CalendarOccurrenceCard — includes height-aware threshold logic for smart event card rendering", () => {
  const cardSource = readFileSync(
    resolve(process.cwd(), "artifacts/admin/src/components/calendar/CalendarOccurrenceCard.tsx"),
    "utf8",
  );
  assert.match(cardSource, /isVeryShort = height < 30/);
  assert.match(cardSource, /height >= 30/);
  assert.match(cardSource, /height >= 46/);
  assert.match(cardSource, /height >= 60/);
  assert.match(cardSource, /height >= 75/);
});
