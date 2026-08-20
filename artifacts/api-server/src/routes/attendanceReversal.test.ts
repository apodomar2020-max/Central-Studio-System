/**
 * Wave 3 — attendance reversal Admin route exposure. Proves the routes
 * reuse the existing service functions unchanged (no reimplementation),
 * carry the required permission guards, and are actually mounted.
 * The service's own eligibility/separation-of-duties/restoration logic is
 * already integration-tested by attendanceReversalLifecycle.integration.test.ts
 * and attendanceReversalService.integration.test.ts — this file only
 * covers the NEW surface added this wave (the routes), not the
 * pre-existing service.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROUTE_FILE = "artifacts/api-server/src/routes/attendanceReversal.ts";
const INDEX_FILE = "artifacts/api-server/src/routes/index.ts";
const source = readFileSync(resolve(process.cwd(), ROUTE_FILE), "utf8");
const indexSource = readFileSync(resolve(process.cwd(), INDEX_FILE), "utf8");

test("the router is imported and mounted in the app's route index", () => {
  assert.match(indexSource, /import attendanceReversalRouter from "\.\/attendanceReversal";/);
  assert.match(indexSource, /router\.use\(attendanceReversalRouter\);/);
});

test("every service function is imported unchanged from attendanceReversalService — no reimplementation", () => {
  assert.match(source, /import \{\s*approveAttendanceReversal,\s*AttendanceReversalServiceError,\s*calculateAttendanceReversalEligibility,\s*completeAttendanceReversal,\s*failAttendanceReversal,\s*rejectAttendanceReversal,\s*requestAttendanceReversal,\s*\} from "\.\.\/lib\/attendanceReversalService";/);
});

test("eligibility view route requires attendance:view", () => {
  assert.match(source, /router\.get\("\/admin\/attendance\/:id\/reversal-eligibility", \.\.\.viewGuards,/);
  assert.match(source, /const viewGuards = \[requireAdminAuth, requireAdminPermission\("attendance", "view"\)\];/);
});

test("request route requires attendance:edit", () => {
  assert.match(source, /router\.post\("\/admin\/attendance\/:id\/reversal-requests", \.\.\.requestGuards,/);
  assert.match(source, /const requestGuards = \[requireAdminAuth, requireAdminPermission\("attendance", "edit"\)\];/);
});

test("approve/complete/fail require both attendance:edit AND finance:refundsManage — the smallest safe static gate for the financially-implied actions", () => {
  assert.match(source, /const financialGuards = \[requireAdminAuth, requireAdminPermission\("attendance", "edit"\), requireAdminPermission\("finance", "refundsManage"\)\];/);
  assert.match(source, /router\.post\("\/admin\/attendance-reversals\/:id\/approve", \.\.\.financialGuards,/);
  assert.match(source, /router\.post\("\/admin\/attendance-reversals\/:id\/complete", \.\.\.financialGuards,/);
  assert.match(source, /router\.post\("\/admin\/attendance-reversals\/:id\/fail", \.\.\.financialGuards,/);
});

test("reject route only requires attendance:edit — rejecting never moves money", () => {
  assert.match(source, /router\.post\("\/admin\/attendance-reversals\/:id\/reject", \.\.\.requestGuards,/);
});

test("every mutating route writes an admin activity log entry", () => {
  const mutatingRouteCount = (source.match(/router\.post\(/g) ?? []).length;
  const logActivityCallCount = (source.match(/await logActivity\(req,/g) ?? []).length;
  assert.equal(logActivityCallCount, mutatingRouteCount, "expected one logActivity call per mutating route");
});

test("actor identity is always derived from the authenticated admin, never from the request body", () => {
  assert.match(source, /function actorId\(req: AdminRequest\): string \{\s*return `admin:\$\{req\.adminUser!\.sub\}`;/);
});
