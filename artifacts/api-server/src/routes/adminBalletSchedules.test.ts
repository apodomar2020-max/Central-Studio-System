import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

const classRouteSource = () => readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/adminBalletClasses.ts"), "utf8");
const scheduleRouteSource = () => readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/adminBalletSchedules.ts"), "utf8");

test("canonical class payload requires relationships but rejects timing fields", async () => {
  const { BalletClassBody } = await import("./adminBalletClasses");
  const valid = BalletClassBody.safeParse({
    title: "Ballet Level 1",
    levelId: 1,
    groupId: 2,
    instructorId: 3,
    isActive: true,
  });
  assert.equal(valid.success, true);

  for (const key of ["levelId", "groupId", "instructorId"] as const) {
    const body: Record<string, unknown> = { ...valid.data };
    delete body[key];
    assert.equal(BalletClassBody.safeParse(body).success, false, `${key} must be required`);
  }

  for (const key of ["dayOfWeek", "startTime", "endTime", "durationMins", "scheduleStatus"] as const) {
    assert.equal(BalletClassBody.safeParse({ ...valid.data, [key]: key === "dayOfWeek" ? 1 : "16:00" }).success, false, `${key} must be rejected`);
  }
});

test("legacy relationship arrays are rejected from class creation", async () => {
  const { BalletClassBody } = await import("./adminBalletClasses");
  const base = { title: "Class", levelId: 1, groupId: 2, instructorId: 3 };
  assert.equal(BalletClassBody.safeParse({ ...base, levelIds: [1] }).success, false);
  assert.equal(BalletClassBody.safeParse({ ...base, groupIds: [2] }).success, false);
  assert.equal(BalletClassBody.safeParse({ ...base, scheduleIds: [4] }).success, false);
});

test("duration is derived from the schedule time range", async () => {
  const { deriveBalletScheduleDuration } = await import("./adminBalletSchedules");
  assert.equal(deriveBalletScheduleDuration("16:00", "17:15"), 75);
  assert.throws(() => deriveBalletScheduleDuration("17:00", "17:00"), /END_TIME/);
  assert.throws(() => deriveBalletScheduleDuration("18:00", "17:00"), /END_TIME/);
});

test("class creation inserts no schedule and class edit never updates schedules", () => {
  const source = classRouteSource();
  assert.match(source, /tx\.insert\(balletClassesTable\)/);
  assert.doesNotMatch(source, /tx\.insert\(balletSchedulesTable\)/);
  assert.doesNotMatch(source, /tx\.update\(balletSchedulesTable\)/);
  assert.match(source, /schedules:\s*\[\]/);
  assert.match(source, /schedule:\s*null/);
});

test("standalone schedule creation is enabled and exact duplicate slots return 409", () => {
  const source = scheduleRouteSource();
  assert.match(source, /classId:\s*z\.number/);
  assert.match(source, /tx\.insert\(balletSchedulesTable\)/);
  assert.match(source, /for update/);
  assert.match(source, /DUPLICATE_BALLET_SCHEDULE_SLOT/);
  assert.match(source, /status\(409\)/);
  assert.doesNotMatch(source, /status\(405\)/);
  assert.doesNotMatch(source, /CREATE_CLASS_REQUIRED/);
});

test("schedule status changes do not alter the owning class or sibling schedules", () => {
  const source = scheduleRouteSource();
  assert.match(source, /\.where\(eq\(balletSchedulesTable\.id, id\)\)/);
  assert.doesNotMatch(source, /tx\.update\(balletClassesTable\)[\s\S]{0,200}isActive/);
  assert.doesNotMatch(source, /\.where\(eq\(balletSchedulesTable\.classId/);
});
