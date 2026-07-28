/**
 * Phase D closure: prove that the package-order row lock serializes two
 * different occurrences competing for the same participant's final credit.
 *
 * This intentionally uses the real Express route, auth middleware, Drizzle
 * transaction, and PostgreSQL database. The occurrence uniqueness constraint
 * cannot decide this race because each request targets a different schedule.
 */
import assert from "node:assert/strict";
import { after, before, test } from "node:test";

const DATABASE_URL = process.env.DISPOSABLE_LAST_CREDIT_DATABASE_URL
  ?? "postgresql://abdelrahmanomar@127.0.0.1:5432/central_studio_disposable_last_credit";

function assertDisposableUrl(databaseUrl: string): void {
  const url = new URL(databaseUrl);
  if (url.hostname !== "127.0.0.1" && url.hostname !== "localhost") {
    throw new Error(`Refusing: DATABASE_URL host "${url.hostname}" is not local`);
  }
  if (!/disposable|local|test/i.test(url.pathname)) {
    throw new Error(`Refusing: database name "${url.pathname}" is not disposable`);
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

let app: import("express").Express;
let server: import("node:http").Server;
let pool: typeof import("@workspace/db").pool;
let port: number;
let jwtSign: (payload: object, secret: string, opts?: object) => string;

function apiUrl(path: string): string {
  return `http://127.0.0.1:${port}${path}`;
}

function studentToken(id: number, email: string): string {
  return jwtSign(
    { sub: id, email, type: "student", emailVerified: true },
    process.env.STUDENT_JWT_SECRET!,
  );
}

async function postBooking(token: string, body: Record<string, unknown>): Promise<Response> {
  return fetch(apiUrl("/api/bookings"), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}

async function jsonBody(response: Response): Promise<Record<string, unknown>> {
  return response.json().catch(() => ({})) as Promise<Record<string, unknown>>;
}

before(async () => {
  const express = (await import("express")).default;
  jwtSign = (await import("jsonwebtoken")).default.sign;
  const { requireAuth } = await import("../middlewares/auth");
  const bookingsRouter = (await import("./bookings")).default;
  pool = (await import("@workspace/db")).pool;

  app = express();
  app.use(express.json());
  app.use("/api", requireAuth);
  app.use("/api", bookingsRouter);
  await new Promise<void>((resolve) => {
    server = app.listen(0, "127.0.0.1", () => resolve());
  });
  port = (server.address() as import("node:net").AddressInfo).port;
});

after(async () => {
  await new Promise((resolve) => setTimeout(resolve, 50));
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  await pool.end();
});

test("12 races: different occurrences competing for one final participant credit produce one booking and one deduction", async (t) => {
  const winnerScheduleIndexes = new Set<number>();

  for (let iteration = 0; iteration < 12; iteration += 1) {
    const run = `${Date.now()}-${iteration}-${Math.random().toString(36).slice(2, 8)}`;
    const email = `last-credit-${run}@example.com`;
    const student = await pool.query(
      `INSERT INTO students
        (name, email, phone, account_type, date_of_birth, email_verified)
       VALUES ($1, $2, '0100000000', 'student', '1990-01-01', true)
       RETURNING id`,
      [`Last Credit ${run}`, email],
    );
    const studentId = student.rows[0].id as number;
    const instructor = await pool.query(
      `INSERT INTO instructors (name, is_active) VALUES ($1, true) RETURNING id`,
      [`Last Credit Instructor ${run}`],
    );
    const klass = await pool.query(
      `INSERT INTO classes
        (title, category, instructor_id, is_active, capacity, allow_all_ages)
       VALUES ($1, 'general', $2, true, 10, true)
       RETURNING id`,
      [`Last Credit Class ${run}`, instructor.rows[0].id],
    );
    const classId = klass.rows[0].id as number;
    const schedules = await pool.query(
      `INSERT INTO schedules
        (class_id, type, status, date, start_time, end_time, package_eligible)
       VALUES
        ($1, 'one_time', 'active', CURRENT_DATE, '00:00', '11:00', true),
        ($1, 'one_time', 'active', CURRENT_DATE, '12:00', '23:59', true)
       RETURNING id`,
      [classId],
    );
    const scheduleIds = schedules.rows.map((row) => row.id as number);
    assert.equal(scheduleIds.length, 2);
    assert.notEqual(scheduleIds[0], scheduleIds[1]);

    const pricePackage = await pool.query(
      `INSERT INTO price_packages
        (name, type, price_egp, sessions, validity_months, is_active, allow_all_ages)
       VALUES ($1, 'per_class', 1000, 1, 6, true, true)
       RETURNING id`,
      [`Final Credit Package ${run}`],
    );
    const order = await pool.query(
      `INSERT INTO package_orders
        (student_name, student_email, student_id, participant_type, package_id,
         package_name, total_credits, remaining_credits, status, expires_at)
       VALUES ($1, $1, $2, 'self', $3, $4, 1, 1, 'active', now() + interval '1 year')
       RETURNING id`,
      [email, studentId, pricePackage.rows[0].id, `Final Credit Package ${run}`],
    );
    const packageOrderId = order.rows[0].id as number;
    await pool.query(
      `INSERT INTO credit_transactions
        (package_order_id, student_id, participant_type, type, delta,
         balance_before, balance_after, created_by)
       VALUES ($1, $2, 'self', 'package_activated', 1, 0, 1, 'test')`,
      [packageOrderId, studentId],
    );

    const token = studentToken(studentId, email);
    const bodyFor = (scheduleId: number) => ({
      studentName: email,
      studentEmail: email,
      participantType: "self",
      classId,
      scheduleId,
      paymentMode: "package_credit",
      packageOrderId,
    });

    const responses = await Promise.all([
      postBooking(token, bodyFor(scheduleIds[0])),
      postBooking(token, bodyFor(scheduleIds[1])),
    ]);
    const statuses = responses.map((response) => response.status).sort((a, b) => a - b);
    assert.deepEqual(statuses, [201, 409], `iteration ${iteration}: exactly one request must spend the credit`);

    const loser = responses.find((response) => response.status === 409)!;
    const loserBody = await jsonBody(loser);
    assert.equal(loserBody.code, "PACKAGE_NO_CREDITS");

    const packageState = await pool.query(
      `SELECT remaining_credits, status FROM package_orders WHERE id = $1`,
      [packageOrderId],
    );
    assert.equal(packageState.rows[0].remaining_credits, 0);
    assert.equal(packageState.rows[0].status, "fullyUsed");

    const bookings = await pool.query(
      `SELECT id, schedule_id, participant_type, participant_child_id, package_order_id,
              payment_mode, booking_status
         FROM bookings
        WHERE account_owner_student_id = $1`,
      [studentId],
    );
    assert.equal(bookings.rowCount, 1, "the losing transaction must leave no booking");
    assert.equal(bookings.rows[0].participant_type, "self");
    assert.equal(bookings.rows[0].participant_child_id, null);
    assert.equal(bookings.rows[0].package_order_id, packageOrderId);
    assert.equal(bookings.rows[0].payment_mode, "package_credit");
    assert.ok(scheduleIds.includes(bookings.rows[0].schedule_id));
    winnerScheduleIndexes.add(scheduleIds.indexOf(bookings.rows[0].schedule_id));

    const deductions = await pool.query(
      `SELECT delta, balance_before, balance_after, booking_id, package_order_id,
              participant_type, participant_child_id
         FROM credit_transactions
        WHERE package_order_id = $1 AND type = 'booking_deduction'`,
      [packageOrderId],
    );
    assert.equal(deductions.rowCount, 1);
    assert.equal(deductions.rows[0].delta, -1);
    assert.equal(deductions.rows[0].balance_before, 1);
    assert.equal(deductions.rows[0].balance_after, 0);
    assert.equal(deductions.rows[0].booking_id, bookings.rows[0].id);
    assert.equal(deductions.rows[0].package_order_id, packageOrderId);
    assert.equal(deductions.rows[0].participant_type, "self");
    assert.equal(deductions.rows[0].participant_child_id, null);

    const sideEffects = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM payment_records WHERE booking_id = ANY($1::int[])) AS payment_records,
         (SELECT count(*)::int
            FROM payment_events pe
            JOIN payment_records pr ON pr.id = pe.payment_record_id
           WHERE pr.booking_id = ANY($1::int[])) AS payment_events,
         (SELECT count(*)::int FROM notifications WHERE target = $2) AS notifications,
         (SELECT count(*)::int FROM promotion_redemptions WHERE student_id = $3) AS promotions`,
      [bookings.rows.map((row) => row.id), `student:${studentId}`, studentId],
    );
    assert.equal(sideEffects.rows[0].payment_records, 0);
    assert.equal(sideEffects.rows[0].payment_events, 0);
    assert.equal(sideEffects.rows[0].notifications, 1, "only the committed booking creates a notification");
    assert.equal(sideEffects.rows[0].promotions, 0);

    const capacity = await pool.query(
      `SELECT schedule_id, count(*)::int AS reserved
         FROM bookings
        WHERE account_owner_student_id = $1
          AND booking_status IN ('pending', 'confirmed')
        GROUP BY schedule_id`,
      [studentId],
    );
    assert.equal(capacity.rowCount, 1);
    assert.equal(capacity.rows[0].reserved, 1);
  }

  assert.ok(winnerScheduleIndexes.size >= 1, "the test must not assume a particular winning occurrence");
  t.diagnostic(`winning request indexes observed: ${[...winnerScheduleIndexes].sort().join(", ")}`);
});
