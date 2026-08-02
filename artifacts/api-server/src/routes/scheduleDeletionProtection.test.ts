import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const routeSource = read("artifacts/api-server/src/routes/schedules.ts");
const adminSource = read("artifacts/admin/src/pages/schedules.tsx");

const deleteRoute = routeSource.match(/router\.delete\("\/schedules\/:id"[\s\S]*?\n\}\);/)?.[0] ?? "";

test("DELETE Schedule blocks active/historical schedules with 409", () => {
  assert.match(deleteRoute, /res\.status\(409\)\.json/);
  assert.match(deleteRoute, /SCHEDULE_DELETE_NOT_ALLOWED/);
  assert.match(deleteRoute, /Schedules with existing bookings, attendance, or credit records cannot be permanently deleted/);
  assert.match(deleteRoute, /db\.delete\(schedulesTable\)/);
});

test("Regular Schedule Admin exposes controlled schedule deletion", () => {
  assert.match(adminSource, /useDeleteSchedule/);
  assert.match(adminSource, /handleDeleteSchedule/);
  assert.match(adminSource, /button-delete-schedule/);
});

test("Schedule cancellation remains an update with notification and activity logging", () => {
  assert.match(routeSource, /existing\.status !== "cancelled" && updated\.status === "cancelled"/);
  assert.match(routeSource, /notifyScheduleBookings\([\s\S]*?"Class cancelled"/);
  assert.match(routeSource, /row\.status === "cancelled"[\s\S]*?"cancel"/);
});

test("Schedule update and Branch/Room immutability protection remain active", () => {
  assert.match(routeSource, /router\.patch\("\/schedules\/:id"/);
  assert.match(routeSource, /validateScheduleLocationChangeAllowed\(\s*tx,\s*"regular",\s*existing\.id/);
  assert.match(routeSource, /tx\.update\(schedulesTable\)/);
});
