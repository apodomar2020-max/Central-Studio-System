/**
 * Real-route integration coverage for the Pre-Phase-2 Payment Integrity
 * Hotfix's booking payment-confirmation guard.
 *
 * Safety gate: refuses non-local/non-disposable DATABASE_URL values. Boots
 * the actual Express router and real admin auth middleware over HTTP; never
 * calls route-internal helpers directly, matching the established convention
 * in adminBalletMultipleSchedules.integration.test.ts.
 *
 * `PATCH /bookings/:id` is a general-purpose update endpoint (schedule,
 * notes, status, payment status, …), not a dedicated "confirm payment"
 * action, so these tests exercise it exactly as the Admin UI does: a PATCH
 * whose body happens to set paymentStatus:"paid".
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

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
process.env.API_SECRET_KEY = "test-api-secret-key";
delete process.env.REDIS_URL;
delete process.env.PUSH_NOTIFICATIONS_ENABLED;

const ADMIN_JWT_SECRET = "dev-admin-secret-change-in-production";

let app: import("express").Express;
let server: import("node:http").Server;
let pool: import("pg").Pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;
let superAdminId: number;
let classId: number;
let scheduleId: number;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function adminToken(): string {
  return jwtSign({ sub: superAdminId, username: `booking-confirm-super-${superAdminId}`, isSuperAdmin: true, roleId: null }, ADMIN_JWT_SECRET);
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

async function confirmPaid(id: number): Promise<Response> {
  return asAdmin(`/api/bookings/${id}`, { method: "PATCH", body: JSON.stringify({ paymentStatus: "paid" }) });
}

async function bookingRow(id: number): Promise<{ paymentStatus: string; bookingStatus: string; paymentMode: string | null; notes: string | null }> {
  const result = await pool.query(
    `SELECT payment_status, booking_status, payment_mode, notes FROM bookings WHERE id = $1`,
    [id],
  );
  return {
    paymentStatus: result.rows[0].payment_status,
    bookingStatus: result.rows[0].booking_status,
    paymentMode: result.rows[0].payment_mode,
    notes: result.rows[0].notes,
  };
}

/** Creates a fresh booking with the given paymentMode/paymentStatus/bookingStatus. */
async function makeBooking(
  run: string,
  label: string,
  opts: { paymentMode: string; paymentStatus: string; bookingStatus?: string; notes?: string },
): Promise<{ id: number }> {
  const studentEmail = `booking-confirm-${run}-${label}@example.com`;
  const booking = await pool.query(
    `INSERT INTO bookings
       (student_name, student_email, schedule_id, class_id, status, booking_status, payment_status, payment_mode, notes)
     VALUES ($1, $2, $3, $4, 'confirmed', $5, $6, $7, $8)
     RETURNING id`,
    [
      `Booking Confirm Test ${label}`,
      studentEmail,
      scheduleId,
      classId,
      opts.bookingStatus ?? "confirmed",
      opts.paymentStatus,
      opts.paymentMode,
      opts.notes ?? null,
    ],
  );
  return { id: booking.rows[0].id as number };
}

before(async () => {
  const expressModule = await import("express");
  const express = expressModule.default;
  const jwtModule = await import("jsonwebtoken");
  jwtSign = jwtModule.default.sign;
  const { requireAuth } = await import("../middlewares/auth.ts");
  const bookingsRouter = (await import("./bookings.ts")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const existingSuper = await pool.query(`SELECT id FROM system_users WHERE is_super_admin = true LIMIT 1`);
  if (existingSuper.rows.length > 0) {
    superAdminId = existingSuper.rows[0].id as number;
  } else {
    const superAdmin = await pool.query(
      `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
       VALUES ($1, $2, 'x', 'Booking Confirm Super', true) RETURNING id`,
      [`booking-confirm-super-${run}`, `booking-confirm-super-${run}@example.com`],
    );
    superAdminId = superAdmin.rows[0].id as number;
  }

  const instructor = await pool.query(`INSERT INTO instructors (name, is_active) VALUES ('Booking Confirm Instructor', true) RETURNING id`);
  const klass = await pool.query(
    `INSERT INTO classes (title, category, instructor_id, is_active) VALUES ('Booking Confirm Class', 'general', $1, true) RETURNING id`,
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

// ─── 1: valid confirmation ───────────────────────────────────────────────

test("a valid unpaid monetary (pay_at_studio) booking can be marked paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "valid", { paymentMode: "pay_at_studio", paymentStatus: "pending_payment" });

  const res = await confirmPaid(id);
  assert.equal(res.status, 200);
  const body = await jsonBody(res);
  assert.equal(body.paymentStatus, "paid");
  assert.equal((await bookingRow(id)).paymentStatus, "paid");
});

test("a failed online_payment booking can be reconfirmed as paid after a successful retry", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "retry", { paymentMode: "online_payment", paymentStatus: "failed" });

  const res = await confirmPaid(id);
  assert.equal(res.status, 200);
  assert.equal((await bookingRow(id)).paymentStatus, "paid");
});

// ─── 2: repeated confirmation ─────────────────────────────────────────────

test("repeated confirmation of an already-paid booking is rejected, not silently re-applied", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "repeat", { paymentMode: "pay_at_studio", paymentStatus: "pending_payment" });

  const first = await confirmPaid(id);
  assert.equal(first.status, 200);

  const second = await confirmPaid(id);
  assert.equal(second.status, 409);
  const body = await jsonBody(second);
  assert.equal(body.code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "paid", "still paid — the rejected retry must not corrupt state");
});

// ─── 3: concurrency ───────────────────────────────────────────────────────

test("two concurrent confirmation attempts on the same booking produce exactly one transition", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "concurrent", { paymentMode: "pay_at_studio", paymentStatus: "pending_payment" });

  const [a, b] = await Promise.all([confirmPaid(id), confirmPaid(id)]);
  const statuses = [a.status, b.status].sort((x, y) => x - y);
  assert.deepEqual(statuses, [200, 409], "exactly one request must succeed and the other must safely conflict");

  const loser = a.status === 409 ? a : b;
  assert.equal((await jsonBody(loser)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "paid");
});

// ─── 4: package-credit booking can never become paid-cash ───────────────────

test("a package-credit booking cannot be confirmed as cash paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "credit", { paymentMode: "package_credit", paymentStatus: "not_required" });

  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "not_required", "must remain not_required, never become paid");
});

// ─── 5: free booking can never become paid-cash ──────────────────────────────

test("a free booking cannot be confirmed as cash paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "free", { paymentMode: "free", paymentStatus: "not_required" });

  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "not_required");
});

// ─── 6: refunded / terminal bookings ──────────────────────────────────────

test("a refunded booking cannot be reconfirmed as paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "refunded", { paymentMode: "pay_at_studio", paymentStatus: "refunded" });

  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "refunded");
});

test("a cancelled booking cannot be confirmed as paid even if payment was still pending", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "cancelled", {
    paymentMode: "pay_at_studio",
    paymentStatus: "pending_payment",
    bookingStatus: "cancelled",
  });

  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
  assert.equal((await bookingRow(id)).paymentStatus, "pending_payment", "a rejected confirmation must not mutate state");
});

test("a rejected booking cannot be confirmed as paid", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "booking-rejected", {
    paymentMode: "pay_at_studio",
    paymentStatus: "pending_payment",
    bookingStatus: "rejected",
  });

  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  assert.equal((await jsonBody(res)).code, "PAYMENT_STATUS_NOT_CONFIRMABLE");
});

// ─── 7: unrelated fields survive a rejected confirmation unchanged ───────────

test("unrelated booking fields remain unchanged after a rejected confirmation attempt", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "unrelated-fields", {
    paymentMode: "package_credit",
    paymentStatus: "not_required",
    notes: "original note",
  });

  const before = await bookingRow(id);
  const res = await confirmPaid(id);
  assert.equal(res.status, 409);
  const afterRow = await bookingRow(id);
  assert.deepEqual(afterRow, before, "every field, including notes/paymentMode/bookingStatus, must be byte-for-byte unchanged");
});

test("unrelated booking fields survive a successful confirmation unchanged", async () => {
  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { id } = await makeBooking(run, "unrelated-fields-success", {
    paymentMode: "pay_at_studio",
    paymentStatus: "pending_payment",
    notes: "keep me",
  });

  const res = await confirmPaid(id);
  assert.equal(res.status, 200);
  const row = await bookingRow(id);
  assert.equal(row.notes, "keep me");
  assert.equal(row.paymentMode, "pay_at_studio");
});

test("a 404 is returned for a nonexistent booking, not a 500", async () => {
  const res = await confirmPaid(999_999_999);
  assert.equal(res.status, 404);
});
