/**
 * Real-route integration coverage for Finance Phase 2B-4: Studio Walk-in
 * Atomic Monetary Capture.
 *
 * POST /attendance without a bookingId, and without a valid Package Credit,
 * now supports an explicit paid:true|false confirmation. paid:true creates
 * a synthetic booking + attendance + payment_records + payment_events
 * atomically, using the server-resolved single-class price. paid:false
 * aborts with no rows written. Omitting `paid` entirely preserves the
 * pre-existing (unpriced) walk-in behavior unchanged.
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
let scheduleOverrideId: number;
let studioDefaultPriceEgp: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `walkin-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

let studentCounter = 0;
async function makeStudent(): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `walkin-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Walk-in Test ${studentCounter}`, email],
  );
  return { id: result.rows[0].id as number, email, name: `Walk-in Test ${studentCounter}` };
}

async function totals() {
  const [bookings, attendance, records, events, walkinRecords, refunds, credits, activationEvents] = await Promise.all([
    pool.query(`SELECT count(*)::int AS n FROM bookings`),
    pool.query(`SELECT count(*)::int AS n FROM attendance`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events`),
    pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'studio_walkin'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_refunds`),
    pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE type = 'package_activated'`),
    pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE event_type = 'activation_credits_issued'`),
  ]);
  return {
    bookings: bookings.rows[0].n as number,
    attendance: attendance.rows[0].n as number,
    records: records.rows[0].n as number,
    events: events.rows[0].n as number,
    walkinRecords: walkinRecords.rows[0].n as number,
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
       VALUES ($1, $2, 'x', 'Walk-in Super', true) RETURNING id`,
      [`walkin-super-${run}`, `walkin-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Walk-in Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Walk-in Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;

  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', NULL) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;

  const scheduleOverride = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 2, '11:00', '12:00', 450) RETURNING id`,
    [classId],
  );
  scheduleOverrideId = scheduleOverride.rows[0].id as number;

  const pricingSettings = await pool.query(
    `INSERT INTO class_pricing_settings (id, single_class_price_egp) VALUES (1, 300)
     ON CONFLICT (id) DO UPDATE SET single_class_price_egp = 300
     RETURNING single_class_price_egp`,
  );
  studioDefaultPriceEgp = pricingSettings.rows[0].single_class_price_egp as number;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 300));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── Category A: happy-path paid walk-in ─────────────────────────────────────

test("a paid walk-in creates a synthetic booking, attendance, and matching Finance rows using the Studio default price", async () => {
  const student = await makeStudent();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id,
      classId, scheduleId, paid: true,
    }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.paid, true);
  assert.ok(body.bookingId);

  const record = await pool.query(`SELECT * FROM payment_records WHERE booking_id = $1 AND flow_type = 'studio_walkin'`, [body.bookingId]);
  assert.equal(record.rowCount, 1);
  const r = record.rows[0];
  assert.equal(r.package_order_id, null);
  assert.equal(r.capture_origin, "live_capture");
  assert.equal(r.evidence_class, "confirmed");
  assert.equal(r.amount_availability, "exact");
  assert.equal(r.amount_source, "creation_snapshot");
  assert.equal(r.gross_amount_minor, studioDefaultPriceEgp * 100);
  assert.equal(r.discount_amount_minor, 0);
  assert.equal(r.final_payable_amount_minor, studioDefaultPriceEgp * 100);
  assert.equal(r.paid_amount_minor, studioDefaultPriceEgp * 100);
  assert.equal(r.refunded_amount_minor, 0);
  assert.equal(r.currency, "EGP");
  assert.equal(r.requested_payment_channel, "pay_at_studio");
  assert.equal(r.raw_requested_channel, "pay_at_studio");
  assert.equal(r.confirmed_payment_method, "unknown");
  assert.equal(r.raw_confirmed_method, null);
  assert.equal(r.status, "paid");
  assert.ok(r.paid_at);
  assert.equal(r.confirming_admin_id, superAdminId);
  assert.equal(r.provider_reference, null);
  assert.equal(r.student_id, student.id);
  assert.equal(r.child_id, null);

  const events = await pool.query(`SELECT * FROM payment_events WHERE payment_record_id = $1`, [r.id]);
  assert.equal(events.rowCount, 1);
  const e = events.rows[0];
  assert.equal(e.event_type, "created_and_confirmed");
  assert.equal(e.amount_minor, studioDefaultPriceEgp * 100);
  assert.equal(e.previous_status, null);
  assert.equal(e.new_status, "paid");
  assert.equal(e.actor_type, "admin");
  assert.equal(e.actor_admin_id, superAdminId);
  assert.equal(e.credit_transaction_id, null);
  assert.equal(e.payment_refund_id, null);
  assert.equal(e.reason, "studio_walkin_paid_at_studio");

  const attendance = await pool.query(`SELECT * FROM attendance WHERE booking_id = $1`, [body.bookingId]);
  assert.equal(attendance.rowCount, 1);
  assert.equal(attendance.rows[0].student_id, student.id);
  assert.equal(attendance.rows[0].credit_deducted, false);

  const booking = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [body.bookingId]);
  assert.equal(booking.rows[0].payment_mode, "pay_at_studio");
  assert.equal(booking.rows[0].booking_status, "attended");
  assert.equal(booking.rows[0].payment_status, "paid");
});

test("a schedule-level price override is used over the Studio default, and the displayed/captured amounts agree", async () => {
  const student = await makeStudent();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: scheduleOverrideId, paid: true }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.finalPayableAmountMinor, 45000, "450 EGP override, not the 300 EGP Studio default");
  const record = await pool.query(`SELECT gross_amount_minor FROM payment_records WHERE booking_id = $1`, [body.bookingId]);
  assert.equal(record.rows[0].gross_amount_minor, 45000, "the API response and the captured Finance row must report the exact same price");
});

test("client-supplied monetary fields cannot override the server-resolved price", async () => {
  const student = await makeStudent();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true,
      priceEgp: 1, amount: 1, amountMinor: 1, grossAmountMinor: 1,
    }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.finalPayableAmountMinor, studioDefaultPriceEgp * 100);
});

test("a walk-in without a linked studentId still captures Finance rows correctly (unlinked walk-in)", async () => {
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: "unlinked-walkin@example.com", studentName: "Unlinked Walkin", classId, scheduleId, paid: true }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  const record = await pool.query(`SELECT student_id FROM payment_records WHERE booking_id = $1`, [body.bookingId]);
  assert.equal(record.rows[0].student_id, null);
});

// ─── Category B: Not Paid ─────────────────────────────────────────────────

test("Not Paid aborts the whole operation — no booking, attendance, or Finance rows", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: false }),
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_not_paid");
  const after = await totals();
  assert.deepEqual(after, before);
});

// ─── Category C: exclusions ───────────────────────────────────────────────

test("a valid Package Credit walk-in creates no monetary Finance rows, credit behavior unchanged", async () => {
  const student = await makeStudent();
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('Walkin Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Walkin Pkg', 8, 8, 'active') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  const packageOrderId = order.rows[0].id as number;

  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId,
      creditDeducted: true, packageOrderId, paid: true, // paid ignored — credit path takes priority
    }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.attendance, before.attendance + 1, "attendance must still be recorded");
  assert.equal(after.walkinRecords, before.walkinRecords, "no studio_walkin payment record for a credit walk-in");
  assert.equal(after.events, before.events, "no payment_events for a credit walk-in");

  const remaining = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(remaining.rows[0].remaining_credits, 7, "existing credit-deduction behavior must be unchanged");
});

test("omitting `paid` entirely preserves the pre-existing unpriced walk-in behavior, no Finance rows", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.attendance, before.attendance + 1);
  assert.equal(after.bookings, before.bookings, "the legacy walk-in path creates no synthetic booking");
  assert.equal(after.walkinRecords, before.walkinRecords);
  assert.equal(after.events, before.events);
});

test("an existing-booking check-in creates no studio_walkin payment record", async () => {
  const student = await makeStudent();
  // A one_time schedule dated today with an all-day window, so the
  // check-in window is guaranteed open regardless of wall-clock time.
  const todaySchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, price_egp) VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59', 300) RETURNING id`,
    [classId],
  );
  const booking = await pool.query(
    `INSERT INTO bookings (student_name, student_email, account_owner_student_id, schedule_id, class_id, occurrence_date, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, $5, CURRENT_DATE, 'confirmed', 'confirmed', 'pending_payment', 'pay_at_studio') RETURNING id`,
    [student.name, student.email, student.id, todaySchedule.rows[0].id, classId],
  );
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, bookingId: booking.rows[0].id }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.walkinRecords, before.walkinRecords, "existing-booking check-in must never create a studio_walkin payment record");
});

// ─── Category D: invalid/zero price ──────────────────────────────────────

test("a zero schedule price with no valid fallback fails atomically and is not classified as waived", async () => {
  const zeroSchedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 3, '09:00', '10:00', 0) RETURNING id`,
    [classId],
  );
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: zeroSchedule.rows[0].id, paid: true }),
  });
  assert.equal(res.status, 409);
  const body = await jsonBody(res);
  assert.equal(body.error, "invalid_price_configuration");
  const after = await totals();
  assert.deepEqual(after, before, "an invalid-price walk-in must create zero rows of any kind");

  const events = await pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE event_type = 'waived'`);
  assert.equal(events.rows[0].n, 0, "an invalid-price case must never be classified as waived");
});

test("a missing schedule price with a valid Studio-default fallback still succeeds", async () => {
  const student = await makeStudent();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, paid: true }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.finalPayableAmountMinor, studioDefaultPriceEgp * 100);
});
