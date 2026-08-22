/**
 * Wave 3 — real-route integration coverage for PATCH /bookings/:id/cancel:
 * the 2-hour self-cancellation cutoff and the auto-opened single-class
 * refund. Boots the actual Express router (bookings + booking-refunds) and
 * real student/admin auth over HTTP, exactly like the established
 * bookings.*.integration.test.ts convention in this file's sibling tests.
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

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let classId: number;
let scheduleId: number;
let superAdminId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(label: string): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `booking-cutoff-${Date.now()}-${studentCounter}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ($1, $2, '0100000000', 'student', '1990-01-01', true) RETURNING id`,
    [`Booking Cutoff Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `booking-cutoff-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(init.headers as Record<string, string> | undefined) },
  });
}

async function asAdmin(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: { "content-type": "application/json", "x-api-key": "test-api-secret-key", "x-admin-token": adminToken(), ...(init.headers as Record<string, string> | undefined) },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

/** Cairo wall-clock date/time strings for "now + offsetMinutes", matching the app's own Cairo-time convention. */
function cairoOccurrenceAtOffset(offsetMinutes: number): { date: string; time: string } {
  const target = new Date(Date.now() + offsetMinutes * 60_000);
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit" });
  const timeFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Africa/Cairo", hour: "2-digit", minute: "2-digit", hour12: false });
  return { date: dateFmt.format(target), time: timeFmt.format(target) };
}

/** Inserts a booking directly (bypassing POST /bookings) so occurrenceDate/paymentMode/paymentStatus are fully controlled. */
async function makeBooking(opts: {
  studentEmail: string;
  studentId: number;
  occurrenceDate: string;
  paymentMode: string;
  paymentStatus: string;
  bookingStatus?: string;
}): Promise<{ id: number }> {
  const row = await pool.query(
    `INSERT INTO bookings
       (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, $5, $6, 'confirmed', $7, $8, $9)
     RETURNING id`,
    [opts.studentEmail, opts.studentEmail, opts.studentId, scheduleId, classId, opts.occurrenceDate, opts.bookingStatus ?? "confirmed", opts.paymentStatus, opts.paymentMode],
  );
  return { id: row.rows[0].id as number };
}

async function makePaidPaymentRecord(bookingId: number, paidAmountMinor: number): Promise<{ id: number }> {
  const nowIso = new Date().toISOString();
  const row = await pool.query(
    `INSERT INTO payment_records
       (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, refunded_amount_minor,
        currency, requested_payment_channel, confirmed_payment_method, status, paid_at, confirming_admin_id)
     VALUES ('single_class_booking', $1, 'live_capture', $2, 'confirmed', 'exact', 'creation_snapshot',
             $3, 0, $3, $3, 0, 'EGP', 'pay_at_studio', 'cash', 'paid', $2, $4)
     RETURNING id`,
    [bookingId, nowIso, paidAmountMinor, superAdminId],
  );
  return { id: row.rows[0].id as number };
}

async function refundRowForBooking(bookingId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT pr.* FROM payment_refunds pr
     JOIN payment_records rec ON rec.id = pr.payment_record_id
     WHERE rec.booking_id = $1`,
    [bookingId],
  );
  return result.rows[0];
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const bookingsRouter = (await import("./bookings")).default;
  const bookingRefundsRouter = (await import("./bookingRefunds")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  app.use("/api", bookingRefundsRouter);
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
       VALUES ($1, $2, 'x', 'Booking Cutoff Super', true) RETURNING id`,
      [`booking-cutoff-super-${run}`, `booking-cutoff-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Booking Cutoff Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Booking Cutoff Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
});

after(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// Each test creates its OWN schedule with a startTime baked to the exact
// Cairo wall-clock moment "now + offsetMinutes" so the cutoff boundary is
// exercised against the real server clock, not a mocked one.
async function makeScheduleAtOffset(offsetMinutes: number): Promise<number> {
  const { date, time } = cairoOccurrenceAtOffset(offsetMinutes);
  const row = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp) VALUES ($1, 'one_time', 'active', $2, $3, '23:59', 300) RETURNING id`,
    [classId, date, time],
  );
  return row.rows[0].id as number;
}

test("far in advance (3h) — a paid pay_at_studio booking can self-cancel and opens a full-amount refund request", async () => {
  scheduleId = await makeScheduleAtOffset(3 * 60);
  const { date } = cairoOccurrenceAtOffset(3 * 60);
  const student = await makeStudent("far");
  const booking = await makeBooking({ studentEmail: student.email, studentId: student.id, occurrenceDate: date, paymentMode: "pay_at_studio", paymentStatus: "paid" });
  await makePaidPaymentRecord(booking.id, 35000);

  const res = await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.bookingStatus, "cancelled");
  assert.equal(res.headers.get("x-booking-refund-opened"), "true");

  const refund = await refundRowForBooking(booking.id);
  assert.ok(refund, "expected an auto-opened payment_refunds row");
  assert.equal(refund!.status, "underReview");
  assert.equal(refund!.requested_amount_minor, 35000);
  assert.equal(refund!.refund_method, "cash");
});

test("1h 59m before start — blocked with cancellation_window_closed, no refund opened, booking stays confirmed", async () => {
  scheduleId = await makeScheduleAtOffset(119);
  const { date } = cairoOccurrenceAtOffset(119);
  const student = await makeStudent("close");
  const booking = await makeBooking({ studentEmail: student.email, studentId: student.id, occurrenceDate: date, paymentMode: "pay_at_studio", paymentStatus: "paid" });
  await makePaidPaymentRecord(booking.id, 35000);

  const res = await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.code, "cancellation_window_closed");

  const refund = await refundRowForBooking(booking.id);
  assert.equal(refund, undefined, "no refund must be opened for a blocked cancellation attempt");
  const row = await pool.query(`SELECT booking_status FROM bookings WHERE id = $1`, [booking.id]);
  assert.equal(row.rows[0].booking_status, "confirmed");
});

test("an unpaid pay_at_studio booking cancels within the window but opens no refund — nothing was collected", async () => {
  scheduleId = await makeScheduleAtOffset(3 * 60);
  const { date } = cairoOccurrenceAtOffset(3 * 60);
  const student = await makeStudent("unpaid");
  const booking = await makeBooking({ studentEmail: student.email, studentId: student.id, occurrenceDate: date, paymentMode: "pay_at_studio", paymentStatus: "pending_payment" });
  // pending_confirmation payment_records row (never paid) — created the same way POST /bookings would.
  await pool.query(
    `INSERT INTO payment_records
       (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, refunded_amount_minor,
        currency, requested_payment_channel, status)
     VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 35000, 0, 35000, 0, 0, 'EGP', 'pay_at_studio', 'pending_confirmation')`,
    [booking.id],
  );

  const res = await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("x-booking-refund-opened"), null);
  const refund = await refundRowForBooking(booking.id);
  assert.equal(refund, undefined, "no refund must be fabricated for a booking that was never paid");
});

test("cancelling an already-cancelled booking is idempotent and never opens a second refund", async () => {
  scheduleId = await makeScheduleAtOffset(3 * 60);
  const { date } = cairoOccurrenceAtOffset(3 * 60);
  const student = await makeStudent("dup");
  const booking = await makeBooking({ studentEmail: student.email, studentId: student.id, occurrenceDate: date, paymentMode: "pay_at_studio", paymentStatus: "paid" });
  await makePaidPaymentRecord(booking.id, 20000);

  const first = await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  assert.equal(first.status, 200);
  const second = await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  assert.equal(second.status, 200);

  const result = await pool.query(
    `SELECT count(*)::int AS n FROM payment_refunds pr JOIN payment_records rec ON rec.id = pr.payment_record_id WHERE rec.booking_id = $1`,
    [booking.id],
  );
  assert.equal(result.rows[0].n, 1, "exactly one refund row must exist even after a repeated cancel call");
});

test("admin approve -> complete moves the refund to refunded, updates payment_records, and is idempotent on retry", async () => {
  scheduleId = await makeScheduleAtOffset(3 * 60);
  const { date } = cairoOccurrenceAtOffset(3 * 60);
  const student = await makeStudent("complete");
  const booking = await makeBooking({ studentEmail: student.email, studentId: student.id, occurrenceDate: date, paymentMode: "pay_at_studio", paymentStatus: "paid" });
  await makePaidPaymentRecord(booking.id, 40000);
  await asStudent(studentToken(student.id, student.email), `/api/bookings/${booking.id}/cancel`, { method: "PATCH" });
  const refund = await refundRowForBooking(booking.id);
  assert.ok(refund);

  const approveRes = await asAdmin(`/api/admin/booking-refunds/${refund!.id}/approve`, { method: "POST", body: JSON.stringify({}) });
  assert.equal(approveRes.status, 200);

  const completionKey = crypto.randomUUID();
  // provider_reference is unique per event_type at the DB level — must be
  // unique per test run, not a hardcoded literal, since this disposable DB
  // persists across repeated local test runs.
  const transactionReference = `TEST-REF-${crypto.randomUUID()}`;
  const completeBody = JSON.stringify({ completionIdempotencyKey: completionKey, transactionReference });
  const completeRes1 = await asAdmin(`/api/admin/booking-refunds/${refund!.id}/complete`, { method: "POST", body: completeBody });
  assert.equal(completeRes1.status, 200);
  const completeBody1 = await jsonBody(completeRes1);
  assert.equal((completeBody1.refund as Record<string, unknown>).status, "refunded");
  assert.equal((completeBody1.refund as Record<string, unknown>).refundedAmountMinor, 40000);

  // Retried completion with the SAME evidence is idempotent, not an error.
  const completeRes2 = await asAdmin(`/api/admin/booking-refunds/${refund!.id}/complete`, { method: "POST", body: completeBody });
  assert.equal(completeRes2.status, 200);

  const record = await pool.query(`SELECT status, refunded_amount_minor, paid_amount_minor FROM payment_records WHERE booking_id = $1`, [booking.id]);
  assert.equal(record.rows[0].status, "refunded");
  assert.equal(record.rows[0].refunded_amount_minor, 40000);
  assert.equal(record.rows[0].refunded_amount_minor, record.rows[0].paid_amount_minor, "refund never exceeds amount paid");

  const bookingRow = await pool.query(`SELECT payment_status FROM bookings WHERE id = $1`, [booking.id]);
  assert.equal(bookingRow.rows[0].payment_status, "refunded");
});
