import assert from "node:assert/strict";
import { after, before, mock, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_ATTENDANCE_DATABASE_URL
  ?? "postgresql://postgres@127.0.0.1:5612/central_studio_disposable_attendance";
const url = new URL(DATABASE_URL);
if (!["127.0.0.1", "localhost"].includes(url.hostname) || !/disposable|test|local/i.test(url.pathname)) {
  throw new Error("Refusing to run QR attendance tests outside a disposable local database.");
}
process.env.DATABASE_URL = DATABASE_URL;
delete process.env.REDIS_URL;

let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let adminId: number;
let jwtSign: (payload: object, secret: string, options?: object) => string;
let student: { id: number; email: string; qrToken: string };
let packageOrderId: number;

function adminToken(): string {
  return jwtSign(
    { sub: adminId, username: `phase-e-admin-${adminId}`, isSuperAdmin: true, roleId: null },
    "dev-admin-secret-change-in-production",
  );
}

async function request(body: Record<string, unknown>): Promise<Response> {
  return fetch(`http://127.0.0.1:${port}/api/check-in/qr`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": "test-api-secret-key",
      "x-admin-token": adminToken(),
    },
    body: JSON.stringify(body),
  });
}

async function createPackageBooking(label: string): Promise<number> {
  const klass = await pool.query(
    `INSERT INTO classes (title, category, is_active)
     VALUES ($1, 'general', true) RETURNING id`,
    [`${label} ${Date.now()} ${Math.random()}`],
  );
  const schedule = await pool.query(
    `INSERT INTO schedules (class_id, type, status, date, start_time, end_time, package_eligible)
     VALUES ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '23:59', true) RETURNING id`,
    [klass.rows[0].id],
  );
  const booking = await pool.query(
    `INSERT INTO bookings
      (student_name, student_email, account_owner_student_id, participant_type, booking_scope,
       schedule_id, class_id, occurrence_date, payment_mode, package_order_id, status, booking_status)
     VALUES ($1, $2, $3, 'self', 'self', $4, $5, CURRENT_DATE,
       'package_credit', $6, 'confirmed', 'confirmed') RETURNING id`,
    [label, student.email, student.id, schedule.rows[0].id, klass.rows[0].id, packageOrderId],
  );
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, type, delta, balance_before,
       balance_after, reference_id, reference_type, booking_id, created_by)
     VALUES ($1, $2, 'self', 'booking_deduction', -1, 4, 3, $3, 'booking', $3, 'test')`,
    [packageOrderId, student.id, booking.rows[0].id],
  );
  return booking.rows[0].id as number;
}

before(async () => {
  mock.module("../lib/pushNotifications", {
    namedExports: {
      sendPushNotification: async () => ({ sent: 0, failed: 0, skipped: true, reason: "push_disabled" as const }),
      sendBroadcastPushNotification: async () => ({ sent: 0, failed: 0 }),
    },
  });
  const express = (await import("express")).default;
  jwtSign = (await import("jsonwebtoken")).default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const checkInRouter = (await import("./checkIn")).default;
  const dbModule = await import("@workspace/db");
  pool = dbModule.pool;

  const app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", checkInRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;

  const run = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const admin = await pool.query(
    `INSERT INTO system_users (username, email, password_hash, full_name, is_super_admin)
     VALUES ($1, $2, 'x', 'Phase E Admin', true) RETURNING id`,
    [`phase-e-${run}`, `phase-e-${run}@example.com`],
  );
  adminId = admin.rows[0].id;
  const account = await pool.query(
    `INSERT INTO students (name, email, phone, account_type, email_verified)
     VALUES ('Phase E Student', $1, '01098765432', 'student', true)
     RETURNING id, email, qr_token`,
    [`phase-e-student-${run}@example.com`],
  );
  student = {
    id: account.rows[0].id,
    email: account.rows[0].email,
    qrToken: account.rows[0].qr_token,
  };
  const pkg = await pool.query(
    `INSERT INTO price_packages (name, type, price_egp, sessions, validity_months, is_active)
     VALUES ('Phase E QR Package', 'per_class', 1000, 4, 6, true) RETURNING id`,
  );
  const order = await pool.query(
    `INSERT INTO package_orders
      (student_name, student_email, student_id, package_id, package_name, total_credits,
       remaining_credits, status, participant_type)
     VALUES ('Phase E Student', $1, $2, $3, 'Phase E QR Package', 4, 3, 'active', 'self')
     RETURNING id`,
    [student.email, student.id, pkg.rows[0].id],
  );
  packageOrderId = order.rows[0].id;
  await pool.query(
    `INSERT INTO credit_transactions
      (package_order_id, student_id, participant_type, type, delta, balance_before, balance_after, created_by)
     VALUES ($1, $2, 'self', 'package_activated', 4, 0, 4, 'test')`,
    [packageOrderId, student.id],
  );
});

after(async () => {
  mock.reset();
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  await pool.end();
});

test("QR attendance returns the booking participant and never deducts a second credit", async () => {
  const bookingId = await createPackageBooking("Phase E QR Self");
  const response = await request({
    qrToken: student.qrToken,
    bookingId,
    paymentMode: "package_credit",
    packageOrderId,
  });
  assert.equal(response.status, 201);
  const body = await response.json() as Record<string, unknown>;
  assert.equal(body.participantType, "self");
  assert.equal(body.creditDeducted, false);
  assert.equal(body.paymentSource, "booking_package_credit");
  const [order, ledger, attendance] = await Promise.all([
    pool.query(`SELECT remaining_credits FROM package_orders WHERE id = $1`, [packageOrderId]),
    pool.query(
      `SELECT count(*)::int AS n FROM credit_transactions
       WHERE booking_id = $1 AND type = 'attendance_deduction'`,
      [bookingId],
    ),
    pool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [bookingId]),
  ]);
  assert.equal(order.rows[0].remaining_credits, 3);
  assert.equal(ledger.rows[0].n, 0);
  assert.equal(attendance.rows[0].n, 1);
});

test("two simultaneous QR scans create one attendance and no additional deduction", async () => {
  const bookingId = await createPackageBooking("Phase E QR Race");
  const payload = {
    qrToken: student.qrToken,
    bookingId,
    paymentMode: "package_credit",
    packageOrderId,
  };
  const [first, second] = await Promise.all([request(payload), request(payload)]);
  assert.deepEqual([first.status, second.status].sort((a, b) => a - b), [201, 409]);
  const attendance = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [bookingId]);
  assert.equal(attendance.rows[0].n, 1);
});

test("an invalid QR is rejected before attendance is written", async () => {
  const bookingId = await createPackageBooking("Phase E Invalid QR");
  const response = await request({
    qrToken: "00000000-0000-4000-8000-000000000000",
    bookingId,
    paymentMode: "package_credit",
    packageOrderId,
  });
  assert.equal(response.status, 404);
  const attendance = await pool.query(`SELECT count(*)::int AS n FROM attendance WHERE booking_id = $1`, [bookingId]);
  assert.equal(attendance.rows[0].n, 0);
});
