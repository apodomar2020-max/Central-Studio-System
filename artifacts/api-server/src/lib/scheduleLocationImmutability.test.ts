import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

process.env["DATABASE_URL"] ??= "postgres://localhost:1/central_studio_test";

const loadGuard = () => import("./scheduleLocation");

test("unchanged Branch and Room bypass the historical activity lookup", async () => {
  const { assertScheduleLocationChangeAllowed } = await loadGuard();
  let lookedUp = false;
  await assertScheduleLocationChangeAllowed(
    { branchId: 1, roomId: 2 },
    { branchId: 1, roomId: 2 },
    async () => { lookedUp = true; return true; },
  );
  assert.equal(lookedUp, false);
});

test("Branch and Room may change before schedule activity exists", async () => {
  const { assertScheduleLocationChangeAllowed } = await loadGuard();
  await assert.doesNotReject(assertScheduleLocationChangeAllowed(
    { branchId: 1, roomId: 2 },
    { branchId: 3, roomId: 4 },
    async () => false,
  ));
});

for (const [name, requested] of [
  ["Branch", { branchId: 3, roomId: 2 }],
  ["Room", { branchId: 1, roomId: 4 }],
] as const) {
  test(`${name} changes are rejected after schedule activity exists`, async () => {
    const { assertScheduleLocationChangeAllowed, IMMUTABLE_SCHEDULE_LOCATION_MESSAGE, ScheduleLocationError } = await loadGuard();
    await assert.rejects(
      assertScheduleLocationChangeAllowed(
        { branchId: 1, roomId: 2 },
        requested,
        async () => true,
      ),
      (error: unknown) => error instanceof ScheduleLocationError
        && error.status === 422
        && error.code === "SCHEDULE_LOCATION_IMMUTABLE"
        && error.message === IMMUTABLE_SCHEDULE_LOCATION_MESSAGE,
    );
  });
}

test("historical NULL assignments remain unchanged without being blocked", async () => {
  const { assertScheduleLocationChangeAllowed } = await loadGuard();
  await assert.doesNotReject(assertScheduleLocationChangeAllowed(
    { branchId: null, roomId: null },
    { branchId: null, roomId: null },
    async () => true,
  ));
});

test("legacy schedules with null branch can receive initial branch assignment even with historical activity", async () => {
  const { assertScheduleLocationChangeAllowed } = await loadGuard();
  await assert.doesNotReject(assertScheduleLocationChangeAllowed(
    { branchId: null, roomId: null },
    { branchId: 1, roomId: 2 },
    async () => true,
  ));
});

test("Regular and Ballet PATCH routes invoke the shared guard for their own domain", () => {
  const regularSource = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/schedules.ts"), "utf8");
  const balletSource = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/routes/adminBalletSchedules.ts"), "utf8");

  assert.match(regularSource, /validateScheduleLocationChangeAllowed\(\s*tx,\s*"regular",\s*existing\.id/);
  assert.match(balletSource, /validateScheduleLocationChangeAllowed\(\s*tx,\s*"ballet",\s*existing\.id/);
});

test("historical activity covers direct records and Ballet assessment applications", () => {
  const source = readFileSync(resolve(process.cwd(), "artifacts/api-server/src/lib/scheduleLocation.ts"), "utf8");

  assert.match(source, /bookingsTable\.scheduleId/);
  assert.match(source, /bookingsTable\.balletScheduleId/);
  assert.match(source, /attendanceTable\.scheduleId/);
  assert.match(source, /attendanceTable\.balletScheduleId/);
  assert.match(source, /balletApplicationsTable\.assessmentScheduleId/);
  assert.doesNotMatch(source, /bookingStatus/);
  assert.doesNotMatch(source, /attendanceTable\.status/);
});
