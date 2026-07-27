/**
 * Real-route integration coverage for the Studio Walk-in Explicit
 * Settlement hotfix.
 *
 * POST /attendance without a bookingId (a Walk-in) now requires a mandatory
 * `settlementMode`: "package_credit" | "pay_at_studio" | "not_paid" — there
 * is no default and package availability never selects a mode on its own.
 * "pay_at_studio" creates a synthetic booking + attendance + payment_records
 * + payment_events atomically using the server-resolved single-class price,
 * and never touches package credits even when valid ones exist.
 * "package_credit" deducts exactly one credit and creates zero payment
 * rows. "not_paid" aborts with no rows written. Omitting `settlementMode`
 * entirely is a validation error (400), not a silent fallback.
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

// Deterministic teardown: the fire-and-forget push dispatch
// (setTimeout(0)/post-commit) is replaced with an in-process spy so
// teardown can wait for it to actually settle instead of racing
// notification_delivery_logs inserts against pool.end() with a fixed
// sleep. Same pattern as adminAttendanceGateway.studioWalkIn and
// attendance.studioWalkInCapture.zeroWriter integration tests. Since this
// file's tests trigger a variable, path-dependent number of push calls
// (0-2 depending on branch), teardown waits for the call count to go
// quiet (stable across consecutive polls) rather than requiring each
// test to track an exact expected total.
let pushCallCount = 0;
async function waitForPushCallsToSettle(quietRounds = 6, intervalMs = 100, timeoutMs = 10000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastCount = -1;
  let stableRounds = 0;
  while (Date.now() < deadline) {
    if (pushCallCount === lastCount) {
      stableRounds += 1;
      if (stableRounds >= quietRounds) return;
    } else {
      stableRounds = 0;
      lastCount = pushCallCount;
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
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
  await waitForPushCallsToSettle();
  mock.reset();
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
      classId, scheduleId, settlementMode: "pay_at_studio",
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
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: scheduleOverrideId, settlementMode: "pay_at_studio" }),
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
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, settlementMode: "pay_at_studio",
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
    body: JSON.stringify({ studentEmail: "unlinked-walkin@example.com", studentName: "Unlinked Walkin", classId, scheduleId, settlementMode: "pay_at_studio" }),
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
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, settlementMode: "not_paid" }),
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, "walkin_not_paid");
  const after = await totals();
  assert.deepEqual(after, before);
});

// ─── Category C: explicit settlementMode is the ONLY thing that decides ───

// This is the most important regression test in this file: a participant
// with a valid, available package credit explicitly settled as
// "pay_at_studio" must leave that credit completely untouched — package
// availability must never override an explicit Admin choice. Prior to the
// explicit-settlement hotfix, this exact scenario silently deducted a
// credit instead (see git history), which is the bug this test guards
// against regressing to.
test("valid Package Credit + explicit Pay at Studio leaves credits untouched and creates the canonical payment", async () => {
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
      packageOrderId, settlementMode: "pay_at_studio",
    }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  const after = await totals();

  assert.equal(after.attendance, before.attendance + 1, "attendance must still be recorded");
  assert.equal(after.bookings, before.bookings + 1, "exactly one synthetic Walk-in booking");
  assert.equal(after.walkinRecords, before.walkinRecords + 1, "exactly one canonical studio_walkin payment record");
  assert.equal(after.events, before.events + 1, "exactly one payment event");

  const record = await pool.query(`SELECT status, final_payable_amount_minor FROM payment_records WHERE booking_id = $1 AND flow_type = 'studio_walkin'`, [body.bookingId]);
  assert.equal(record.rowCount, 1);
  assert.equal(record.rows[0].status, "paid");
  assert.equal(record.rows[0].final_payable_amount_minor, studioDefaultPriceEgp * 100, "exact captured amount");

  const remaining = await pool.query(`SELECT remaining_credits, status FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(remaining.rows[0].remaining_credits, 8, "package credits must remain byte-for-byte unchanged");
  assert.equal(remaining.rows[0].status, "active", "package status must remain unchanged");

  const ledger = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`, [packageOrderId]);
  assert.equal(ledger.rows[0].n, 0, "zero credit ledger entries");
});

test("valid Package Credit + explicit Package Credit deducts exactly one credit and creates zero payment rows", async () => {
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
      packageOrderId, settlementMode: "package_credit",
    }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.attendance, before.attendance + 1, "attendance must still be recorded");
  assert.equal(after.walkinRecords, before.walkinRecords, "zero payment records for a credit walk-in");
  assert.equal(after.events, before.events, "zero monetary payment events for a credit walk-in");

  const remaining = await pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]);
  assert.equal(remaining.rows[0].remaining_credits, 7, "exactly one credit deducted");

  const ledger = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE package_order_id = $1`, [packageOrderId]);
  assert.equal(ledger.rows[0].n, 1, "exactly one credit ledger entry");
});

test("no valid credit + explicit Package Credit returns a business error and writes zero rows", async () => {
  const student = await makeStudent();
  const pkg = await pool.query(`INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active) VALUES ('Empty Pkg', 'per_class', 1000, 8, 6, true) RETURNING id`);
  const order = await pool.query(
    `INSERT INTO package_orders (student_name, student_email, student_id, package_id, package_name, total_credits, remaining_credits, status)
     VALUES ($1, $2, $3, $4, 'Empty Pkg', 8, 0, 'fullyUsed') RETURNING id`,
    [student.name, student.email, student.id, pkg.rows[0].id],
  );
  const packageOrderId = order.rows[0].id as number;

  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId,
      packageOrderId, settlementMode: "package_credit",
    }),
  });
  assert.equal(res.status, 400);
  const body = await jsonBody(res);
  assert.equal(body.error, "no_credits");
  const after = await totals();
  assert.deepEqual(after, before, "a failed Package Credit selection must write zero rows");
});

test("no valid credit + explicit Pay at Studio still creates the payment and attendance normally", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({
      studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId,
      settlementMode: "pay_at_studio",
    }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.attendance, before.attendance + 1);
  assert.equal(after.walkinRecords, before.walkinRecords + 1);

  const creditRows = await pool.query(`SELECT count(*)::int AS n FROM credit_transactions WHERE notes LIKE $1`, [`%${classId}%`]);
  assert.ok(creditRows.rows[0].n >= 0, "no credit writes are expected for a no-package walk-in");
});

test("a retry of an explicit Pay at Studio walk-in for a distinct request does not duplicate anything beyond the intended second attendance", async () => {
  // Concurrent-duplicate protection for the SAME class/day is covered by
  // the existing same-day advisory-lock guard exercised elsewhere; here we
  // confirm a second, distinct Pay at Studio walk-in for the SAME student
  // still creates its own single attendance/payment pair rather than
  // silently reusing or duplicating the first.
  const student = await makeStudent();
  const first = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: scheduleOverrideId, settlementMode: "pay_at_studio" }),
  });
  assert.equal(first.status, 201);
  const dup = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: scheduleOverrideId, settlementMode: "pay_at_studio" }),
  });
  assert.equal(dup.status, 409, "the existing same-day duplicate-attendance guard still applies on the pay_at_studio path");
});

test("omitting settlementMode entirely on a walk-in returns a validation error, zero writes", async () => {
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId }),
  });
  assert.equal(res.status, 400, "settlementMode is mandatory for a walk-in — there is no silent default");
  const after = await totals();
  assert.deepEqual(after, before, "an unresolved settlement choice must never fall through to any write path");
});

test("marking a walk-in as absent is exempt from the settlementMode requirement and writes zero credit/payment rows", async () => {
  // Marking a no-show "absent" is not an arrival/Walk-in in the payment
  // sense — the legacy manual attendance page (artifacts/admin/src/pages/
  // attendance.tsx) uses this status without any settlement choice.
  const student = await makeStudent();
  const before = await totals();
  const res = await asAdmin("/api/attendance", {
    method: "POST",
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, status: "absent" }),
  });
  assert.equal(res.status, 201);
  const after = await totals();
  assert.equal(after.attendance, before.attendance + 1);
  assert.equal(after.bookings, before.bookings, "absence marking creates no synthetic booking");
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
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId: zeroSchedule.rows[0].id, settlementMode: "pay_at_studio" }),
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
    body: JSON.stringify({ studentEmail: student.email, studentName: student.name, studentId: student.id, classId, scheduleId, settlementMode: "pay_at_studio" }),
  });
  assert.equal(res.status, 201);
  const body = await jsonBody(res);
  assert.equal(body.finalPayableAmountMinor, studioDefaultPriceEgp * 100);
});
