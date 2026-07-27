/**
 * Finance Phase 2B-4: proves the paid Studio walk-in transaction is
 * genuinely all-or-nothing at each internal failure point, by injecting a
 * real Postgres-level failure via a temporary trigger — matching the
 * pattern established in Phase 2B-1/2B-2. Also proves concurrent duplicate
 * attempts produce exactly one successful write, not double revenue.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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
process.env.API_SECRET_KEY = "test-api-secret-key";
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
  return jwtSign({ sub: superAdminId, username: `walkin-atomic-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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
  const email = `walkin-atomic-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Walk-in Atomic Test ${studentCounter}`, email],
  );
  return { id: result.rows[0].id as number, email, name: `Walk-in Atomic Test ${studentCounter}` };
}

async function attachFailTrigger(table: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_inject_failure_${table}() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected test failure on %', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER test_inject_failure_${table}_trigger
    BEFORE INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION test_inject_failure_${table}();
  `);
}

async function detachFailTrigger(table: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS test_inject_failure_${table}_trigger ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS test_inject_failure_${table}()`);
}

async function countsFor(studentEmail: string): Promise<{ bookings: number; attendance: number; records: number; events: number; notifications: number }> {
  const bookings = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE student_email = $1`, [studentEmail]);
  const attendance = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE student_email = $1`, [studentEmail]);
  const records = await pool.query(
    `SELECT count(*)::int AS n FROM payment_records pr JOIN bookings b ON b.id = pr.booking_id WHERE b.student_email = $1`,
    [studentEmail],
  );
  const events = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe
     JOIN payment_records pr ON pr.id = pe.payment_record_id
     JOIN bookings b ON b.id = pr.booking_id
     WHERE b.student_email = $1`,
    [studentEmail],
  );
  const notifications = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE type = 'attendance_checked_in' AND metadata->>'bookingId' IN (
       SELECT id::text FROM bookings WHERE student_email = $1
     )`,
    [studentEmail],
  );
  return {
    bookings: bookings.rows[0].n as number,
    attendance: attendance.rows[0].n as number,
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    notifications: notifications.rows[0].n as number,
  };
}

before(async () => {
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
       VALUES ($1, $2, 'x', 'Walk-in Atomic Super', true) RETURNING id`,
      [`walkin-atomic-super-${run}`, `walkin-atomic-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Walk-in Atomic Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Walk-in Atomic Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 4, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("a payment_records insert failure leaves zero new bookings, attendance, payment records, payment events, and notifications", async () => {
  const student = await makeStudent();
  await attachFailTrigger("payment_records");
  try {
    const res = await asAdmin("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true, settlementMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201);
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, attendance: 0, records: 0, events: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_records");
  }
});

test("a payment_events insert failure leaves zero new bookings, attendance, payment records, payment events, and notifications", async () => {
  const student = await makeStudent();
  await attachFailTrigger("payment_events");
  try {
    const res = await asAdmin("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true, settlementMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201);
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, attendance: 0, records: 0, events: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_events");
  }
});

test("an attendance insert failure rolls back the synthetic booking and all Finance rows too", async () => {
  const student = await makeStudent();
  await attachFailTrigger("attendance");
  try {
    const res = await asAdmin("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true, settlementMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201);
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, attendance: 0, records: 0, events: 0, notifications: 0 }, "attendance failure must roll back the booking and Finance rows too");
  } finally {
    await detachFailTrigger("attendance");
  }
});

test("a notifications insert failure rolls back the synthetic booking and all Finance rows too (notification row is atomic)", async () => {
  const student = await makeStudent();
  await attachFailTrigger("notifications");
  try {
    const res = await asAdmin("/api/attendance", {
      method: "POST",
      body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true, settlementMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201);
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, attendance: 0, records: 0, events: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("notifications");
  }
});

test("concurrent duplicate paid walk-in attempts for the same student+class produce exactly one successful booking/attendance/payment record/event", async () => {
  const student = await makeStudent();
  const attempt = () => asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true, settlementMode: "pay_at_studio" }),
  });

  const responses = await Promise.all([attempt(), attempt(), attempt()]);
  const succeeded = responses.filter((r) => r.status === 201);
  assert.equal(succeeded.length, 1, "the existing duplicate-attendance guard must allow exactly one success");

  const counts = await countsFor(student.email);
  assert.equal(counts.bookings, 1);
  assert.equal(counts.attendance, 1);
  assert.equal(counts.records, 1);
  assert.equal(counts.events, 1);
});
