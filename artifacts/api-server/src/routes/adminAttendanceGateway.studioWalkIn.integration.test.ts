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
async function makeStudent(phone: string): Promise<{ id: number; email: string; name: string }> {
  studentCounter += 1;
  const email = `gw-walkin-${Date.now()}-${studentCounter}@example.com`;
  const result = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, $3, 'parent', true) RETURNING id`,
    [`Gateway Walkin Test ${studentCounter}`, email, phone],
  );
  return { id: result.rows[0].id as number, email, name: `Gateway Walkin Test ${studentCounter}` };
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
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", gatewayRouter);
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

test("a paid walk-in confirm through the gateway atomically creates booking, attendance, payment record, and event", async () => {
  const phone = uniquePhone();
  const student = await makeStudent(phone);
  const candidate = await resolveWalkInCandidate(phone);

  const res = await asAdmin("/api/admin/attendance/confirm", {
    method: "POST",
    body: JSON.stringify({
      candidateKey: candidate.candidateKey, program: "studio", accountId: student.id, source: "phone",
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
  assert.equal(record.rows[0].confirming_admin_id, superAdminId);

  const events = await pool.query(`SELECT * FROM payment_events WHERE payment_record_id = $1`, [record.rows[0].id]);
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0].event_type, "created_and_confirmed");
  assert.equal(events.rows[0].actor_admin_id, superAdminId);
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true, childId, expectedPriceEgp: candidate.walkinPriceEgp,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true, childId: childOfB.rows[0].id,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true, expectedPriceEgp: candidate.walkinPriceEgp,
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
      scheduleId: overridePriceScheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
      scheduleId, paymentMode: "pay_at_studio", paid: true,
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
    scheduleId, paymentMode: "pay_at_studio", paid: true, expectedPriceEgp: candidate.walkinPriceEgp,
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
