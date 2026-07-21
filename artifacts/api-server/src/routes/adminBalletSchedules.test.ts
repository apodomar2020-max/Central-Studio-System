import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

test("canonical class payload requires one level, group, instructor, day and time range", async () => {
  const { ClassScheduleBody } = await import("./adminBalletClasses");
  const valid = ClassScheduleBody.safeParse({
    title: "Ballet Level 1 Monday",
    levelId: 1,
    groupId: 2,
    instructorId: 3,
    dayOfWeek: 1,
    startTime: "16:00",
    endTime: "17:15",
    isActive: true,
    scheduleStatus: "active",
  });
  assert.equal(valid.success, true);

  for (const key of ["levelId", "groupId", "instructorId", "dayOfWeek", "startTime", "endTime"] as const) {
    const body: Record<string, unknown> = { ...valid.data };
    delete body[key];
    assert.equal(ClassScheduleBody.safeParse(body).success, false, `${key} must be required`);
  }
});

test("legacy relationship arrays and client duration are rejected", async () => {
  const { ClassScheduleBody } = await import("./adminBalletClasses");
  const base = { title: "Class", levelId: 1, groupId: 2, instructorId: 3, dayOfWeek: 1, startTime: "16:00", endTime: "17:00" };
  assert.equal(ClassScheduleBody.safeParse({ ...base, levelIds: [1] }).success, false);
  assert.equal(ClassScheduleBody.safeParse({ ...base, groupIds: [2] }).success, false);
  assert.equal(ClassScheduleBody.safeParse({ ...base, scheduleIds: [4] }).success, false);
  assert.equal(ClassScheduleBody.safeParse({ ...base, durationMins: 60 }).success, false);
});

test("duration is derived from the time range", async () => {
  const { deriveBalletClassDuration } = await import("./adminBalletClasses");
  assert.equal(deriveBalletClassDuration("16:00", "17:15"), 75);
  assert.throws(() => deriveBalletClassDuration("17:00", "17:00"), /END_TIME/);
  assert.throws(() => deriveBalletClassDuration("18:00", "17:00"), /END_TIME/);
});

test("standalone schedule creation is disabled and edit cannot change class or duration", () => {
  const source = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/adminBalletSchedules.ts"), "utf8");
  assert.match(source, /CREATE_CLASS_REQUIRED/);
  assert.match(source, /status\(405\)/);
  assert.doesNotMatch(source, /classId:\s*z\.number/);
  assert.doesNotMatch(source, /durationMins:\s*z\./);
});
