import assert from "node:assert/strict";
import test from "node:test";
import {
  countActiveBalletWeeklySchedules,
  groupBalletSchedulesByGroupId,
  normalizeBalletClasses,
  selectOperationalBalletClasses,
} from "./balletClassScheduleModel";

const schedule = (id: number | null, dayOfWeek: number, startTime: string, endTime: string, overrides: Record<string, unknown> = {}) => ({
  id,
  dayOfWeek,
  startTime,
  endTime,
  durationMins: 60,
  status: "active",
  ...overrides,
});

const balletClass = (id: number, schedules: unknown[], overrides: Record<string, unknown> = {}) => ({
  id,
  title: `Class ${id}`,
  classImageUrl: null,
  classVideoUrl: null,
  instructor: { id: id + 100, name: `Instructor ${id}`, photoUrl: null, isActive: true },
  groupId: id + 10,
  levelId: id + 20,
  isActive: true,
  isLegacy: false,
  schedules,
  schedule: schedules[0] ?? null,
  ...overrides,
});

test("one Schedule array entry remains one", () => {
  assert.equal(normalizeBalletClasses([balletClass(1, [schedule(1, 1, "16:00", "17:00")])]).at(0)?.schedules.length, 1);
});

test("resolved Branch and Room survive Ballet schedule normalization", () => {
  const resolved = schedule(1, 1, "16:00", "17:00", {
    branch: { id: 2, name: "Downtown", code: "BR-002" },
    room: { id: 7, branchId: 2, name: "Studio A", code: "RM-007" },
  });
  const normalized = normalizeBalletClasses([balletClass(1, [resolved])]).at(0)?.schedules.at(0);
  assert.equal(normalized?.branch?.name, "Downtown");
  assert.equal(normalized?.room?.name, "Studio A");
});

test("three Schedule array entries are preserved and sorted", () => {
  const [item] = normalizeBalletClasses([balletClass(1, [
    schedule(3, 4, "16:00", "17:00"),
    schedule(1, 0, "17:00", "18:00"),
    schedule(2, 0, "16:00", "17:00"),
  ])]);
  assert.deepEqual(item.schedules.map((value) => value.id), [2, 1, 3]);
});

test("duplicate Schedule IDs are deduplicated", () => {
  const [item] = normalizeBalletClasses([balletClass(1, [
    schedule(7, 1, "16:00", "17:00"),
    schedule(7, 1, "16:00", "17:00"),
  ])]);
  assert.equal(item.schedules.length, 1);
});

test("missing Schedule IDs use the Class/day/time composite fallback", () => {
  const [item] = normalizeBalletClasses([balletClass(1, [
    schedule(null, 1, "16:00", "17:00"),
    schedule(null, 1, "16:00", "17:00"),
  ])]);
  assert.equal(item.schedules.length, 1);
});

test("singular compatibility fallback is used only when schedules is absent", () => {
  const raw = balletClass(1, []) as Record<string, unknown>;
  delete raw.schedules;
  raw.schedule = schedule(8, 2, "16:00", "17:00");
  assert.deepEqual(normalizeBalletClasses([raw]).at(0)?.schedules.map((value) => value.id), [8]);
});

test("an array, including an empty array, takes precedence over the singular alias", () => {
  const raw = balletClass(1, [], { schedule: schedule(8, 2, "16:00", "17:00") });
  assert.deepEqual(normalizeBalletClasses([raw]).at(0)?.schedules, []);
});

test("cancelled, deactivated, and invalid-time Schedules are excluded", () => {
  const [item] = normalizeBalletClasses([balletClass(1, [
    schedule(1, 1, "16:00", "17:00", { status: "cancelled" }),
    schedule(2, 1, "17:00", "18:00", { status: "deactivated" }),
    schedule(3, 1, "18:00", "17:00"),
    schedule(4, 9, "18:00", "19:00"),
    schedule(5, 1, "18:00", "19:00", { durationMins: 0 }),
    schedule(6, 1, "18:00", "19:00"),
  ])]);
  assert.deepEqual(item.schedules.map((value) => value.id), [6]);
});

test("one Class contributes one, two, or three weekly sessions", () => {
  for (const total of [1, 2, 3]) {
    const schedules = Array.from({ length: total }, (_, index) => schedule(index + 1, index, "16:00", "17:00"));
    assert.equal(countActiveBalletWeeklySchedules(normalizeBalletClasses([balletClass(1, schedules)])), total);
  }
});

test("two Classes contribute the sum of their active Schedules", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, [schedule(1, 0, "16:00", "17:00"), schedule(2, 1, "16:00", "17:00")]),
    balletClass(2, [schedule(3, 2, "16:00", "17:00"), schedule(4, 3, "16:00", "17:00"), schedule(5, 4, "16:00", "17:00")]),
  ]);
  assert.equal(countActiveBalletWeeklySchedules(classes), 5);
});

test("zero/cancelled-only schedules contribute zero and are absent from operational cards", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, []),
    balletClass(2, [schedule(2, 1, "16:00", "17:00", { status: "cancelled" })]),
  ]);
  assert.equal(countActiveBalletWeeklySchedules(classes), 0);
  assert.deepEqual(selectOperationalBalletClasses(classes), []);
});

test("one active plus one cancelled Schedule contributes one", () => {
  const classes = normalizeBalletClasses([balletClass(1, [
    schedule(1, 1, "16:00", "17:00"),
    schedule(2, 2, "16:00", "17:00", { status: "cancelled" }),
  ])]);
  assert.equal(countActiveBalletWeeklySchedules(classes), 1);
});

test("Legacy, inactive, or invalid-relation Classes do not normalize", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, [schedule(1, 1, "16:00", "17:00")], { isLegacy: true }),
    balletClass(2, [schedule(2, 1, "16:00", "17:00")], { isActive: false }),
    balletClass(3, [schedule(3, 1, "16:00", "17:00")], { instructor: null }),
    balletClass(4, [schedule(4, 1, "16:00", "17:00")], { level: { id: 24, isActive: false } }),
    balletClass(5, [schedule(5, 1, "16:00", "17:00")], { group: { id: 15, levelId: 999, isActive: true } }),
  ]);
  assert.deepEqual(classes, []);
});

test("duplicate Class rows merge schedules into one card without inflating duplicates", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, [schedule(1, 1, "16:00", "17:00")]),
    balletClass(1, [schedule(1, 1, "16:00", "17:00"), schedule(2, 3, "18:00", "19:00")]),
  ]);
  assert.equal(classes.length, 1);
  assert.deepEqual(classes[0].schedules.map((value) => value.id), [1, 2]);
  assert.equal(countActiveBalletWeeklySchedules(classes), 2);
});

test("group and level entitlement filters are applied before card selection and counting", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, [schedule(1, 1, "16:00", "17:00")], { groupId: 10, levelId: 20 }),
    balletClass(2, [schedule(2, 2, "16:00", "17:00"), schedule(3, 3, "16:00", "17:00")], { groupId: 11, levelId: 21 }),
  ]);
  const childA = selectOperationalBalletClasses(classes, { groupId: 10, levelId: 20 });
  const childB = selectOperationalBalletClasses(classes, { groupId: 11, levelId: 21 });
  assert.equal(countActiveBalletWeeklySchedules(childA), 1);
  assert.equal(countActiveBalletWeeklySchedules(childB), 2);
});

test("Application Status grouping deduplicates and isolates schedules by Group", () => {
  const classes = normalizeBalletClasses([
    balletClass(1, [schedule(1, 1, "16:00", "17:00")], { groupId: 10 }),
    balletClass(2, [schedule(2, 2, "16:00", "17:00")], { groupId: 11 }),
  ]);
  const grouped = groupBalletSchedulesByGroupId(classes);
  assert.deepEqual(grouped.get(10)?.map((value) => value.id), [1]);
  assert.deepEqual(grouped.get(11)?.map((value) => value.id), [2]);
});

test("refreshed Schedule responses update counts without treating time edits as new sessions", () => {
  const initial = normalizeBalletClasses([balletClass(1, [schedule(1, 1, "16:00", "17:00")])]);
  const added = normalizeBalletClasses([balletClass(1, [
    schedule(1, 1, "16:00", "17:00"),
    schedule(2, 3, "18:00", "19:00"),
    schedule(3, 5, "15:00", "16:00"),
  ])]);
  const edited = normalizeBalletClasses([balletClass(1, [
    schedule(1, 1, "16:30", "17:30"),
    schedule(2, 3, "18:00", "19:00"),
    schedule(3, 5, "15:00", "16:00"),
  ])]);
  const cancelled = normalizeBalletClasses([balletClass(1, [
    schedule(1, 1, "16:30", "17:30"),
    schedule(2, 3, "18:00", "19:00", { status: "cancelled" }),
    schedule(3, 5, "15:00", "16:00"),
  ])]);

  assert.equal(countActiveBalletWeeklySchedules(initial), 1);
  assert.equal(countActiveBalletWeeklySchedules(added), 3);
  assert.equal(countActiveBalletWeeklySchedules(edited), 3);
  assert.equal(countActiveBalletWeeklySchedules(cancelled), 2);
});
