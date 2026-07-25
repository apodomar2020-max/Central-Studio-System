/**
 * Finance Phase 2B-2: zero-unintended-writer proof, by paymentMode.
 *
 * A successful direct-payment booking must write exactly one payment_record
 * and one payment_event (flow_type=single_class_booking) — nothing in
 * payment_refunds, credit_transactions, or activation_credits_issued
 * events, and package_credit/free bookings must add zero Finance rows from
 * this slice at all.
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
process.env.API_SECRET_KEY = "test-api-secret-key";
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
  const email = `booking-zerowriter-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ('Zero Writer Test', $1, '0100000000', 'student', true) RETURNING id`,
    [email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function totals() {
  const [bookings, records, events, singleClassRecords, packagePurchaseRecords, refunds, credits, activationEvents] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM bookings`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'single_class_booking'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'package_purchase'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_refunds`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE type = 'package_activated'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE event_type = 'activation_credits_issued'`),
  ]);
  return {
    bookings: bookings.rows[0].n as number,
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    singleClassRecords: singleClassRecords.rows[0].n as number,
    packagePurchaseRecords: packagePurchaseRecords.rows[0].n as number,
    refunds: refunds.rows[0].n as number,
    activationCredits: credits.rows[0].n as number,
    activationEvents: activationEvents.rows[0].n as number,
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
  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Zero Writer Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Zero Writer Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 5, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

test("a successful direct-payment booking writes exactly +1 booking, +1 single_class_booking payment record, +1 created event, and nothing else", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  const before = await totals();
  const res = await fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201);
  const after = await totals();

  assert.equal(after.bookings, before.bookings + 1);
  assert.equal(after.records, before.records + 1);
  assert.equal(after.events, before.events + 1);
  assert.equal(after.singleClassRecords, before.singleClassRecords + 1);
  assert.equal(after.packagePurchaseRecords, before.packagePurchaseRecords, "package-purchase counts are unaffected — Phase 2B-1 is a separate legitimate writer");
  assert.equal(after.refunds, before.refunds);
  assert.equal(after.activationCredits, before.activationCredits);
  assert.equal(after.activationEvents, before.activationEvents);
});

test("a package_credit booking adds a booking but zero Finance rows from this slice", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);
  const pkgPackage = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('Zero Writer Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`,
  );
  const pkgOrder = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Zero Writer Pkg', 8, 8, 'active') RETURNING id`,
    [student.email, student.email, student.id, pkgPackage.rows[0].id],
  );

  const before = await totals();
  const res = await fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "package_credit", packageOrderId: pkgOrder.rows[0].id }),
  });
  assert.equal(res.status, 201);
  const after = await totals();

  assert.equal(after.bookings, before.bookings + 1);
  assert.equal(after.records, before.records, "zero payment_records from this slice for package_credit");
  assert.equal(after.events, before.events, "zero payment_events from this slice for package_credit");
});

test("a free-booking attempt adds zero rows of any kind (currently rejected outright)", async () => {
  const student = await makeStudent();
  const token = studentToken(student.id, student.email);

  const before = await totals();
  const res = await fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "free" }),
  });
  assert.equal(res.status, 400);
  const after = await totals();
  assert.deepEqual(after, before);
});
