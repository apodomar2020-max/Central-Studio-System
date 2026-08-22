/**
 * Finance Phase 2B-2: proves the booking creation transaction is genuinely
 * all-or-nothing at each internal failure point, by injecting a real
 * Postgres-level failure via a temporary trigger — matching the pattern
 * established and reviewed in Phase 2B-1
 * (packageOrders.creationCapture.atomicity.integration.test.ts).
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_SINGLE_CLASS_BOOKING_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_single_class_booking";

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
process.env.STUDENT_JWT_SECRET = "test-student-secret";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `booking-atomic-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ('Atomicity Test', $1, '0100000000', 'student', true) RETURNING id`,
    [email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
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

async function countsFor(studentEmail: string): Promise<{ bookings: number; records: number; events: number; notifications: number }> {
  const bookings = await pool.query(`SELECT count(*)::int AS n FROM bookings WHERE student_email = $1`, [studentEmail]);
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
    `SELECT count(*)::int AS n FROM notifications WHERE type IN ('booking_created', 'booking_confirmed') AND metadata->>'bookingId' IN (
       SELECT id::text FROM bookings WHERE student_email = $1
     )`,
    [studentEmail],
  );
  return {
    bookings: bookings.rows[0].n as number,
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
  const bookingsRouter = (await import("./bookings")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Atomicity Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Atomicity Class ${run}`, instructor.rows[0].id],
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

test("a payment_records insert failure leaves zero new bookings, payment records, payment events, and notifications", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("payment_records");
  try {
    const res = await fetch(apiUrl("/api/bookings"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while payment_records insert is failing");
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, records: 0, events: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_records");
  }
});

test("a payment_events insert failure leaves zero new bookings, payment records, payment events, and notifications", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("payment_events");
  try {
    const res = await fetch(apiUrl("/api/bookings"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while payment_events insert is failing");
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, records: 0, events: 0, notifications: 0 });
  } finally {
    await detachFailTrigger("payment_events");
  }
});

test("a notifications insert failure rolls back the booking and Finance rows too (notification row is atomic with the booking)", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  await attachFailTrigger("notifications");
  try {
    const res = await fetch(apiUrl("/api/bookings"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
    });
    assert.notEqual(res.status, 201, "the request must not succeed while notifications insert is failing");
    const counts = await countsFor(student.email);
    assert.deepEqual(counts, { bookings: 0, records: 0, events: 0, notifications: 0 }, "notification failure must roll back the booking and Finance rows too, not leave partial state");
  } finally {
    await detachFailTrigger("notifications");
  }
});
