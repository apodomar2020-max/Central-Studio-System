import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8");
const attendance = read("artifacts/api-server/src/lib/balletAttendance.ts");
const parentRoute = read("artifacts/api-server/src/routes/ballet.ts");

test("parent applications use the currently active paid subscription-cycle summary", () => {
  assert.match(parentRoute, /computeBalletCurrentSubscriptionAttendanceSummary/);
  assert.match(parentRoute, /summary = await computeBalletCurrentSubscriptionAttendanceSummary\(assignmentIdByApplicationId\.get\(a\.id\)!?, a\.id\)/);
});

test("current-plan usage is bounded by the paid plan start and expiration dates", () => {
  assert.match(attendance, /findPaidCycleActiveOn\([\s\S]*getPaymentCyclesForApplication\(applicationId\)[\s\S]*todayDateOnly\(\)/);
  assert.doesNotMatch(attendance.slice(attendance.indexOf("export async function computeBalletCurrentSubscriptionAttendanceSummary")), /getCurrentSubscriptionForApplication\(applicationId\)/);
  assert.match(attendance, /gte\(attendanceTable\.classDate, startDate\)/);
  assert.match(attendance, /lte\(attendanceTable\.classDate, endDate\)/);
  assert.match(attendance, /paid\.subscriptionStartDate,[\s\S]*paid\.subscriptionExpiresAt/);
});

test("a renewal derives its entitlement and remaining hours from the selected paid package", () => {
  assert.match(attendance, /where\(eq\(balletPackagesTable\.id, paid\.packageId\)\)/);
  assert.match(attendance, /remainingHours: Math\.max\(packageRow\.monthlyHours - hours\.consumedHours, 0\)/);
  assert.match(attendance, /subscriptionExpiresAt: paid\.subscriptionExpiresAt/);
});
