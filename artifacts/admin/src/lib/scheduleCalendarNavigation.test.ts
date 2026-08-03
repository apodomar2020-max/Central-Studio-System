/**
 * Pure unit tests for Calendar Phase 3's navigation-target builders, used by
 * pages/calendar.tsx. Kept dependency-free (lib/scheduleCalendarNavigation.ts
 * has no React/path-alias imports) specifically so this file can import and
 * exercise the real functions directly with plain node:test — importing
 * pages/calendar.tsx itself would pull in Vite's `@/` alias resolution and
 * JSX, which the existing frontend test convention in this app avoids
 * entirely (see pages/scheduleDeletionProtection.test.ts / pages/branches.test.ts,
 * both source-inspection style for exactly this reason).
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildBalletScheduleListPath,
  buildScheduleCreatePath,
  buildScheduleEditPath,
  pixelOffsetToTimeString,
} from "./scheduleCalendarNavigation.ts";

test("buildScheduleEditPath preserves the schedule id and targets the existing Schedules page", () => {
  assert.equal(buildScheduleEditPath(123), "/schedules?editScheduleId=123");
  assert.equal(buildScheduleEditPath(1), "/schedules?editScheduleId=1");
});

test("buildScheduleCreatePath preserves every selected context field", () => {
  const url = buildScheduleCreatePath({ date: "2026-08-10", startTime: "17:00", branchId: 1, roomId: 2 });
  const [path, query] = url.split("?");
  assert.equal(path, "/schedules");
  const params = new URLSearchParams(query);
  assert.equal(params.get("date"), "2026-08-10");
  assert.equal(params.get("startTime"), "17:00");
  assert.equal(params.get("branchId"), "1");
  assert.equal(params.get("roomId"), "2");
});

test("buildScheduleCreatePath omits fields that were not selected", () => {
  assert.equal(buildScheduleCreatePath({}), "/schedules");
  assert.equal(buildScheduleCreatePath({ date: null, startTime: null, branchId: null, roomId: null }), "/schedules");
  assert.equal(buildScheduleCreatePath({ branchId: 5 }), "/schedules?branchId=5");
  assert.equal(buildScheduleCreatePath({ date: "2026-08-10" }), "/schedules?date=2026-08-10");
});

test("buildScheduleCreatePath never includes an editScheduleId — create and edit are distinct URLs", () => {
  const url = buildScheduleCreatePath({ date: "2026-08-10", branchId: 1, roomId: 2 });
  assert.ok(!url.includes("editScheduleId"));
});

test("buildBalletScheduleListPath targets the separate Ballet schedules page with no query params", () => {
  assert.equal(buildBalletScheduleListPath(), "/ballet/schedules");
});

test("pixelOffsetToTimeString rounds to the nearest 30-minute mark", () => {
  const gridStart = 12 * 60;
  const gridEnd = 24 * 60;
  assert.equal(pixelOffsetToTimeString(0, gridStart, gridEnd), "12:00");
  assert.equal(pixelOffsetToTimeString(10, gridStart, gridEnd), "12:00");
  assert.equal(pixelOffsetToTimeString(20, gridStart, gridEnd), "12:30");
  assert.equal(pixelOffsetToTimeString(40, gridStart, gridEnd), "12:30");
  // 45 is exactly halfway between 12:30 and 13:00 — Math.round rounds half up.
  assert.equal(pixelOffsetToTimeString(45, gridStart, gridEnd), "13:00");
  assert.equal(pixelOffsetToTimeString(50, gridStart, gridEnd), "13:00");
});

test("pixelOffsetToTimeString clamps to the visible grid window", () => {
  const gridStart = 12 * 60;
  const gridEnd = 24 * 60;
  assert.equal(pixelOffsetToTimeString(-100, gridStart, gridEnd), "12:00");
  assert.equal(pixelOffsetToTimeString(10_000, gridStart, gridEnd), "00:00");
});
