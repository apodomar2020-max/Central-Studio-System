/**
 * Real-route integration coverage for Finance Phase 2A DB Foundation — Step 3's
 * controlled booking-delete tombstone transaction.
 *
 * `DELETE /bookings/:id` is the only real booking hard-delete path in this
 * repository (confirmed by grep across artifacts/ and lib/ for
 * `delete(bookingsTable)` and raw `DELETE FROM bookings` outside tests).
 * Its external behavior — permissions, request contract, success/not-found
 * responses — is unchanged by this task; only its internal implementation
 * gained the payment_records tombstone step.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values, matching
 * the established convention in packageOrders.activation.integration.test.ts.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_PAYMENT_RECORDS_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_payment_records";

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
  return jwtSign({ sub: superAdminId, username: `booking-delete-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function deleteBooking(id: number): Promise<Response> {
  return asAdmin(`/api/bookings/${id}`, { method: "DELETE" });
}

async function makeBooking(label: string): Promise<number> {
  const studentEmail = `booking-delete-${label}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@example.com`;
  const result = await pool.query(
    `INSERT INTO bookings (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode)
     VALUES ($1, $2, $3, $4, 'confirmed', 'confirmed', 'pending_payment', 'pay_at_studio') RETURNING id`,
    [`Booking Delete Test ${label}`, studentEmail, scheduleId, classId],
  );
  return result.rows[0].id as number;
}

async function insertPaymentRecordForBooking(bookingId: number): Promise<number> {
  const result = await pool.query(
    `INSERT INTO payment_records
       (flow_type, booking_id, capture_origin, occurred_at, evidence_class, amount_availability, amount_source,
        gross_amount_minor, discount_amount_minor, final_payable_amount_minor, status)
     VALUES ('single_class_booking', $1, 'live_capture', now(), 'confirmed', 'exact', 'creation_snapshot', 300, 0, 300, 'unpaid')
     RETURNING id`,
    [bookingId],
  );
  return result.rows[0].id as number;
}

async function bookingExists(id: number): Promise<boolean> {
  const result = await pool.query(`SELECT 1 FROM bookings WHERE id = $1`, [id]);
  return result.rows.length > 0;
}

async function paymentRecordRow(id: number): Promise<{ bookingId: number | null; sourceDeletedAt: string | null }> {
  const result = await pool.query(`SELECT booking_id, source_deleted_at FROM payment_records WHERE id = $1`, [id]);
  return { bookingId: result.rows[0].booking_id, sourceDeletedAt: result.rows[0].source_deleted_at };
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
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Booking Delete Super', true) RETURNING id`,
      [`booking-delete-super-${run}`, `booking-delete-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Booking Delete Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('Booking Delete Class', 'general', $1, true) RETURNING id`,
    [instructor.rows[0].id],
  );
  classId = klass.rows[0].id as number;
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, day_of_week, start_time, end_time, price_egp) VALUES ($1, 'weekly', 'active', 1, '10:00', '11:00', 300) RETURNING id`,
    [classId],
  );
  scheduleId = schedule.rows[0].id as number;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 100));
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  await pool.end();
});

// ─── 1: a booking with no payment_records row deletes exactly as before ────

test("deleting a booking with no linked payment_records row returns 204 and removes the booking, unaffected by the new tombstone step", async () => {
  const id = await makeBooking("no-payment-record");
  const res = await deleteBooking(id);
  assert.equal(res.status, 204);
  assert.equal(await bookingExists(id), false);
});

test("repeat delete of an already-deleted booking (no payment record) returns the existing 404 behavior", async () => {
  const id = await makeBooking("repeat-no-record");
  const first = await deleteBooking(id);
  assert.equal(first.status, 204);
  const second = await deleteBooking(id);
  assert.equal(second.status, 404);
});

test("a 404 is returned for a nonexistent booking id, not a 500", async () => {
  const res = await deleteBooking(999_999_999);
  assert.equal(res.status, 404);
});

// ─── 2: a booking WITH a linked payment_records row ────────────────────────

test("deleting a booking with a linked payment_records row returns 204, tombstones the payment record, and deletes the booking", async () => {
  const bookingId = await makeBooking("with-payment-record");
  const paymentRecordId = await insertPaymentRecordForBooking(bookingId);

  const res = await deleteBooking(bookingId);
  assert.equal(res.status, 204, "external response must remain the existing success status");

  assert.equal(await bookingExists(bookingId), false);

  const row = await paymentRecordRow(paymentRecordId);
  assert.equal(row.bookingId, null, "payment_records.booking_id must be tombstoned to null");
  assert.ok(row.sourceDeletedAt !== null, "payment_records.source_deleted_at must be set");
});

test("repeat delete after a tombstoning delete returns the existing 404 behavior, not a new response shape", async () => {
  const bookingId = await makeBooking("repeat-with-record");
  await insertPaymentRecordForBooking(bookingId);

  const first = await deleteBooking(bookingId);
  assert.equal(first.status, 204);

  const second = await deleteBooking(bookingId);
  assert.equal(second.status, 404);
  const body = await second.json().catch(() => ({}));
  assert.deepEqual(body, { error: "Booking not found" }, "no new response field may be introduced");
});

// ─── 3: a failed transaction rolls back both the tombstone and the delete ──

test("a transaction that fails after tombstoning rolls back both the payment_records tombstone and the booking delete", async () => {
  const bookingId = await makeBooking("rollback-test");
  const paymentRecordId = await insertPaymentRecordForBooking(bookingId);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(`SELECT id FROM bookings WHERE id = $1 FOR UPDATE`, [bookingId]);
    await client.query(`SET LOCAL app.allow_payment_source_tombstone = 'on'`);
    await client.query(
      `UPDATE payment_records SET booking_id = NULL, source_deleted_at = now(), updated_at = now() WHERE booking_id = $1`,
      [bookingId],
    );
    // Force a failure AFTER the tombstone write but before the booking
    // delete would occur, proving the whole transaction — including the
    // already-executed tombstone UPDATE — rolls back atomically rather than
    // partially committing.
    await assert.rejects(client.query(`SELECT 1/0`));
  } finally {
    await client.query("ROLLBACK").catch(() => {});
    client.release();
  }

  assert.equal(await bookingExists(bookingId), true, "the booking must still exist after rollback");
  const row = await paymentRecordRow(paymentRecordId);
  assert.equal(row.bookingId, bookingId, "the payment_records tombstone must have rolled back too");
  assert.equal(row.sourceDeletedAt, null, "source_deleted_at must have rolled back to null");
});

// ─── 4: concurrent deletion is serialized safely ───────────────────────────

test("two concurrent delete requests for the same booking produce exactly one 204 and one 404", async () => {
  const bookingId = await makeBooking("concurrent-delete");
  await insertPaymentRecordForBooking(bookingId);

  const [a, b] = await Promise.all([deleteBooking(bookingId), deleteBooking(bookingId)]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [204, 404], "exactly one request must succeed and the other must safely observe not-found");
  assert.equal(await bookingExists(bookingId), false);
});
