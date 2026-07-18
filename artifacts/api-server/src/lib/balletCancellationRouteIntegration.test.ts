/**
 * Real route + database integration tests for Ballet cancellation initiation.
 *
 * Unlike the source/regex-assertion tests elsewhere in this file group, this
 * suite boots the ACTUAL Express router (routes/balletCancellationRefunds.ts)
 * behind the ACTUAL auth middlewares (requireAuth, requireAdminAuth,
 * requireAdminPermission — all unmodified imports from the real source),
 * issues real HTTP requests against it, and asserts on real row state in a
 * disposable local Postgres database.
 *
 * Safety gate: refuses to run unless DATABASE_URL points at 127.0.0.1/localhost
 * and a database name containing disposable/local/test — the same rule as
 * lib/db/tools/verification/run-disposable-migrations.mjs. This database must
 * already be migrated through 0068 before running this file (see the
 * companion migration-verification report — not done here to avoid coupling
 * this suite's runtime to a migration run).
 *
 * No Redis, no push notifications: REDIS_URL/PUSH_NOTIFICATIONS_ENABLED are
 * deliberately left unset, so enqueueJob()/sendPushNotification() take their
 * existing no-op fallback paths (see lib/queue.ts's queueRedisUrl() and
 * lib/pushNotifications.ts's pushEnabled()) — no network calls, no worker
 * infra required for this route/DB-level test.
 */
import assert from "node:assert/strict";
import { test, before, after } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ROUTES_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5602/central_studio_disposable_routes";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not localhost/127.0.0.1`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" does not look disposable/local/test`);
  }
  if (/rlwy\.net|railway/i.test(databaseUrl)) {
    throw new Error("Refusing: DATABASE_URL looks like Railway");
  }
}
assertDisposableUrl(DATABASE_URL);

// Set BEFORE any dynamic import of app modules below (they read these at
// module-load time). STUDENT_JWT_SECRET / ADMIN_JWT_SECRET are intentionally
// left unset — both middlewares fall back to documented dev defaults, which
// this file signs test tokens with (see studentToken()/adminToken() below).
process.env.DATABASE_URL = DATABASE_URL;
process.env.API_SECRET_KEY = "test-api-secret-key";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const STUDENT_JWT_SECRET = "dev-student-secret-change-in-production";
const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

// ─── Suite-wide fixtures (built once in before()) ───────────────────────────────

let app: import("express").Express;
let server: import("node:http").Server;
let pool: import("pg").Pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

let parentId: number;
let superAdminId: number;
let authorizedAdminId: number;
let unauthorizedAdminId: number;
let levelId: number;

function apiUrl(p: string): string {
  return `http://127.0.0.1:${port}${p}`;
}

function studentToken(studentId: number, email: string): string {
  return jwtSign({ sub: studentId, email, type: "student", emailVerified: true }, STUDENT_JWT_SECRET);
}

function adminToken(adminId: number, username: string): string {
  return jwtSign({ sub: adminId, username, isSuperAdmin: false, roleId: null }, ADMIN_JWT_SECRET);
}

async function asParent(studentId: number, email: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${studentToken(studentId, email)}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function asAdmin(adminId: number, username: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(adminId, username),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

/** Insert a fresh application + return its id. `overrides` merges onto sane defaults. */
async function insertApplication(overrides: Partial<{
  status: string;
  parentStudentId: number;
  childName: string;
}> = {}): Promise<number> {
  const status = overrides.status ?? "pending";
  const parentStudentIdValue = overrides.parentStudentId ?? parentId;
  const childName = overrides.childName ?? `Test Child ${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO ballet_applications (parent_student_id, parent_name, parent_phone, parent_email, child_name, status)
     VALUES ($1, 'Test Parent', '0100000000', 'parent@example.com', $2, $3) RETURNING id`,
    [parentStudentIdValue, childName, status],
  );
  return rows[0].id;
}

async function insertAssignment(applicationId: number, status = "active"): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_level_assignments (application_id, level_id, status) VALUES ($1, $2, $3) RETURNING id`,
    [applicationId, levelId, status],
  );
  return rows[0].id;
}

async function insertAttendance(assignmentId: number): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO attendance (student_id, student_name, student_email, ballet_level_assignment_id, class_date, status, duration_minutes)
     VALUES ($1, 'Test Child', 'parent@example.com', $2, '2026-07-01', 'checked_in', 60) RETURNING id`,
    [parentId, assignmentId],
  );
  return rows[0].id;
}

// Date helpers computed relative to the real "today" (not hardcoded absolute
// dates) so these tests never silently pass/fail depending on which calendar
// day they happen to run on.
function addDays(dateOnly: string, days: number): string {
  const d = new Date(`${dateOnly}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
const TODAY = new Date().toISOString().slice(0, 10);

interface CyclePaymentOptions {
  amountEgp?: number;
  paymentMethod?: string;
  subscriptionStartDate: string;
  subscriptionExpiresAt: string;
}

async function insertSubscriptionCyclePayment(applicationId: number, assignmentId: number | null, opts: CyclePaymentOptions): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_payments (application_id, level_assignment_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
     VALUES ($1, $2, $3, 'paid', $4, now(), $5, $6) RETURNING id`,
    [applicationId, assignmentId, opts.amountEgp ?? 1000, opts.paymentMethod ?? "inPerson", opts.subscriptionStartDate, opts.subscriptionExpiresAt],
  );
  return rows[0].id;
}

/** A payment whose subscription window contains today — the "current cycle". */
async function insertCurrentCyclePayment(applicationId: number, assignmentId: number | null, amountEgp = 1000, paymentMethod = "inPerson"): Promise<number> {
  return insertSubscriptionCyclePayment(applicationId, assignmentId, {
    amountEgp,
    paymentMethod,
    subscriptionStartDate: addDays(TODAY, -10),
    subscriptionExpiresAt: addDays(TODAY, 20),
  });
}

/** A payment whose subscription window ended before today — an expired historical cycle. */
async function insertExpiredCyclePayment(applicationId: number, assignmentId: number | null, amountEgp = 1000): Promise<number> {
  return insertSubscriptionCyclePayment(applicationId, assignmentId, {
    amountEgp,
    subscriptionStartDate: addDays(TODAY, -40),
    subscriptionExpiresAt: addDays(TODAY, -10),
  });
}

/** A payment whose subscription window starts after today — a future renewal. */
async function insertFutureCyclePayment(applicationId: number, assignmentId: number | null, amountEgp = 1000): Promise<number> {
  return insertSubscriptionCyclePayment(applicationId, assignmentId, {
    amountEgp,
    subscriptionStartDate: addDays(TODAY, 20),
    subscriptionExpiresAt: addDays(TODAY, 50),
  });
}

/** A flat, cycle-less payment (e.g. an assessment/registration fee) for pre-activation refund tests. */
async function insertFlatPayment(applicationId: number, amountEgp = 1000): Promise<number> {
  const { rows } = await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method, paid_at)
     VALUES ($1, $2, 'paid', 'inPerson', now()) RETURNING id`,
    [applicationId, amountEgp],
  );
  return rows[0].id;
}

async function insertBalletPackage(priceEgp = 2500): Promise<number> {
  const token = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    `INSERT INTO ballet_packages (name, monthly_classes, monthly_hours, price_egp, is_active)
     VALUES ($1, 8, 12, $2, true) RETURNING id`,
    [`Route Test Package ${token}`, priceEgp],
  );
  return rows[0].id;
}

async function insertBalletGroup(): Promise<number> {
  const token = Math.random().toString(36).slice(2, 8);
  const { rows } = await pool.query(
    `INSERT INTO ballet_groups (name, level_id, is_active) VALUES ($1, $2, true) RETURNING id`,
    [`Route Test Group ${token}`, levelId],
  );
  return rows[0].id;
}

async function makeAssignedGroupedApplication(): Promise<{ appId: number; assignmentId: number; groupId: number }> {
  const appId = await insertApplication({ status: "assignedToLevel" });
  const assignmentId = await insertAssignment(appId, "active");
  const groupId = await insertBalletGroup();
  await pool.query(`UPDATE ballet_applications SET assigned_level_id = $2 WHERE id = $1`, [appId, levelId]);
  await pool.query(`UPDATE ballet_level_assignments SET group_id = $2 WHERE id = $1`, [assignmentId, groupId]);
  return { appId, assignmentId, groupId };
}

async function countRows(table: string, where: string, params: unknown[] = []): Promise<number> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return rows[0].n;
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const cancellationRouter = (await import("../routes/balletCancellationRefunds.ts")).default;
  const paymentsRouter = (await import("../routes/adminBalletPayments.ts")).default;
  const adminBalletRouter = (await import("../routes/adminBallet.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use(requireAuth);
  app.use(cancellationRouter);
  app.use(paymentsRouter);
  app.use(adminBalletRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  // Shared fixtures. Suffixed with a run-unique token so this file can be
  // re-run against the same disposable database any number of times without
  // colliding on students.email / system_users.username|email / roles.name
  // unique constraints from a previous run.
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type) VALUES ('Route Test Parent', $1, '0111111111', 'parent') RETURNING id`,
    [`route-test-parent-${run}@example.com`],
  );
  parentId = student.rows[0].id;

  const level = await pool.query(`SELECT id FROM ballet_levels ORDER BY id LIMIT 1`);
  levelId = level.rows[0].id;

  // Super Admin — reuse the pre-existing seeded super admin if present, else create one.
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id;
  } else {
    const su = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin) VALUES ($1, $2, 'x', 'Route Test Super', true) RETURNING id`,
      [`route-test-super-${run}`, `route-test-super-${run}@example.com`],
    );
    superAdminId = su.rows[0].id;
  }

  // Authorized admin — role WITH ballet.applications:cancel.
  const roleWithCancel = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Route Test Cancel Role ${run}`, JSON.stringify({ "ballet.applications": { view: true, review: true, approve: true, reject: true, cancel: true } })],
  );
  const authorizedAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', 'Route Test Authorized Admin', false, $3) RETURNING id`,
    [`route-test-authorized-${run}`, `route-test-authorized-${run}@example.com`, roleWithCancel.rows[0].id],
  );
  authorizedAdminId = authorizedAdmin.rows[0].id;

  // Unauthorized admin — role WITHOUT the cancel action.
  const roleWithoutCancel = await pool.query(
    `INSERT INTO roles (name, permissions) VALUES ($1, $2::jsonb) RETURNING id`,
    [`Route Test No-Cancel Role ${run}`, JSON.stringify({ "ballet.applications": { view: true } })],
  );
  const unauthorizedAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin, role_id) VALUES ($1, $2, 'x', 'Route Test Unauthorized Admin', false, $3) RETURNING id`,
    [`route-test-unauthorized-${run}`, `route-test-unauthorized-${run}@example.com`, roleWithoutCancel.rows[0].id],
  );
  unauthorizedAdminId = unauthorizedAdmin.rows[0].id;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Parent pre-activation ───────────────────────────────────────────────────────

test("parent: pending application → POST cancel → 200, status becomes cancelled", async () => {
  const appId = await insertApplication({ status: "pending" });
  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Changed our minds about the program" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { application: { status: string } };
  assert.equal(body.application.status, "cancelled");
  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'cancelled'", [appId]), 1);
});

test("parent: accepted application → POST cancel → 200, status becomes cancelled", async () => {
  const appId = await insertApplication({ status: "accepted" });
  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "No longer available on class days" }),
  });
  assert.equal(res.status, 200);
  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'cancelled'", [appId]), 1);
});

test("parent: assignedToLevel → POST cancel → application cancelled, assignment withdrawn (row preserved, not deleted), attendance preserved, reason stored, actor is parent (no admin)", async () => {
  const appId = await insertApplication({ status: "assignedToLevel" });
  const assignmentId = await insertAssignment(appId, "active");
  const attendanceId = await insertAttendance(assignmentId);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Schedule conflict with school" }),
  });
  assert.equal(res.status, 200);

  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'cancelled'", [appId]), 1);
  // Assignment row preserved (not deleted), status withdrawn, metadata set, no admin actor.
  const assignment = await pool.query(`SELECT status, withdrawal_reason, withdrawn_by_admin_id FROM ballet_level_assignments WHERE id = $1`, [assignmentId]);
  assert.equal(assignment.rows.length, 1, "assignment row must still exist");
  assert.equal(assignment.rows[0].status, "withdrawn");
  assert.equal(assignment.rows[0].withdrawal_reason, "Schedule conflict with school");
  assert.equal(assignment.rows[0].withdrawn_by_admin_id, null, "parent-initiated cancel must not attribute an admin actor");
  // Attendance preserved untouched.
  const attendance = await pool.query(`SELECT id FROM attendance WHERE id = $1`, [attendanceId]);
  assert.equal(attendance.rows.length, 1, "attendance row must be preserved");
  // Reason stored on the application_events row, changed_by_id null (parent, not admin).
  const event = await pool.query(`SELECT note, changed_by_id FROM ballet_application_events WHERE application_id = $1 ORDER BY id DESC LIMIT 1`, [appId]);
  assert.equal(event.rows[0].note, "Schedule conflict with school");
  assert.equal(event.rows[0].changed_by_id, null);
});

// ─── Parent active program ────────────────────────────────────────────────────────

test("parent: active enrollment → creates exactly one cancellation request with reason/timing/initiator stored", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Moving to another city" }),
  });
  assert.equal(res.status, 201);

  const rows = await pool.query(
    `SELECT reason, requested_timing, initiated_by_type, initiated_by_admin_id FROM ballet_enrollment_cancellation_requests WHERE level_assignment_id = $1`,
    [assignmentId],
  );
  assert.equal(rows.rows.length, 1, "exactly one cancellation request row");
  assert.equal(rows.rows[0].reason, "Moving to another city");
  assert.equal(rows.rows[0].requested_timing, "endOfPeriod");
  assert.equal(rows.rows[0].initiated_by_type, "parent");
  assert.equal(rows.rows[0].initiated_by_admin_id, null);
});

test("parent: duplicate cancellation-request on the same open enrollment is rejected (409), still exactly one row", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const first = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "First request" }),
  });
  assert.equal(first.status, 201);

  const second = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Second request, should be rejected" }),
  });
  assert.equal(second.status, 409);

  assert.equal(await countRows("ballet_enrollment_cancellation_requests", "level_assignment_id = $1", [assignmentId]), 1);
});

test("parent: refund row created ONLY when an eligible paid inPerson payment exists, and no amount is ever accepted from the request body", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  await insertCurrentCyclePayment(appId, assignmentId, 1500);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    // requestedAmountEgp is not a real field in the schema — sending it
    // proves the server never reads/persists a parent-supplied amount.
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Requesting a refund", requestRefund: true, requestedAmountEgp: 999999 }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refundCreated: boolean };
  assert.equal(body.refundCreated, true);

  const refunds = await pool.query(
    `SELECT refund_method, requested_amount_egp, status FROM ballet_refunds WHERE application_id = $1`,
    [appId],
  );
  assert.equal(refunds.rows.length, 1);
  assert.equal(refunds.rows[0].refund_method, "cash");
  assert.equal(refunds.rows[0].status, "underReview");
  assert.equal(refunds.rows[0].requested_amount_egp, null, "no refund amount is ever accepted from the parent");
});

test("parent: refund NOT created when no eligible paid inPerson payment exists", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  // No payment seeded at all.

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Requesting a refund but none eligible", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refundCreated: boolean };
  assert.equal(body.refundCreated, false);
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 0);
});

test("1. Parent End of Period with both a current cycle and a future renewal — stored effectiveDate equals current cycle expiry, refund references current cycle paymentId, future renewal ignored", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const currentPaymentId = await insertCurrentCyclePayment(appId, assignmentId, 1200);
  const futurePaymentId = await insertFutureCyclePayment(appId, assignmentId, 1200);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Ending at the close of the current billing period", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as {
    refundCreated: boolean;
    refund: { id: number; paymentId: number } | null;
    cancellationRequest: { requestedEffectiveDate: string | null };
  };
  assert.equal(body.refundCreated, true, "the current cycle is a paid inPerson cycle, so a refund must be created");
  assert.ok(body.refund, "refund payload must be present");

  // Stored effectiveDate (requestedEffectiveDate, established once at
  // creation time) equals the CURRENT cycle's own expiry — never the future
  // renewal's expiry, which would fall outside the current cycle's window
  // entirely if the old currentSubscription()-based derivation were still in
  // place (it sorts by latest subscriptionStartDate with no concept of
  // "today", so it would have returned the renewal instead).
  const expectedExpiry = addDays(TODAY, 20); // matches insertCurrentCyclePayment's own window
  assert.equal(body.cancellationRequest.requestedEffectiveDate, expectedExpiry);

  // Belt-and-suspenders: re-fetch the request row directly, independent of the HTTP response shape.
  const requestRow = await pool.query(`SELECT requested_effective_date FROM ballet_enrollment_cancellation_requests WHERE level_assignment_id = $1 ORDER BY id DESC LIMIT 1`, [assignmentId]);
  assert.equal(requestRow.rows[0].requested_effective_date, expectedExpiry);

  // The stored refund's payment_id is the DB-level proof of which cycle the
  // effective date actually resolved against.
  const refund = await pool.query(`SELECT payment_id FROM ballet_refunds WHERE id = $1`, [body.refund!.id]);
  assert.equal(refund.rows[0].payment_id, currentPaymentId, "refund must be tied to the current cycle's payment");
  assert.notEqual(refund.rows[0].payment_id, futurePaymentId, "refund must never be tied to the future renewal's payment");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 1, "exactly one refund row");
});

test("2. Admin-initiated End of Period with both a current cycle and a future renewal — same assertions: stored effectiveDate equals current cycle expiry, refund references current cycle paymentId, future renewal ignored", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const currentPaymentId = await insertCurrentCyclePayment(appId, assignmentId, 1200);
  const futurePaymentId = await insertFutureCyclePayment(appId, assignmentId, 1200);

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Admin end-of-period with a future renewal on file", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as {
    refund: { id: number; paymentId: number } | null;
    cancellationRequest: { approvedEffectiveDate: string | null };
  };
  assert.ok(body.refund, "current cycle is a paid inPerson cycle, so a refund must be created");

  const expectedExpiry = addDays(TODAY, 20);
  assert.equal(body.cancellationRequest.approvedEffectiveDate, expectedExpiry, "admin-initiated end-of-period stores the CURRENT cycle's expiry, never the future renewal's");

  const refund = await pool.query(`SELECT payment_id FROM ballet_refunds WHERE id = $1`, [body.refund!.id]);
  assert.equal(refund.rows[0].payment_id, currentPaymentId);
  assert.notEqual(refund.rows[0].payment_id, futurePaymentId);
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 1);
});

test("3. Admin approval: creating a future renewal AFTER the parent's request does not change the already-established effectiveDate or the refund's payment identity", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const currentPaymentId = await insertCurrentCyclePayment(appId, assignmentId, 1200);

  // Parent creates the request while only the current cycle exists —
  // establishes requestedEffectiveDate + a refund tied to currentPaymentId.
  const created = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Ending at period close", requestRefund: true }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as {
    cancellationRequest: { id: number; requestedEffectiveDate: string | null };
    refund: { id: number; paymentId: number } | null;
  };
  const requestId = createdBody.cancellationRequest.id;
  const expectedExpiry = addDays(TODAY, 20);
  assert.equal(createdBody.cancellationRequest.requestedEffectiveDate, expectedExpiry);
  assert.ok(createdBody.refund);
  assert.equal(createdBody.refund!.paymentId, currentPaymentId);

  // NOW a future renewal is created — simulating a new payment recorded
  // after the parent's request but before an admin gets to approving it.
  const futurePaymentId = await insertFutureCyclePayment(appId, assignmentId, 1200);

  // Admin approves end-of-period WITHOUT supplying an explicit effective date.
  const approved = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/cancellation-requests/${requestId}/approve-end-of-period`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(approved.status, 200);
  const approvedBody = await approved.json() as { cancellationRequest: { approvedEffectiveDate: string | null } };

  // The approved effective date must equal the ORIGINALLY-established date —
  // the newly created renewal must never change it.
  assert.equal(approvedBody.cancellationRequest.approvedEffectiveDate, expectedExpiry, "a renewal created after the request must not change an older cancellation request's effective date");

  // The refund created at request-creation time must still point to the
  // ORIGINAL payment — approve-end-of-period never touches refunds at all.
  const refund = await pool.query(`SELECT payment_id FROM ballet_refunds WHERE id = $1`, [createdBody.refund!.id]);
  assert.equal(refund.rows[0].payment_id, currentPaymentId);
  assert.notEqual(refund.rows[0].payment_id, futurePaymentId);
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 1, "still exactly one refund row — approval never creates a second one");
});

test("4. Boundary date: current cycle expiry and renewal start on the same date — result follows the documented rule (the already-active, earlier-starting cycle owns the shared boundary day)", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  // Current cycle expires exactly TODAY; renewal starts exactly TODAY.
  const currentPaymentId = await insertSubscriptionCyclePayment(appId, assignmentId, {
    amountEgp: 1200,
    subscriptionStartDate: addDays(TODAY, -30),
    subscriptionExpiresAt: TODAY,
  });
  const renewalPaymentId = await insertSubscriptionCyclePayment(appId, assignmentId, {
    amountEgp: 1200,
    subscriptionStartDate: TODAY,
    subscriptionExpiresAt: addDays(TODAY, 30),
  });

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Boundary date cancellation", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refund: { id: number; paymentId: number } | null };
  assert.ok(body.refund, "the already-active (earlier-starting) cycle is inPerson and eligible");

  const refund = await pool.query(`SELECT payment_id FROM ballet_refunds WHERE id = $1`, [body.refund!.id]);
  assert.equal(refund.rows[0].payment_id, currentPaymentId, "the cycle already active before the boundary date owns that date through its own expiry — never the renewal starting that same day");
  assert.notEqual(refund.rows[0].payment_id, renewalPaymentId);
});

// ─── Refund payment selection (context-aware, effective-date-driven) ───────────────

test("active cancellation: a future renewal payment is not chosen — no refund created when only a future cycle exists", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  await insertFutureCyclePayment(appId, assignmentId, 1200);

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Cancelling before the future renewal starts", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refund: unknown };
  assert.equal(body.refund, null, "a not-yet-started future renewal must never be treated as the current cycle");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 0);
});

test("active cancellation: an expired historical cycle is not chosen — no refund created when only an expired cycle exists", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  await insertExpiredCyclePayment(appId, assignmentId, 1200);

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Cancelling long after the last cycle expired", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refund: unknown };
  assert.equal(body.refund, null, "an expired cycle must never be substituted for a current one");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 0);
});

test("active cancellation: current cycle paid by a non-cash method does not fall back to an older cash cycle", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  await insertCurrentCyclePayment(appId, assignmentId, 1200, "kashier");
  const olderCashPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 800);

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Current cycle is not cash", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refund: unknown };
  assert.equal(body.refund, null, "current cycle is non-cash — no automatic cash refund");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 0);
  assert.equal(await countRows("ballet_refunds", "payment_id = $1", [olderCashPaymentId]), 0, "the older cash payment must never be substituted for the current non-cash cycle");
});

test("active cancellation: current cycle with zero remaining refundable amount is not eligible, and does not fall back to an older cycle", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const currentPaymentId = await insertCurrentCyclePayment(appId, assignmentId, 1200);
  const olderPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 800);
  // Fully refund the current cycle's payment ahead of time — its remaining balance is now zero.
  await pool.query(
    `INSERT INTO ballet_refunds (application_id, level_assignment_id, payment_id, status, refund_method, requested_reason, approved_amount_egp, refunded_amount_egp)
     VALUES ($1, $2, $3, 'refunded', 'cash', 'Pre-existing full refund', 1200, 1200)`,
    [appId, assignmentId, currentPaymentId],
  );

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Current cycle already fully refunded", requestRefund: true }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { refund: unknown };
  assert.equal(body.refund, null, "zero remaining balance on the current cycle must not fall back to an older cycle");
  assert.equal(await countRows("ballet_refunds", "payment_id = $1 AND status = 'underReview'", [currentPaymentId]), 0, "no second underReview refund against the already fully-refunded payment");
  assert.equal(await countRows("ballet_refunds", "payment_id = $1", [olderPaymentId]), 0);
});

test("pre-activation cancellation: a flat paid inPerson payment (no subscription cycle) is still eligible for refund", async () => {
  const appId = await insertApplication({ status: "pending" });
  await insertFlatPayment(appId, 900);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "Cancelling before activation", requestRefund: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { refund: { id: number; refundMethod: string } | null };
  assert.ok(body.refund, "a flat application-fee payment must still be refund-eligible pre-activation");
  assert.equal(body.refund!.refundMethod, "cash");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 1);
});

test("mobile detail: accepted application with paid initial inPerson payment and no subscription dates reports refund eligibility without expiry initialization", async () => {
  const appId = await insertApplication({ status: "accepted" });
  const paymentId = await insertFlatPayment(appId, 900);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}`);
  assert.equal(res.status, 200);
  const body = await res.json() as { eligibleRefund: { eligible: boolean; paymentId: number | null; remainingRefundableEgp: number } };
  assert.equal(body.eligibleRefund.eligible, true);
  assert.equal(body.eligibleRefund.paymentId, paymentId);
  assert.equal(body.eligibleRefund.remainingRefundableEgp, 900);
});

test("pre-activation cancellation: an active/future subscription-cycle payment is never substituted for a missing application fee", async () => {
  const appId = await insertApplication({ status: "accepted" });
  await insertCurrentCyclePayment(appId, null, 1200);
  await insertFutureCyclePayment(appId, null, 1200);

  const res = await asParent(parentId, "route-test-parent@example.com", `/ballet/applications/${appId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: "No application fee on file", requestRefund: true }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { refund: unknown };
  assert.equal(body.refund, null, "subscription-cycle payments must never be substituted for a pre-activation application fee");
  assert.equal(await countRows("ballet_refunds", "application_id = $1", [appId]), 0);
});

// ─── Admin payment-cycle lifecycle ───────────────────────────────────────────────

test("admin payments: initial payment creation derives package price server-side and starts pending without subscription dates", async () => {
  const appId = await insertApplication({ status: "accepted" });
  const packageId = await insertBalletPackage(2600);

  const res = await asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
    method: "POST",
    body: JSON.stringify({
      applicationId: appId,
      packageId,
      paymentMethod: "inPerson",
      amountEgp: 1,
      status: "pending",
      startDate: TODAY,
      expiresAt: addDays(TODAY, 30),
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { payment: { id: number; amountEgp: number; status: string; isRenewal: boolean; renewedFromId: number | null } };
  assert.equal(body.payment.amountEgp, 2600);
  assert.equal(body.payment.status, "pending");
  assert.equal(body.payment.isRenewal, false);
  assert.equal(body.payment.renewedFromId, null);

  const row = await pool.query(
    `SELECT amount_egp, status, is_renewal, renewed_from_id, paid_at, subscription_start_date, subscription_expires_at
     FROM ballet_payments WHERE id = $1`,
    [body.payment.id],
  );
  assert.equal(row.rows[0].amount_egp, 2600);
  assert.equal(row.rows[0].status, "pending");
  assert.equal(row.rows[0].is_renewal, false);
  assert.equal(row.rows[0].renewed_from_id, null);
  assert.equal(row.rows[0].paid_at, null);
  assert.equal(row.rows[0].subscription_start_date, null);
  assert.equal(row.rows[0].subscription_expires_at, null);
});

test("admin payments: duplicate and concurrent initial payment creation produce one row only", async () => {
  const appId = await insertApplication({ status: "assignedToLevel" });
  const packageId = await insertBalletPackage(2600);
  const body = { applicationId: appId, packageId, paymentMethod: "inPerson" };

  const [one, two] = await Promise.all([
    asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ]);
  assert.deepEqual([one.status, two.status].sort(), [201, 409]);
  assert.equal(await countRows("ballet_payments", "application_id = $1 AND is_renewal = false AND status = 'pending'", [appId]), 1);

  const third = await asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(third.status, 409);
  const thirdBody = await third.json() as { code: string };
  assert.equal(thirdBody.code, "BALLET_INITIAL_PAYMENT_EXISTS");
});

test("admin payments: application 17 equivalent can progress no payment → pending → paid → explicit activation", async () => {
  const { appId, assignmentId } = await makeAssignedGroupedApplication();
  const packageId = await insertBalletPackage(2600);

  const blockedBeforePayment = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", note: "Activation readiness check before payment" }),
  });
  assert.equal(blockedBeforePayment.status, 422);
  const blockedBeforeBody = await blockedBeforePayment.json() as { error: string };
  assert.match(blockedBeforeBody.error, /no active paid Ballet subscription period/i);

  const created = await asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
    method: "POST",
    body: JSON.stringify({
      applicationId: appId,
      packageId,
      levelAssignmentId: assignmentId,
      paymentMethod: "inPerson",
      amountEgp: 1,
    }),
  });
  assert.equal(created.status, 201);
  const createdBody = await created.json() as { payment: { id: number; status: string } };
  assert.equal(createdBody.payment.status, "pending");

  const blockedPending = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", note: "Activation readiness check while payment pending" }),
  });
  assert.equal(blockedPending.status, 422);

  const beforeConfirm = await pool.query(`SELECT status FROM ballet_applications WHERE id = $1`, [appId]);
  assert.equal(beforeConfirm.rows[0].status, "assignedToLevel");

  const confirmed = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/payments/${createdBody.payment.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate: TODAY, expiresAt: addDays(TODAY, 30) }),
  });
  assert.equal(confirmed.status, 200);

  const afterConfirm = await pool.query(
    `SELECT a.status AS application_status, p.status AS payment_status, p.paid_at, p.subscription_start_date, p.subscription_expires_at
     FROM ballet_applications a
     JOIN ballet_payments p ON p.application_id = a.id
     WHERE a.id = $1 AND p.id = $2`,
    [appId, createdBody.payment.id],
  );
  assert.equal(afterConfirm.rows[0].application_status, "assignedToLevel", "confirming payment must not auto-activate the application");
  assert.equal(afterConfirm.rows[0].payment_status, "paid");
  assert.notEqual(afterConfirm.rows[0].paid_at, null);
  assert.equal(afterConfirm.rows[0].subscription_start_date, TODAY);
  assert.equal(afterConfirm.rows[0].subscription_expires_at, addDays(TODAY, 30));

  const activated = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "active", note: "Explicit activation after payment confirmation" }),
  });
  assert.equal(activated.status, 200);
  const finalApp = await pool.query(`SELECT status FROM ballet_applications WHERE id = $1`, [appId]);
  assert.equal(finalApp.rows[0].status, "active");
});

test("admin payments: pending initial payment is not counted as Ballet revenue, but confirmed paid initial payment is counted", async () => {
  const appId = await insertApplication({ status: "accepted" });
  const packageId = await insertBalletPackage(3100);
  const { getFinancialAggregates } = await import("./financialAggregates.ts");

  const before = await getFinancialAggregates();
  const created = await asAdmin(superAdminId, "route-test-super", "/admin/ballet/payments", {
    method: "POST",
    body: JSON.stringify({ applicationId: appId, packageId, paymentMethod: "inPerson" }),
  });
  assert.equal(created.status, 201);
  const { payment } = await created.json() as { payment: { id: number } };

  const afterPending = await getFinancialAggregates();
  assert.equal(afterPending.grossBalletRevenueEgp, before.grossBalletRevenueEgp, "pending initial payments must not count as collected revenue");

  const confirmed = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/payments/${payment.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate: TODAY, expiresAt: addDays(TODAY, 30) }),
  });
  assert.equal(confirmed.status, 200);

  const afterPaid = await getFinancialAggregates();
  assert.equal(afterPaid.grossBalletRevenueEgp, before.grossBalletRevenueEgp + 3100, "paid initial payment revenue uses the stored package-derived amount");
});

test("admin payments: renewal creation always creates a pending payment cycle with package price and no paid/subscription dates, even if the client sends paid fields", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const previousPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const packageId = await insertBalletPackage(2600);

  const res = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
    method: "POST",
    body: JSON.stringify({
      renewedFromId: previousPaymentId,
      packageId,
      paymentMethod: "inPerson",
      billingMonth: "2026-08",
      status: "paid",
      amountEgp: 999999,
      startDate: TODAY,
      expiresAt: addDays(TODAY, 30),
    }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { payment: { id: number; status: string; amountEgp: number; isRenewal: boolean; renewedFromId: number } };
  assert.equal(body.payment.status, "pending");
  assert.equal(body.payment.amountEgp, 2600);
  assert.equal(body.payment.isRenewal, true);
  assert.equal(body.payment.renewedFromId, previousPaymentId);

  const row = await pool.query(
    `SELECT status, amount_egp, is_renewal, renewed_from_id, paid_at, subscription_start_date, subscription_expires_at, original_expires_at
     FROM ballet_payments WHERE id = $1`,
    [body.payment.id],
  );
  assert.equal(row.rows[0].status, "pending");
  assert.equal(row.rows[0].amount_egp, 2600);
  assert.equal(row.rows[0].is_renewal, true);
  assert.equal(row.rows[0].renewed_from_id, previousPaymentId);
  assert.equal(row.rows[0].paid_at, null);
  assert.equal(row.rows[0].subscription_start_date, null);
  assert.equal(row.rows[0].subscription_expires_at, null);
  assert.equal(row.rows[0].original_expires_at, null);

  const previous = await pool.query(
    `SELECT status, subscription_start_date, subscription_expires_at FROM ballet_payments WHERE id = $1`,
    [previousPaymentId],
  );
  assert.equal(previous.rows[0].status, "paid", "creating a renewal must preserve the previous cycle");
  assert.equal(previous.rows[0].subscription_expires_at, addDays(TODAY, -10));
});

test("admin payments: duplicate pending renewal for the same application/source cycle is rejected and only one row exists", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const previousPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const packageId = await insertBalletPackage(2600);
  const body = { renewedFromId: previousPaymentId, packageId, paymentMethod: "inPerson", billingMonth: "2026-08" };

  const first = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(first.status, 201);

  const second = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
    method: "POST",
    body: JSON.stringify(body),
  });
  assert.equal(second.status, 409);
  const secondBody = await second.json() as { code: string };
  assert.equal(secondBody.code, "BALLET_PENDING_RENEWAL_EXISTS");

  assert.equal(
    await countRows("ballet_payments", "application_id = $1 AND renewed_from_id = $2 AND is_renewal = true AND status = 'pending'", [appId, previousPaymentId]),
    1,
  );
});

test("admin payments: concurrent duplicate renewal attempts produce one pending row and one conflict", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const previousPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const packageId = await insertBalletPackage(2600);
  const body = { renewedFromId: previousPaymentId, packageId, paymentMethod: "inPerson", billingMonth: "2026-08" };

  const [one, two] = await Promise.all([
    asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
    asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  ]);
  const statuses = [one.status, two.status].sort();
  assert.deepEqual(statuses, [201, 409]);
  assert.equal(
    await countRows("ballet_payments", "application_id = $1 AND renewed_from_id = $2 AND is_renewal = true AND status = 'pending'", [appId, previousPaymentId]),
    1,
  );
});

test("admin payments: confirming a pending renewal marks only that row paid and establishes subscription dates; previous cycle remains unchanged", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const previousPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const previousBefore = await pool.query(
    `SELECT status, subscription_start_date, subscription_expires_at FROM ballet_payments WHERE id = $1`,
    [previousPaymentId],
  );
  const packageId = await insertBalletPackage(2600);

  const created = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
    method: "POST",
    body: JSON.stringify({ renewedFromId: previousPaymentId, packageId, paymentMethod: "inPerson", billingMonth: "2026-08" }),
  });
  assert.equal(created.status, 201);
  const { payment } = await created.json() as { payment: { id: number } };

  const startDate = addDays(TODAY, 1);
  const expiresAt = addDays(TODAY, 31);
  const confirmed = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/payments/${payment.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate, expiresAt }),
  });
  assert.equal(confirmed.status, 200);

  const renewal = await pool.query(
    `SELECT status, paid_at, subscription_start_date, subscription_expires_at, original_expires_at FROM ballet_payments WHERE id = $1`,
    [payment.id],
  );
  assert.equal(renewal.rows[0].status, "paid");
  assert.notEqual(renewal.rows[0].paid_at, null);
  assert.equal(renewal.rows[0].subscription_start_date, startDate);
  assert.equal(renewal.rows[0].subscription_expires_at, expiresAt);
  assert.equal(renewal.rows[0].original_expires_at, expiresAt);

  const previousAfter = await pool.query(
    `SELECT status, subscription_start_date, subscription_expires_at FROM ballet_payments WHERE id = $1`,
    [previousPaymentId],
  );
  assert.deepEqual(previousAfter.rows[0], previousBefore.rows[0], "confirming a renewal must not overwrite the prior cycle");

  const repeated = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/payments/${payment.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate, expiresAt }),
  });
  assert.equal(repeated.status, 422);
  const repeatedBody = await repeated.json() as { code: string };
  assert.equal(repeatedBody.code, "BALLET_PAYMENT_NOT_PENDING");
});

test("admin payments: pending renewal is not counted as Ballet revenue, but confirmed paid renewal is counted", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const previousPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const packageId = await insertBalletPackage(2600);
  const { getFinancialAggregates } = await import("./financialAggregates.ts");

  const before = await getFinancialAggregates();
  const created = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscriptions/renew`, {
    method: "POST",
    body: JSON.stringify({ renewedFromId: previousPaymentId, packageId, paymentMethod: "inPerson", billingMonth: "2026-08" }),
  });
  assert.equal(created.status, 201);
  const { payment } = await created.json() as { payment: { id: number } };

  const afterPending = await getFinancialAggregates();
  assert.equal(afterPending.grossBalletRevenueEgp, before.grossBalletRevenueEgp, "pending renewals must not count as collected revenue");

  const confirmed = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/payments/${payment.id}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status: "paid", startDate: TODAY, expiresAt: addDays(TODAY, 30) }),
  });
  assert.equal(confirmed.status, 200);

  const afterPaid = await getFinancialAggregates();
  assert.equal(afterPaid.grossBalletRevenueEgp, before.grossBalletRevenueEgp + 2600, "paid renewal revenue uses the stored payment amount");
});

test("admin payments: active paid current cycle expiry can be adjusted with structured history and audit log, without changing payment/app/assignment state", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const paymentId = await insertCurrentCyclePayment(appId, assignmentId, 1700);
  const before = await pool.query(
    `SELECT status, paid_at, subscription_expires_at, original_expires_at FROM ballet_payments WHERE id = $1`,
    [paymentId],
  );
  const oldExpiry = before.rows[0].subscription_expires_at as string;

  const res = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 3, reason: "studioHoliday", note: "Studio closed" }),
  });
  assert.equal(res.status, 200);
  const body = await res.json() as { previousExpiresAt: string; newExpiresAt: string; adjustment: { adjustmentMethod: string; additionalDays: number; reason: string } };
  assert.equal(body.previousExpiresAt, oldExpiry);
  assert.equal(body.newExpiresAt, addDays(oldExpiry, 3));
  assert.equal(body.adjustment.adjustmentMethod, "addDays");
  assert.equal(body.adjustment.additionalDays, 3);
  assert.equal(body.adjustment.reason, "Studio holiday");

  const after = await pool.query(
    `SELECT status, paid_at, subscription_expires_at, original_expires_at, extension_history FROM ballet_payments WHERE id = $1`,
    [paymentId],
  );
  assert.equal(after.rows[0].status, "paid");
  assert.equal(after.rows[0].paid_at.toISOString(), before.rows[0].paid_at.toISOString(), "paidAt must not change");
  assert.equal(after.rows[0].subscription_expires_at, addDays(oldExpiry, 3));
  assert.equal(after.rows[0].original_expires_at, oldExpiry, "original expiry is preserved on first adjustment");
  assert.equal(after.rows[0].extension_history.length, 1);
  assert.equal(after.rows[0].extension_history[0].previousExpiresAt, oldExpiry);
  assert.equal(after.rows[0].extension_history[0].newExpiresAt, addDays(oldExpiry, 3));

  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'active'", [appId]), 1, "application status unchanged");
  assert.equal(await countRows("ballet_level_assignments", "id = $1 AND status = 'active'", [assignmentId]), 1, "assignment status unchanged");
  assert.equal(
    await countRows("admin_activity_logs", "module = 'ballet.payments' AND action = 'adjustExpiry' AND entity_id = $1", [String(paymentId)]),
    1,
    "one audit log is written for the expiry adjustment",
  );
});

test("admin payments: pending, refunded, and expired cycles cannot be adjusted by the application-level expiry endpoint", async () => {
  const pendingAppId = await insertApplication({ status: "active" });
  await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method, subscription_start_date, subscription_expires_at)
     VALUES ($1, 1000, 'pending', 'inPerson', $2, $3)`,
    [pendingAppId, addDays(TODAY, -1), addDays(TODAY, 10)],
  );
  const pending = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${pendingAppId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 3, reason: "studioHoliday" }),
  });
  assert.equal(pending.status, 422);

  const refundedAppId = await insertApplication({ status: "active" });
  await pool.query(
    `INSERT INTO ballet_payments (application_id, amount_egp, status, payment_method, paid_at, subscription_start_date, subscription_expires_at)
     VALUES ($1, 1000, 'refunded', 'inPerson', now(), $2, $3)`,
    [refundedAppId, addDays(TODAY, -1), addDays(TODAY, 10)],
  );
  const refunded = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${refundedAppId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 3, reason: "studioHoliday" }),
  });
  assert.equal(refunded.status, 422);

  const expiredAppId = await insertApplication({ status: "active" });
  await insertExpiredCyclePayment(expiredAppId, null, 1000);
  const expired = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${expiredAppId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 3, reason: "studioHoliday" }),
  });
  assert.equal(expired.status, 422);
  const expiredBody = await expired.json() as { code: string };
  assert.equal(expiredBody.code, "BALLET_NO_ADJUSTABLE_SUBSCRIPTION");
});

test("admin payments: expiry adjustment rejects invalid days, non-extension dates, and missing Other reason", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const paymentId = await insertCurrentCyclePayment(appId, assignmentId, 1700);
  const row = await pool.query(`SELECT subscription_expires_at FROM ballet_payments WHERE id = $1`, [paymentId]);
  const currentExpiry = row.rows[0].subscription_expires_at as string;

  for (const body of [
    { adjustmentMethod: "addDays", additionalDays: 0, reason: "studioHoliday" },
    { adjustmentMethod: "addDays", additionalDays: -1, reason: "studioHoliday" },
    { adjustmentMethod: "addDays", additionalDays: 1.5, reason: "studioHoliday" },
    { adjustmentMethod: "setDate", newExpiresAt: currentExpiry, reason: "studioHoliday" },
    { adjustmentMethod: "setDate", newExpiresAt: addDays(currentExpiry, -1), reason: "studioHoliday" },
    { adjustmentMethod: "setDate", newExpiresAt: addDays(currentExpiry, 1), reason: "other" },
  ]) {
    const res = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscription/expiry`, {
      method: "PATCH",
      body: JSON.stringify(body),
    });
    assert.ok(res.status === 400 || res.status === 422, `expected rejection for ${JSON.stringify(body)}, got ${res.status}`);
  }
});

test("admin payments: application-level expiry adjustment cannot select an unrelated historical cycle", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const historicalPaymentId = await insertExpiredCyclePayment(appId, assignmentId, 1700);
  const currentPaymentId = await insertCurrentCyclePayment(appId, assignmentId, 1700);
  const historicalBefore = await pool.query(`SELECT subscription_expires_at, extension_history FROM ballet_payments WHERE id = $1`, [historicalPaymentId]);

  const res = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscription/expiry`, {
    method: "PATCH",
    body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 2, reason: "administrativeCorrection" }),
  });
  assert.equal(res.status, 200);

  const historicalAfter = await pool.query(`SELECT subscription_expires_at, extension_history FROM ballet_payments WHERE id = $1`, [historicalPaymentId]);
  assert.deepEqual(historicalAfter.rows[0], historicalBefore.rows[0], "historical cycle must remain untouched");
  const currentAfter = await pool.query(`SELECT extension_history FROM ballet_payments WHERE id = $1`, [currentPaymentId]);
  assert.equal(currentAfter.rows[0].extension_history.length, 1, "only the authoritative current cycle receives the adjustment");
});

test("admin payments: concurrent expiry adjustments append both history entries without losing either update", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const paymentId = await insertCurrentCyclePayment(appId, assignmentId, 1700);
  const before = await pool.query(`SELECT subscription_expires_at FROM ballet_payments WHERE id = $1`, [paymentId]);
  const oldExpiry = before.rows[0].subscription_expires_at as string;

  const [one, two] = await Promise.all([
    asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscription/expiry`, {
      method: "PATCH",
      body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 1, reason: "studioHoliday" }),
    }),
    asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/subscription/expiry`, {
      method: "PATCH",
      body: JSON.stringify({ adjustmentMethod: "addDays", additionalDays: 2, reason: "classSuspension" }),
    }),
  ]);
  assert.equal(one.status, 200);
  assert.equal(two.status, 200);

  const after = await pool.query(`SELECT subscription_expires_at, extension_history FROM ballet_payments WHERE id = $1`, [paymentId]);
  assert.equal(after.rows[0].extension_history.length, 2);
  assert.equal(after.rows[0].subscription_expires_at, addDays(oldExpiry, 3));
  assert.equal(
    await countRows("admin_activity_logs", "module = 'ballet.payments' AND action = 'adjustExpiry' AND entity_id = $1", [String(paymentId)]),
    2,
  );
});

// ─── Admin active program ────────────────────────────────────────────────────────

test("admin: unauthorized admin (missing ballet.applications:cancel) → 403, no request row created", async () => {
  const appId = await insertApplication({ status: "active" });
  await insertAssignment(appId, "active");

  const res = await asAdmin(unauthorizedAdminId, "route-test-unauthorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Should be blocked" }),
  });
  assert.equal(res.status, 403);
  assert.equal(await countRows("ballet_enrollment_cancellation_requests", "application_id = $1", [appId]), 0);
});

test("admin: authorized admin creates an IMMEDIATE cancellation — request completed, application+assignment withdrawn, attendance preserved, one audit log, one parent notification", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");
  const attendanceId = await insertAttendance(assignmentId);

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Admin-initiated immediate cancellation" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { cancellationRequest: { status: string }; timing: string };
  assert.equal(body.timing, "immediate");
  assert.equal(body.cancellationRequest.status, "completed");

  const request = await pool.query(
    `SELECT id, initiated_by_type, initiated_by_admin_id, status FROM ballet_enrollment_cancellation_requests WHERE application_id = $1`,
    [appId],
  );
  assert.equal(request.rows.length, 1, "exactly one cancellation-request record");
  assert.equal(request.rows[0].initiated_by_type, "admin");
  assert.equal(request.rows[0].initiated_by_admin_id, authorizedAdminId);
  assert.equal(request.rows[0].status, "completed");
  const requestId = request.rows[0].id as number;

  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'withdrawn'", [appId]), 1);
  const assignment = await pool.query(`SELECT status FROM ballet_level_assignments WHERE id = $1`, [assignmentId]);
  assert.equal(assignment.rows[0].status, "withdrawn");
  const attendance = await pool.query(`SELECT id FROM attendance WHERE id = $1`, [attendanceId]);
  assert.equal(attendance.rows.length, 1, "attendance preserved");

  assert.equal(
    await countRows("admin_activity_logs", "entity_type = 'ballet_enrollment_cancellation_request' AND entity_id = $1", [String(requestId)]),
    1,
    "exactly one audit log for this cancellation request",
  );
  assert.equal(
    await countRows("notifications", "target = $1 AND related_entity_type = 'ballet_enrollment_cancellation_request' AND related_entity_id = $2", [`student:${parentId}`, requestId]),
    1,
    "exactly one parent notification for this cancellation request",
  );
});

test("admin: end-of-period cancellation creates one approved request, application/assignment stay active, duplicate is rejected", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const res = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Admin end-of-period cancellation" }),
  });
  assert.equal(res.status, 201);
  const body = await res.json() as { cancellationRequest: { status: string; approvedEffectiveDate: string | null }; timing: string };
  assert.equal(body.timing, "endOfPeriod");
  assert.equal(body.cancellationRequest.status, "approved");
  assert.ok(body.cancellationRequest.approvedEffectiveDate, "approved effective date must be stored");

  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'active'", [appId]), 1, "application remains active until finalization");
  assert.equal(await countRows("ballet_level_assignments", "id = $1 AND status = 'active'", [assignmentId]), 1, "assignment remains active until finalization");

  const duplicate = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "Duplicate attempt" }),
  });
  assert.equal(duplicate.status, 409);
  assert.equal(await countRows("ballet_enrollment_cancellation_requests", "application_id = $1", [appId]), 1, "still exactly one request row");
});

test("admin: Super Admin can execute the admin-initiated cancellation without an explicit role grant", async () => {
  const appId = await insertApplication({ status: "active" });
  await insertAssignment(appId, "active");

  const res = await asAdmin(superAdminId, "route-test-super", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Super admin action" }),
  });
  assert.equal(res.status, 201);
  assert.equal(await countRows("ballet_applications", "id = $1 AND status = 'withdrawn'", [appId]), 1);
});

// ─── Idempotency ──────────────────────────────────────────────────────────────────

test("idempotency: repeating an immediate admin cancellation after completion is rejected (app no longer active), no duplicate request/audit/notification rows", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const first = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "First immediate cancellation" }),
  });
  assert.equal(first.status, 201);
  const requestCountAfterFirst = await countRows("ballet_enrollment_cancellation_requests", "application_id = $1", [appId]);
  assert.equal(requestCountAfterFirst, 1);

  const second = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Repeated call" }),
  });
  assert.equal(second.status, 422, "application is no longer active — repeated call must be rejected, not silently duplicated");
  assert.equal(await countRows("ballet_enrollment_cancellation_requests", "application_id = $1", [appId]), 1, "no duplicate cancellation-request row");
  assert.equal(await countRows("ballet_level_assignments", "id = $1 AND status = 'withdrawn'", [assignmentId]), 1, "assignment withdrawn exactly once");
});

test("idempotency: finalizing an already-completed cancellation request a second time does not mutate state again or duplicate the audit log", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const created = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/applications/${appId}/request-cancellation`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "immediate", reason: "Immediate for finalize-twice test" }),
  });
  assert.equal(created.status, 201);
  const { cancellationRequest } = await created.json() as { cancellationRequest: { id: number } };
  const requestId = cancellationRequest.id;

  const auditCountAfterCreate = await countRows(
    "admin_activity_logs",
    "entity_type = 'ballet_enrollment_cancellation_request' AND entity_id = $1",
    [String(requestId)],
  );

  const secondFinalize = await asAdmin(authorizedAdminId, "route-test-authorized", `/admin/ballet/cancellation-requests/${requestId}/finalize`, {
    method: "POST",
    body: JSON.stringify({}),
  });
  assert.equal(secondFinalize.status, 200);
  const finalizeBody = await secondFinalize.json() as { cancellationRequest: { status: string } };
  assert.equal(finalizeBody.cancellationRequest.status, "completed");

  const auditCountAfterSecondFinalize = await countRows(
    "admin_activity_logs",
    "entity_type = 'ballet_enrollment_cancellation_request' AND entity_id = $1",
    [String(requestId)],
  );
  assert.equal(auditCountAfterSecondFinalize, auditCountAfterCreate, "finalizing an already-completed request must not add another audit log row");
  assert.equal(await countRows("ballet_level_assignments", "id = $1 AND status = 'withdrawn'", [assignmentId]), 1, "assignment withdrawn exactly once, not toggled again");
});

test("idempotency: repeating a parent withdraw on an already-withdrawn request is rejected, no duplicate state change", async () => {
  const appId = await insertApplication({ status: "active" });
  const assignmentId = await insertAssignment(appId, "active");

  const created = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollments/${assignmentId}/cancellation-requests`, {
    method: "POST",
    body: JSON.stringify({ requestedTiming: "endOfPeriod", reason: "To be withdrawn" }),
  });
  assert.equal(created.status, 201);
  const { cancellationRequest } = await created.json() as { cancellationRequest: { id: number } };

  const firstWithdraw = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollment-cancellation-requests/${cancellationRequest.id}/withdraw`, { method: "POST" });
  assert.equal(firstWithdraw.status, 200);

  const secondWithdraw = await asParent(parentId, "route-test-parent@example.com", `/ballet/enrollment-cancellation-requests/${cancellationRequest.id}/withdraw`, { method: "POST" });
  assert.equal(secondWithdraw.status, 422, "cannot withdraw a request that is no longer pendingReview");

  assert.equal(await countRows("ballet_enrollment_cancellation_requests", "id = $1 AND status = 'withdrawnByParent'", [cancellationRequest.id]), 1);
});
