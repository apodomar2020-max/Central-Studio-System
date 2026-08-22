/**
 * Security H-02 regression coverage: POST /api/bookings untrusted student
 * boundary.
 *
 * Proves a verified student can no longer forge bookingStatus, the legacy
 * `status` alias, paymentStatus, or bookedAt on booking creation — those
 * fields are accepted syntactically (hybrid backward compatibility with
 * already-installed clients) but their VALUES are never trusted; the server
 * always assigns its own lifecycle values regardless of what's submitted.
 *
 * Boots the actual Express router and real student auth middleware over
 * HTTP, exactly like bookings.creationCapture.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_BOOKING_SECURITY_BOUNDARY_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_booking_security_boundary";

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
let capacityOneClassId: number;
let capacityOneScheduleId: number;
let ordersCreated = 0;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

let studentCounter = 0;
async function makeStudent(label: string): Promise<{ id: number; email: string }> {
  studentCounter += 1;
  const email = `booking-security-${Date.now()}-${studentCounter}-${label}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, date_of_birth, email_verified) VALUES ($1, $2, '0100000000', 'student', '1990-01-01', true) RETURNING id`,
    [`Booking Security Test ${label}`, email],
  );
  return { id: result.rows[0].id as number, email };
}

function studentToken(id: number, email: string, emailVerified = true): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified }, process.env.STUDENT_JWT_SECRET!);
}

async function asStudent(token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
  if (res.status === 201) ordersCreated += 1;
  return res;
}

async function pushDeliverySkippedCount(): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM notification_delivery_logs WHERE status = 'skipped' AND error_code = 'push_disabled'`);
  return result.rows[0].n as number;
}
let pushDeliveryBaseline = 0;
async function waitForPushDeliveryDrain(baseline: number, expectedNew: number, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const current = await pushDeliverySkippedCount();
    if (current - baseline >= expectedNew) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function bookingRow(id: number): Promise<Record<string, unknown>> {
  const result = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [id]);
  return result.rows[0];
}

async function paymentRecordForBooking(bookingId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(
    `SELECT * FROM payment_records WHERE flow_type = 'single_class_booking' AND booking_id = $1`,
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
  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Booking Security Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active, capacity) VALUES ($1, 'general', $2, true, 50) RETURNING id`,
    [`Booking Security Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;

  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', NULL) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;

  // Dedicated capacity=1 class for the seat-theft proof.
  const capClass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active, capacity) VALUES ($1, 'general', $2, true, 1) RETURNING id`,
    [`Booking Security Capacity-1 Class ${run}`, instructor.rows[0].id],
  );
  capacityOneClassId = capClass.rows[0].id as number;
  const capSchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 2, '12:00', '13:00', NULL) RETURNING id`,
    [capacityOneClassId],
  );
  capacityOneScheduleId = capSchedule.rows[0].id as number;

  await pool.query(
    `INSERT INTO class_pricing_settings (id, single_class_price_egp) VALUES (1, 350)
     ON CONFLICT (id) DO UPDATE SET single_class_price_egp = 350`,
  );

  await pool.query(`UPDATE class_capacity_settings SET enabled = true WHERE id = 1`).catch(async () => {
    await pool.query(`INSERT INTO class_capacity_settings (id, enabled) VALUES (1, true) ON CONFLICT (id) DO UPDATE SET enabled = true`).catch(() => {});
  });

  pushDeliveryBaseline = await pushDeliverySkippedCount();
});

after(async () => {
  await waitForPushDeliveryDrain(pushDeliveryBaseline, ordersCreated);
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Category A: normal-path server-assigned lifecycle state (per mode) ────

test("normal pay_at_studio booking: pending/pending_payment, payment_records pending_confirmation/paidAmountMinor=0", async () => {
  const student = await makeStudent("normal-pas");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  const row = await bookingRow(booking.id as number);
  assert.equal(row.booking_status, "pending");
  assert.equal(row.payment_status, "pending_payment");
  assert.equal(row.payment_mode, "pay_at_studio");
  const record = await paymentRecordForBooking(booking.id as number);
  assert.equal(record!.status, "pending_confirmation");
  assert.equal(record!.paid_amount_minor, 0);
});

test("normal package_credit booking: pending/not_required, correct credit deduction (0 at creation)", async () => {
  const student = await makeStudent("normal-pkg");
  const token = studentToken(student.id, student.email);
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('Sec Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`,
  );
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, participant_type, package_id, package_name, total_credits, remaining_credits, status, expires_at)
     VALUES ($1, $1, $2, 'self', $3, 'Sec Pkg', 8, 8, 'active', now() + interval '1 year') RETURNING id`,
    [student.email, student.id, pkg.rows[0].id],
  );
  const packageOrderId = order.rows[0].id as number;
  await pool.query(
    `INSERT INTO credit_transactions (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_activated', 8, 0, 8, 'test')`,
    [packageOrderId, student.id],
  );

  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "package_credit", packageOrderId }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  const row = await bookingRow(booking.id as number);
  assert.equal(row.booking_status, "pending");
  assert.equal(row.payment_status, "not_required");
  assert.equal(row.payment_mode, "package_credit");
  const orderAfter = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(orderAfter.rows[0].remaining_credits, 8);
});

test("free booking is still rejected outright (unchanged)", async () => {
  const student = await makeStudent("normal-free");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({ studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "free" }),
  });
  assert.equal(res.status, 400);
});

test("expectedPriceEgp stale-price guard is unaffected", async () => {
  const student = await makeStudent("stale-price");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      expectedPriceEgp: 1,
    }),
  });
  assert.equal(res.status, 409);
});

// ─── Category B: forged lifecycle fields are ignored ───────────────────────

test("forged bookingStatus='confirmed' is ignored: persists pending, does not reserve capacity as confirmed", async () => {
  const student = await makeStudent("forge-confirmed");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      bookingStatus: "confirmed",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.equal(booking.bookingStatus, "pending");
  const row = await bookingRow(booking.id as number);
  assert.equal(row.booking_status, "pending");
});

test("forged bookingStatus='attended' is ignored: persists pending, no attendance row created", async () => {
  const student = await makeStudent("forge-attended");
  const token = studentToken(student.id, student.email);
  const before = await pool.query(`SELECT count(*)::int AS n FROM attendance`);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      bookingStatus: "attended",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.equal(booking.bookingStatus, "pending");
  const after = await pool.query(`SELECT count(*)::int AS n FROM attendance`);
  assert.equal(after.rows[0].n, before.rows[0].n, "no attendance row must be created by booking creation");
});

test("legacy status='confirmed' is ignored: persists pending", async () => {
  const student = await makeStudent("forge-legacy-status");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      status: "confirmed",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.equal(booking.bookingStatus, "pending");
});

test("forged paymentStatus='paid' is ignored: server-derived payment status persists, payment_records stays correct, paidAmountMinor stays 0", async () => {
  const student = await makeStudent("forge-paid");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      paymentStatus: "paid",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.equal(booking.paymentStatus, "pending_payment");
  const record = await paymentRecordForBooking(booking.id as number);
  assert.equal(record!.status, "pending_confirmation");
  assert.equal(record!.paid_amount_minor, 0);
});

test("combined bookingStatus='confirmed'+paymentStatus='paid': neither takes effect", async () => {
  const student = await makeStudent("forge-combined");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      bookingStatus: "confirmed", paymentStatus: "paid",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.equal(booking.bookingStatus, "pending");
  assert.equal(booking.paymentStatus, "pending_payment");
  const record = await paymentRecordForBooking(booking.id as number);
  assert.equal(record!.status, "pending_confirmation");
  assert.equal(record!.paid_amount_minor, 0);
});

test("forged bookedAt is ignored: persisted bookedAt is server-controlled/current, not the forged value", async () => {
  const student = await makeStudent("forge-bookedat");
  const token = studentToken(student.id, student.email);
  const forgedBookedAt = "2001-01-01T00:00:00.000Z";
  const before = Date.now();
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      bookedAt: forgedBookedAt,
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  const row = await bookingRow(booking.id as number);
  const persistedBookedAt = new Date(row.booked_at as string).getTime();
  assert.notEqual(persistedBookedAt, new Date(forgedBookedAt).getTime());
  assert.ok(persistedBookedAt >= before - 5000, "bookedAt must be the server's current time, not the forged past date");
});

// ─── Category C: pre-existing regressions must still hold ──────────────────

test("accountOwnerStudentId forgery is still ignored (regression)", async () => {
  const attacker = await makeStudent("forge-owner-attacker");
  const victim = await makeStudent("forge-owner-victim");
  const token = studentToken(attacker.id, attacker.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: attacker.email, studentEmail: attacker.email, scheduleId, classId, paymentMode: "pay_at_studio",
      accountOwnerStudentId: victim.id,
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  const row = await bookingRow(booking.id as number);
  assert.equal(row.account_owner_student_id, attacker.id);
});

test("occurrenceDate forgery is still ignored (regression)", async () => {
  const student = await makeStudent("forge-occurrence");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      occurrenceDate: "2001-01-01",
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  assert.notEqual(booking.occurrenceDate, "2001-01-01");
});

test("unauthorized participantChildId is still rejected (regression)", async () => {
  const parent = await makeStudent("forge-child-parent");
  const otherParent = await makeStudent("forge-child-other");
  await pool.query(`UPDATE students SET account_type = 'parent' WHERE id = ANY($1)`, [[parent.id, otherParent.id]]);
  const otherChild = await pool.query(
    `INSERT INTO children (parent_id, full_name, birthday, date_of_birth) VALUES ($1, 'Other Child', '2015-01-01', '2015-01-01') RETURNING id`,
    [otherParent.id],
  );
  const token = studentToken(parent.id, parent.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: "x", studentEmail: parent.email, scheduleId, classId, paymentMode: "pay_at_studio",
      participantChildId: otherChild.rows[0].id,
    }),
  });
  assert.equal(res.status, 404);
});

test("unauthorized packageOrderId is still rejected (regression)", async () => {
  const attacker = await makeStudent("forge-pkg-attacker");
  const victim = await makeStudent("forge-pkg-victim");
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('Victim Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`,
  );
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, participant_type, package_id, package_name, total_credits, remaining_credits, status, expires_at)
     VALUES ($1, $1, $2, 'self', $3, 'Victim Pkg', 8, 8, 'active', now() + interval '1 year') RETURNING id`,
    [victim.email, victim.id, pkg.rows[0].id],
  );
  const token = studentToken(attacker.id, attacker.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: attacker.email, studentEmail: attacker.email, scheduleId, classId, paymentMode: "package_credit",
      packageOrderId: order.rows[0].id,
    }),
  });
  assert.notEqual(res.status, 201);
});

test("priceEgp/amountMinor are still non-authoritative (regression)", async () => {
  const student = await makeStudent("forge-price");
  const token = studentToken(student.id, student.email);
  const res = await asStudent(token, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: student.email, studentEmail: student.email, scheduleId, classId, paymentMode: "pay_at_studio",
      priceEgp: 1, amountMinor: 1,
    }),
  });
  assert.equal(res.status, 201);
  const booking = await jsonBody(res);
  const record = await paymentRecordForBooking(booking.id as number);
  assert.equal(record!.gross_amount_minor, 35000, "must come from the server price resolver (350 EGP), not the forged body");
});

// ─── Category D: capacity=1 seat-theft proof ───────────────────────────────

test("capacity=1: forged bookingStatus='confirmed' stores pending and cannot steal the seat from a legitimate booking", async () => {
  const attacker = await makeStudent("cap-attacker");
  const attackerToken = studentToken(attacker.id, attacker.email);
  const attackerRes = await asStudent(attackerToken, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: attacker.email, studentEmail: attacker.email,
      scheduleId: capacityOneScheduleId, classId: capacityOneClassId, paymentMode: "pay_at_studio",
      bookingStatus: "confirmed",
    }),
  });
  assert.equal(attackerRes.status, 201);
  const attackerBooking = await jsonBody(attackerRes);
  assert.equal(attackerBooking.bookingStatus, "pending", "forged confirmed must not persist");

  // A second, legitimate student must NOT be blocked by a fake reserved seat
  // (capacity gating in this route only counts RESERVED_SEAT_STATUSES —
  // confirmed/attended/attendance_reversed — never pending).
  const legit = await makeStudent("cap-legit");
  const legitToken = studentToken(legit.id, legit.email);
  const legitRes = await asStudent(legitToken, "/api/bookings", {
    method: "POST",
    body: JSON.stringify({
      studentName: legit.email, studentEmail: legit.email,
      scheduleId: capacityOneScheduleId, classId: capacityOneClassId, paymentMode: "pay_at_studio",
    }),
  });
  assert.equal(legitRes.status, 201, "capacity=1 seat must not have been stolen by the attacker's forged confirmed status");
  const legitBooking = await jsonBody(legitRes);
  assert.equal(legitBooking.bookingStatus, "pending");
});
