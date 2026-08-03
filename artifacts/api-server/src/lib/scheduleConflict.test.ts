/**
 * Pure unit tests for the schedule conflict detection engine. No DB, no
 * network — every scenario is plain in-memory ScheduleOccupancy data.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertNoScheduleConflict,
  findScheduleConflict,
  ScheduleConflictError,
  type ScheduleOccupancy,
} from "./scheduleConflict.ts";

// 2026-08-03 is a Monday (dayOfWeek 1) — same reference date used elsewhere
// in this codebase's occurrence-logic tests.
const MONDAY = "2026-08-03";

function occupancy(overrides: Partial<ScheduleOccupancy>): ScheduleOccupancy {
  return {
    id: 1,
    source: "class",
    branchId: 1,
    roomId: 1,
    status: "active",
    startTime: "10:00",
    endTime: "11:00",
    classTitle: "Test Class",
    recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: null, effectiveUntil: null },
    ...overrides,
  };
}

// ─── PASS: no conflict ──────────────────────────────────────────────────────

test("PASS: different rooms, same time -> no conflict", () => {
  const candidate = occupancy({ id: null, roomId: 1 });
  const existing = occupancy({ id: 2, roomId: 2 });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: same room, different (non-overlapping) times -> no conflict", () => {
  const candidate = occupancy({ id: null, startTime: "10:00", endTime: "11:00" });
  const existing = occupancy({ id: 2, startTime: "11:00", endTime: "12:00" });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: cancelled schedule does not block", () => {
  const candidate = occupancy({ id: null });
  const existing = occupancy({ id: 2, status: "cancelled" });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: weekly schedules on different days -> no conflict", () => {
  const candidate = occupancy({ id: null, recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: null, effectiveUntil: null } });
  const existing = occupancy({ id: 2, recurrence: { type: "weekly", dayOfWeek: 2, effectiveFrom: null, effectiveUntil: null } });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: missing branch/room assignment -> no conflict, even at the same time", () => {
  const candidate = occupancy({ id: null, branchId: null, roomId: null });
  const existing = occupancy({ id: 2, branchId: null, roomId: null });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: expired/completed/deactivated statuses do not block", () => {
  const candidate = occupancy({ id: null });
  for (const status of ["expired", "completed", "deactivated"]) {
    const existing = occupancy({ id: 2, status });
    assert.equal(findScheduleConflict(candidate, [existing]), null, `status "${status}" should not block`);
  }
});

test("PASS: weekly effective date ranges do not overlap -> no conflict", () => {
  const candidate = occupancy({ id: null, recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: "2026-01-01", effectiveUntil: "2026-06-30" } });
  const existing = occupancy({ id: 2, recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: "2026-07-01", effectiveUntil: null } });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

test("PASS: a schedule does not conflict with its own prior state (self-exclusion by id+source)", () => {
  const existing = occupancy({ id: 5, source: "class" });
  const candidate = occupancy({ id: 5, source: "class" });
  assert.equal(findScheduleConflict(candidate, [existing]), null);
});

// ─── FAIL: conflict detected ────────────────────────────────────────────────

test("FAIL: same room, same day, overlapping weekly schedules -> conflict", () => {
  const candidate = occupancy({ id: null, startTime: "10:00", endTime: "11:00" });
  const existing = occupancy({ id: 2, startTime: "10:30", endTime: "11:30" });
  const conflict = findScheduleConflict(candidate, [existing]);
  assert.ok(conflict);
  assert.equal(conflict.id, 2);
});

test("FAIL: same room, same date, overlapping one-time schedules -> conflict", () => {
  const candidate = occupancy({ id: null, startTime: "14:00", endTime: "15:00", recurrence: { type: "one_time", date: MONDAY } });
  const existing = occupancy({ id: 3, startTime: "14:30", endTime: "15:30", recurrence: { type: "one_time", date: MONDAY } });
  const conflict = findScheduleConflict(candidate, [existing]);
  assert.ok(conflict);
  assert.equal(conflict.id, 3);
});

test("FAIL: weekly vs one-time conflict — date matches the weekly's day and overlaps in time", () => {
  const weeklyExisting = occupancy({ id: 4, startTime: "09:00", endTime: "10:00", recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: null, effectiveUntil: null } });
  const oneTimeCandidate = occupancy({ id: null, startTime: "09:30", endTime: "10:30", recurrence: { type: "one_time", date: MONDAY } });
  const conflict = findScheduleConflict(oneTimeCandidate, [weeklyExisting]);
  assert.ok(conflict);
  assert.equal(conflict.id, 4);
});

test("FAIL: weekly vs one-time — no conflict when the one-time date is outside the weekly's effective window", () => {
  const weeklyExisting = occupancy({ id: 4, recurrence: { type: "weekly", dayOfWeek: 1, effectiveFrom: "2027-01-01", effectiveUntil: null } });
  const oneTimeCandidate = occupancy({ id: null, recurrence: { type: "one_time", date: MONDAY } });
  assert.equal(findScheduleConflict(oneTimeCandidate, [weeklyExisting]), null);
});

test("FAIL: regular ('class') schedule vs Ballet schedule, same room, overlapping -> conflict", () => {
  const balletExisting = occupancy({ id: 6, source: "ballet", classTitle: "Beginner Ballet" });
  const regularCandidate = occupancy({ id: null, source: "class" });
  const conflict = findScheduleConflict(regularCandidate, [balletExisting]);
  assert.ok(conflict);
  assert.equal(conflict.source, "ballet");
  assert.equal(conflict.id, 6);
});

// ─── assertNoScheduleConflict: throwing wrapper + UI-ready error shape ─────

test("assertNoScheduleConflict throws a structured ScheduleConflictError carrying conflict details", () => {
  const existing = occupancy({ id: 7, classTitle: "Hip Hop" });
  const candidate = occupancy({ id: null });
  assert.throws(
    () => assertNoScheduleConflict(candidate, [existing]),
    (err: unknown) => {
      assert.ok(err instanceof ScheduleConflictError);
      assert.equal(err.status, 409);
      assert.equal(err.code, "SCHEDULE_TIME_CONFLICT");
      assert.equal(err.conflict.scheduleId, 7);
      assert.equal(err.conflict.source, "class");
      assert.equal(err.conflict.classTitle, "Hip Hop");
      return true;
    },
  );
});

test("assertNoScheduleConflict does not throw when there is no conflict", () => {
  const candidate = occupancy({ id: null, recurrence: { type: "weekly", dayOfWeek: 5, effectiveFrom: null, effectiveUntil: null } });
  assert.doesNotThrow(() => assertNoScheduleConflict(candidate, []));
});
