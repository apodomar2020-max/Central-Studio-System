/**
 * Real-route integration coverage for the full Studio walk-in flow through
 * the Unified Attendance Gateway (Finance Phase 2B-4, complete slice):
 *
 *   1. POST /admin/attendance/resolve returns walk-in candidates
 *      (bookingId: null) for schedules with an open attendance window,
 *      including the server-resolved display price.
 *   2. POST /admin/attendance/confirm, given a walk-in candidateKey +
 *      scheduleId, atomically creates the synthetic booking + attendance +
 *      payment_records + payment_events for a Paid confirmation, or
 *      creates nothing for Not Paid, or routes through the EXISTING
 *      Package Credit flow untouched when paymentMode=package_credit.
 *
 * Boots the real Express app (attendance router unused here — this exercises
 * adminAttendanceGateway.ts directly) over HTTP; never calls route-internal
 * helpers, matching the established convention.
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
process.env.API_SECRET_KEY = "test-api-secret-key";
process.env.STUDENT_JWT_SECRET = "test-student-secret";
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
let overridePriceScheduleId: number;
const OVERRIDE_PRICE_EGP = 450;
let studioDefaultPriceEgp: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `gw-walkin-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

function studentToken(studentId: number, email: string): string {
  return jwtSign(
    { sub: studentId, email, type: "student", emailVerified: true },
    "test-student-secret",
  );
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

async function asStudent(studentId: number, email: string, path: string): Promise<Response> {
  return fetch(apiUrl(path), {
    headers: {
      authorization: `Bearer ${studentToken(studentId, email)}`,
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

let studentCounter = 0;
async function makeStudent(phone: string): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `gw-walkin-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, $3, 'parent', true) RETURNING id`,
    [`Gateway Walkin Test ${studentCounter}`, email, phone],
  );
  return { id: result.rows[0].id as number, email, name: `Gateway Walkin Test ${studentCounter}` };
}

async function activateSelfOrder(orderId: number, studentId: number, credits = 8): Promise<void> {
  await pool.query(
    `UPDATE package_orders SET participant_type = 'self' WHERE id = $1`,
    [orderId],
  );
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_activated', $3, 0, $3, 'test')`,
    [orderId, studentId, credits],
  );
}

function uniquePhone(): string {
  studentCounter += 1;
  const suffix = String(Date.now() % 10_000_000).padStart(7, "0") + String(studentCounter).padStart(2, "0");
  return `01${suffix}`;
}

// Cairo "now" — schedule fixtures below are built to have an open window
// at the wall-clock time the test actually runs, using a wide-open
// one_time schedule dated today (00:00-23:59), matching the pattern
// already proven in attendance.studioWalkInCapture.integration.test.ts.
// Deterministic teardown: mock the push module rather than polling
// notification_delivery_logs. Both performStudioWalkIn's post-commit
// dispatchStudioWalkInPush and performBookingCheckIn's (package-credit
// path) setTimeout(0)-scheduled createStudentNotification pushes ultimately
// call sendPushNotification — replacing it with an in-process counter spy
// avoids the race where the real fire-and-forget notification_delivery_logs
// insert lands after this suite's pool.end(), which previously caused
// intermittent "asynchronous activity after the test ended" failures. Same
// established pattern as attendance.studioWalkInNotificationPostCommit and
// attendance.studioWalkInCapture.zeroWriter integration suites.
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
  const gatewayRouter = (await import("./adminAttendanceGateway")).default;
  const bookingsRouter = (await import("./bookings")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", gatewayRouter);
  app.use("/api", bookingsRouter);
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
       VALUES ($1, $2, 'x', 'Gateway Walkin Super', true) RETURNING id`,
      [`gw-walkin-super-${run}`, `gw-walkin-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Gateway Walkin Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Gateway Walkin Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp) VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59', NULL) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;

  // A second schedule WITH an explicit priceEgp override, to prove the
  // price-binding guard binds to the schedule-level override (not just the
  // Studio-wide fallback the other fixture schedule uses).
  const overrideSchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp) VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59', $2) RETURNING id`,
    [classId, OVERRIDE_PRICE_EGP],
  );
  overridePriceScheduleId = overrideSchedule.rows[0].id as number;

  const pricingSettings = await pool.query(
    `INSERT INTO class_pricing_settings (id, single_class_price_egp) VALUES (1, 275)
     ON CONFLICT (id) DO UPDATE SET single_class_price_egp = 275
     RETURNING single_class_price_egp`,
  );
  studioDefaultPriceEgp = pricingSettings.rows[0].single_class_price_egp as number;
});

let expectedPushCalls = 0;

after(async () => {
  await waitForPushCalls(expectedPushCalls);
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

async function resolveWalkInCandidate(
  phone: string,
  childId: number | null = null,
  forScheduleId: number = scheduleId,
): Promise<Record<string, unknown>> {
  const res = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: phone }),
  });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  const accounts = body.accounts as Array<{ candidates: Array<Record<string, unknown>> }>;
  const candidate = accounts[0]?.candidates.find((c) =>
    c.bookingId == null && c.scheduleId === forScheduleId && c.walkinChildId === childId);
  assert.ok(candidate, "a walk-in candidate for this schedule/participant must be returned by resolve()");
  return candidate!;
}

test("resolve() returns a walk-in candidate with the server-resolved display price for an open-window schedule", async () => {
  const phone = uniquePhone();
  await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);
  assert.equal(candidate.walkinPriceEgp, studioDefaultPriceEgp);
  assert.equal(candidate.eligibility, "eligible");
});

test("the booking participant-candidates HTTP endpoint evaluates canonical DOB on the exact server occurrence", async () => {
  const phone = uniquePhone();
  const parent = await makeStudent(phone);
  await pool.query(`UPDATE students SET date_of_birth = '1990-01-01' WHERE id = $1`, [parent.id]);
  const occurrence = new Date();
  occurrence.setUTCDate(occurrence.getUTCDate() + 1);
  const occurrenceDate = occurrence.toISOString().slice(0, 10);
  const birthdayAtAge = (age: number): string => {
    const date = new Date(`${occurrenceDate}T12:00:00Z`);
    date.setUTCFullYear(date.getUTCFullYear() - age);
    return date.toISOString().slice(0, 10);
  };
  const children = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth)
     VALUES ($1, 'Boundary Five', $2), ($1, 'Boundary Thirteen', $3)
     RETURNING id, full_name`,
    [parent.id, birthdayAtAge(5), birthdayAtAge(13)],
  );
  const instructor = await pool.query(
    `INSERT INTO instructors (name, is_active) VALUES ($1, true) RETURNING id`,
    [`Booking Candidates Instructor ${Date.now()}`],
  );
  const klass = await pool.query(
    `INSERT INTO classes
      (title, category, instructor_id, is_active, allow_all_ages, min_age, max_age)
     VALUES ($1, 'general', $2, true, false, 5, 12) RETURNING id`,
    [`Booking Candidates Kids ${Date.now()}`, instructor.rows[0].id],
  );
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time)
     VALUES ($1, 'one_time', 'active', $2, '10:00', '11:00') RETURNING id`,
    [klass.rows[0].id, occurrenceDate],
  );

  const response = await asStudent(
    parent.id,
    parent.email,
    `/api/bookings/participant-candidates?scheduleId=${schedule.rows[0].id}&occurrenceDate=${occurrenceDate}`,
  );
  assert.equal(response.status, 200);
  assert.match(response.headers.get("cache-control") ?? "", /private/i);
  const body = await jsonBody(response);
  const candidates = body.candidates as Array<Record<string, unknown>>;
  const self = candidates.find((row) => row.participantType === "self");
  const ageFive = candidates.find((row) => row.participantChildId === children.rows[0].id);
  const ageThirteen = candidates.find((row) => row.participantChildId === children.rows[1].id);
  assert.deepEqual(
    { eligible: self?.eligible, reasonCode: self?.reasonCode },
    { eligible: false, reasonCode: "ABOVE_MAXIMUM_AGE" },
  );
  assert.deepEqual(
    { age: ageFive?.ageOnOccurrenceDate, eligible: ageFive?.eligible, reasonCode: ageFive?.reasonCode },
    { age: 5, eligible: true, reasonCode: "ELIGIBLE" },
  );
  assert.deepEqual(
    { age: ageThirteen?.ageOnOccurrenceDate, eligible: ageThirteen?.eligible, reasonCode: ageThirteen?.reasonCode },
    { age: 13, eligible: false, reasonCode: "ABOVE_MAXIMUM_AGE" },
  );

  const stale = await asStudent(
    parent.id,
    parent.email,
    `/api/bookings/participant-candidates?scheduleId=${schedule.rows[0].id}&occurrenceDate=2099-01-01`,
  );
  assert.equal(stale.status, 409);
});

test("an age-ineligible participant is disabled by discovery and rejected again at the transactional walk-in boundary", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  await pool.query(`UPDATE students SET date_of_birth = '1990-01-01' WHERE id = $1`, [student.id]);
  const instructor = await pool.query(
    `INSERT INTO instructors (name, is_active) VALUES ($1, true) RETURNING id`,
    [`Gateway Kids Instructor ${Date.now()}`],
  );
  const klass = await pool.query(
    `INSERT INTO classes
      (title, category, instructor_id, is_active, allow_all_ages, min_age, max_age)
     VALUES ($1, 'general', $2, true, false, 5, 12) RETURNING id`,
    [`Gateway Kids Class ${Date.now()}`, instructor.rows[0].id],
  );
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time)
     VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59') RETURNING id`,
    [klass.rows[0].id],
  );
  const candidate = await resolveWalkInCandidate(phone, null, schedule.rows[0].id);
  assert.equal(candidate.eligibility, "participant_not_eligible");

  const before = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM bookings WHERE account_owner_student_id = $1 AND schedule_id = $2) AS bookings,
       (SELECT count(*)::int FROM attendance WHERE student_id = $1 AND schedule_id = $2) AS attendance,
       (SELECT count(*)::int FROM payment_records WHERE student_id = $1) AS payments`,
    [student.id, schedule.rows[0].id],
  );
  const response = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      program: "studio",
      accountId: student.id,
      source: "phone",
      scheduleId: schedule.rows[0].id,
      paymentMode: "pay_at_studio",
      paid: true,
      confirmedPaymentMethod: "cash",
    }),
  });
  assert.equal(response.status, 409);
  const body = await jsonBody(response);
  assert.equal(body.error, "WALKIN_PARTICIPANT_INELIGIBLE");
  const after = await pool.query(
    `SELECT
       (SELECT count(*)::int FROM bookings WHERE account_owner_student_id = $1 AND schedule_id = $2) AS bookings,
       (SELECT count(*)::int FROM attendance WHERE student_id = $1 AND schedule_id = $2) AS attendance,
       (SELECT count(*)::int FROM payment_records WHERE student_id = $1) AS payments`,
    [student.id, schedule.rows[0].id],
  );
  assert.deepEqual(after.rows[0], before.rows[0]);
});

test("a paid walk-in confirm through the gateway atomically creates booking, attendance, payment record, and event", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1; // performStudioWalkIn's post-commit push dispatch
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;
  assert.equal(attendance.paid, true);
  assert.equal(attendance.finalPayableAmountMinor, studioDefaultPriceEgp * 100);

  const record = await pool.query(`SELECT * FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rowCount, 1);
  assert.equal(record.rows[0].flow_type, "studio_walkin");
  assert.equal(record.rows[0].status, "paid");
  assert.equal(record.rows[0].confirmed_payment_method, "cash");
  assert.equal(record.rows[0].confirming_admin_id, superAdminId);

  const events = await pool.query(`SELECT * FROM payment_events WHERE payment_record_id = $1`, [record.rows[0].id]);
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0].event_type, "created_and_confirmed");
  assert.equal(events.rows[0].actor_admin_id, superAdminId);
});

test("Paid without an explicit payment method is rejected with zero writes", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);
  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      program: "studio",
      accountId: student.id,
      source: "phone",
      scheduleId,
      paymentMode: "pay_at_studio",
      paid: true,
    }),
  });
  assert.equal(res.status, 400);
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("a pending existing booking is returned explicitly and suppresses Walk-in fallback", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const cairoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const booking = await pool.query(
    `INSERT INTO bookings
      (student_name, student_email, account_owner_student_id, participant_type, booking_scope,
       schedule_id, class_id, occurrence_date, payment_mode, payment_status, booking_status, status)
     VALUES ($1, $2, $3, 'self', 'self', $4, $5, $6, 'pay_at_studio', 'pending_payment', 'pending', 'pendingPayment')
     RETURNING id`,
    [student.name, student.email, student.id, scheduleId, classId, cairoDate],
  );
  const res = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: phone }),
  });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  const accounts = body.accounts as Array<{ candidates: Array<Record<string, unknown>> }>;
  const candidates = accounts[0].candidates;
  const booked = candidates.find((candidate) => candidate.bookingId === booking.rows[0].id);
  assert.ok(booked);
  assert.equal(booked!.bookingState, "payment_required");
  assert.equal(booked!.eligibility, "booking_payment_required");
  assert.equal(
    candidates.some((candidate) => candidate.bookingId == null && candidate.scheduleId === scheduleId),
    false,
    "a known pending booking must block account-wide Walk-in fallback for that occurrence",
  );
});

for (const method of ["cash", "card"] as const) {
  test(`an existing Pay-at-Studio booking is settled in place with ${method} and creates no replacement booking`, async () => {
    const phone = uniquePhone();
    const student = await makeStudent(phone);
    const cairoDate = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Africa/Cairo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
    const booking = await pool.query(
      `INSERT INTO bookings
        (student_name, student_email, account_owner_student_id, participant_type, booking_scope,
         schedule_id, class_id, occurrence_date, payment_mode, payment_status, booking_status, status)
       VALUES ($1, $2, $3, 'self', 'self', $4, $5, $6, 'pay_at_studio', 'pending_payment', 'pending', 'pendingPayment')
       RETURNING id`,
      [student.name, student.email, student.id, scheduleId, classId, cairoDate],
    );
    const bookingId = booking.rows[0].id as number;
    const payment = await pool.query(
      `INSERT INTO payment_records
        (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
         gross_amount_minor, discount_amount_minor, final_payable_amount_minor, paid_amount_minor, refunded_amount_minor,
         currency, requested_payment_channel, raw_requested_channel, status, student_id, participant_type)
       VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot',
               $2, 0, $2, 0, 0, 'EGP', 'pay_at_studio', 'pay_at_studio', 'pending_confirmation', $3, 'self')
       RETURNING id`,
      [bookingId, studioDefaultPriceEgp * 100, student.id],
    );
    await pool.query(
      `INSERT INTO payment_events (payment_record_id, event_type, new_status)
       VALUES ($1, 'created', 'pending_confirmation')`,
      [payment.rows[0].id],
    );

    const resolve = await asAdmin("/api/admin/attendance/resolve", {
      method: "POST",
      body: JSON.stringify({ source: "phone", query: phone }),
    });
    assert.equal(resolve.status, 200);
    const resolved = await jsonBody(resolve);
    const candidate = (resolved.accounts as Array<{ candidates: Array<Record<string, unknown>> }>)[0]
      .candidates.find((row) => row.bookingId === bookingId);
    assert.ok(candidate);
    const confirmation = await asAdmin("/api/admin/attendance/confirm", {
      method: "POST",
      body: JSON.stringify({
        candidateKey: candidate!.candidateKey,
        program: "studio",
        accountId: student.id,
        source: "phone",
        bookingId,
        confirmedPaymentMethod: method,
      }),
    });
    assert.equal(confirmation.status, 201);
    expectedPushCalls += 1;

    const bookings = await pool.query(`SELECT booking_status, payment_status FROM bookings WHERE id = $1`, [bookingId]);
    assert.equal(bookings.rows[0].booking_status, "attended");
    assert.equal(bookings.rows[0].payment_status, "paid");
    const bookingCount = await pool.query(
      `SELECT count(*)::int AS n FROM bookings WHERE account_owner_student_id = $1 AND schedule_id = $2 AND occurrence_date = $3`,
      [student.id, scheduleId, cairoDate],
    );
    assert.equal(bookingCount.rows[0].n, 1);
    const attendance = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [bookingId]);
    assert.equal(attendance.rows[0].n, 1);
    const paymentState = await pool.query(
      `SELECT status, confirmed_payment_method FROM payment_records WHERE id = $1`,
      [payment.rows[0].id],
    );
    assert.equal(paymentState.rows[0].status, "paid");
    assert.equal(paymentState.rows[0].confirmed_payment_method, method);
    const creditRows = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE booking_id = $1`, [bookingId]);
    assert.equal(creditRows.rows[0].n, 0);
  });
}

test("a pending package booking checks in against its original deduction without a second credit or payment", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const cairoDate = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Cairo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active)
     VALUES ($1, 'per_class', 1000, 8, 6, true) RETURNING id`,
    [`Gateway Existing Booking Package ${Date.now()}`],
  );
  const order = await pool.query(
    `INSERT INTO package_orders
      (student_name, student_email, student_id, participant_type, package_id, package_name,
       total_credits, remaining_credits, status, expires_at)
     VALUES ($1, $2, $3, 'self', $4, 'Gateway Existing Booking Package', 8, 7, 'active', now() + interval '6 months')
     RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  const booking = await pool.query(
    `INSERT INTO bookings
      (student_name, student_email, account_owner_student_id, participant_type, booking_scope,
       schedule_id, class_id, occurrence_date, payment_mode, payment_status, booking_status, status, package_order_id)
     VALUES ($1, $2, $3, 'self', 'self', $4, $5, $6, 'package_credit', 'not_required', 'pending', 'pendingPayment', $7)
     RETURNING id`,
    [student.name, student.email, student.id, scheduleId, classId, cairoDate, order.rows[0].id],
  );
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, booking_id, type, delta,
       balance_before, balance_after, created_by)
     VALUES
      ($1, $2, 'self', NULL, 'package_activated', 8, 0, 8, 'test'),
      ($1, $2, 'self', $3, 'booking_deduction', -1, 8, 7, 'test')`,
    [order.rows[0].id, student.id, booking.rows[0].id],
  );

  const resolve = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: phone }),
  });
  assert.equal(resolve.status, 200);
  const resolved = await jsonBody(resolve);
  const candidate = (resolved.accounts as Array<{ candidates: Array<Record<string, unknown>> }>)[0]
    .candidates.find((row) => row.bookingId === booking.rows[0].id);
  assert.ok(candidate);
  assert.equal(candidate!.bookingState, "package_pending");

  const confirmation = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate!.candidateKey,
      program: "studio",
      accountId: student.id,
      source: "phone",
      bookingId: booking.rows[0].id,
    }),
  });
  assert.equal(confirmation.status, 201);
  expectedPushCalls += 1;
  const credits = await pool.query(
    `SELECT type, delta FROM credit_transactions WHERE package_order_id = $1 ORDER BY id`,
    [order.rows[0].id],
  );
  assert.deepEqual(credits.rows, [
    { type: "package_activated", delta: 8 },
    { type: "booking_deduction", delta: -1 },
  ]);
  const remaining = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [order.rows[0].id]);
  assert.equal(remaining.rows[0].remaining_credits, 7);
  const payments = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [booking.rows[0].id]);
  assert.equal(payments.rows[0].n, 0);
  const attendance = await pool.query(`SELECT credit_deducted, package_order_id FROM attendance WHERE booking_id = $1`, [booking.rows[0].id]);
  assert.equal(attendance.rowCount, 1);
  assert.equal(attendance.rows[0].credit_deducted, false);
  assert.equal(attendance.rows[0].package_order_id, order.rows[0].id);
});

test("Not Paid through the gateway creates no rows", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: false,
    }),
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_not_paid");
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("a Package Credit walk-in through the gateway reuses the existing credit flow and creates no monetary Finance rows", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('GW Walkin Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'GW Walkin Pkg', 8, 8, 'active') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  await activateSelfOrder(order.rows[0].id, student.id);
  const candidate = await resolveWalkInCandidate(phone);

  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "package_credit", packageOrderId: order.rows[0].id,
    }),
  });
  assert.equal(res.status, 201);
  // performBookingCheckIn's Step 9: "Checked in" + "Credit used" notifications
  // (remainingCredits goes 8 -> 7, not exhausted, so no third notification).
  expectedPushCalls += 2;
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n, "no monetary Finance rows for a package-credit walk-in");

  const remaining = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [order.rows[0].id]);
  assert.equal(remaining.rows[0].remaining_credits, 7);
});

test("a stale/mismatched candidateKey is rejected before any write", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  await resolveWalkInCandidate(phone); // resolve, but then submit a bogus key

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: "studioWalkin:999999:1:2099-01-01", program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
    }),
  });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "candidate_key_mismatch");
});

test("resolve() returns a walk-in candidate for a child, distinct from the parent's own candidate", async () => {
  const phone = uniquePhone();
  const parent = await makeStudent(phone);
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'GW Walkin Child', '2015-01-01') RETURNING id`,
    [parent.id],
  );
  const childId = child.rows[0].id as number;

  const res = await asAdmin("/api/admin/attendance/resolve", {
    method: "POST",
    body: JSON.stringify({ source: "phone", query: phone }),
  });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  const accounts = body.accounts as Array<{ candidates: Array<Record<string, unknown>> }>;
  const selfCandidate = accounts[0]?.candidates.find((c) => c.bookingId == null && c.scheduleId === scheduleId && c.walkinChildId == null);
  const childCandidate = accounts[0]?.candidates.find((c) => c.bookingId == null && c.scheduleId === scheduleId && c.walkinChildId === childId);
  assert.ok(selfCandidate, "the parent's own walk-in candidate must still be present");
  assert.ok(childCandidate, "a separate walk-in candidate for the child must be present");
  assert.equal(childCandidate!.participantType, "child");
  assert.equal(childCandidate!.participantName, "GW Walkin Child");
  assert.notEqual(selfCandidate!.candidateKey, childCandidate!.candidateKey);
});

test("a paid child walk-in maps identity correctly: payment_records.student_id is the parent, child_id is the resolved child", async () => {
  const phone = uniquePhone();
  const parent = await makeStudent(phone);
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'GW Walkin Child 2', '2015-01-01') RETURNING id`,
    [parent.id],
  );
  const childId = child.rows[0].id as number;
  const candidate = await resolveWalkInCandidate(phone, childId);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: parent.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash", childId, expectedPriceEgp: candidate.walkinPriceEgp,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1; // performStudioWalkIn's post-commit push dispatch
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;

  const record = await pool.query(`SELECT student_id, child_id FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rows[0].student_id, parent.id);
  assert.equal(record.rows[0].child_id, childId);
});

test("an owned child package walk-in deducts only that child's entitlement", async () => {
  const phone = uniquePhone();
  const parent = await makeStudent(phone);
  const child = await pool.query(
    `INSERT INTO children (parent_id, full_name, date_of_birth)
     VALUES ($1, 'Gateway Package Child', '2014-07-30') RETURNING id`,
    [parent.id],
  );
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active)
     VALUES ('Gateway Child Package', 'per_class', 1000, 3, 6, true) RETURNING id`,
  );
  const order = await pool.query(
    `INSERT INTO package_orders
      (student_name, student_email, student_id, package_id, package_name, total_credits,
       remaining_credits, status, participant_type, participant_child_id)
     VALUES ('Gateway Package Child', $1, $2, $3, 'Gateway Child Package', 3, 3,
       'active', 'child', $4) RETURNING id`,
    [parent.email, parent.id, pkg.rows[0].id, child.rows[0].id],
  );
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, participant_child_id, type,
       delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'child', $3, 'package_activated', 3, 0, 3, 'test')`,
    [order.rows[0].id, parent.id, child.rows[0].id],
  );
  const candidate = await resolveWalkInCandidate(phone, child.rows[0].id);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey,
      program: "studio",
      accountId: parent.id,
      source: "phone",
      scheduleId,
      childId: child.rows[0].id,
      paymentMode: "package_credit",
      packageOrderId: order.rows[0].id,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 2;
  const [balance, attendance] = await Promise.all([
    pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [order.rows[0].id]),
    pool.query(
      `SELECT participant_type, participant_child_id, booking_id, payment_source
       FROM attendance WHERE package_order_id = $1`,
      [order.rows[0].id],
    ),
  ]);
  assert.equal(balance.rows[0].remaining_credits, 2);
  assert.deepEqual(attendance.rows[0], {
    participant_type: "child",
    participant_child_id: child.rows[0].id,
    booking_id: null,
    payment_source: "walk_in_package_credit",
  });
});

test("an unrelated child id (belonging to a different parent) is rejected before any write", async () => {
  const phoneA = uniquePhone();
  const phoneB = uniquePhone();
  const parentA = await makeStudent(phoneA);
  const parentB = await makeStudent(phoneB);
  const childOfB = await pool.query(
    `INSERT INTO children (parent_id, full_name, birthday) VALUES ($1, 'Not Yours', '2015-01-01') RETURNING id`,
    [parentB.id],
  );
  const candidate = await resolveWalkInCandidate(phoneA); // A's own walk-in candidate

  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: parentA.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash", childId: childOfB.rows[0].id,
    }),
  });
  // Rejected even earlier than the candidateKey check: childId ownership
  // (childrenTable.parentId === accountId) is validated first, so a
  // completely unrelated child is caught at that step, before candidateKey
  // recomputation is ever reached.
  assert.equal(res.status, 403, "an unrelated child must be rejected by the ownership check before any write");
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("a price change between resolve and confirm returns 409 walkin_price_changed and creates zero rows", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: (candidate.walkinPriceEgp as number) + 1, // stale/wrong displayed price
    }),
  });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_price_changed");
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("Paid confirms exactly the displayed price when expectedPriceEgp matches the current resolver result", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash", expectedPriceEgp: candidate.walkinPriceEgp,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1; // performStudioWalkIn's post-commit push dispatch
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;
  const record = await pool.query(`SELECT gross_amount_minor FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rows[0].gross_amount_minor, (candidate.walkinPriceEgp as number) * 100);
});

// ── Fix A: price-binding guard compares minor-unit (egpToMinor) amounts,
// never raw EGP integer equality — checkInService.ts's performStudioWalkIn,
// ~line 532. All of the tests below exercise that comparison specifically.
//
// Note: schedules.price_egp and class_pricing_settings.single_class_price_egp
// are both integer DB columns (lib/db/src/schema/schedules.ts,
// classPricingSettings.ts) — the server-resolved price itself can never be
// a non-integer EGP value. The decimal-EGP cases below therefore exercise
// what a forged/malformed client-submitted expectedPriceEgp could attempt,
// not a resolver-side rounding scenario (there isn't one to construct given
// the integer-only schema).

test("a schedule price override binds correctly through the price-binding guard", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone, null, overridePriceScheduleId);
  assert.equal(candidate.walkinPriceEgp, OVERRIDE_PRICE_EGP);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId: overridePriceScheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: candidate.walkinPriceEgp,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1;
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;
  const record = await pool.query(`SELECT gross_amount_minor FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rows[0].gross_amount_minor, OVERRIDE_PRICE_EGP * 100);
});

test("the Studio-wide fallback price binds correctly through the price-binding guard", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone); // scheduleId (fixture) has price_egp NULL -> falls back to studioDefaultPriceEgp
  assert.equal(candidate.walkinPriceEgp, studioDefaultPriceEgp);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: candidate.walkinPriceEgp,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1;
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;
  const record = await pool.query(`SELECT gross_amount_minor FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rows[0].gross_amount_minor, studioDefaultPriceEgp * 100);
});

test("a forged expectedPriceEgp that is off by a fraction of an EGP is rejected with 409, not silently rounded into agreement", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);
  const realPriceEgp = candidate.walkinPriceEgp as number;

  const before = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: realPriceEgp - 0.5, // forged: sub-EGP skew, still egpToMinor-distinct from the real price
    }),
  });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_price_changed");
  const after = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`);
  assert.equal(after.rows[0].n, before.rows[0].n);
});

test("a matching decimal-formatted expectedPriceEgp (e.g. 275.0) still binds correctly — the guard compares minor-unit values, not raw representations", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);
  const realPriceEgp = candidate.walkinPriceEgp as number;

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: realPriceEgp + 0.0, // exact-integer-valued decimal — must still bind
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 1;
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;
  const record = await pool.query(`SELECT gross_amount_minor FROM payment_records WHERE booking_id = $1`, [attendance.bookingId]);
  assert.equal(record.rows[0].gross_amount_minor, realPriceEgp * 100);
});

test("a price mismatch creates literally zero rows across every affected table (booking/attendance/payment_records/payment_events/notifications/credit_transactions)", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const countsBefore = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM bookings`),
    pool.query(`SELECT count(*)::int AS n FROM attendance`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM notifications`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions`),
  ]);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash",
      expectedPriceEgp: (candidate.walkinPriceEgp as number) + 1,
    }),
  });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_price_changed");

  const countsAfter = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM bookings`),
    pool.query(`SELECT count(*)::int AS n FROM attendance`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM notifications`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions`),
  ]);

  for (let i = 0; i < countsBefore.length; i += 1) {
    assert.equal(countsAfter[i].rows[0].n, countsBefore[i].rows[0].n, `table index ${i} must have zero new rows on a rejected price mismatch`);
  }
  // No push dispatched either — nothing was ever committed for this attempt.
});

test("a duplicate confirmation attempt (same candidate, submitted twice) produces exactly one result", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);
  const confirmBody = JSON.stringify({
    candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
    scheduleId, paymentMode: "pay_at_studio", paid: true, confirmedPaymentMethod: "cash", expectedPriceEgp: candidate.walkinPriceEgp,
  });

  const first = await asAdmin("/api/admin/attendance/confirm", { method: "POST", body: confirmBody });
  assert.equal(first.status, 201);
  expectedPushCalls += 1; // performStudioWalkIn's post-commit push dispatch (first, successful confirm only)
  const firstBody = await jsonBody(first);

  // Re-resolving after the first confirmation should no longer offer this
  // schedule as a walk-in candidate for this account (it now has an active
  // booking for the occurrence) — but even if a caller replays the exact
  // same stale candidateKey, the duplicate-attendance guard must still
  // block a second write.
  const second = await asAdmin("/api/admin/attendance/confirm", { method: "POST", body: confirmBody });
  assert.notEqual(second.status, 201, "a replayed confirmation must not create a second result");

  const records = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE booking_id = $1`, [firstBody.attendance ? (firstBody.attendance as Record<string, unknown>).bookingId : null]);
  assert.equal(records.rows[0].n, 1);
});

// ─── Finance Batch 1 Part D — package-credit re-verification, end to end ────
//
// Re-verifies the full atomic flow explicitly (not just "8 -> 7" as the
// earlier test above does): exactly one credit deducted, exactly one
// credit_transactions ledger row, exactly one attendance row, zero payment
// records, the response returns the updated balance, and a retried/
// duplicate scan does not deduct a second credit. This is unaffected by
// Part C's Admin UI labeling fix (that change is presentation-only in
// unified-attendance-dialog.tsx and does not touch this route or
// checkInService.ts), but is re-run here to confirm the core remains sound
// after that fix landed, per the corrective brief's Part D requirement.

test("Part D: package-credit walk-in deducts exactly one credit, one ledger row, one attendance row, zero payment records, and returns the updated balance", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('GW Part D Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'GW Part D Pkg', 8, 8, 'active') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  const packageOrderId = order.rows[0].id as number;
  await activateSelfOrder(packageOrderId, student.id);
  const candidate = await resolveWalkInCandidate(phone);

  const paymentRecordsBefore = await pool.query(`SELECT count(*)::int AS n FROM payment_records`);
  const ledgerBefore = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "package_credit", packageOrderId,
    }),
  });
  assert.equal(res.status, 201);
  expectedPushCalls += 2; // "Checked in" + "Credit used" (not exhausted: 8 -> 7)
  const body = await jsonBody(res);
  const attendance = body.attendance as Record<string, unknown>;

  // Response returns the updated balance directly — no separate refetch
  // needed for the admin UI to display it.
  assert.equal(attendance.remainingCredits, 7, "response must carry the POST-deduction balance");
  assert.equal(attendance.creditDeducted, true);

  const orderAfter = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(orderAfter.rows[0].remaining_credits, 7, "exactly one credit deducted");
  assert.equal(orderAfter.rows[0].status, "active");

  const ledgerAfter = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );
  assert.equal(ledgerAfter.rows[0].n, ledgerBefore.rows[0].n + 1, "exactly one ledger row inserted");

  const attendanceRows = await pool.query(
    `SELECT count(*)::int AS n FROM attendance WHERE id = $1`,
    [attendance.attendanceId],
  );
  assert.equal(attendanceRows.rows[0].n, 1, "exactly one attendance row inserted");

  const paymentRecordsAfter = await pool.query(`SELECT count(*)::int AS n FROM payment_records`);
  assert.equal(
    paymentRecordsAfter.rows[0].n,
    paymentRecordsBefore.rows[0].n,
    "a package-credit check-in must create NO payment record",
  );

  // Retry/duplicate scan of the SAME candidateKey must not deduct twice.
  const retry = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "package_credit", packageOrderId,
    }),
  });
  assert.notEqual(retry.status, 201, "a duplicate scan must be rejected, not silently re-applied");

  const orderAfterRetry = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(orderAfterRetry.rows[0].remaining_credits, 7, "retry must not deduct a second credit");

  const ledgerAfterRetry = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );
  assert.equal(ledgerAfterRetry.rows[0].n, ledgerBefore.rows[0].n + 1, "retry must not insert a second ledger row");
});

test("Part D: two concurrent package-credit check-ins for the same candidateKey result in exactly one deduction", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('GW Part D Concurrency Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'GW Part D Concurrency Pkg', 8, 8, 'active') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  const packageOrderId = order.rows[0].id as number;
  await activateSelfOrder(packageOrderId, student.id);
  const candidate = await resolveWalkInCandidate(phone);
  const confirmBody = JSON.stringify({
    candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
    scheduleId, paymentMode: "package_credit", packageOrderId,
  });

  const [first, second] = await Promise.all([
    asAdmin("/api/admin/attendance/confirm", { method: "POST", body: confirmBody }),
    asAdmin("/api/admin/attendance/confirm", { method: "POST", body: confirmBody }),
  ]);
  const statuses = [first.status, second.status].sort((a, b) => a - b);
  assert.equal(statuses[0], 201, "exactly one of the two concurrent requests must succeed");
  assert.notEqual(statuses[1], 201, "the other concurrent request must be rejected, not also succeed");
  expectedPushCalls += 2; // only the winning request's "Checked in" + "Credit used" pushes fire

  const orderAfter = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(orderAfter.rows[0].remaining_credits, 7, "concurrent duplicate requests must deduct exactly once");

  const ledgerAfter = await pool.query(
    `SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1 AND type = 'attendance_deduction'`,
    [packageOrderId],
  );
  assert.equal(ledgerAfter.rows[0].n, 1, "concurrent duplicate requests must insert exactly one ledger row");
});
