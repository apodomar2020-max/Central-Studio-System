/**
 * Pure unit tests for the calendar occurrence projector. No DB, no network.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  InvalidCalendarRangeError,
  isoDateRange,
  projectOccurrenceDates,
  scheduleOccursOnDate,
} from "./calendarOccurrence.ts";

test("isoDateRange returns an inclusive list of dates", () => {
  assert.deepEqual(isoDateRange("2026-08-03", "2026-08-05"), [
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
  ]);
});

test("isoDateRange rejects from > to", () => {
  assert.throws(() => isoDateRange("2026-08-05", "2026-08-03"), InvalidCalendarRangeError);
});

test("isoDateRange rejects malformed dates", () => {
  assert.throws(() => isoDateRange("not-a-date", "2026-08-05"), InvalidCalendarRangeError);
});

test("isoDateRange rejects ranges over the configured max span", () => {
  assert.throws(() => isoDateRange("2026-01-01", "2026-12-31"), InvalidCalendarRangeError);
});

test("scheduleOccursOnDate: one_time matches only its own date", () => {
  const schedule = { type: "one_time" as const, date: "2026-08-10" };
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-10"), true);
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-11"), false);
});

test("scheduleOccursOnDate: weekly matches every occurrence of its day-of-week", () => {
  // 2026-08-03 is a Monday (dayOfWeek 1).
  const schedule = { type: "weekly" as const, dayOfWeek: 1 };
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-03"), true);
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-10"), true);
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-04"), false);
});

test("scheduleOccursOnDate: weekly with no dayOfWeek never matches", () => {
  assert.equal(scheduleOccursOnDate({ type: "weekly", dayOfWeek: null }, "2026-08-03"), false);
});

test("scheduleOccursOnDate: respects effectiveFrom/effectiveUntil bounds", () => {
  const schedule = {
    type: "weekly" as const,
    dayOfWeek: 1,
    effectiveFrom: "2026-08-10",
    effectiveUntil: "2026-08-17",
  };
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-03"), false); // before effectiveFrom
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-10"), true);
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-17"), true);
  assert.equal(scheduleOccursOnDate(schedule, "2026-08-24"), false); // after effectiveUntil
});

test("projectOccurrenceDates: weekly schedule across a two-week range", () => {
  const schedule = { type: "weekly" as const, dayOfWeek: 1 }; // Mondays
  assert.deepEqual(
    projectOccurrenceDates(schedule, "2026-08-01", "2026-08-14"),
    ["2026-08-03", "2026-08-10"],
  );
});

test("projectOccurrenceDates: one_time schedule inside range yields one date", () => {
  const schedule = { type: "one_time" as const, date: "2026-08-06" };
  assert.deepEqual(projectOccurrenceDates(schedule, "2026-08-01", "2026-08-14"), ["2026-08-06"]);
});

test("projectOccurrenceDates: one_time schedule outside range yields nothing", () => {
  const schedule = { type: "one_time" as const, date: "2026-09-01" };
  assert.deepEqual(projectOccurrenceDates(schedule, "2026-08-01", "2026-08-14"), []);
});
