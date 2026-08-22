/**
 * Finance Phase 2C — real-route integration coverage for
 * `confirmCanonicalPaymentRecord` as wired into PATCH /bookings/:id's
 * paymentStatus->"paid" confirmation guard (see
 * artifacts/api-server/src/lib/financeConfirmation.ts and the guard block
 * in ./bookings.ts).
 *
 * Companion to bookings.paymentConfirmation.integration.test.ts (which
 * covers the pre-existing Payment Integrity Hotfix guard) — this file
 * covers ONLY the new Finance confirmation behavior layered on top of it:
 * payment_records transitioning to "paid", the "confirmed" payment_events
 * row, the legacy_missing compatibility path, post-commit push timing, and
 * DB-failure atomicity.
 *
 * Same boot/auth/safety-gate conventions as the paymentConfirmation test
 * file and as packageOrders.financeConfirmation.integration.test.ts: real
 * Express router + real admin auth middleware over HTTP, disposable-DB
 * guard, DISPOSABLE_HOTFIX_DATABASE_URL / central_studio_disposable_hotfix.
 *
 * Investigation findings baked into this suite (mirroring the package-order
 * companion file's A19/A20 investigation, see that file's header comment
 * for the full reasoning):
 *
 *   B17/B18 (multi-record): `payment_records_flow_booking_unique` is a real
 *   unique constraint on (flow_type, booking_id) — a second payment_records
 *   row for the same booking simply cannot be inserted. Proven directly.
 *
 *   (wrong_flow_type/wrong_source_fk): confirmCanonicalPaymentRecord's own
 *   SELECT filters `WHERE flow_type = params.flowType AND booking_id =
 *   params.bookingId` before ever inspecting a row, so those two branches
 *   are unreachable dead code regardless of caller — proven with a direct
 *   call below, exactly as in the package-order companion file.
 */
import assert from "node:assert/strict";
import { after, before, test, mock } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_HOTFIX_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_hotfix";

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

type PushCall = { notificationId: number; visibleAtCallTime: boolean };
const pushCalls: PushCall[] = [];
let forceNextPushRejection = false;

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let secondAdminId: number;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(adminId = superAdminId): string {
  return jwtSign({ sub: adminId, username: `booking-finance-super-${adminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
}

function studentToken(id: number, email: string): string {
  return jwtSign({ sub: id, email, type: "student", emailVerified: true }, process.env.STUDENT_JWT_SECRET!);
}

async function asAdmin(path: string, init: RequestInit = {}, adminId?: number): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(adminId),
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function asStudentJwt(path: string, token: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), {
    ...init,
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

async function jsonBody(res: Response): Promise<Record<string, unknown>> {
  return res.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

async function confirmPaid(id: number, body: Record<string, unknown> = {}, adminId?: number): Promise<Response> {
  return asAdmin(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ paymentStatus: "paid", ...body }) }, adminId);
}

async function bookingRow(id: number): Promise<{ paymentStatus: string; bookingStatus: string; paymentMode: string | null }> {
  const result = await pool.query(`SELECT payment_status, booking_status, payment_mode FROM bookings WHERE id = $1`, [id]);
  return {
    paymentStatus: result.rows[0].payment_status,
    bookingStatus: result.rows[0].booking_status,
    paymentMode: result.rows[0].payment_mode,
  };
}

async function paymentRecordForBooking(bookingId: number): Promise<Record<string, unknown> | undefined> {
  const result = await pool.query(`SELECT * FROM payment_records WHERE flow_type = 'single_class_booking' AND booking_id = $1`, [bookingId]);
  return result.rows[0];
}

async function paymentRecordCountForBooking(bookingId: number): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM payment_records WHERE flow_type = 'single_class_booking' AND booking_id = $1`, [bookingId]);
  return result.rows[0].n as number;
}

async function paymentEventCount(paymentRecordId: number, eventType: string): Promise<number> {
  const result = await pool.query(`SELECT count(*)::int AS n FROM payment_events WHERE payment_record_id = $1 AND event_type = $2`, [paymentRecordId, eventType]);
  return result.rows[0].n as number;
}

async function waitForPushCalls(expected: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (pushCalls.length >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Creates a fresh pending-payment monetary booking WITH a canonical
 * pending_confirmation payment_records row, via the REAL POST route. */
async function makeCanonicalPendingBooking(run: string, label: string): Promise<{ id: number; studentId: number; studentEmail: string; paymentRecordId: number; finalPayableAmountMinor: number }> {
  const email = `booking-finance-${run}-${label}@example.com`;
  const student = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified) VALUES ($1, $2, '0100000000', 'student', true) RETURNING id`,
    [`Booking Finance Test ${label}`, email],
  );
  const studentId = student.rows[0].id as number;
  const token = studentToken(studentId, email);
  const res = await asStudentJwt("/api/bookings", token, {
    method: "POST",
    body: JSON.stringify({ studentName: email, studentEmail: email, scheduleId, classId, paymentMode: "pay_at_studio" }),
  });
  const booking = await jsonBody(res);
  assert.equal(res.status, 201, `setup: booking creation must succeed (got ${res.status}: ${JSON.stringify(booking)})`);
  const record = await paymentRecordForBooking(booking.id as number);
  assert.ok(record, "setup: a canonical payment_records row must exist after POST /bookings");
  return {
    id: booking.id as number,
    studentId,
    studentEmail: email,
    paymentRecordId: record!.id as number,
    finalPayableAmountMinor: record!.final_payable_amount_minor as number,
  };
}

/** Simulates a legacy/pre-Phase-2B booking: inserted directly via SQL,
 * bypassing POST /bookings, so NO payment_records row exists for it. */
async function makeLegacyPendingBooking(run: string, label: string): Promise<{ id: number; studentId: number; studentEmail: string }> {
  const studentEmail = `booking-finance-legacy-${run}-${label}@example.com`;
  const booking = await pool.query(
    `INSERT INTO bookings
       (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', 'confirmed', 'pending_payment', 'pay_at_studio')
     RETURNING id`,
    [`Booking Finance Legacy Test ${label}`, studentEmail, scheduleId, classId],
  );
  return { id: booking.rows[0].id as number, studentId: 0, studentEmail };
}

/** paymentMode-specific booking, raw-inserted, for the operational guard tests (B19-B21). */
async function makeBookingWithMode(run: string, label: string, opts: { paymentMode: string; paymentStatus: string; bookingStatus?: string }): Promise<{ id: number }> {
  const studentEmail = `booking-finance-mode-${run}-${label}@example.com`;
  const booking = await pool.query(
    `INSERT INTO bookings
       (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7)
     RETURNING id`,
    [`Booking Finance Mode Test ${label}`, studentEmail, scheduleId, classId, opts.bookingStatus ?? "confirmed", opts.paymentStatus, opts.paymentMode],
  );
  return { id: booking.rows[0].id as number };
}

async function attachFailTrigger(table: string): Promise<void> {
  await pool.query(`
    CREATE OR REPLACE FUNCTION test_inject_failure_bkgfin_${table}() RETURNS TRIGGER AS $$
    BEGIN
      RAISE EXCEPTION 'injected test failure on %', TG_TABLE_NAME;
    END;
    $$ LANGUAGE plpgsql;
  `);
  await pool.query(`
    CREATE TRIGGER test_inject_failure_bkgfin_${table}_trigger
    BEFORE UPDATE OR INSERT ON ${table}
    FOR EACH ROW EXECUTE FUNCTION test_inject_failure_bkgfin_${table}();
  `);
}
async function detachFailTrigger(table: string): Promise<void> {
  await pool.query(`DROP TRIGGER IF EXISTS test_inject_failure_bkgfin_${table}_trigger ON ${table}`);
  await pool.query(`DROP FUNCTION IF EXISTS test_inject_failure_bkgfin_${table}()`);
}

before(async () => {
  // Registered before bookings.ts (and therefore before its own
  // `import { sendPushNotification } from "../lib/pushNotifications"`) is
  // ever imported, so the router receives the mocked binding — same
  // pattern as packageOrders.financeConfirmation.integration.test.ts.
  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async (input: { notificationId?: number | null }) => {
        if (forceNextPushRejection) {
          forceNextPushRejection = false;
          throw new Error("injected test push failure");
        }
        const observerClient = await pool.connect();
        try {
          const result = await observerClient.query(`SELECT 1 FROM notifications WHERE id = $1`, [input.notificationId]);
          pushCalls.push({ notificationId: input.notificationId!, visibleAtCallTime: (result.rowCount ?? 0) > 0 });
        } finally {
          observerClient.release();
        }
        return { sent: 0, failed: 0, skipped: true, reason: "push_disabled" };
      },
      sendBroadcastPushNotification: async () => ({ sent: 0, failed: 0 }),
    },
  });

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
  const superAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Booking Finance Super', true) RETURNING id`,
    [`booking-finance-super-${run}`, `booking-finance-super-${run}@example.com`],
  );
  superAdminId = superAdmin.rows[0].id as number;
  const secondAdmin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Booking Finance Second Admin', true) RETURNING id`,
    [`booking-finance-second-${run}`, `booking-finance-second-${run}@example.com`],
  );
  secondAdminId = secondAdmin.rows[0].id as number;

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Booking Finance Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ($1, 'general', $2, true) RETURNING id`,
    [`Booking Finance Class ${run}`, instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  mock.reset();
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── B1-B4: canonical confirmation happy path ────────────────────────────

test("B1-B4: canonical pending-payment booking confirms successfully, transitions to paid with the correct amount, and sets paidAt once", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId, finalPayableAmountMinor } = await makeCanonicalPendingBooking(run, "b1");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, JSON.stringify(await jsonBody(res)));

  const record = await paymentRecordForBooking(id);
  assert.equal(record!.status, "paid");
  assert.equal(record!.paid_amount_minor, finalPayableAmountMinor);
  assert.equal(record!.final_payable_amount_minor, finalPayableAmountMinor);
  assert.ok(record!.paid_at, "paidAt must be set");
  assert.equal(record!.id, paymentRecordId);
  assert.equal((await bookingRow(id)).paymentStatus, "paid");
});

test("B5: confirmed method is stored exactly as submitted (cash and kashier)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const cash = await makeCanonicalPendingBooking(run, "method-cash");
  const kashier = await makeCanonicalPendingBooking(run, "method-kashier");

  await confirmPaid(cash.id, { confirmedPaymentMethod: "cash" });
  await confirmPaid(kashier.id, { confirmedPaymentMethod: "kashier" });

  assert.equal((await paymentRecordForBooking(cash.id))!.confirmed_payment_method, "cash");
  assert.equal((await paymentRecordForBooking(kashier.id))!.confirmed_payment_method, "kashier");
});

test("B23: confirmedPaymentMethod 'unknown' is explicitly accepted and stored exactly as 'unknown'", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b23");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "unknown" });
  assert.equal(res.status, 200);
  assert.equal((await paymentRecordForBooking(id))!.confirmed_payment_method, "unknown");
});

test("B6: confirmingAdminId is server-derived from the authenticated admin, never from a forged request body value", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b6");

  const forgedPaidAt = "2000-01-01T00:00:00.000Z";
  const res = await confirmPaid(id, {
    confirmedPaymentMethod: "cash",
    confirmingAdminId: 999_999_999,
    paidAt: forgedPaidAt,
    paidAmountMinor: 1,
  }, secondAdminId);
  assert.equal(res.status, 200);

  const record = await paymentRecordForBooking(id);
  assert.equal(record!.confirming_admin_id, secondAdminId, "confirmingAdminId must equal the AUTHENTICATED admin, not any forged body value");
  assert.notEqual(record!.confirming_admin_id, 999_999_999);
  assert.notEqual(record!.paid_at, forgedPaidAt, "the client-supplied paidAt must be ignored");
});

test("B7: exactly one 'confirmed' payment_events row is appended", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b7");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200);
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
});

test("B8: the booking's operational transition remains correct alongside the Finance write (Finance Batch 1 Part E: payment confirmation now also confirms the booking)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b8");
  const bookingStatusBefore = (await bookingRow(id)).bookingStatus;
  assert.equal(bookingStatusBefore, "pending", "setup: a freshly created direct-payment booking starts pending");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.paymentStatus, "paid");
  assert.equal(body.bookingStatus, "confirmed", "the response must report the booking as confirmed, not left pending");
  const row = await bookingRow(id);
  assert.equal(row.paymentStatus, "paid");
  // Reversed from the original assertion here (which encoded the exact bug
  // reported: paymentStatus became "paid" while bookingStatus silently
  // stayed "pending", leaving Confirm/Reject visible in the Admin UI even
  // though payment was already collected) — the Finance write and the
  // booking-status transition are now atomically one fact, not two.
  assert.equal(row.bookingStatus, "confirmed", "the Finance write must ALSO confirm the booking — this was the exact reported bug");
});

test("B9: the payment-confirmation notification (type payment_paid) is inserted exactly once", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, studentId } = await makeCanonicalPendingBooking(run, "b9");

  await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  const notifications = await pool.query(
    `SELECT count(*)::int AS n FROM notifications WHERE target = $1 AND type = 'payment_paid' AND related_entity_type = 'booking' AND related_entity_id = $2 AND is_draft = false`,
    [`student:${studentId}`, id],
  );
  assert.equal(notifications.rows[0].n, 1);
});

// ─── B10-B11: post-commit push timing ────────────────────────────────────

test("B10: push occurs only after the confirmation transaction commits", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b10");

  const before = pushCalls.length;
  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200);
  await waitForPushCalls(before + 1);

  assert.equal(pushCalls.length, before + 1, "exactly one push dispatch for this confirmation");
  assert.equal(pushCalls[pushCalls.length - 1].visibleAtCallTime, true, "the row must already be visible over an independent connection — proof of post-commit dispatch");
});

test("B11: a push failure does not roll back the confirmation", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b11");

  forceNextPushRejection = true;
  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, "the route must still return success even though the post-commit push rejects");

  const record = await paymentRecordForBooking(id);
  assert.equal(record!.status, "paid", "payment_records must still be committed");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
});

// ─── B12: repeat against an already-paid booking (pre-existing 409 still holds) ─

test("B12: repeated confirmation of an already-paid booking returns the existing 409, zero additional writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b12");

  const first = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(first.status, 200);

  const second = await confirmPaid(id, { confirmedPaymentMethod: "kashier" });
  assert.equal(second.status, 409);
  assert.equal((await jsonBody(second)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");

  assert.equal((await paymentRecordForBooking(id))!.confirmed_payment_method, "cash", "the second attempt must NOT have overwritten the first");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
});

// ─── B13: concurrency ─────────────────────────────────────────────────────

test("B13: concurrent duplicate confirmation requests produce exactly one payment_records transition and one confirmed event", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b13");

  const [a, b] = await Promise.all([
    confirmPaid(id, { confirmedPaymentMethod: "cash" }),
    confirmPaid(id, { confirmedPaymentMethod: "kashier" }),
  ]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409]);

  assert.equal((await paymentRecordForBooking(id))!.status, "paid");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 1);
  assert.equal(await paymentRecordCountForBooking(id), 1, "no second payment_records row created");
});

// ─── B14: DB-failure atomicity ────────────────────────────────────────────

test("B14: a DB failure injected during the Finance transition rolls back everything", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b14");

  await attachFailTrigger("payment_events");
  try {
    const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
    assert.notEqual(res.status, 200, "confirmation must not succeed while payment_events insert is failing");
  } finally {
    await detachFailTrigger("payment_events");
  }

  const row = await bookingRow(id);
  assert.equal(row.paymentStatus, "pending_payment", "bookings.payment_status must remain unmutated — the whole transaction rolled back");
  assert.equal((await paymentRecordForBooking(id))!.status, "pending_confirmation");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0);
});

// ─── B15-B16: legacy_missing path ─────────────────────────────────────────

test("B15: a booking with no existing payment_records row confirms via the legacy_missing path, zero payment_records rows created", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeLegacyPendingBooking(run, "b15");
  assert.equal(await paymentRecordCountForBooking(id), 0, "setup: legacy booking must have no payment_records row");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 200, JSON.stringify(await jsonBody(res)));
  assert.equal(res.headers.get("x-finance-compatibility"), "legacy_payment_record_missing");

  assert.equal((await bookingRow(id)).paymentStatus, "paid", "the operational transition must proceed normally even without a Finance record");
  assert.equal(await paymentRecordCountForBooking(id), 0, "no payment_records row may be fabricated");
});

test("B16: the legacy_missing path creates no orphan payment_events row", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeLegacyPendingBooking(run, "b16");

  await confirmPaid(id, { confirmedPaymentMethod: "cash" });

  // No payment_records row exists for this booking at all (proven in B15),
  // and payment_events.payment_record_id is a real FK into payment_records
  // — so the only way an event could exist "for" this booking is via a
  // payment_records row referencing it, which by construction cannot
  // exist. Scoped correctly this time (unlike a naive cross-table NOT
  // EXISTS, which would also match every OTHER booking's legitimate
  // events and produce a false positive).
  assert.equal(await paymentRecordCountForBooking(id), 0);
  const linkedEvents = await pool.query(
    `SELECT count(*)::int AS n FROM payment_events pe
     JOIN payment_records pr ON pr.id = pe.payment_record_id
     WHERE pr.booking_id = $1`,
    [id],
  );
  assert.equal(linkedEvents.rows[0].n, 0, "no payment_events row may exist without a corresponding payment_records row for this booking");
});

// ─── B17-B18: multi-record / mismatched-record integrity — DB-constraint findings ──
//
// FINDING (verified against lib/db/src/schema/paymentRecords.ts): the table
// carries `unique("payment_records_flow_booking_unique").on(flowType,
// bookingId)`. A second payment_records row with the SAME
// (flow_type='single_class_booking', booking_id) therefore cannot be
// inserted at all. Proven directly below (B17).
//
// wrong_flow_type/wrong_source_fk: confirmCanonicalPaymentRecord's
// matchCondition already filters `flowType = params.flowType AND
// bookingId = params.bookingId` in the SQL WHERE clause itself
// (financeConfirmation.ts). Any row the query can possibly return
// therefore already satisfies both equalities by construction — the
// `wrong_flow_type`/`wrong_source_fk` branches are unreachable given the
// current query, not merely hard to set up with today's schema
// constraints. Proven with a direct call below (B18), mirroring the
// package-order companion file's investigation.

test("B17: a second payment_records row for the same (flow_type, booking_id) is rejected by the DB unique constraint", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b17");

  await assert.rejects(
    pool.query(
      `INSERT INTO payment_records
         (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
          gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status)
       VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 30000, 0, 30000, 'pending_confirmation')`,
      [id],
    ),
    /unique|duplicate key/i,
    "a second payment_records row for the same booking_id must be rejected by payment_records_flow_booking_unique",
  );
  assert.equal(await paymentRecordCountForBooking(id), 1, "still exactly the one original row");
});

test("B18: confirmCanonicalPaymentRecord's own query pre-filters by flowType+FK, so wrong_flow_type/wrong_source_fk are unreachable even via a direct call", async () => {
  const { db } = await import("@workspace/db");
  const { confirmCanonicalPaymentRecord } = await import("../lib/financeConfirmation");

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b18");

  // Wrong flowType against a real single_class_booking row's bookingId — the
  // WHERE clause filters flow_type = 'package_purchase' up front, so the
  // row (whose flow_type is actually 'single_class_booking') is simply
  // never found, not found-then-flagged-wrong_flow_type.
  const result1 = await db.transaction(async (tx) => {
    return confirmCanonicalPaymentRecord(tx, {
      flowType: "package_purchase",
      packageOrderId: id,
      confirmedPaymentMethod: "cash",
      confirmingAdminId: superAdminId,
    });
  });
  assert.equal(result1.kind, "legacy_missing", "a flowType mismatch surfaces as 'not found', never 'wrong_flow_type'");

  // Correct flowType, wrong bookingId — same reasoning.
  const result2 = await db.transaction(async (tx) => {
    return confirmCanonicalPaymentRecord(tx, {
      flowType: "single_class_booking",
      bookingId: id + 999_999_000, // does not exist
      confirmedPaymentMethod: "cash",
      confirmingAdminId: superAdminId,
    });
  });
  assert.equal(result2.kind, "legacy_missing", "a bookingId mismatch surfaces as 'not found', never 'wrong_source_fk'");

  // Sanity: correct params against the real row succeed as "confirmed".
  const control = await db.transaction(async (tx) => {
    return confirmCanonicalPaymentRecord(tx, {
      flowType: "single_class_booking",
      bookingId: id,
      confirmedPaymentMethod: "cash",
      confirmingAdminId: superAdminId,
    });
  });
  assert.equal(control.kind, "confirmed");
});

// ─── B19-B21: pre-existing operational guards remain intact ───────────────

test("B19: a cancelled/rejected booking cannot be confirmed as paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBookingWithMode(run, "b19", { paymentMode: "pay_at_studio", paymentStatus: "pending_payment", bookingStatus: "cancelled" });

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "pending_payment");
});

test("B20: a package_credit-mode booking cannot be confirmed as cash paid, payment_records stays nonexistent", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBookingWithMode(run, "b20", { paymentMode: "package_credit", paymentStatus: "not_required" });

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "not_required");
  assert.equal(await paymentRecordCountForBooking(id), 0, "no payment_records row for a package_credit booking");
});

test("B21: a free-mode booking remains rejected", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBookingWithMode(run, "b21", { paymentMode: "free", paymentStatus: "not_required" });

  const res = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "not_required");
});

// ─── B22: student (non-admin) cannot call this route ───────────────────────

test("B22: a student (not admin) cannot call PATCH /bookings/:id at all", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, studentId, studentEmail } = await makeCanonicalPendingBooking(run, "b22");
  const token = studentToken(studentId, studentEmail);

  const res = await fetch(apiUrl(`/api/bookings/${id}`), {
    method: "PATCH",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ paymentStatus: "paid", confirmedPaymentMethod: "cash" }),
  });
  assert.ok(res.status === 401 || res.status === 403, `expected 401/403 for a student calling the Admin-only route, got ${res.status}`);
  assert.equal((await bookingRow(id)).paymentStatus, "pending_payment", "the booking must remain unchanged");
});

// ─── B24: missing confirmedPaymentMethod on paymentStatus:"paid" ───────────

test("B24: sending paymentStatus:'paid' WITHOUT confirmedPaymentMethod returns 400, zero writes", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id, paymentRecordId } = await makeCanonicalPendingBooking(run, "b24");

  const res = await confirmPaid(id, {});
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).code, "CONFIRMED_PAYMENT_METHOD_REQUIRED");

  assert.equal((await bookingRow(id)).paymentStatus, "pending_payment");
  assert.equal((await paymentRecordForBooking(id))!.status, "pending_confirmation");
  assert.equal(await paymentEventCount(paymentRecordId, "confirmed"), 0);
});

test("B24b: an invalid confirmedPaymentMethod value also returns 400 CONFIRMED_PAYMENT_METHOD_REQUIRED", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b24b");

  const res = await confirmPaid(id, { confirmedPaymentMethod: "bitcoin" });
  assert.equal(res.status, 400);
  assert.equal((await jsonBody(res)).code, "CONFIRMED_PAYMENT_METHOD_REQUIRED");
  assert.equal((await bookingRow(id)).paymentStatus, "pending_payment");
});

// ─── B25: no second payment_records row is ever created ───────────────────

test("B25: no second payment_records row is ever created across the confirmation lifecycle (count stays 1)", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeCanonicalPendingBooking(run, "b25");
  assert.equal(await paymentRecordCountForBooking(id), 1);

  await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(await paymentRecordCountForBooking(id), 1);

  const retry = await confirmPaid(id, { confirmedPaymentMethod: "cash" });
  assert.equal(retry.status, 409);
  assert.equal(await paymentRecordCountForBooking(id), 1);
});
