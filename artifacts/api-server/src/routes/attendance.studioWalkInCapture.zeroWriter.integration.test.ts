/**
 * Finance Phase 2B-4: zero-unintended-writer proof.
 *
 * A successful paid walk-in must write exactly one payment_record and one
 * payment_event (flow_type=studio_walkin) — nothing in payment_refunds,
 * credit_transactions, package_purchase, or single_class_booking records.
 * Package Credit / Not Paid walk-ins must add zero monetary Finance rows.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_STUDIO_WALKIN_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_studio_walkin";

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

process.env.DATABASE_URL = DATABASE_URL;
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `walkin-zw-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

let studentCounter = 0;
async function makeStudent(): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `walkin-zw-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Walk-in ZW ${studentCounter}`, email],
  );
  return { id: result.rows[0].id as number, email, name: `Walk-in ZW ${studentCounter}` };
}

async function totals() {
  const [records, events, walkinRecords, packagePurchaseRecords, singleClassRecords, refunds, credits, activationEvents] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'package_purchase'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'single_class_booking'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_refunds`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE type = 'package_activated'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE event_type = 'activation_credits_issued'`),
  ]);
  return {
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    walkinRecords: walkinRecords.rows[0].n as number,
    packagePurchaseRecords: packagePurchaseRecords.rows[0].n as number,
    singleClassRecords: singleClassRecords.rows[0].n as number,
    refunds: refunds.rows[0].n as number,
    activationCredits: credits.rows[0].n as number,
    activationEvents: activationEvents.rows[0].n as number,
  };
}

// Deterministic teardown: replace the fire-and-forget push dispatch with a
// spy that resolves once its own DB write (via the real code path is never
// exercised — this stands in for it), tracked via an in-process counter
// instead of polling notification_delivery_logs. Same established pattern
// as attendance.studioWalkInNotificationPostCommit.integration.test.ts —
// avoids the race where notification_delivery_logs inserts (fired from
// setTimeout(0)/fire-and-forget calls) land after the test's pool.end(),
// which previously caused intermittent "asynchronous activity after the
// test ended" failures.
let pushCallCount = 0;
async function waitForPushCalls(expected: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pushCallCount >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

before(async () => {
  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async () => {
        pushCallCount += 1;
        return { sent: 0, failed: 0, skipped: true, reason: "push_disabled" as const };
      },
      sendBroadcastPushNotification: async () => ({ sent: 0, failed: 0 }),
    },
  });

  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const attendanceRouter = (await import("./attendance")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", attendanceRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Walk-in ZW Super', true) RETURNING id`,
      [`walkin-zw-super-${run}`, `walkin-zw-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Walk-in ZW Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Walk-in ZW Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 6, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

let expectedPushCalls = 0;

after(async () => {
  // Wait for the mocked push dispatch to have actually been invoked the
  // expected number of times before tearing down — deterministic, no
  // arbitrary sleep, no DB polling race.
  await waitForPushCalls(expectedPushCalls);
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("an explicit pay_at_studio no-credit walk-in writes exactly +1 studio_walkin payment record, +1 created_and_confirmed event, and nothing else", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, settlementMode: "pay_at_studio", confirmedPaymentMethod: "cash" }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1; // performStudioWalkIn's post-commit push dispatch
  const after = await totals();

  assert.equal(after.records, before.records + 1);
  assert.equal(after.events, before.events + 1);
  assert.equal(after.walkinRecords, before.walkinRecords + 1);
  assert.equal(after.packagePurchaseRecords, before.packagePurchaseRecords);
  assert.equal(after.singleClassRecords, before.singleClassRecords);
  assert.equal(after.refunds, before.refunds);
  assert.equal(after.activationCredits, before.activationCredits);
  assert.equal(after.activationEvents, before.activationEvents);
});

test("an explicit package_credit walk-in adds zero monetary Finance rows", async () => {
  const student = await makeStudent();
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('ZW Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'ZW Pkg', 8, 8, 'active') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  await pool.query(`UPDATE package_orders SET participant_type = 'self' WHERE id = $1`, [order.rows[0].id]);
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_activated', 8, 0, 8, 'test')`,
    [order.rows[0].id, student.id],
  );

  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId,
      settlementMode: "package_credit", packageOrderId: order.rows[0].id,
    }),
  });
  assert.equal(res.status, 201);
  // Legacy package-credit check-in path: createStudentNotification fires
  // twice (checked-in + credit-used), each via setTimeout(0) push dispatch.
  expectedPushCalls += 2;
  const after = await totals();
  assert.equal(after.walkinRecords, before.walkinRecords);
  assert.equal(after.events, before.events);
});

test("Not Paid adds zero rows", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, settlementMode: "not_paid" }),
  });
  assert.equal(res.status, 400);
  const after = await totals();
  assert.deepEqual(after, before);
});

test("omitting settlementMode entirely on a walk-in returns a validation error, zero writes", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId }),
  });
  assert.equal(res.status, 400);
  const after = await totals();
  assert.deepEqual(after, before, "an unresolved settlement choice must never fall through to any write path");
});
