import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");

const routeSource = read("artifacts/api-server/src/routes/schedules.ts");
const adminSource = read("artifacts/admin/src/pages/schedules.tsx");
const openApiSource = read("lib/api-spec/openapi.yaml");

const deleteRoute = routeSource.match(/router\.delete\("\/schedules\/:id"[\s\S]*?\n\}\);/)?.[0] ?? "";

test("DELETE Schedule is blocked without touching schedule state", () => {
  assert.match(deleteRoute, /res\.status\(409\)\.json/);
  assert.match(deleteRoute, /SCHEDULE_DELETE_NOT_ALLOWED/);
  assert.match(deleteRoute, /Schedules cannot be deleted\. Cancel the schedule instead\./);
  assert.doesNotMatch(deleteRoute, /db\.transaction|tx\.delete\(|notifyScheduleBookings|logActivity/);
});

test("Regular Schedule Admin exposes no hard-delete action", () => {
  assert.doesNotMatch(adminSource, /useDeleteSchedule|handleDelete|button-delete-schedule|Delete this schedule|Trash2/);
});

test("Schedule cancellation remains an update with notification and activity logging", () => {
  assert.match(routeSource, /existing\.status !== "cancelled" && updated\.status === "cancelled"/);
  assert.match(routeSource, /notifyScheduleBookings\([\s\S]*?"Class cancelled"/);
  assert.match(routeSource, /row\.status === "cancelled"[\s\S]*?"cancel"/);
});

test("Schedule update and Branch\/Room immutability protection remain active", () => {
  assert.match(routeSource, /router\.patch\("\/schedules\/:id"/);
  assert.match(routeSource, /validateScheduleLocationChangeAllowed\(\s*tx,\s*"regular",\s*existing\.id/);
  assert.match(routeSource, /tx\.update\(schedulesTable\)/);
});

test("OpenAPI documents the blocked DELETE response", () => {
  const deleteContract = openApiSource.match(/    delete:\n      operationId: deleteSchedule[\s\S]*?(?=\n  \/admin\/ballet\/schedules:)/)?.[0] ?? "";
  assert.match(deleteContract, /"409":/);
  assert.match(deleteContract, /Schedule deletion is not allowed/);
  assert.doesNotMatch(deleteContract, /"204":|description: Deleted/);
});
